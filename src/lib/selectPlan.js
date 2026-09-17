/**
 * AI 자동 표제어 추출의 선별 규칙.
 *
 * 화면(Workspace)과 점검 도구(tools/select-diagnose.mjs)가 같은 코드를 쓰도록 여기에 모았다.
 * 네트워크 호출만 request 로 주입받고, 판단은 전부 이 파일 안에서 한다.
 *
 * 핵심은 두 단계다.
 *   1) 지문 분량에 비례한 쿼터를 먼저 정하고(planQuotas), 쿼터보다 넉넉히 후보를 모은다.
 *   2) 지문마다 자기 쿼터만큼 난이도 높은 순으로 채운 뒤(골고루),
 *      남은 자리를 지문 구분 없이 난이도 높은 순으로 채운다(어려운 것 우선).
 */

import { tokenize, locateSurface } from './tokenize.js'
import { sentenceAt } from './passages.js'
import { guessPos, guessLevel } from './posLite.js'
import { inflectionKey } from './duplicates.js'

/** 쿼터를 못 채운 지문에 다시 물어보는 최대 횟수 */
export const MAX_ROUNDS = 3

/** AI 난이도(1~5)를 표·집계에서 쓰는 상/중/하로 옮긴다. 값이 없으면 어림짐작으로 되돌아간다. */
export function levelOf(difficulty, surface) {
  if (difficulty >= 4) return '상'
  if (difficulty === 3) return '중'
  if (difficulty >= 1) return '하'
  return guessLevel(surface)
}

/**
 * 모아둔 후보에서 최종 표제어를 고른다.
 *
 * 자리 겹침과 굴절형 중복은 이 단계에서 걸러야 한다. 후보를 받을 때 거르면
 * 먼저 도착한 쪽이 이기지만, 여기서 거르면 같은 값일 때 난이도 높은 쪽이 살아남는다.
 */
export function pickByDifficulty({ passages, poolByNo, quotaByNo, needed, kept = [], drops }) {
  const chosen = []
  const takenKeys = new Set(kept.map((s) => inflectionKey(s.surface)).filter(Boolean))

  const accept = (c) => {
    const clash = [...kept, ...chosen].some(
      (s) => s.passageId === c.passage.id && s.start < c.hit.end && c.hit.start < s.end
    )
    if (clash) {
      drops.clash += 1
      return false
    }
    const key = inflectionKey(c.surface)
    if (key && takenKeys.has(key)) {
      drops.duplicate += 1
      return false
    }
    takenKeys.add(key)

    const sentence = sentenceAt(c.passage.english, c.hit.start)
    chosen.push({
      id: `ai${c.passage.id}_${c.hit.start}`,
      passageId: c.passage.id,
      passageNo: c.passage.no,
      passageLabel: c.passage.label,
      from: c.hit.from,
      to: c.hit.to,
      start: c.hit.start,
      end: c.hit.end,
      surface: c.surface,
      sentence,
      pos: guessPos(c.surface, sentence),
      level: levelOf(c.difficulty, c.surface),
      difficulty: c.difficulty,
      origin: 'ai',
    })
    return true
  }

  // 점수가 같으면 AI가 내놓은 지문 안 순서(order)를 따른다.
  // 지문에 나온 위치(hit.start)는 난이도와 아무 상관이 없어 기준이 되지 못한다.
  const hardestFirst = (a, b) =>
    b.difficulty - a.difficulty || a.order - b.order || a.passage.no - b.passage.no

  const leftovers = []
  for (const p of passages) {
    const quota = quotaByNo.get(p.no) || 0
    let got = 0
    for (const c of [...(poolByNo.get(p.no) || [])].sort(hardestFirst)) {
      if (got < quota && chosen.length < needed) {
        if (accept(c)) got += 1
        continue
      }
      leftovers.push(c)
    }
  }

  for (const c of leftovers.sort(hardestFirst)) {
    if (chosen.length >= needed) break
    accept(c)
  }

  return chosen
}

/**
 * 후보를 모아 최종 표제어를 고르는 전 과정.
 *
 * @param request ({ passages, quotas, exclude }) => Promise<items[]>  AI 호출을 주입한다
 * @param onStage 진행 상황 보고 — { round, shortCount } 또는 { group, groupCount }
 * @returns {{ added, rounds, drops, error }} 도중에 실패해도 그때까지 모은 것으로 골라 돌려준다
 */
export async function runSelection({ passages, quotas, needed, kept = [], request, onStage }) {
  const quotaByNo = new Map(passages.map((p, i) => [p.no, quotas[i]]))
  // 지문별 후보 주머니. 라운드를 거듭하며 쌓이고, 최종 선별은 다 모은 뒤 한 번에 한다.
  const poolByNo = new Map(passages.map((p) => [p.no, []]))
  // 같은 표현이 지문에 여러 번 나올 때 매번 다른 자리를 찾도록, 이미 잡은 자리를 기억한다.
  const takenStarts = new Map(
    passages.map((p) => [p.id, kept.filter((s) => s.passageId === p.id).map((s) => s.start)])
  )
  const tokensById = new Map()
  const exclude = new Set(kept.map((s) => s.surface.toLowerCase()))
  const drops = { notFound: 0, noPassage: 0, clash: 0, duplicate: 0 }
  let rounds = 0
  let error = null

  try {
    while (rounds < MAX_ROUNDS) {
      // 아직 쿼터만큼 후보를 못 모은 지문에만 다시 묻는다
      const short = []
      const shortQuotas = []
      for (const p of passages) {
        const deficit = (quotaByNo.get(p.no) || 0) - poolByNo.get(p.no).length
        if (deficit > 0) {
          short.push(p)
          shortQuotas.push(deficit)
        }
      }
      if (!short.length) break

      rounds += 1
      onStage?.({ round: rounds, shortCount: short.length })

      const items = await request({ passages: short, quotas: shortQuotas, exclude: [...exclude], onStage })
      if (!items?.length) break

      let fresh = 0
      for (const item of items) {
        const passage = passages.find((p) => p.no === Number(item.passageNo))
        if (!passage) {
          drops.noPassage += 1
          continue
        }
        if (!tokensById.has(passage.id)) tokensById.set(passage.id, tokenize(passage.english))
        const taken = takenStarts.get(passage.id)
        const hit = locateSurface(passage.english, tokensById.get(passage.id), item.surface, taken)
        if (!hit) {
          drops.notFound += 1
          continue
        }
        taken.push(hit.start)
        const surface = passage.english.slice(hit.start, hit.end)
        exclude.add(surface.toLowerCase())
        const pool = poolByNo.get(passage.no)
        pool.push({
          passage,
          hit,
          surface,
          // 난이도를 안 보내오면 0 — 정렬에서 뒤로 밀린다
          difficulty: Number(item.difficulty) || 0,
          // AI가 이 지문에서 몇 번째로 내놓았는지. 어려운 것부터 내놓으라고 일러두었다.
          order: pool.length,
        })
        fresh += 1
      }
      // 한 바퀴를 돌고도 새 후보가 하나도 없으면 더 물어봐야 소용없다
      if (!fresh) break
    }
  } catch (err) {
    // 중간까지 모은 후보는 살린다. 고르는 일은 아래에서 그대로 진행한다.
    error = err
  }

  const added = pickByDifficulty({ passages, poolByNo, quotaByNo, needed, kept, drops })
  return { added, rounds, drops, error }
}
