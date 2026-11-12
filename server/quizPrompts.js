/**
 * 시험지 PART II · III · V · VI 프롬프트와 PART I · V 점검 프롬프트.
 * PART I 과 IV 는 단어장에 있는 것만으로 조립된다. PART I 은 다른 낱말로 읽힐 여지만 AI 가 점검한다.
 *
 * 네 PART 는 서로 의존이 없어 동시에 호출한다.
 * 규칙은 지시로 걸되, 어긴 것은 받은 뒤 코드로 걸러낸다 (개수 보장을 코드로 하는 것과 같은 방식).
 */

import { JSON_ONLY } from './prompts.js'
import {
  BEYOND_EXAM_DISTRACTORS,
  NEAR_DISTRACTOR_EXAMPLES,
  STORY_OPENINGS,
  STORY_ENDINGS,
} from '../src/lib/quizRules.js'

const COMMON = `너는 한국 고등학생 대상 수능 영어 어휘 심화 시험지를 만드는 출제자다.
문항은 실제 학평 수준이어야 하고, 학생이 어림짐작으로 맞힐 수 있으면 안 된다.`

/**
 * 같은 시험지의 PART I 정답 — 학생이 우리말을 보고 써야 하는 말이라, 다른 문항 글에 나오면 답이 드러난다
 * (Week 03 검수: PART IV 문장에 PART I 정답 niche · concept creep 이 그대로 나왔다).
 */
const avoidBlock = (avoid) =>
  Array.isArray(avoid) && avoid.length
    ? `\n\n## 글에 쓰지 말 낱말\n다음은 같은 시험지의 다른 문항 정답이다. 문장 · 글에 쓰지 마라(형태를 바꿔도 안 된다): ${avoid.join(', ')}`
    : ''

/* ------------------------------------------------------------------ */
/* PART I 점검 — 다른 낱말로 읽힐 여지                                 */
/* ------------------------------------------------------------------ */

/**
 * PART I 은 우리말 뜻을 보고 영어를 쓰는 문항이다. 뜻이 더 흔한 말에도 그대로 들어맞으면 학생은 그 말을 쓴다
 * (Week 03 검수 7번: "다르게" 는 differentially 보다 differently 로 쓴다 — 단어장 유의어이기도 했다).
 * 정답을 알려 주고, 정답 말고 쓸 만한 말과 좁힌 뜻을 받는다.
 * @param {{items: Array<{id, no, prompt, answer, pos, synonyms}>}} payload
 */
export function buildPartICheckPrompt({ items }) {
  const body = items
    .map((it) => `${it.no}. id=${it.id}  우리말: ${it.prompt}  → 정답 ${it.answer} (${it.pos})${it.synonyms ? `  · 단어장 유의어: ${it.synonyms}` : ''}`)
    .join('\n')

  return `${JSON_ONLY}

너는 수능 영어 단어 시험을 검토하는 꼼꼼한 교사다. 아래는 "우리말에 해당하는 영어 단어 또는 어구를 쓰시오" 문항이다.
학생은 단어장으로 공부했고, 시험지에서는 우리말 뜻(괄호 숫자는 어구의 낱말 수)만 보고 영어를 쓴다.

각 문항에서 **학생이 정답 대신 써 낼 만하고, 채점할 때 틀렸다고 하기 어려운 다른 영어 낱말 · 어구**만 찾아 others 에 적어라.
- 그 우리말을 영어로 옮길 때 **정답만큼, 또는 정답보다 먼저** 떠오르고 뜻도 그대로 들어맞는 말이어야 한다.
  뜻이 비슷한 말을 모으는 것이 아니다. 단어장 유의어라고 다 적지 마라 — 그 우리말과 결이 다르면 채점에서 틀렸다고 할 수 있다.
- 적지 말 것: 정답의 굴절형 · 철자 변이, 우리말을 낱말마다 옮긴 말("개념 확장" → concept expansion), 더 넓거나 좁은 말,
  괄호의 낱말 수와 낱말 수가 다른 말("자신을 돋보이게 하다 (3)" → stand out 은 두 낱말).
- 대부분의 문항은 others 가 빈 배열이다. 10문항이면 걸리는 것은 보통 한두 개다.
- 찾은 말마다 likely 를 적는다.
  - true — 정답보다 흔하거나 쉬워 학생이 먼저 떠올려 쓸 말. (예: "다르게" → differently. differentially 보다 훨씬 먼저 쓴다)
  - false — 들어맞기는 하지만 그 정도로 먼저 떠오르지는 않는 말. 채점 기준만 정해 두면 된다. (예: "정서적인" → emotional)
- likely 가 true 인 말이 있으면, **정답만 가리키는 좁힌 우리말 뜻**을 prompt 에 적는다. 표제어만의 결을 살린다
  (differentially → "차등적으로"). 품사 어미는 원래 뜻과 같게 쓰고, 괄호 낱말 수는 적지 마라.
  - 좁힌 뜻을 보고도 그 다른 말을 그대로 쓸 수 있으면 좁힌 것이 아니다 — 꾸밈말만 덧붙인 뜻("앞날의 가망" → 여전히 chance)은 쓰지 마라.
    그렇게밖에 못 좁히면 빈 문자열로 두고 채점 기준으로 넘긴다.
  - likely 가 true 인 말이 없으면 빈 문자열이다.
- 다른 말이 없으면 others 는 빈 배열이다. 억지로 찾지 마라.

## 문항
${body}

## 출력 형식
{
  "items": [
    { "id": "입력의 id 그대로", "others": [ { "word": "differently", "likely": true, "why": "왜 그렇게 쓰는지 30자 이내 한국어" } ], "prompt": "차등적으로" }
  ]
}

items 는 입력 ${items.length}개 전부를 순서대로 포함해야 한다.`
}

/* ------------------------------------------------------------------ */
/* PART II — 영영풀이 매칭                                             */
/* ------------------------------------------------------------------ */

export function buildPartIIPrompt({ items }) {
  const body = items
    .map((it, i) => `${i + 1}. id=${it.id}  ${it.headword} (${it.pos}) — 뜻: ${it.meaning}`)
    .join('\n')

  return `${JSON_ONLY}

${COMMON}

아래 ${items.length}개 단어 각각의 **영영풀이**를 쓰고, 오답용 단어(distractor) 1개를 함께 골라라.

## 영영풀이 규칙
- 길이는 **10~20 단어**. 한 문장으로 쓴다.
- 핵심 의미를 1~2개 속성으로 풀어 설명한다.
  "based on", "in a manner that", "having", "able to be", "tending to" 같은 구조어를 활용한다.
- **유의어를 그대로 내놓지 마라.** "a synonym for X", "the same as X" 같은 표현 금지.
  하나의 유의어로 갈음하지 말고 반드시 풀어서 설명한다.
- 풀이 안에 표제어 자신이나 그 파생형을 쓰지 마라.
- 부사가 표제어면 "in a ... manner", "in a way that ..." 으로 부사임을 드러내도 된다.

## distractor 규칙
- 정답 단어들과 **의미가 가깝지만 미묘하게 다른** 단어 하나.
  (예: 정답 reluctant(꺼리는) ↔ distractor hesitant(망설이는))
- 위 ${items.length}개 단어 중 하나를 다시 쓰면 안 된다.
- 품사는 위 단어들과 같은 갈래(형용사 또는 부사)로 맞춘다.
- 어느 풀이에도 들어맞지 않아야 한다. 학생이 배제 추론으로 걸러낼 수 있어야 한다.

## 대상 단어
${body}

## 출력 형식
{
  "definitions": [
    { "id": "입력의 id 그대로", "headword": "단어", "definition": "영영풀이" }
  ],
  "distractor": { "word": "오답 단어", "reason": "왜 헷갈리는지 15자 이내 한국어" }
}

definitions 는 입력 ${items.length}개 전부를 입력 순서대로 포함해야 한다.`
}

/* ------------------------------------------------------------------ */
/* PART III — 어휘 관계 분석                                           */
/* ------------------------------------------------------------------ */

export function buildPartIIIPrompt({ derivative, synonym, antonym }) {
  // avoid — 후보 가운데 PART IV 문장에 나오는 말. 정답으로 고르면 PART IV 가 답을 보여준다
  const line = (it, extra) =>
    `id=${it.id}  ${it.headword} (${it.pos}) — 뜻: ${it.meaning}${extra}` +
    (it.avoid?.length ? ` — 정답으로 고르지 말 것: ${it.avoid.join(', ')} (같은 시험지 PART IV 문장에 나옴)` : '')

  return `${JSON_ONLY}

${COMMON}

비례식 어휘 관계 문항을 만든다. 형태는 \`A : B = C : ???\` 이고, C 는 주어진 표제어, ??? 가 정답이다.
학생은 A 와 B 의 관계를 파악해 같은 관계를 C 에 적용한다.

## 1) 파생어 문항 2개
정답은 표제어의 **파생어**다.

- 형태가 일반적이지 않은 파생어를 우선한다. 단순히 -ly 만 붙인 것은 정답으로 쓰지 마라.
- **가장 중요 — 보기 쌍(A:B)의 파생 어미와 정답의 파생 어미가 서로 달라야 한다.**
  같으면 학생이 어미만 베껴서 풀 수 있어 문항이 무의미해진다.
  - 좋음: \`assume : assumption = leak : leakage\`   (-ption 과 -age 로 다름)
  - 좋음: \`modern : modernity = evolve : evolution\` (-ity 와 -tion 으로 다름)
  - 나쁨: \`assume : assumption = perceive : perception\` (둘 다 -tion, 베끼면 풀림)
- A : B 는 정답과 **같은 품사 관계**여야 한다 (동사→명사면 동사→명사).
- A, B 는 고등학생이 아는 평이한 단어로 고른다.
- 첫 글자 힌트를 주지 않는다 (hint 는 빈 문자열).

## 2) 유의어 문항 1개
정답은 표제어의 **유의어**다.
- A : B 도 유의어 쌍이어야 한다 (예: hide : conceal).
- 어근이 달라 단서가 필요하므로 **정답의 첫 글자**를 hint 에 넣는다.

## 3) 반의어 문항 2개
정답은 표제어의 **반의어**다.
- A : B 도 반의어 쌍이어야 한다 (예: present : absent, always : never).
- **정답의 첫 글자**를 hint 에 넣는다.

## 4) 첫 글자 힌트로 정답이 하나로 좁혀져야 한다 (유의어 · 반의어 문항)
- 정답과 **같은 첫 글자로 시작하면서 같은 관계가 되는 다른 흔한 말**이 있으면 학생이 그 말을 써도 틀렸다고 할 수 없다.
  (stretch 의 반의어 s___ → shrink 도 shorten 도 맞다 · respective 의 반의어 c___ → common 도 collective 도 맞다)
- 그래서 후보 가운데 **그런 말이 없는 것을 정답으로 우선 고른다.**
- 어느 후보를 골라도 그런 말이 있으면, 그 말들을 rivals 에 **빠짐없이** 적는다. 코드가 힌트를 두 글자까지만 늘리고
  (sh___ · pr___), 그 두 글자로 시작하는 rivals 는 **함께 정답으로 인정**한다(previous · prior · preceding).
  힌트가 세 글자 이상 드러나면 문항이 너무 쉬워지기 때문이다. 그런 말이 없으면 rivals 는 빈 배열이다.

## 공통
- 다섯 문항의 관계 유형(동사:명사 / 형용사:명사 / 동사:형용사 / 부사:부사 …)이 서로 겹치지 않게 흩어라.
- 정답은 반드시 아래에 주어진 후보 안에서 고른다. 없는 말을 지어내지 마라.
- "정답으로 고르지 말 것" 이 붙은 후보는 다른 후보가 있으면 고르지 마라.

## 파생어 문항 대상 (2개)
${derivative.map((it) => line(it, ` — 파생어 후보: ${it.derivatives.join(', ')}`)).join('\n')}

## 유의어 문항 대상 (1개)
${synonym.map((it) => line(it, ` — 유의어 후보: ${it.synonyms.join(', ')}`)).join('\n')}

## 반의어 문항 대상 (2개)
${antonym.map((it) => line(it, ` — 반의어 후보: ${it.antonyms.join(', ')}`)).join('\n')}

## 출력 형식
{
  "items": [
    {
      "id": "입력의 id 그대로",
      "kind": "derivative | synonym | antonym",
      "left": "A",
      "right": "B",
      "headword": "C (주어진 표제어 그대로)",
      "answer": "정답",
      "hint": "정답 첫 글자 (파생어 문항은 빈 문자열)",
      "rivals": ["같은 첫 글자로 시작하고 같은 관계가 되는 다른 말 (없으면 빈 배열)"],
      "relation": "관계 설명 (예: 동사 → 명사 파생)",
      "note": "어미가 어떻게 다른지 20자 이내 (파생어 문항만)"
    }
  ]
}

items 는 파생어 2개 · 유의어 1개 · 반의어 2개, 모두 5개여야 한다.`
}

/* ------------------------------------------------------------------ */
/* PART V — 복수 정답 유의어 변별                                       */
/* ------------------------------------------------------------------ */

export function buildPartVPrompt({ items, avoid }) {
  const body = items
    .map(
      (it, i) =>
        `${i + 1}. id=${it.id}  ${it.headword} (${it.pos}) — 뜻: ${it.meaning}\n` +
        `   유의어: ${it.synonyms.join(', ') || '없음'}\n` +
        `   반의어: ${it.antonyms.join(', ') || '없음'}`
    )
    .join('\n')

  return `${JSON_ONLY}

${COMMON}

표제어가 가장 자연스럽게 쓰이는 **문장을 새로 지어** 빈칸을 만들고, 5지선다를 구성한다.
지문에서 문장을 가져오지 마라. 새로 쓴다.

## 문장 규칙
- **25~40 단어.** 학술적·추상적 주제로 쓴다.
- ${items.length}개 문항의 주제 영역이 서로 달라야 한다.
  (외교·정치 / 학술·연구 / 기술 / 사회학 / 윤리 / 문학 비평 등)
- 빈칸은 \`_______________\` (밑줄 15개) 로 표시한다. 문장에 빈칸은 하나뿐이다.
- 빈칸 바로 앞에 관사를 쓰면 **a(n)** 으로 적는다. a 나 an 으로 쓰면 첫소리가 다른 선택지가 바로 지워진다.
- **문맥 단서를 2개 이상 심어라.** 정답 방향이 명확해 오답의 여지가 없어야 한다.
  - 부사 (deliberately, increasingly, spontaneously)
  - 결합 명사 (full-scale war, surface-level adjustments)
  - 대조 표현 (rather than, despite, instead of)
  - 시간·원인 표지

## 선택지 규칙
- 선택지는 5개.
- **정답 개수를 문항마다 다르게 한다.** ${items.length}문항 전체에서 3개 정답 1~2문항,
  2개 정답 1~2문항, 1개 정답 1문항이 되도록 흩어라.
- 정답은 표제어와 그 유의어에서 고른다. 표제어를 일부러 정답에서 빼고 유의어만 정답으로 삼아도 된다.

## 오답 규칙 — 소거만으로 풀리면 안 된다
오답이 모두 정답과 반대 방향이면, 학생은 정답 단어를 몰라도 "쉬운 반대말" 을 지우고 남은 것을 다 골라 맞힌다.
그래서 오답은 아래 두 갈래로만 만든다.

1. **버리는 오답 — 문항마다 1개 이상.** 정답과 반대 방향의 쉬운 말. 누구나 지울 수 있는 선지다. 반의어 후보는 여기에 쓴다.
2. **근접 오답 — 문항마다 정확히 1개.** 정답과 **같은 방향**이거나 **형태가 비슷하지만**, 이 문장의
   **문맥 · 연어(단어 결합) · 사실관계** 때문에 들어갈 수 없는 말. 정답 단어의 뜻과 쓰임을 정확히 아는 학생만 걸러낼 수 있어야 한다.
${NEAR_DISTRACTOR_EXAMPLES.map((e) => `   - 정답 ${e.answer} 자리의 **${e.near}** — ${e.why}`).join('\n')}

- 근접 오답이 다른 정답으로 읽힐 여지가 조금이라도 있으면 안 된다 — 복수 정답 시비가 난다.
  문장 속 단서(문맥 · 연어 · 사실관계) 하나로 **분명히** 걸러져야 한다. 만든 뒤 따로 풀어 보며 점검한다.
- **오답마다 틀린 이유를 한 마디씩** reasons 에 적는다 — 버리는 오답도, 근접 오답도. 정답해설에 그대로 실린다.
- **선택지 낱말은 고3(수능) 수준 이내.** 문항을 어렵게 만드는 것은 드문 낱말이 아니라 근접 오답과 정답의 가까움이다.
  수능 범위를 넘는 드문 말 · 문어적인 말 · 낯선 숙어는 쓰지 마라. (✗ ${BEYOND_EXAM_DISTRACTORS.join(', ')})
- **고난도 문항 1~2개.** ${items.length}문항 가운데 1~2문항(20~30%)은 근접 오답이 정답과 아주 가까워 연어나 미묘한 뜻 차이로만
  갈리는 고난도로 만들고 hard 를 true 로 적는다. 나머지 문항의 근접 오답은 문맥 단서로 비교적 분명히 걸러진다.
- 정답과 오답을 섞어 배치한다. 정답이 특정 번호에 몰리지 않게 한다.

## 대상 표제어
${body}${avoidBlock(avoid)}

## 출력 형식
{
  "items": [
    {
      "id": "입력의 id 그대로",
      "sentence": "빈칸이 든 25~40단어 문장",
      "choices": ["①에 올 말", "②", "③", "④", "⑤"],
      "answers": [2, 4, 5],
      "roles": ["버림", "정답", "근접", "정답", "정답"],
      "reasons": ["반대 방향 — 함께하는 사람이 아니라 맞서는 사람", "", "같은 사람 계열이지만 '그냥 아는 사이' 라 faithful 과 안 맞음", "", ""],
      "hard": false,
      "clues": ["정답 방향을 가리키는 표현", "또 하나"],
      "translation": "문장 전체의 한국어 번역"
    }
  ]
}

answers 는 1부터 시작하는 번호다. roles 는 choices 와 같은 순서로, 정답이면 "정답", 버리는 선지(반대 방향 쉬운 말)면 "버림",
근접 오답(같은 방향이거나 형태가 비슷하지만 문맥 · 연어 · 사실관계로 틀리는 말)이면 "근접" 이다.
"근접" 은 문항마다 정확히 1개, "버림" 은 1개 이상이다. reasons 도 choices 와 같은 순서로, 정답 자리는 빈 문자열,
오답 자리는 틀린 이유를 40자 이내 한국어 한 마디로 적는다. hard 는 고난도 문항이면 true. items 는 입력 ${items.length}개 전부를 순서대로 포함해야 한다.`
}

/* ------------------------------------------------------------------ */
/* PART V 복수 정답 점검                                              */
/* ------------------------------------------------------------------ */

/**
 * 만든 PART V 를 정답을 알려 주지 않고 다시 풀게 한다. 오답(특히 근접 오답)을 답으로 고르거나
 * 애매하다고 하면 다른 정답으로 읽힐 여지가 있다는 뜻이다 — 받은 쪽(quizClient)이 정답과 견줘 짚는다.
 * @param {{items: Array<{id, sentence, choices}>}} payload
 */
export function buildPartVCheckPrompt({ items }) {
  const body = items
    .map((it, i) => `${i + 1}. id=${it.id}\n   ${it.sentence}\n   ${it.choices.map((c, k) => `${'①②③④⑤'[k]} ${c}`).join('   ')}`)
    .join('\n\n')

  return `${JSON_ONLY}

너는 수능 영어 문항을 검토하는 꼼꼼한 교사다. 아래 문항은 "빈칸에 들어가기에 적절한 단어를 모두 고르시오" 이고,
정답은 문항마다 1~3개다. 정답을 모른다고 생각하고 문장만 보고 직접 풀어라.

- 빈칸에 문맥 · 어법 · 연어(단어 결합) · 사실관계 모두 자연스럽게 들어가는 선택지를 fits 에 모두 적는다.
- 출제자의 의도를 짐작하지 마라. 학생이 "이것도 답 아닌가요?" 하고 따질 만한 선택지는 fits 에 넣지 말고
  doubtful 에 이유와 함께 적는다.
- 번호는 1부터 센다(① = 1).

## 문항
${body}

## 출력 형식
{
  "items": [
    { "id": "입력의 id 그대로", "fits": [2, 4], "doubtful": [ { "choice": 3, "why": "이것도 답으로 읽힐 수 있는 이유 40자 이내 한국어" } ] }
  ]
}

items 는 입력 ${items.length}개 전부를 순서대로 포함해야 한다. doubtful 이 없으면 빈 배열이다.`
}

/* ------------------------------------------------------------------ */
/* PART VI — 지문형 빈칸 (서사)                                        */
/* ------------------------------------------------------------------ */

/**
 * @param {{items, startNo?: number, opening?: number, ending?: number}} payload
 *   opening · ending 은 STORY_OPENINGS · STORY_ENDINGS 의 번호. 없으면 여기서 무작위로 고른다 —
 *   같은 틀을 매주 되풀이하지 않게 한다.
 */
export function buildPartVIPrompt({ items, startNo = 31, opening, ending, avoid }) {
  const pick = (list, i) => list[Number.isInteger(i) && i >= 0 && i < list.length ? i : Math.floor(Math.random() * list.length)]
  const openWith = pick(STORY_OPENINGS, opening)
  const endWith = pick(STORY_ENDINGS, ending)
  const body = items
    .map((it, i) => `${i + 1}. id=${it.id}  ${it.headword} (${it.pos}) — 뜻: ${it.meaning}`)
    .join('\n')

  const numbers = items.map((_, i) => startNo + i)

  return `${JSON_ONLY}

${COMMON}

아래 ${items.length}개 단어가 빈칸으로 들어가는 **하나의 짧은 이야기**를 쓴다.

## 서사 규칙
- **90~110 단어.** 인물 한 사람을 중심으로 한 이야기여야 한다.
- 직업·배경을 구체적으로 잡는다 (교사·의사·예술가·자원봉사자·과학자·제빵사·농부 등).
- 고등학생이 읽어서 흥미로울 만한 내용으로 쓴다.
- **도입: ${openWith}.**
  "Elena Ruiz spent thirty years as a child psychologist in a coastal town." 처럼 이름 · 경력 연수 · 직업 · 장소를
  한 문장에 늘어놓는 소개로 시작하지 마라. "[이름] spent/had spent N years as a [직업] …" 틀은 금지다.
  인물의 직업과 배경은 장면 속에서 자연스럽게 드러낸다.
- **마무리: ${endWith}.**
  교훈 · 칭찬 · 요약 문장으로 끝내지 마라. 인물의 덕목(patience, persistence, kindness, dedication, respect …)을
  이름 붙여 말하는 문장은 금지다. 금지 예: "His patience proved that steady care builds community." ·
  "Her quiet persistence inspired the whole lab." · "…, and she treated each one with patience and respect."
  인물이 어떤 사람인지는 행동과 장면으로만 보여준다.

## 빈칸 규칙
- 빈칸은 ${items.length}개. 본문에 \`{${numbers[0]}}\` \`{${numbers[1]}}\` … 형태로 번호를 넣어 표시한다.
- 빈칸 번호는 ${numbers.join(', ')} 를 순서대로 쓴다.
- 빈칸이 연달아 붙거나 한곳에 몰리지 않게 **고르게 흩어라.**
- **주어진 단어를 변형 없이 원형 그대로** 넣을 수 있는 자리를 만들어라.
  (조동사 뒤 동사원형, to + 동사원형, 명사 자리, 형용사 자리, 부사 자리)
- 빈칸 바로 앞에 관사를 쓰면 **a(n)** 으로 적는다 (\`a(n) {${numbers[0]}}\`). a 나 an 으로 쓰면 첫소리가 다른 보기가
  후보에서 빠져 답이 드러난다.
- 앞뒤 맥락만으로 어떤 단어가 들어갈지 추론할 수 있어야 한다.

## 넣을 단어
${body}${avoidBlock(avoid)}

## 출력 형식
{
  "story": "{${numbers[0]}} 같은 번호 표시가 든 90~110단어 본문",
  "blanks": [
    { "no": ${numbers[0]}, "id": "입력의 id 그대로", "answer": "그 자리에 들어갈 단어", "clue": "무엇이 단서인지 20자 이내 한국어" }
  ],
  "translation": "본문 전체의 한국어 번역 (정답 단어 자리는 그대로 번역)"
}

blanks 는 ${items.length}개 전부를 번호 순서대로 포함해야 한다.`
}
