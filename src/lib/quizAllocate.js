/**
 * 시험지 6개 PART 에 표제어를 나눠 담는다.
 *
 * 두 가지 원칙만 지킨다.
 *   1. 조건이 까다로운 PART 가 먼저 가져간다 (IV → III → II → V → VI → I)
 *      늦게 배정되는 PART 일수록 아무 낱말이나 받아도 되기 때문이다.
 *   2. 한 번 쓴 말은 다시 쓰지 않는다. 비교는 굴절형 기준이라
 *      develop 을 쓴 뒤 developing 이 다른 PART 로 새어 나가지 않는다.
 *
 * AI 를 부르지 않는다. 여기서 나온 숫자를 보고 각 PART 가 성립하는지 먼저 판단한다.
 */

import { inflectionKey } from './duplicates.js'
import { isPhrase } from './tokenize.js'

/** 배정 순서대로. need 는 그 PART 가 필요로 하는 표제어 수. */
export const PARTS = [
  { key: 'IV', need: 5, label: '동사 형태 변형', why: '동사만 쓸 수 있고 형태까지 달라야 한다' },
  { key: 'III', need: 5, label: '어휘 관계 분석', why: '파생어·유의어·반의어를 가진 말이어야 한다' },
  { key: 'II', need: 5, label: '영영풀이 매칭', why: '품사를 형용사·부사로 통일해야 한다' },
  { key: 'V', need: 5, label: '복수 정답 유의어 변별', why: '유의어가 2개 있어야 한다' },
  { key: 'VI', need: 5, label: '지문형 빈칸 서사', why: '원형 그대로 넣으므로 어구는 쓰지 않는다' },
  { key: 'I', need: 10, label: '우리말 → 영어 쓰기', why: '어구를 우선 쓰고 남은 말로 채운다' },
]

/**
 * 지문에 나온 형태를 갈래로 나눈다. 구동사는 첫 낱말이 변하므로 그것만 본다.
 * 동명사와 현재분사, 과거와 과거분사는 문맥을 봐야 갈리므로 여기서 나누지 않는다 — AI 가 판정한다.
 */
export function verbForm(surface, headword) {
  const head = (t) => String(t || '').toLowerCase().trim().split(/\s+/)[0] || ''
  const s = head(surface)
  const h = head(headword)
  if (!s || !h) return 'base'
  if (s === h) return 'base'
  if (s === `${h}s` || s === `${h}es` || (h.endsWith('y') && s === `${h.slice(0, -1)}ies`)) return 'third'
  if (s.endsWith('ing')) return 'ing'
  if (s.endsWith('ed')) return 'ed'
  return 'irregular'
}

export const FORM_LABEL = {
  base: '원형',
  third: '3인칭 단수',
  ing: '-ing (동명사·현재분사)',
  ed: '-ed (과거·과거분사)',
  irregular: '불규칙 변화',
}

/**
 * 형태가 겹치지 않게 동사를 고른다.
 * 형태별로 한 개씩 돌아가며 담아, 후보가 넉넉하면 5문항이 모두 다른 형태가 된다.
 * 형태 가짓수가 모자라면 두 바퀴째부터 같은 형태가 섞인다 (명세가 허용하는 범위).
 *
 * 같은 표제어가 서로 다른 형태로 두 번 나올 수 있다(developed / developing).
 * 형태만 보고 뽑으면 둘 다 담기므로, 뽑는 순간에도 대장을 확인한다.
 */
function takeDiverseVerbs(candidates, need, ledger) {
  const byForm = new Map()
  for (const row of candidates) {
    const form = verbForm(row.surface, row.headword)
    if (!byForm.has(form)) byForm.set(form, [])
    byForm.get(form).push(row)
  }

  const picked = []
  while (picked.length < need) {
    let addedThisRound = false
    for (const list of byForm.values()) {
      if (picked.length >= need) break
      while (list.length) {
        const next = list.shift()
        const key = inflectionKey(next.headword)
        if (!key || ledger.has(key)) continue // 다른 형태로 이미 뽑힌 말
        ledger.add(key)
        picked.push(next)
        addedThisRound = true
        break
      }
    }
    if (!addedThisRound) break
  }
  return picked
}

const isPhraseRow = (row) => row.pos === '구' || isPhrase(row.surface || row.headword)
const countOf = (list) => (Array.isArray(list) ? list.length : 0)

/** 시드를 받는 난수 (mulberry32). 같은 시드면 같은 수열이 나와 배정을 다시 만들 수 있다. */
function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(list, seed) {
  const random = seededRandom(seed)
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * @param {Array} rows 확정된 단어장
 * @param {{seed?: number}} [options] 시드가 있으면 후보 순서를 섞어 다른 배정을 낸다.
 *   규칙(까다로운 PART 먼저, 굴절형 중복 금지)은 그대로이고 앞에서부터 훑는 순서만 바뀐다.
 *   없으면 단어장 순서 그대로다.
 * @returns {{parts, stats, shortages, ok}}
 */
export function allocate(rows, { seed } = {}) {
  // 고유명사는 출제 대상이 아니다
  const usable = (rows || []).filter((r) => r.headword && !r.properNoun)
  const pool = seed == null ? usable : shuffled(usable, seed)

  const ledger = new Set()

  /**
   * 조건에 맞는 것을 need 개까지 고르고 대장에 올린다.
   * 이미 오른 말과 굴절형이 겹치면 건너뛴다 — 한 번의 선택 안에서도 마찬가지다.
   * (같은 표제어가 societies / society 처럼 두 줄로 들어와 있을 수 있다)
   */
  const take = (fits, need) => {
    const picked = []
    for (const row of pool) {
      if (picked.length >= need) break
      if (!fits(row)) continue
      const key = inflectionKey(row.headword)
      if (!key || ledger.has(key)) continue
      ledger.add(key)
      picked.push(row)
    }
    return picked
  }

  const parts = {}

  // IV — 동사. 어구는 형태 변형 문항에 맞지 않아 제외한다
  parts.IV = takeDiverseVerbs(pool.filter((r) => r.pos === '동' && !isPhraseRow(r)), 5, ledger)

  // III — 파생 2 · 유의 1 · 반의 2. 세 갈래를 각각 채운다
  const derivative = take((r) => countOf(r.derivatives) >= 1, 2)
  const synonym = take((r) => countOf(r.synonyms) >= 1, 1)
  const antonym = take((r) => countOf(r.antonyms) >= 1, 2)
  parts.III = { derivative, synonym, antonym, all: [...derivative, ...synonym, ...antonym] }

  // II — 품사로 답을 추론하지 못하도록 형용사·부사로 통일
  parts.II = take((r) => r.pos === '형' || r.pos === '부', 5)

  // V — 유의어 2개. 반의어 보유는 조건이 아니다 (오답은 밖에서 조달해도 된다)
  parts.V = take((r) => countOf(r.synonyms) >= 2, 5)

  // VI — 보기 낱말을 원형 그대로 넣으므로 어구는 뺀다
  parts.VI = take((r) => !isPhraseRow(r), 5)

  // I — 어구를 먼저 담고 남은 자리는 아무 말로나 채운다
  const phrases = take(isPhraseRow, 4)
  const rest = take(() => true, 10 - phrases.length)
  parts.I = [...phrases, ...rest]

  const got = { ...parts, III: parts.III.all }
  const shortages = PARTS.filter((p) => countOf(got[p.key]) < p.need).map((p) => ({
    part: p.key,
    label: p.label,
    got: countOf(got[p.key]),
    need: p.need,
    why: p.why,
  }))

  return {
    parts,
    stats: summarize(usable, rows || []),
    shortages,
    ok: shortages.length === 0,
    // PART III 은 세 갈래가 각각 채워져야 한다
    thirdDetail: {
      derivative: { got: derivative.length, need: 2 },
      synonym: { got: synonym.length, need: 1 },
      antonym: { got: antonym.length, need: 2 },
    },
  }
}

/** 배정이 가능한지 미리 가늠하게 해주는 숫자들. 부족하면 어디가 모자란지 바로 보인다. */
export function summarize(usable, all) {
  const byPos = {}
  for (const row of usable) byPos[row.pos || '?'] = (byPos[row.pos || '?'] || 0) + 1

  const verbForms = {}
  for (const row of usable.filter((r) => r.pos === '동' && !isPhraseRow(r))) {
    const form = verbForm(row.surface, row.headword)
    verbForms[form] = (verbForms[form] || 0) + 1
  }

  return {
    total: all.length,
    usable: usable.length,
    properNoun: all.length - usable.filter((r) => r.headword).length,
    byPos,
    verbs: usable.filter((r) => r.pos === '동' && !isPhraseRow(r)).length,
    verbForms,
    adjAdv: usable.filter((r) => r.pos === '형' || r.pos === '부').length,
    phrases: usable.filter(isPhraseRow).length,
    withDerivatives: usable.filter((r) => countOf(r.derivatives) >= 1).length,
    withSynonyms: usable.filter((r) => countOf(r.synonyms) >= 1).length,
    withSynonyms2: usable.filter((r) => countOf(r.synonyms) >= 2).length,
    withAntonyms: usable.filter((r) => countOf(r.antonyms) >= 1).length,
    /** 6개 PART 가 요구하는 총 표제어 수 */
    required: PARTS.reduce((sum, p) => sum + p.need, 0),
  }
}
