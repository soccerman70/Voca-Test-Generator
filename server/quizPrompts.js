/**
 * 시험지 PART II · III · V · VI 프롬프트.
 * PART I 과 IV 는 단어장에 있는 것만으로 조립되므로 AI 를 부르지 않는다.
 *
 * 네 PART 는 서로 의존이 없어 동시에 호출한다.
 * 규칙은 지시로 걸되, 어긴 것은 받은 뒤 코드로 걸러낸다 (개수 보장을 코드로 하는 것과 같은 방식).
 */

import { JSON_ONLY } from './prompts.js'
import {
  BEYOND_EXAM_DISTRACTORS,
  EXAM_LEVEL_DISTRACTOR_EXAMPLES,
  STORY_OPENINGS,
  STORY_ENDINGS,
} from '../src/lib/quizRules.js'

const COMMON = `너는 한국 고등학생 대상 수능 영어 어휘 심화 시험지를 만드는 출제자다.
문항은 실제 학평 수준이어야 하고, 학생이 어림짐작으로 맞힐 수 있으면 안 된다.`

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
  const line = (it, extra) => `id=${it.id}  ${it.headword} (${it.pos}) — 뜻: ${it.meaning}${extra}`

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
- 어느 후보를 골라도 그런 말이 있으면, 그 말들을 rivals 에 **빠짐없이** 적는다. 코드가 힌트 글자를 늘려
  (shr___ · com___) 정답만 남게 한다. 그런 말이 없으면 rivals 는 빈 배열이다.

## 공통
- 다섯 문항의 관계 유형(동사:명사 / 형용사:명사 / 동사:형용사 / 부사:부사 …)이 서로 겹치지 않게 흩어라.
- 정답은 반드시 아래에 주어진 후보 안에서 고른다. 없는 말을 지어내지 마라.

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

export function buildPartVPrompt({ items }) {
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
- **선택지 난이도는 고3(수능) 수준에 맞춘다.** 한국 고3 학생이 수능을 준비하며 익히는 어휘로 오답을 고른다.
  기초어(good, bad, fail, lose, happy 같은 중학 수준 말)만으로 채우지 말고, 그렇다고 수능 범위를 넘는 드문 말 · 문어적인 말 ·
  낯선 숙어도 쓰지 마라 — 학생은 문맥 단서로 오답을 걸러내야 한다.
  (✗ 수능을 넘는 말: ${BEYOND_EXAM_DISTRACTORS.join(', ')}
   ✓ 수능 수준: ${EXAM_LEVEL_DISTRACTOR_EXAMPLES.join(', ')})
- **오답을 반대 뜻 말로만 채우지 마라.** 정답은 같은 뜻 무리, 오답은 모두 반대 뜻 무리로 짜면 학생이 뜻의 방향만 보고
  두 무리를 갈라 풀 수 있다. 한 문항의 오답 가운데 반대 방향 말은 **많아야 2개**이고, 나머지 오답은
  - 같은 화제에서 나올 법하지만 이 문장의 문맥 단서와 맞지 않는 말
    (예: 빈칸이 '함께 고생한 동반자' 자리인데 witness, stranger)
  - 뜻은 그럴듯하지만 빈칸 앞뒤 말과 어울리지 않는 말(연어 · 어법이 안 맞는 말)
  로 섞는다. 반의어 후보는 그 2개 안에서만 쓴다.
- 어떤 오답도 문맥상 들어갈 여지가 있으면 안 된다. 문장 속 단서 하나로 **분명히** 걸러져야 한다.
- ${items.length}개 문항의 오답 구성을 서로 다르게 한다. 다섯 문항이 한 가지 틀로 보이면 안 된다.
- 정답과 오답을 섞어 배치한다. 정답이 특정 번호에 몰리지 않게 한다.

## 대상 표제어
${body}

## 출력 형식
{
  "items": [
    {
      "id": "입력의 id 그대로",
      "sentence": "빈칸이 든 25~40단어 문장",
      "choices": ["①에 올 말", "②", "③", "④", "⑤"],
      "answers": [2, 4, 5],
      "roles": ["반대", "정답", "문맥", "정답", "정답"],
      "clues": ["정답 방향을 가리키는 표현", "또 하나"],
      "wrongWhy": "오답이 왜 안 되는지 40자 이내 한국어",
      "translation": "문장 전체의 한국어 번역"
    }
  ]
}

answers 는 1부터 시작하는 번호다. roles 는 choices 와 같은 순서로, 정답이면 "정답", 반대 방향 오답이면 "반대",
문맥 · 어울림이 안 맞는 오답이면 "문맥" 이다. items 는 입력 ${items.length}개 전부를 순서대로 포함해야 한다.`
}

/* ------------------------------------------------------------------ */
/* PART VI — 지문형 빈칸 (서사)                                        */
/* ------------------------------------------------------------------ */

/**
 * @param {{items, startNo?: number, opening?: number, ending?: number}} payload
 *   opening · ending 은 STORY_OPENINGS · STORY_ENDINGS 의 번호. 없으면 여기서 무작위로 고른다 —
 *   같은 틀을 매주 되풀이하지 않게 한다.
 */
export function buildPartVIPrompt({ items, startNo = 31, opening, ending }) {
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
- 앞뒤 맥락만으로 어떤 단어가 들어갈지 추론할 수 있어야 한다.

## 넣을 단어
${body}

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
