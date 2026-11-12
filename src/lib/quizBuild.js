/**
 * AI 를 부르지 않고 조립할 수 있는 PART 를 만든다.
 *
 * PART I — 우리말 뜻과 정답이 이미 단어장에 있다. 낱말 수만 세면 된다.
 * PART IV — 표제어를 고르는 순간 출처 문장이 저장됐다. 동사 자리를 빈칸으로 바꾸면 끝난다.
 *
 * 맥락이 모자란지는 여기서 판단하지 않는다. 문장을 실제로 읽어야 알 수 있는 일이라
 * 화면에서 사람이 보고 expandContext 로 앞뒤 문장을 붙인다.
 */

import { splitSentences, stripParagraphLabel, hasQuestionBlank, isSummarySentence } from './passages.js'
import { verbForm } from './quizAllocate.js'

export const BLANK = '_______________'

/**
 * 보기 순서를 정답 순서와 어긋나게 하는 고정 순열.
 * 어느 자리도 제자리에 남지 않는다(0→2, 1→0, 2→4, 3→1, 4→3).
 * 무작위를 쓰지 않는 것은 화면을 다시 그릴 때마다 보기 순서가 바뀌면 안 되기 때문이다.
 */
const SHUFFLE_5 = [2, 0, 4, 1, 3]

export function shuffleChoices(items) {
  return items.length === 5 ? SHUFFLE_5.map((i) => items[i]) : [...items]
}

export function countWords(text) {
  return (String(text || '').match(/[A-Za-z0-9'’-]+/g) || []).length
}

/** 문장에서 해당 표현을 찾아 빈칸으로 바꾼다. 대소문자는 무시한다. */
export function blankOut(sentence, surface) {
  const text = String(sentence || '')
  const needle = String(surface || '')
  if (!text || !needle) return text
  const idx = text.toLowerCase().indexOf(needle.toLowerCase())
  if (idx === -1) return text
  return text.slice(0, idx) + BLANK + text.slice(idx + needle.length)
}

/**
 * PART I — 우리말 → 영어 쓰기 (10문항)
 * 어구는 낱말 수를 괄호로 알려준다: `~을 대신하여 (3)`
 *
 * @param {object} [meanings] 시험지에서 좁혀 바꾼 뜻 { [rowId]: '차등적으로' }. 단어장 뜻이 더 흔한 말(differently)에도
 *   들어맞을 때 PART I 점검이 제안하고 사람이 고른다. 단어장 표는 그대로다.
 */
export function buildPartI(rows, startNo = 1, meanings = {}) {
  return rows.map((row, i) => {
    const words = String(row.headword || '').trim().split(/\s+/).filter(Boolean).length
    const meaning = String(meanings?.[row.id] || '').trim() || row.meaning
    return {
      no: startNo + i,
      rowId: row.id,
      prompt: words >= 2 ? `${meaning} (${words})` : meaning,
      answer: row.headword,
      pos: row.pos,
      meaning,
      synonyms: (row.synonyms || []).map((s) => s.word).join(', '),
      passageNo: row.passageNo,
      passageLabel: row.passageLabel,
    }
  })
}

/**
 * PART IV — 동사 형태 변형 (5문항)
 * 보기에는 원형을 싣고, 정답은 지문에 나온 그대로의 형태다.
 */
export function buildPartIV(rows, startNo = 21) {
  const items = rows.map((row, i) => ({
    no: startNo + i,
    rowId: row.id,
    sentence: stripParagraphLabel(row.sentence || ''),
    answer: row.surface,
    base: row.headword,
    form: verbForm(row.surface, row.headword),
    passageNo: row.passageNo,
    passageLabel: row.passageLabel,
    // 화면에서 사람이 조절한다. 0 이면 출처 문장만 쓴다.
    before: 0,
    after: 0,
  }))

  return { items, choices: shuffleChoices(rows.map((r) => r.headword)) }
}

/** 공백을 한 칸으로 — 엑셀 셀을 거치며 줄바꿈 · 겹친 공백이 달라져도 같은 문장으로 본다. */
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim()

const wordsOf = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) || []

/**
 * 두 문장이 낱말로 얼마나 같은지 (0~1). 같은 낱말 수를 긴 쪽 낱말 수로 나눈다.
 * 11/12 내려받기 폴더의 단어장으로 잰 값 — 검수에서 고친 문장은 0.82 이상(48가지), 같은 지문의 다른 문장은
 * 7,934쌍 가운데 99% 가 0.33 이하이고 가장 높은 것이 0.61(같은 틀로 쓴 두 문장)이다.
 */
export function sentenceSimilarity(a, b) {
  const A = wordsOf(a)
  const B = wordsOf(b)
  if (!A.length || !B.length) return 0
  const bag = new Map()
  for (const w of A) bag.set(w, (bag.get(w) || 0) + 1)
  let common = 0
  for (const w of B) {
    const n = bag.get(w)
    if (n) {
      common += 1
      bag.set(w, n - 1)
    }
  }
  return common / Math.max(A.length, B.length)
}

/** 이만큼 닮아야 고친 문장으로 본다 — 다른 문장의 최고치(0.61)와 고친 문장의 최저치(0.82) 사이 */
const MIN_SIMILARITY = 0.7

/** text 와 가장 닮은 문장의 자리. fits 를 주면 그것을 만족하는 문장만 본다. 충분히 닮은 것이 없으면 -1. */
function mostSimilar(sentences, text, fits = () => true) {
  let best = -1
  let score = 0
  sentences.forEach((s, j) => {
    if (!fits(s)) return
    const v = sentenceSimilarity(s, text)
    if (v > score) {
      best = j
      score = v
    }
  })
  return score >= MIN_SIMILARITY ? best : -1
}

/**
 * 표의 문장이 지문 문장 하나를 통째로 앞이나 뒤에 품고 있으면 고친 것이 아니라,
 * 따옴표 처리를 고치기 전의 분리 규칙으로 두 문장이 붙어 저장된 것이다(`… are." Then …`).
 */
function isGluedPair(text, sentences) {
  return sentences.some((x) => {
    const s = squash(x)
    return wordsOf(s).length >= 4 && (text.startsWith(`${s} `) || text.endsWith(` ${s}`))
  })
}

/**
 * 단어장 표에서 고친 출처 문장을 지문 문장 목록에 덮어쓴다.
 *
 * 어법 · 어휘 문항 지문에는 일부러 틀린 말이 들어 있다(is → are, more → less 처럼). 선생님은 엑셀에서 출처 문장을
 * 바로잡지만 지문 원문(1단계에서 나눈 지문 · 엑셀 숨김 시트)은 그대로다. PART IV 가 지문에서 문장을 다시 찾으면
 * 고치기 전 문장이 실린다(11/12 완성반 Week03 24번 "the listener expends more energy").
 * 그래서 표의 문장이 지문에 그대로 없으면, 지문에서 가장 닮은 문장을 고친 문장으로 바꿔 넣는다.
 * 지문 원문 자체는 바꾸지 않는다 — 2단계 선택이 지문의 글자 자리를 들고 있다.
 *
 * - 요약문 문장은 덮지 않는다 — 앞뒤 문장을 붙일 때 멈추는 자리로 남아야 한다.
 * - 같은 지문 문장을 여러 줄이 서로 다르게 고쳤으면 앞에 온 것이 이긴다. 문항 자신의 문장을 맨 앞에 둔다.
 *
 * @param {string[]} sentences 지문을 나눈 문장
 * @param {string[]} fixes 같은 지문에서 나온 표의 출처 문장들
 * @returns {string[]} 고친 문장을 넣은 새 목록
 */
export function applySentenceFixes(sentences, fixes) {
  const out = [...sentences]
  const original = sentences.map(squash)
  const taken = new Set()
  for (const raw of fixes) {
    const text = squash(stripParagraphLabel(raw))
    if (!text || original.includes(text) || isGluedPair(text, sentences)) continue
    const at = mostSimilar(sentences, text, (s) => !isSummarySentence(s))
    if (at === -1 || taken.has(at)) continue
    out[at] = text
    taken.add(at)
  }
  return out
}

/**
 * 저장된 문장이 지문 문장과 글자 그대로 같지 않을 수 있다.
 * - 따옴표 처리를 고치기 전에 저장된 문장은 `… are." Then …` 처럼 두 문장이 붙어 있다.
 * - 같은 지문 문장을 다른 줄이 고쳐 덮었다 (applySentenceFixes).
 * 그래서 저장된 값을 그대로 믿지 않고 정답 표현을 품은 문장을 지문에서 다시 찾는다.
 */
function findSentence(sentences, item) {
  const saved = squash(item.sentence)
  const exact = sentences.findIndex((s) => squash(s) === saved)
  if (exact !== -1) return exact

  const answer = String(item.answer || '').toLowerCase()
  const has = (s) => Boolean(answer) && s.toLowerCase().includes(answer)

  // 옛 문장 안에 들어 있으면서 정답을 품은 것 — 한 덩어리였다가 쪼개진 경우
  const inside = sentences.findIndex((s) => has(s) && (saved.includes(squash(s)) || squash(s).includes(saved)))
  if (inside !== -1) return inside

  // 다른 줄이 고쳐 덮은 문장 — 정답이 든 문장 가운데 가장 닮은 것. 같은 낱말이 앞 문장에 또 있어도 헷갈리지 않는다
  const near = mostSimilar(sentences, saved, has)
  if (near !== -1) return near

  return sentences.findIndex(has)
}

/**
 * 문항에 실릴 최종 문장. before/after 만큼 앞뒤 문장을 붙이고 동사 자리를 빈칸으로 만든다.
 * 명세상 한 문항이 40단어를 넘으면 안 되므로, 넘는지 여부도 함께 돌려준다.
 *
 * @param {Array} [rows] 지금 단어장 표. 주면 표에서 고친 출처 문장을 지문 위에 덮어 쓴다 (applySentenceFixes).
 *   문항 자신의 문장뿐 아니라 앞뒤로 붙이는 문장도 다른 줄에서 고쳤으면 고친 대로 실린다.
 */
export function renderPartIVItem(item, passages, rows = []) {
  const passage = (passages || []).find((p) => p.no === item.passageNo)
  const fallback = () => {
    const own = blankOut(item.sentence, item.answer)
    return { text: own, words: countWords(own), overLimit: countWords(own) > 40, atStart: true, atEnd: true }
  }

  if (!passage) return fallback()

  // 순서 배열 문항의 단락 이름표 "(A) …" 는 지문에 남아 있을 수 있다(옛 단어장) — 문항에 찍지 않는다
  const fixes = [
    item.sentence,
    ...(rows || []).filter((r) => r.passageNo === item.passageNo && r.id !== item.rowId).map((r) => r.sentence),
  ]
  const sentences = applySentenceFixes(splitSentences(passage.english).map(stripParagraphLabel), fixes)
  const idx = findSentence(sentences, item)
  if (idx === -1) return fallback()

  /*
   * 요약문처럼 빈칸 (A)·(B) 가 남은 문장은 문항에 싣지 않는다.
   * 출처 문장 자체가 그런 문장이면 단어장에서 빈칸을 채운 문장(item.sentence)을 쓰고,
   * 앞뒤 문장을 붙일 때는 그런 문장 앞에서 멈춘다 — 요약문은 대개 지문 맨 끝에 붙어 있다.
   */
  const own = hasQuestionBlank(sentences[idx]) && !hasQuestionBlank(item.sentence) ? item.sentence : sentences[idx]
  let from = idx
  while (from > 0 && idx - from < (item.before || 0) && !hasQuestionBlank(sentences[from - 1])) from -= 1
  let to = idx
  while (to < sentences.length - 1 && to - idx < (item.after || 0) && !hasQuestionBlank(sentences[to + 1])) to += 1
  const text = sentences
    .slice(from, to + 1)
    .map((s, k) => (from + k === idx ? blankOut(own, item.answer) : s))
    .join(' ')

  return {
    text,
    words: countWords(text),
    overLimit: countWords(text) > 40,
    // 더 붙일 문장이 없으면 버튼을 막는다. 빈칸이 남은 문장은 붙일 수 없으므로 끝으로 본다
    atStart: from === 0 || hasQuestionBlank(sentences[from - 1]),
    atEnd: to === sentences.length - 1 || hasQuestionBlank(sentences[to + 1]),
  }
}
