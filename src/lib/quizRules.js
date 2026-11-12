/**
 * 시험지 검수에서 되풀이해 지적된 것을 규칙으로 모은 곳.
 * 프롬프트(server/quizPrompts.js)와 받은 뒤 검사(quizClient.js)가 같은 목록을 쓴다.
 */

import { inflectionKey } from './duplicates.js'
import { splitSentences } from './passages.js'

/**
 * PART V 선택지 난이도는 **고3(수능 준비 어휘)까지**다 — 사용자 결정 (Week 09 검수 뒤).
 * 검수는 adversary · stagnation · harness 같은 오답이 "고2 수준을 넘는다" 고 짚었지만, 기준을 고3 으로 정해
 * 이런 수능 어휘는 쓸 수 있다. 막는 것은 **수능 범위를 넘는 드문 말**뿐이다.
 *
 * 아래는 Week 07 · 08 시험지 PART V 오답 가운데 그런 말이다(검수 목록이 아니라 이 목록을 만들며 골랐다).
 * 프롬프트에 ✗ 예로 싣고, 받은 뒤 다시 나오면 짚는다. 검수에서 새로 지적되면 여기에 더한다.
 */
export const BEYOND_EXAM_DISTRACTORS = [
  'mendicant', 'vassal', 'junta', 'placatory', 'indemnity', 'lapse into oblivion', 'recede from prominence',
]

/**
 * PART V 근접 오답의 예 — 시험지 검수(Week 06~09)가 낸 것. 프롬프트에 그대로 싣는다.
 * 오답이 모두 반대 방향이라 "쉬운 반대말을 지우고 남은 것을 다 고르면" 풀렸다(06-30 · 07-26).
 * 선생님 기준: 버리는 선지는 1개, 오답이 모두 같은 방향이면 답이 드러난다.
 */
export const NEAR_DISTRACTOR_EXAMPLES = [
  { answer: 'ward off · fend off · repel', near: 'put off', why: "같은 off 구동사지만 '연기하다' 라는 뜻이라 막아 낸다는 뜻이 아니다" },
  { answer: '(보험) premium', near: 'tax', why: '내는 돈이지만 보험사가 걷는 돈이 아니다' },
  { answer: 'havoc · chaos (금융망에 일으키는 혼란)', near: 'panic', why: '혼란 계열이지만 금융망은 공황에 빠지는 주체가 아니다' },
  { answer: 'a flash of insight · inspiration (돌파구의 원천)', near: 'memory', why: "a flash of 는 되지만 '돌파구의 원천' 이라는 문맥에 맞지 않는다" },
]

/** PART V 선택지 역할 — 정답 · 버리는 선지(반대 방향 쉬운 말, 문항마다 1개) · 근접 오답 */
export const CHOICE_ROLES = ['정답', '버림', '근접']

const keyOf = (word) => {
  const w = String(word || '').toLowerCase().replace(/\s+/g, ' ').trim()
  return /\s/.test(w) ? w : inflectionKey(w) || w
}
const BEYOND_KEYS = new Set(BEYOND_EXAM_DISTRACTORS.map(keyOf))

/** 수능 범위를 넘는 드문 말로 짚어 둔 오답인지 */
export const isBeyondExamDistractor = (word) => BEYOND_KEYS.has(keyOf(word))

/**
 * PART VI 이야기의 도입과 마무리. 매번 같은 틀로 쓰면 3주 만에 AI 글로 읽힌다
 * (Week 07~09: "[이름] spent N years as a [직업] in a [장소]" 로 시작해 "His patience proved …" 로 끝남).
 * 생성할 때마다 하나씩 골라 프롬프트에 박는다.
 */
export const STORY_OPENINGS = [
  '인물이 한창 일하는 장면 한가운데에서 시작한다 — 지금 무엇을 하고 있는지부터 보여준다',
  '인물이나 주변 사람이 한 말 한 마디(따옴표 대사)로 시작한다',
  '어느 날 생긴 문제나 뜻밖의 일로 시작한다',
  '구체적인 시각과 장소의 장면 묘사로 시작한다 (예: "At five in the morning, the ferry dock was still dark.")',
  '인물이 손에 든 물건 하나를 묘사하며 시작한다',
  '주변 사람(학생 · 이웃 · 손님 · 동료)의 눈에 비친 인물의 모습으로 시작한다',
]

export const STORY_ENDINGS = [
  '인물의 구체적인 행동 하나로 끝낸다',
  '인물이나 다른 사람의 대사 한 마디로 끝낸다',
  '작은 반전이나 뜻밖의 결과로 끝낸다',
  '처음 장면과 이어지는 마지막 장면 묘사로 끝낸다',
]

/**
 * 빈칸 바로 앞의 관사를 a(n) 으로 바꾼다. "a ___" 는 모음으로 시작하는 보기를 후보에서 빼 버린다
 * (Week 03 검수 35번: "Mina noticed a ___" 라 authenticity 가 빠졌다. Week 01 은 a(n) 이었다).
 * PART VI 의 `{35}` 표시와 PART V 의 밑줄 빈칸을 모두 받는다. 이미 a(n) 이면 그대로 둔다. 대문자는 살린다(An → A(n)).
 */
export function neutralArticles(text) {
  return String(text ?? '').replace(/\b(an?)(\s+)(?=\{\d+\}|_{3,})/gi, (_, art, space) => `${art[0]}(n)${space}`)
}

/** "Elena Ruiz spent thirty years as a child psychologist in …" 같은 소개 틀 */
const INTRO_TEMPLATE = /\b(?:had\s+)?spent\s+(?:[\w-]+\s+){0,3}years?\s+(?:working\s+)?as\s+an?\b/i

/** 덕목을 말로 정리하는 마무리 — "His patience proved …", "… with patience and respect." */
const VIRTUE_WORDS =
  /\b(?:patience|persistence|perseverance|kindness|dedication|devotion|compassion|respect|courage|generosity|determination|commitment|integrity|humility|empathy|hard work)\b/i
const MORAL_VERBS = /\b(?:proved|taught|reminded|showed)\s+(?:\w+\s+){0,3}(?:that|how)\b/i

/**
 * PART VI 이야기가 되풀이된 틀에 걸리는지. 걸린 것을 사람이 읽을 문장으로 돌려준다.
 * @param {string} story `{31}` 같은 빈칸 표시가 든 본문
 */
export function storyPatternIssues(story) {
  const text = String(story || '').replace(/\{\d+\}/g, 'blank').trim()
  // 약어(Dr. Mina Park)에서 끊기지 않게 지문과 같은 문장 나누기를 쓴다
  const sentences = splitSentences(text)
  const first = sentences[0] || ''
  const last = sentences[sentences.length - 1] || ''
  const issues = []
  if (INTRO_TEMPLATE.test(first)) issues.push('첫 문장이 "이름 spent N years as a 직업" 틀')
  const virtue = last.match(VIRTUE_WORDS)
  if (virtue) issues.push(`마지막 문장이 덕목(${virtue[0]})을 말로 정리함`)
  else if (MORAL_VERBS.test(last)) issues.push('마지막 문장이 교훈으로 끝남')
  return issues
}

/**
 * PART III 힌트는 두 글자까지만 보여준다 — 사용자 결정 (Week 03 검수 20번).
 * 예전에는 정답 하나로 좁혀질 때까지 늘렸는데(Week 09 검수 뒤), subsequent 의 반의어가 prev___ 로 네 글자나 드러났다.
 */
export const HINT_MAX = 2

/**
 * PART III 유의어 · 반의어 문항의 첫 글자 힌트와, 그 힌트로 인정할 정답들.
 *
 * 같은 관계가 되는 다른 말(rivals)과 첫 글자가 겹치면 갈릴 때까지 늘리되 HINT_MAX 글자에서 멈춘다.
 * 거기서도 겹치는 말은 **함께 정답으로 인정**한다 — subsequent 의 반의어 pr___ 는 previous · prior · preceding 모두 정답.
 * 정답이 다른 말의 앞부분이어도(common / commonplace) 같은 방식이다.
 *
 * @param {string} answer AI 가 고른 정답
 * @param {string[]} rivals 같은 관계가 되는 다른 말 (AI 가 적은 것 + 단어장 후보)
 * @returns {{hint: string, accepted: string[], clash: string[]}}
 *   accepted — 인정하는 정답 (AI 정답이 맨 앞). clash — 한 글자로는 겹쳐서 힌트를 늘리게 만든 말
 */
export function uniqueHint(answer, rivals) {
  const a = String(answer || '').trim()
  if (!a) return { hint: '', accepted: [], clash: [] }
  const lower = a.toLowerCase()
  const others = [...new Set((rivals || []).map((r) => String(r || '').trim()).filter(Boolean))].filter(
    (r) => r.toLowerCase() !== lower && r[0].toLowerCase() === lower[0]
  )
  const sharing = (n) => others.filter((r) => r.toLowerCase().startsWith(lower.slice(0, n)))

  let n = 1
  while (n < Math.min(HINT_MAX, a.length) && sharing(n).length) n += 1
  return {
    hint: a.slice(0, n),
    accepted: [a, ...sharing(n)],
    clash: n > 1 ? sharing(n - 1) : [],
  }
}

/**
 * PART III 문항에서 인정하는 정답. 힌트로 여러 말이 인정되면 모두다 — `previous · prior · preceding`.
 * 예전 결과(accepted 없음)는 AI 정답 하나다.
 */
export function partThreeAnswers(it) {
  return Array.isArray(it?.accepted) && it.accepted.length ? it.accepted : [it?.answer].filter(Boolean)
}
