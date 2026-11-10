/**
 * AI 를 부르지 않고 조립할 수 있는 PART 를 만든다.
 *
 * PART I — 우리말 뜻과 정답이 이미 단어장에 있다. 낱말 수만 세면 된다.
 * PART IV — 표제어를 고르는 순간 출처 문장이 저장됐다. 동사 자리를 빈칸으로 바꾸면 끝난다.
 *
 * 맥락이 모자란지는 여기서 판단하지 않는다. 문장을 실제로 읽어야 알 수 있는 일이라
 * 화면에서 사람이 보고 expandContext 로 앞뒤 문장을 붙인다.
 */

import { splitSentences, stripParagraphLabel, hasQuestionBlank } from './passages.js'
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
 */
export function buildPartI(rows, startNo = 1) {
  return rows.map((row, i) => {
    const words = String(row.headword || '').trim().split(/\s+/).filter(Boolean).length
    return {
      no: startNo + i,
      rowId: row.id,
      prompt: words >= 2 ? `${row.meaning} (${words})` : row.meaning,
      answer: row.headword,
      pos: row.pos,
      meaning: row.meaning,
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

/**
 * 문항에 실릴 최종 문장. before/after 만큼 앞뒤 문장을 붙이고 동사 자리를 빈칸으로 만든다.
 * 명세상 한 문항이 40단어를 넘으면 안 되므로, 넘는지 여부도 함께 돌려준다.
 */
/**
 * 저장된 문장이 지금의 분리 규칙과 어긋날 수 있다.
 * 따옴표 처리를 고치기 전에 저장된 문장은 `… are." Then …` 처럼 두 문장이 붙어 있다.
 * 그래서 저장된 값을 그대로 믿지 않고 정답 표현을 품은 문장을 지문에서 다시 찾는다.
 */
function findSentence(sentences, item) {
  const exact = sentences.indexOf(item.sentence)
  if (exact !== -1) return exact

  const answer = String(item.answer || '').toLowerCase()
  const saved = String(item.sentence || '')
  const has = (s) => Boolean(answer) && s.toLowerCase().includes(answer)

  // 옛 문장 안에 들어 있으면서 정답을 품은 것 — 한 덩어리였다가 쪼개진 경우
  const inside = sentences.findIndex((s) => has(s) && (saved.includes(s) || s.includes(saved)))
  if (inside !== -1) return inside

  return sentences.findIndex(has)
}

export function renderPartIVItem(item, passages) {
  const passage = (passages || []).find((p) => p.no === item.passageNo)
  const fallback = () => {
    const own = blankOut(item.sentence, item.answer)
    return { text: own, words: countWords(own), overLimit: countWords(own) > 40, atStart: true, atEnd: true }
  }

  if (!passage) return fallback()

  // 순서 배열 문항의 단락 이름표 "(A) …" 는 지문에 남아 있을 수 있다(옛 단어장) — 문항에 찍지 않는다
  const sentences = splitSentences(passage.english).map(stripParagraphLabel)
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
