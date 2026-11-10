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
 * PART III 첫 글자 힌트를 정답 하나로 좁혀지게 늘린다.
 * stretch : s___ 는 shrink 도 shorten 도 되므로 shr___ 까지 보여준다 (Week 09 검수 19 · 20번).
 *
 * @param {string} answer 정답
 * @param {string[]} rivals 같은 관계가 되는 다른 말 (AI 가 적은 것 + 단어장 후보)
 * @returns {{hint: string, clash: string[], unique: boolean}} 힌트, 겹쳐서 늘리게 만든 말, 끝내 갈렸는지
 */
export function uniqueHint(answer, rivals) {
  const a = String(answer || '').trim()
  const lower = a.toLowerCase()
  const others = [...new Set((rivals || []).map((r) => String(r || '').trim().toLowerCase()))].filter(
    (r) => r && r !== lower && r[0] === lower[0]
  )
  if (!a) return { hint: '', clash: [], unique: true }
  for (let n = 1; n <= a.length; n += 1) {
    if (!others.some((r) => r.startsWith(lower.slice(0, n)))) {
      // 한 글자로 모자라 늘렸다면, 바로 앞 길이에서 겹친 말이 늘리게 만든 말이다
      const clash = n > 1 ? others.filter((r) => r.startsWith(lower.slice(0, n - 1))) : []
      return { hint: a.slice(0, n), clash, unique: true }
    }
  }
  // 정답이 다른 말의 앞부분이면(common / commonplace) 글자를 늘려도 갈리지 않는다
  return { hint: a.slice(0, 1), clash: others, unique: false }
}
