/**
 * 표제어끼리 같은 단어이거나 파생 관계인지 찾는다.
 *
 * 표제어 원형화는 생성 단계에서 AI가 한다. 그래서 선택 화면에서는 멀쩡해 보이던
 * societies 와 society 가 결과 표에서 똑같은 줄 두 개로 나타난다. 그 전에 알려주기 위한 모듈이다.
 *
 * 두 단계로 나눠 본다.
 *   - 굴절(inflection): 복수·시제·분사만 떼어낸다. 여기서 같아지면 정규화 후 확실히 같은 표제어다.
 *   - 파생(derivation): 접미사까지 떼어 어근에 가깝게 만든다. 같은 뿌리지만 다른 단어일 수 있다.
 *
 * 파생 판정은 규칙 기반이라 economy/economic 처럼 둘 다 표제어로 가치 있는 쌍도 걸린다.
 * 그래서 이 모듈은 판정만 하고 무엇을 지울지는 정하지 않는다 — 경고까지가 역할이다.
 */

import { isPhrase, tokenize } from './tokenize.js'

/** 어근이 이보다 짧아지면 자르지 않는다. ration → rat 같은 오탐을 막는 유일한 방어선이다. */
const MIN_STEM = 4

/** 규칙으로 되돌릴 수 없는 복수형 */
const IRREGULAR = {
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth',
  mice: 'mouse', geese: 'goose', people: 'person', lives: 'life', knives: 'knife',
  wives: 'wife', leaves: 'leaf', halves: 'half', selves: 'self',
  phenomena: 'phenomenon', criteria: 'criterion', data: 'datum', media: 'medium',
  analyses: 'analysis', bases: 'basis', crises: 'crisis', theses: 'thesis',
  hypotheses: 'hypothesis', indices: 'index', matrices: 'matrix', appendices: 'appendix',
  stimuli: 'stimulus', nuclei: 'nucleus', curricula: 'curriculum',
}

/** 항상 복수형으로만 쓰는 명사 — s 를 떼면 다른 단어가 된다 */
const ALWAYS_PLURAL = new Set([
  'goods', 'means', 'species', 'statistics', 'savings', 'belongings', 'news',
  'series', 'physics', 'economics', 'politics', 'ethics', 'mathematics', 'clothes',
])

/**
 * 파생 접미사. 긴 것부터 확인해야 development 에서 ment 가 아니라 더 긴 후보를 먼저 본다.
 * 여기 없는 접미사는 그냥 안 잘릴 뿐이라 미탐이 되지, 오탐이 되지는 않는다.
 */
const DERIV_SUFFIXES = [
  'ability', 'ibility', 'ationally', 'ication', 'ization', 'isation',
  'ational', 'ically', 'ations', 'ement', 'ation', 'ition', 'ution', 'ities',
  'ships', 'hoods', 'fully', 'ously', 'ments', 'nesses',
  'ment', 'ness', 'ance', 'ence', 'ship', 'hood', 'isms', 'ists', 'ives',
  'ably', 'ibly', 'ical', 'ally', 'ious', 'eous', 'able', 'ible', 'less',
  'ity', 'ism', 'ist', 'ive', 'ous', 'ary', 'ory', 'ize', 'ise', 'ify',
  'ful', 'ion', 'ate', 'ers', 'ors', 'ial',
  'ly', 'ic', 'al', 'er', 'or', 'y',
].sort((a, b) => b.length - a.length)

const normalizeWord = (text) =>
  String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z-]/g, '')

/** occurred → occurr → occur. 어미를 떼며 남은 이중자음을 되돌린다. */
function undouble(stem) {
  return /([bdfgklmnprtvz])\1$/.test(stem) ? stem.slice(0, -1) : stem
}

/** 복수·시제·분사만 떼어낸다. */
function stripInflection(w) {
  if (IRREGULAR[w]) return IRREGULAR[w]
  if (ALWAYS_PLURAL.has(w)) return w

  if (/ies$/.test(w) && w.length > 4) return `${w.slice(0, -3)}y`
  if (/(?:ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2)
  if (/s$/.test(w) && !/(?:ss|us|is|as|os)$/.test(w) && w.length > 3) return w.slice(0, -1)
  if (/ied$/.test(w) && w.length > 4) return `${w.slice(0, -3)}y`
  if (/ed$/.test(w) && w.length > 4) return undouble(w.slice(0, -2))
  if (/ing$/.test(w) && w.length > 5) return undouble(w.slice(0, -3))
  return w
}

/** 파생 접미사를 떼어낸다. developmental → development → develop 처럼 여러 겹일 수 있다. */
function stripDerivation(w) {
  let cur = w
  for (let round = 0; round < 3; round += 1) {
    const suffix = DERIV_SUFFIXES.find((s) => cur.endsWith(s) && cur.length - s.length >= MIN_STEM)
    if (!suffix) break
    cur = cur.slice(0, -suffix.length)
  }
  return cur
}

/**
 * 정규화하면 같아질 것들을 묶는 키.
 * 어구는 낱말마다 굴절만 떼고 이어 붙인다. (cascading effects ↔ cascading effect)
 */
export function inflectionKey(surface) {
  const raw = String(surface || '').trim()
  if (!raw) return ''

  if (isPhrase(raw)) {
    return raw
      .toLowerCase()
      .split(/\s+/)
      .map((part) => stripInflection(normalizeWord(part)))
      .filter(Boolean)
      .join(' ')
  }

  const w = normalizeWord(raw)
  return w ? stripInflection(w) : ''
}

/**
 * 묵음 e 를 뗀 열쇠. immerse 는 그대로지만 immersed 는 immers 가 되어 서로 어긋난다.
 * create/created, produce/produced 처럼 흔한 부류라 이것 없이는 동사 상당수를 놓친다.
 *
 * 남는 길이가 4자 미만이면 만들지 않는다 — rate 를 rat 으로 줄이면 문장 속 rats 와 잘못 묶인다.
 * MIN_STEM 과 같은 이유이고 같은 값이다.
 */
export function silentEKey(key) {
  const stem = key.replace(/e$/, '')
  return stem !== key && stem.length >= MIN_STEM ? stem : ''
}

/** 양끝이 낱말 경계인 자리만 찾는다. 찾으면 원문의 표기 그대로 돌려준다. */
export function findWholeWord(text, needle) {
  const isWordChar = (ch) => ch !== undefined && /[A-Za-z0-9]/.test(ch)
  const lower = String(text || '').toLowerCase()
  const target = String(needle || '').toLowerCase()
  if (!target) return null

  for (let at = lower.indexOf(target); at !== -1; at = lower.indexOf(target, at + 1)) {
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + target.length])) {
      return text.slice(at, at + target.length)
    }
  }
  return null
}

/**
 * 글 안에서 그 낱말(어구)이 굴절형으로라도 나온 자리를 찾는다 — develop 으로 Developing 을, rely 로 relied 를.
 * 단어장 불러오기가 surface 를 되찾을 때, 시험지가 다른 문항의 정답이 글에 드러났는지 볼 때 쓴다.
 *
 * 규칙 기반이라 buy/bought 같은 불규칙은 못 잡는다.
 * @returns {string|null} 글에 나온 그대로의 형태. 없으면 null.
 */
export function findInflected(word, text) {
  const head = String(word || '').trim()
  const body = String(text || '')
  if (!head || !body) return null

  // 그대로 있으면 더 볼 것이 없다 (대소문자만 다를 수 있다).
  // 낱말 경계를 반드시 확인한다 — 안 그러면 developing 에서 develop 만 잘라내 온다.
  const exact = findWholeWord(body, head)
  if (exact) return exact

  const words = tokenize(body).filter((t) => t.isWord)
  const key = inflectionKey(head)
  if (!key) return null

  if (!isPhrase(head)) {
    const keys = new Set([key, silentEKey(key)].filter(Boolean))
    const hit = words.find((t) => keys.has(inflectionKey(t.text)))
    return hit ? hit.text : null
  }

  // 어구는 같은 낱말 수만큼 창을 밀며 굴절을 뗀 형태끼리 견준다
  const size = head.split(/\s+/).length
  for (let i = 0; i + size <= words.length; i += 1) {
    const window = words.slice(i, i + size)
    if (inflectionKey(window.map((t) => t.text).join(' ')) === key) {
      return body.slice(window[0].start, window[size - 1].end)
    }
  }
  return null
}

/**
 * 같은 뿌리에서 나온 것들을 묶는 키.
 *
 * 끝을 두 가지로 다듬는다.
 *   - e 제거: immerse ↔ immersion
 *   - y → i: 접미사가 붙으면 y 가 i 로 바뀐다. rely ↔ reliable, rely ↔ reliance
 *
 * 어구에는 파생 규칙을 적용하지 않는다 — 어느 낱말이 핵심인지 규칙으로 알 수 없다.
 */
export function derivationKey(surface) {
  const raw = String(surface || '').trim()
  if (!raw) return ''
  if (isPhrase(raw)) return inflectionKey(raw)

  const stem = stripDerivation(inflectionKey(raw))
  return stem.replace(/e$/, '').replace(/y$/, 'i')
}

function groupBy(selections, keyOf) {
  const map = new Map()
  for (const sel of selections) {
    const key = keyOf(sel.surface)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(sel)
  }
  return map
}

/**
 * 선택 목록에서 중복 무리를 찾는다.
 *
 * exact   — 정규화하면 같아진다. 그대로 두면 결과 표에 같은 줄이 두 개 생긴다.
 * derived — 뿌리는 같지만 다른 단어일 수 있다. 사람이 판단해야 한다.
 *
 * 한 무리 안에서 굴절형까지 같은 것들은 exact 로 이미 잡혔으므로,
 * derived 에는 서로 다른 굴절형만 대표로 하나씩 남긴다.
 */
export function findDuplicates(selections) {
  const exact = [...groupBy(selections, inflectionKey).values()].filter((g) => g.length > 1)

  const derived = []
  for (const group of groupBy(selections, derivationKey).values()) {
    if (group.length < 2) continue
    const byInflection = new Map()
    for (const sel of group) {
      const key = inflectionKey(sel.surface)
      if (!byInflection.has(key)) byInflection.set(key, sel)
    }
    if (byInflection.size > 1) derived.push([...byInflection.values()])
  }

  const flaggedIds = new Set()
  for (const group of [...exact, ...derived]) {
    for (const sel of group) flaggedIds.add(sel.id)
  }

  return { exact, derived, flaggedIds, total: exact.length + derived.length }
}

/**
 * 유의어 · 반의어가 같은 단어장의 다른 표제어와 같은 줄을 찾는다(굴절형만 달라도 같다고 본다).
 * 같은 시험지에서 한 말이 표제어이자 다른 말의 유의어 · 반의어가 되면 답이 겹친다.
 * 묶음마다 따로 생성하므로 프롬프트에 다른 표제어를 알려 줘도 새어 나올 수 있어, 표에서 한 번 더 짚는다.
 *
 * @param {Array} rows 단어장 줄
 * @returns {Map<string, Array<{kind: '유의어'|'반의어', word: string, otherNo: number}>>} 줄 id → 겹친 것들
 */
export function headwordOverlaps(rows) {
  const byKey = new Map()
  rows.forEach((r, i) => {
    const key = inflectionKey(r.headword)
    if (key && !byKey.has(key)) byKey.set(key, i)
  })
  const out = new Map()
  rows.forEach((r, i) => {
    const hits = []
    for (const [field, kind] of [['synonyms', '유의어'], ['antonyms', '반의어']]) {
      for (const entry of r[field] || []) {
        const at = byKey.get(inflectionKey(entry.word))
        if (at !== undefined && at !== i) hits.push({ kind, word: entry.word, otherNo: at + 1 })
      }
    }
    if (hits.length) out.set(r.id, hits)
  })
  return out
}
