/**
 * 시험지 PART II · III · V · VI 를 동시에 만들고, 받은 결과를 코드로 검사한다.
 *
 * 네 PART 는 서로 의존이 없어 기다릴 이유가 없다. 순차로 돌리면 네 배 걸린다.
 *
 * 규칙은 프롬프트로 걸지만 AI 가 늘 지키지는 않는다. 특히 PART III 의 어미 패턴 차단은
 * 어겨도 문장이 멀쩡해 보여서 눈으로는 놓치기 쉽다. 그래서 받은 뒤 여기서 다시 센다.
 * 검사는 막지 않고 알리기만 한다 — 고칠지는 화면에서 사람이 정한다.
 */

import { inflectionKey } from './duplicates.js'
import { apiBase } from './aiClient.js'
import { countWords, shuffleChoices } from './quizBuild.js'
import { isBeyondExamDistractor, storyPatternIssues, uniqueHint, STORY_OPENINGS, STORY_ENDINGS } from './quizRules.js'

export const QUIZ_PARTS = ['II', 'III', 'V', 'VI']

async function post(body) {
  // 브라우저는 같은 출처, node 점검 도구는 VOCA_API_BASE (aiClient 와 같은 규칙)
  const res = await fetch(`${apiBase()}/api/ai/quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({ error: '응답을 해석할 수 없습니다.' }))
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

/* ------------------------------------------------------------------ */
/* 재료 만들기 — rows 를 프롬프트가 기대하는 모양으로                    */
/* ------------------------------------------------------------------ */

const words = (list) => (list || []).map((d) => d.word).filter(Boolean)
const withPos = (list) => (list || []).map((d) => (d.pos ? `${d.word} (${d.pos})` : d.word)).filter(Boolean)

const basic = (row) => ({ id: row.id, headword: row.headword, pos: row.pos, meaning: row.meaning })

export function buildPayloads(parts, startNo = 31) {
  return {
    II: { items: parts.II.map(basic) },
    III: {
      derivative: parts.III.derivative.map((r) => ({ ...basic(r), derivatives: withPos(r.derivatives) })),
      synonym: parts.III.synonym.map((r) => ({ ...basic(r), synonyms: words(r.synonyms) })),
      antonym: parts.III.antonym.map((r) => ({ ...basic(r), antonyms: words(r.antonyms) })),
    },
    V: {
      items: parts.V.map((r) => ({ ...basic(r), synonyms: words(r.synonyms), antonyms: words(r.antonyms) })),
    },
    VI: {
      items: parts.VI.map(basic),
      startNo,
      // 이야기의 도입 · 마무리 틀을 매번 다르게 고른다 (Week 07~09 가 모두 같은 틀이었다)
      opening: Math.floor(Math.random() * STORY_OPENINGS.length),
      ending: Math.floor(Math.random() * STORY_ENDINGS.length),
    },
  }
}

/**
 * PART III 유의어 · 반의어 문항의 첫 글자 힌트를 정답 하나로 좁혀지게 늘린다.
 * 같은 관계가 되는 다른 말은 AI 가 rivals 에 적은 것과 단어장의 같은 칸 후보를 합쳐 본다.
 * 받은 결과를 고쳐 쓴다 — 화면과 docx 가 같은 힌트를 쓰도록.
 */
export function resolveHints(result, payload) {
  const candidates = new Map()
  for (const it of payload?.synonym || []) candidates.set(String(it.id), it.synonyms || [])
  for (const it of payload?.antonym || []) candidates.set(String(it.id), it.antonyms || [])
  for (const it of result?.items || []) {
    if (it.kind !== 'synonym' && it.kind !== 'antonym') continue
    const rivals = [...(Array.isArray(it.rivals) ? it.rivals : []), ...(candidates.get(String(it.id)) || [])]
    const { hint, clash, unique } = uniqueHint(it.answer, rivals)
    if (!hint) continue
    it.hint = hint
    it.hintClash = clash
    it.hintUnique = unique
  }
  return result
}

/* ------------------------------------------------------------------ */
/* 검사                                                                */
/* ------------------------------------------------------------------ */

/**
 * 파생 어미를 **계열**로 묶는다.
 *
 * 글자 그대로 비교하면 assumption(-ption)과 evolution(-ution)이 다른 어미로 보인다.
 * 하지만 학생 눈에는 둘 다 같은 -tion 명사화이고, 보기를 베끼는 것만으로 풀린다.
 * 명세가 `assume : assumption = perceive : perception` 을 막는 이유가 이것이다.
 * 그래서 철자가 아니라 파생 방식이 같은지를 본다.
 */
const FAMILY = [
  [/(?:ation|ition|ution|ption|ction|sion|tion)$/, '-tion 명사화'],
  [/(?:ability|ibility|ity|ety)$/, '-ity 명사화'],
  [/(?:ancy|ency|ance|ence)$/, '-ance 명사화'],
  [/ment$/, '-ment 명사화'],
  [/ness$/, '-ness 명사화'],
  [/(?:ship|hood|dom)$/, '-ship 명사화'],
  [/ism$/, '-ism 명사화'],
  [/(?:ist|er|or)$/, '행위자 명사'],
  [/age$/, '-age 명사화'],
  [/ure$/, '-ure 명사화'],
  [/(?:able|ible)$/, '-able 형용사'],
  [/ive$/, '-ive 형용사'],
  [/(?:ical|ic)$/, '-ic 형용사'],
  [/(?:ious|eous|ous)$/, '-ous 형용사'],
  [/ful$/, '-ful 형용사'],
  [/less$/, '-less 형용사'],
  [/(?:ary|ory)$/, '-ary 형용사'],
  [/(?:ize|ise|ify|ate|en)$/, '동사화'],
  [/(?:ally|ly)$/, '-ly 부사화'],
  [/y$/, '-y 파생'],
]

/** 어근이 3자 미만으로 남으면 어미로 보지 않는다 (age 자체가 -age 가 되는 것을 막는다). */
export function suffixOf(word) {
  const w = String(word || '').toLowerCase()
  for (const [re, family] of FAMILY) {
    const m = w.match(re)
    if (m && w.length - m[0].length >= 3) return family
  }
  return ''
}

function checkII(result, payload) {
  const issues = []
  const defs = result?.definitions || []
  if (defs.length !== payload.items.length) issues.push(`풀이가 ${defs.length}개 (${payload.items.length}개여야 함)`)

  for (const d of defs) {
    const n = countWords(d.definition)
    if (n < 8 || n > 24) issues.push(`${d.headword} — 풀이가 ${n}단어 (10~20 권장)`)
    const stem = String(d.headword || '').toLowerCase().slice(0, 5)
    if (stem && String(d.definition || '').toLowerCase().includes(stem)) {
      issues.push(`${d.headword} — 풀이에 표제어가 그대로 드러남`)
    }
  }

  const dw = result?.distractor?.word
  if (!dw) issues.push('distractor 가 없음')
  else if (defs.some((d) => inflectionKey(d.headword) === inflectionKey(dw))) {
    issues.push(`distractor(${dw}) 가 정답과 겹침`)
  }
  return issues
}

function checkIII(result) {
  const issues = []
  const items = result?.items || []
  if (items.length !== 5) issues.push(`문항이 ${items.length}개 (5개여야 함)`)

  const kinds = items.map((i) => i.kind)
  if (kinds.filter((k) => k === 'derivative').length !== 2) issues.push('파생어 문항이 2개가 아님')
  if (kinds.filter((k) => k === 'synonym').length !== 1) issues.push('유의어 문항이 1개가 아님')
  if (kinds.filter((k) => k === 'antonym').length !== 2) issues.push('반의어 문항이 2개가 아님')

  for (const it of items) {
    if (it.kind === 'derivative') {
      const a = suffixOf(it.right)
      const b = suffixOf(it.answer)
      // 어미가 같으면 보기를 베끼는 것만으로 풀린다 — 문항이 무의미해진다
      if (a && b && a === b) {
        issues.push(`${it.headword} — 보기(${it.right})와 정답(${it.answer})이 둘 다 ${a}`)
      }
      if (/ly$/i.test(it.answer || '')) issues.push(`${it.headword} — 정답이 단순 -ly 파생(${it.answer})`)
      if (it.hint) issues.push(`${it.headword} — 파생어 문항에는 첫 글자를 주지 않는다`)
    } else if (!it.hint) {
      issues.push(`${it.headword} — 첫 글자 힌트가 없음`)
    } else if (!String(it.answer || '').toLowerCase().startsWith(String(it.hint).toLowerCase())) {
      issues.push(`${it.headword} — 힌트(${it.hint})가 정답(${it.answer})의 앞부분과 다름`)
    } else if (it.hintUnique === false) {
      issues.push(`${it.headword} — 힌트를 늘려도 ${it.hintClash.join(', ')} 와(과) 갈리지 않음 (다른 정답으로 다시 만들 것)`)
    } else if (it.hint.length * 2 > String(it.answer).length) {
      issues.push(`${it.headword} — ${it.hintClash.join(', ')} 와(과) 갈리려면 힌트가 ${it.hint}___ 까지 길어짐`)
    }
  }
  return issues
}

function checkV(result) {
  const issues = []
  const items = result?.items || []
  if (items.length !== 5) issues.push(`문항이 ${items.length}개 (5개여야 함)`)

  const counts = []
  for (const it of items) {
    const n = countWords(it.sentence)
    if (n < 20 || n > 45) issues.push(`${n}단어 문장 (25~40 권장)`)
    const blanks = (String(it.sentence || '').match(/_{5,}/g) || []).length
    if (blanks !== 1) issues.push(`빈칸이 ${blanks}개인 문장이 있음`)
    if ((it.choices || []).length !== 5) issues.push(`선택지가 ${(it.choices || []).length}개인 문항이 있음`)
    const answers = it.answers || []
    if (!answers.length) issues.push('정답이 없는 문항이 있음')
    if (answers.some((n2) => n2 < 1 || n2 > 5)) issues.push('정답 번호가 1~5 범위를 벗어남')
    if ((it.clues || []).length < 2) issues.push(`문맥 단서가 ${(it.clues || []).length}개 (2개 이상 필요)`)
    counts.push(answers.length)

    // 선택지는 고3(수능) 수준까지 — 수능 범위를 넘는 드문 말로 짚어 둔 오답이 다시 나왔는지
    const wrong = (it.choices || []).filter((_, k) => !answers.includes(k + 1))
    const rare = wrong.filter(isBeyondExamDistractor)
    if (rare.length) issues.push(`오답 ${rare.join(', ')} — 수능 범위를 넘는 드문 말`)

    // 오답이 모두 반대 뜻이면 뜻의 방향만 보고 풀린다
    const roles = Array.isArray(it.roles) ? it.roles : []
    if (roles.length === 5) {
      const mismatch = roles.some((r, k) => (r === '정답') !== answers.includes(k + 1))
      if (mismatch) issues.push(`${(it.choices || []).join('/')} — 정답 번호와 선택지 표시(roles)가 어긋남`)
      const opposite = roles.filter((r) => r === '반대').length
      if (opposite > 2) issues.push(`오답 ${opposite}개가 반대 뜻 (많아야 2개)`)
    }
  }

  if (counts.length && new Set(counts).size < 2) {
    issues.push(`정답 개수가 ${counts.join('·')} 로 흩어지지 않음 (1~3개로 섞여야 함)`)
  }
  return issues
}

function checkVI(result, payload) {
  const issues = []
  const story = String(result?.story || '')
  const n = countWords(story.replace(/\{\d+\}/g, 'x'))
  if (n < 80 || n > 125) issues.push(`본문이 ${n}단어 (90~110 권장)`)

  const marks = story.match(/\{(\d+)\}/g) || []
  if (marks.length !== payload.items.length) issues.push(`본문의 빈칸 표시가 ${marks.length}개`)

  const blanks = result?.blanks || []
  if (blanks.length !== payload.items.length) issues.push(`정답이 ${blanks.length}개`)

  issues.push(...storyPatternIssues(story))

  // 빈칸이 한곳에 몰리지 않아야 한다
  const positions = marks.map((m) => story.indexOf(m))
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i] - positions[i - 1] < 40) {
      issues.push('빈칸이 서로 너무 가까움')
      break
    }
  }
  return issues
}

const CHECK = { II: checkII, III: checkIII, V: checkV, VI: checkVI }

/** PART 를 넘나드는 중복. 한 PART 안에서는 배정 단계에서 이미 막았다. */
function crossCheck(byPart) {
  const issues = []
  const seen = new Map()

  const note = (word, where) => {
    const key = inflectionKey(word)
    if (!key) return
    if (seen.has(key) && seen.get(key) !== where) {
      issues.push(`${word} — ${seen.get(key)} 와 ${where} 에 겹쳐 나옴`)
    } else {
      seen.set(key, where)
    }
  }

  const dw = byPart.II?.result?.distractor?.word
  if (dw) note(dw, 'PART II distractor')
  for (const it of byPart.III?.result?.items || []) note(it.answer, 'PART III 정답')
  for (const it of byPart.V?.result?.items || []) {
    for (const n of it.answers || []) note((it.choices || [])[n - 1], 'PART V 정답')
  }
  for (const b of byPart.VI?.result?.blanks || []) note(b.answer, 'PART VI 정답')

  return issues
}

/* ------------------------------------------------------------------ */
/* 실행                                                                */
/* ------------------------------------------------------------------ */

/**
 * 네 PART 를 동시에 만든다.
 * 하나가 실패해도 나머지는 살린다 — 다시 만들 때 성공한 것까지 버릴 이유가 없다.
 *
 * only 를 주면 그 PART 만 다시 만들고 나머지는 previous(지난 결과) 그대로 둔다.
 * 검사에 걸린 PART 하나 때문에 멀쩡한 셋까지 버리지 않게 한다.
 */
export async function generateQuizParts({ parts, model, effort, startNo = 31, onProgress, signal, only, previous }) {
  const targets = only?.length ? QUIZ_PARTS.filter((p) => only.includes(p)) : QUIZ_PARTS
  const fresh = buildPayloads(parts, startNo)
  // 다시 만들지 않는 PART 는 지난 재료를 그대로 둔다 (VI 의 도입 · 마무리 틀도)
  const payloads = previous?.payloads
    ? Object.fromEntries(QUIZ_PARTS.map((p) => [p, targets.includes(p) ? fresh[p] : previous.payloads[p] || fresh[p]]))
    : fresh
  const byPart = previous && only?.length ? { ...previous.byPart } : {}
  let done = 0

  const report = () => onProgress?.({ done, total: targets.length })
  report()

  await Promise.all(
    targets.map(async (part) => {
      if (signal?.aborted) return
      try {
        const { result, usage, durationMs } = await post({ part, payload: payloads[part], model, effort })
        if (part === 'III') resolveHints(result, payloads.III)
        byPart[part] = {
          result,
          usage,
          durationMs,
          issues: CHECK[part](result, payloads[part]),
        }
      } catch (err) {
        byPart[part] = { error: err.message, issues: [] }
      } finally {
        done += 1
        report()
      }
    })
  )

  // PART VI 보기는 정답 순서와 어긋나게 섞는다
  const viBlanks = byPart.VI?.result?.blanks || []
  const viChoices = shuffleChoices(viBlanks.map((b) => b.answer))

  return {
    byPart,
    payloads,
    choices: { VI: viChoices },
    crossIssues: crossCheck(byPart),
    failed: QUIZ_PARTS.filter((p) => byPart[p]?.error),
  }
}
