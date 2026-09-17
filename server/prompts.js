/**
 * 정상JLS 심화단어장 — AI 프롬프트 정의
 *
 * 모든 프롬프트는 stdin으로 claude -p 에 전달된다.
 * (Windows에서 인자 따옴표 문제를 피하기 위해 --system-prompt 대신 본문 앞머리에 규칙을 둔다.)
 */

export const JSON_ONLY = `너는 JSON만 출력하는 API다.
설명, 인사말, 마크다운 코드펜스(\`\`\`) 없이 순수 JSON 하나만 출력한다.
출력의 첫 글자는 { 이고 마지막 글자는 } 여야 한다.`

/* ------------------------------------------------------------------ */
/* 1. AI 자동 표제어 추출                                              */
/* ------------------------------------------------------------------ */

export function buildSelectPrompt({ passages, exclude = [] }) {
  const total = passages.reduce((sum, p) => sum + p.quota, 0)

  // 지문별 목표를 본문 앞에 표로 한 번, 각 지문 머리에 한 번 더 적는다.
  // 한 번만 적으면 모델이 앞 지문에서 개수를 다 써버리고 뒤 지문을 비운다.
  const plan = passages.map((p) => `- 지문 ${p.no}: ${p.quota}개`).join('\n')
  const body = passages
    .map((p) => `### 지문 ${p.no} — 이 지문에서 정확히 ${p.quota}개\n${p.english}`)
    .join('\n\n')

  const excludeBlock = exclude.length
    ? `

## 이미 고른 표현 — 다시 고르지 마라 (${exclude.length}개)
${exclude.map((s) => `- ${s}`).join('\n')}`
    : ''

  return `${JSON_ONLY}

너는 한국 고등학생 대상 수능 영어 심화단어장을 만드는 어휘 전문가다.
아래 영어 지문 ${passages.length}개에서 표제어로 삼을 표현을 **지문마다 정해진 개수만큼** 골라라.

## 지문별 목표 개수 (합계 ${total}개)
${plan}

이 배정은 지문 분량에 비례해 미리 계산된 것이다. **임의로 바꾸지 마라.**
한 지문에서 개수를 더 채우고 다른 지문을 비우는 것은 잘못된 출력이다.

## 선정 기준
- 한국 고등학생 기준으로 학습 가치가 높은 심화 어휘를 우선한다.
- 초급 어휘(the, have, good, people 같은 기초 단어)는 제외한다.
- **고유명사는 가능한 한 고르지 마라.** 인명·지명·기관명·상표명·작품명은 학습 가치가 낮다.
  (Csikszentmihalyi, Europe, the Renaissance, Harvard 등)
  그 지문의 핵심 개념어라서 빼놓을 수 없을 때만 예외로 고른다.
- 표제어는 한 단어일 수도 있고, 어구(구동사, 연어, 관용표현)일 수도 있다.
- 어구는 전체의 15~25% 정도가 되도록 한다.
- 같은 표현을 이 요청 안에서 두 번 고르지 마라.

## difficulty — 한국 고등학생 기준 체감 난이도 (필수)
항목마다 1~5의 정수를 매긴다. 이 값으로 최종 표제어를 추리므로 성실하게 매겨야 한다.

| 값 | 기준 |
| --- | --- |
| 5 | 수능 최상위권도 어려워하는 저빈도 학술 어휘 |
| 4 | 수능 빈출 심화 어휘 — 모르면 문장 해석이 막힌다 |
| 3 | 고등 교과 수준 — 대개 알지만 정확한 뜻은 흔들린다 |
| 2 | 중학 수준 — 대부분 안다 |
| 1 | 기초 어휘 — 학습 가치가 없다 |

- **전부 4~5로 매기지 마라.** 지문 안에서의 상대적 난이도가 드러나야 한다.
- 1~2에 해당하는 것은 애초에 고르지 마라.
- **각 지문의 항목은 어려운 것부터 차례로 나열하라.** 배정된 개수보다 넉넉히 뽑으라고 했으므로,
  이 순서가 곧 그 지문에서 무엇을 먼저 살릴지의 기준이 된다. 점수가 같아도 순서는 지켜야 한다.

## surface 규칙 (매우 중요)
"surface"는 지문에 **실제로 나타난 문자열 그대로**여야 한다.
대소문자, 굴절어미(-ed, -ing, -s), 하이픈까지 원문과 정확히 일치해야 한다.
원형으로 바꾸지 마라. 원형 변환은 다음 단계에서 처리한다.
지문에 없는 문자열을 만들어내면 안 된다.

## 지문
${body}${excludeBlock}

## 출력 형식
{
  "items": [
    { "passageNo": 1, "surface": "지문에 나온 그대로의 문자열", "difficulty": 4, "reason": "선정 이유 10자 이내" }
  ]
}

## 개수 (엄격)
지문별 목표 개수를 **지문마다 따로** 맞춰라. 합계만 맞으면 되는 것이 아니다.
출력을 끝내기 전에 지문 번호별로 항목을 세어, 위 표와 일치하는지 확인하라.
어느 지문이 분량이 짧아 배정된 개수를 채우기 어렵다면, 억지로 기초 어휘를 넣지 말고
그 지문에서 찾을 수 있는 만큼만 담아라. 개수를 맞추려고 학습 가치 없는 단어를 넣는 것이 더 나쁘다.
그렇다고 그 부족분을 다른 지문에서 더 뽑아 메우지는 마라.`
}

/* ------------------------------------------------------------------ */
/* 2. 표제어 정규화 + 파생어 / 유의어 / 반의어 생성                     */
/* ------------------------------------------------------------------ */

export function buildEnrichPrompt({ items, antonymTargetRatio = 0.4 }) {
  const body = items
    .map(
      (it, i) =>
        `${i + 1}. id=${it.id}\n   선택된 표현: ${it.surface}\n   출처 지문: ${it.passageNo}\n   출처 문장: ${it.sentence}`
    )
    .join('\n')

  const antonymCount = Math.round(items.length * antonymTargetRatio)

  return `${JSON_ONLY}

너는 한국 고등학생 대상 수능 영어 심화단어장을 만드는 어휘 전문가다.
아래 ${items.length}개 항목 각각에 대해 표제어를 정규화하고 파생어·유의어·반의어를 생성하라.

## 0) 표기 원칙 (모든 항목에 적용)
표제어·파생어·유의어·반의어는 **전부 소문자로** 적는다. 예외는 두 가지뿐이다.

1. 구문 틀의 자리표시자 A, B — 단어가 아니라 기호이므로 대문자로 남긴다.
2. **고유명사** — 원래 표기대로 첫 글자를 대문자로 둔다.
   (Csikszentmihalyi, Europe, European, the Renaissance, Harvard)
   이 항목은 properNoun 을 true 로 표시한다. 고유명사가 아니면 false 로 둔다.
   고유명사에서 파생된 형용사(European, Shakespearean)도 고유명사로 본다.

## 1) 표제어(headword) 정규화 규칙
선택된 표현을 원칙적으로 **그대로** 표제어로 쓴다(소문자로 낮춘 것 외에는). 단, 아래 예외를 적용한다.

- 현재분사 또는 동명사로 쓰인 경우 → 동사 원형으로 바꾼다. (developing → develop)
- 과거형, 과거완료, 3인칭 단수 현재형 → 동사 원형으로 바꾼다. (occurred → occur, matches → match)
- 과거분사인 경우:
  - 완료형(have/has/had + p.p.)이나 수동태(be + p.p.)의 일부라면 → 동사 원형으로 바꾼다.
  - 그 외(형용사적으로 쓰인 과거분사 등)라면 → **그대로 둔다**. (a broken window → broken)
- 현재분사형이지만 **사전에 독립된 형용사로 등재될 만큼 고착화된** 표현만 → 그대로 둔다.
  (interesting, challenging, demanding, outstanding, promising, striking, appealing 등)
  - 판별 기준: 그 형태가 동사의 진행 의미를 넘어서는 **독자적인 뜻**을 갖는가?
    challenging = "힘든"(동사 challenge의 진행 의미와 다름) → 유지.
  - **단지 명사를 앞에서 꾸미고 있다는 이유만으로 형용사로 보지 마라.**
    "widening inequality"의 widening, "rising costs"의 rising, "growing concern"의 growing은
    동사의 뜻 그대로이므로 → 원형(widen, rise, grow)으로 바꾼다.
- **복수형 명사는 반드시 단수형으로 바꾼다.**
  (societies → society, opportunities → opportunity, phenomena → phenomenon, criteria → criterion,
   children → child, analyses → analysis)
  - 어구 안에 들어 있는 복수형도 단수로 바꾼다. (cascading effects → cascading effect)
  - 단, 항상 복수로만 쓰이는 명사는 그대로 둔다. (goods, means, species, statistics, savings, belongings)
- 어구는 어구 전체를 표제어로 두되, 위 규칙을 어구의 핵심어에 적용한다.
  (예: "was drawing on" → "draw on")
- **어구 안의 인칭 표현은 사전 표기로 일반화한다.** 지문의 인칭을 그대로 남기지 마라.
  - 소유격(my, your, his, her, our, their) → **one's**
    (at their disposal → **at one's disposal**, make up your mind → **make up one's mind**,
     caught his eye → **catch one's eye**, on our behalf → **on one's behalf**)
  - 재귀대명사(myself, yourself, himself, herself, ourselves, themselves) → **oneself**
    (pride themselves on → **pride oneself on**, avail themselves of → **avail oneself of**)
  - 목적격 자리에 사람이 오는 틀이면 A로 둔다. (take her into account → take A into account)
  - **예외**: its, itself 처럼 사물을 가리키며 그 형태로 굳어진 것은 그대로 둔다.
    (take its toll, run its course, in itself, an end in itself)
- 판단은 **출처 문장에서의 실제 쓰임**을 근거로 하라. 사전형만 보고 판단하지 마라.

### 1-2) 구문 틀(상관어구)의 자리 채우기 → A·B로 일반화
선택된 어구가 **짝을 이루는 구문 틀**이고 그 사이에 구체적인 내용어가 채워져 있다면,
내용어를 자리표시자로 바꿔 **틀만 남긴다.**

- "Not only my brother but also my sister" → "not only A but also B"
- "either coffee or tea" → "either A or B"
- "neither the teacher nor the students" → "neither A nor B"
- "both economic growth and social equity" → "both A and B"
- "not a burden but an opportunity" → "not A but B"
- "prefer walking to driving" → "prefer A to B"
- "as expensive as a new car" → "as 형용사 as B"
- "so complex that no one could explain it" → "so 형용사 that 주어+동사"
- "too abstract to grasp" → "too 형용사 to 동사원형"
- "The more he practiced, the better he became" → "the 비교급 A, the 비교급 B"

규칙:
- 자리표시자는 A, B를 기본으로 쓰고, 품사가 고정된 자리는 그 품사 이름을 쓴다
  (형용사, 부사, 동사원형, 주어+동사).
- 영어 단어는 모두 소문자로 적는다. 자리표시자 A, B만 대문자로 남긴다.
- 틀이 아닌 **관용구·구동사·연어는 이 규칙을 적용하지 말고 그대로 둔다.**
  (lose track of time, sift through, bring about, take A into account 같이 이미 자리표시자가 관례인 것은 제외)
- 이 경우 pos는 "어구"로 하고, 파생어는 빈 배열로 둔다.

## 2) 파생어(derivatives)
- 최대 2개. 없으면 빈 배열.
- 한국 고등학생이 알아둘 가치가 있는 유용한 파생어만 고른다.
- 우선순위: 명사형 > 형용사형 > 동사형 > 부사형.
- 단, 특히 자주 쓰이면서 형태가 독특하거나 예외적인 파생어는 우선순위를 무시하고 먼저 넣는다.
- 표제어와 형태가 거의 같은 뻔한 파생어(-ly만 붙인 것 등)는 다른 좋은 후보가 있으면 피한다.
- 각 파생어에 품사를 함께 표기한다.

## 3) 유의어(synonyms)
- 적절한 유의어가 존재한다면 **항상 2개**를 생성한다.
- 가장 중요한 조건: **출처 문장에서 표제어 자리를 그대로 대체할 수 있어야 한다.**
  - 대체했을 때 어법 오류가 생기면 안 된다. (자동사/타동사, 전치사 결합, 가산/불가산 등)
  - 대체했을 때 어색하거나 문맥상 뜻이 달라지면 안 된다.
  - 뜻이 비슷해 보여도 이 조건을 못 맞추면 넣지 마라.
- 조건을 만족하는 유의어가 1개뿐이면 1개만, 하나도 없으면 빈 배열.
- 각 유의어에 대해 출처 문장에 실제로 대입해보고 판단하라.
- 표제어가 구문 틀(A·B 형태)이면 유의어도 **같은 뜻의 다른 틀**로 적는다.
  (Not only A but also B → B as well as A / not just A but B)
- **표기 형태**: 판단은 문장에 대입해서 하되, 적어 넣을 때는 표제어와 같은 형태(동사는 원형, 명사는 단수)로 적는다.
  (표제어가 match면 "corresponds to"가 아니라 "correspond to", 표제어가 immerse면 "absorbed"가 아니라 "absorb")

## 4) 반의어(antonyms)
- **꼭 맞는 좋은 반의어가 존재할 때만** 생성한다. 최대 2개.
- 억지스러운 반의어는 넣지 마라. 없으면 빈 배열이 정상이다.
- 이번 묶음 ${items.length}개 중 반의어를 다는 항목은 **약 ${antonymCount}개**가 되도록 하라.
  (전체의 ${Math.round(antonymTargetRatio * 100)}% 수준. 이보다 많으면 안 된다.)
- 각 항목에 confidence(1~5)를 매긴다. 5는 사전적으로 확립된 명확한 반의어, 1은 억지스러운 것.
  confidence가 3 미만이면 반의어를 넣지 마라.

## 5) 품사(pos) — 반드시 한 글자로
표제어가 출처 문장에서 갖는 품사를 **한 글자로만** 적는다.

| 품사 | 표기 |
| --- | --- |
| 명사 | 명 |
| 동사 | 동 |
| 형용사 | 형 |
| 부사 | 부 |
| 전치사 | 전 |
| 접속사 | 접 |
| 대명사 | 대 |
| 어구(두 단어 이상) | 구 |

"명사", "형용사"처럼 두 글자 이상으로 적지 마라. 파생어의 pos도 같은 한 글자 표기를 쓴다.

## 6) 뜻(meaning) — 한국어
표제어가 **출처 문장에서 실제로 쓰인 의미**를 한국어로 적는다.

- 사전 뜻풀이를 나열하지 마라. 그 문장에 대입했을 때 **가장 자연스러운 의미 하나만** 적는다.
- 쉼표로 여러 뜻을 늘어놓지 마라. 하나다.
- 품사에 맞는 어미를 쓴다. 명사는 명사형("몰입"), 동사는 "~하다"형("몰두하다"),
  형용사는 "~한"형("힘든"), 부사는 "~하게"형("힘들이지 않고").
- 어구는 문장에서 갖는 뜻을 자연스러운 한국어로 적는다. ("시간 가는 줄 모르다")
- 구문 틀은 틀 자체의 뜻을 적는다. (not only A but also B → "A뿐만 아니라 B도")
- 같은 단어라도 문장이 다르면 뜻이 달라진다. **어떤 뜻갈래인지는 반드시 그 출처 문장을 근거로** 정하라.
  ("New ideas spring from..." 의 spring → "봄"이 아니라 "생겨나다")

**원형으로 바꾼 경우의 뜻 (중요)**
표제어를 원형으로 되돌렸다면 뜻도 **원형 기준**으로 적는다. 문장의 태(態)를 따라가지 마라.

- 수동태를 원형으로 되돌린 동사는 **타동사 뜻**으로 적는다.
  - "individuals are immersed in a flow state" → 표제어 immerse, 뜻은 "몰두하다"가 아니라 **"몰두시키다"**
  - "the votes were tallied" → 표제어 tally, 뜻은 "집계되다"가 아니라 **"집계하다"**
  - "was brought about by" → 표제어 bring about, 뜻은 "야기되다"가 아니라 **"야기하다"**
- 이것은 능동/수동 방향만의 문제다. 어느 뜻갈래를 고를지는 여전히 출처 문장을 따른다.

## 입력 항목
${body}

## 출력 형식
{
  "results": [
    {
      "id": "입력의 id 그대로",
      "headword": "정규화된 표제어",
      "normalizationNote": "원형으로 바꿨다면 이유 15자 이내, 그대로면 빈 문자열",
      "properNoun": false,
      "pos": "동",
      "meaning": "발전하다",
      "derivatives": [ { "word": "development", "pos": "명" } ],
      "synonyms": [ { "word": "evolve" }, { "word": "advance" } ],
      "antonyms": [ { "word": "decline", "confidence": 4 } ]
    }
  ]
}

results 배열은 입력 항목 ${items.length}개 전부를 입력 순서대로 포함해야 한다.
id는 입력에 주어진 값을 절대 바꾸지 말고 그대로 사용하라.`
}
