# 표제어 중복 검사 추가

선택한 표제어 중에 같은 단어 또는 파생 관계인 것이 섞여 있는지 찾아 알린다.

## 배경

지금은 어떤 중복 검사도 없다. 위치가 겹치는지만 본다.

- 지문 2의 `analysis`와 지문 5의 `analysis` → 둘 다 들어간다
- `societies`와 `society` → 생성 단계에서 둘 다 `society`로 정규화되어 **같은 줄이 두 개** 생긴다
- `developing`과 `development` → 학습자에겐 사실상 같은 어휘

정규화가 생성 단계에서 일어나기 때문에, 선택 화면에서는 멀쩡해 보이던 것이 결과 표에서 중복으로 드러난다.

## 결정 사항

- 파생형은 **경고만** 한다. 자동으로 빼지 않는다. (`economy` / `economic` 처럼 둘 다 가치 있는 경우가 있다)
- 검사 시점은 **선택 화면 + 생성 전 확인 창** 두 곳.
- AI 자동 추출에서 돌아온 **완전 중복만** 코드로 막는다. 파생형은 통과시키고 경고로 넘긴다.

## 작업

- [x] `src/lib/duplicates.js` — 굴절/파생 어간 추출과 중복 그룹 탐지
      → 검증: 아래 판정 표의 기대값을 모두 통과
- [x] 검증 스크립트로 오탐·미탐 확인
      → 검증: `ration`/`rat` 같은 짧은 어근 오탐이 없어야 함
- [x] `Workspace.jsx` — 중복 계산해 하위로 전달, AI 자동 추출에서 완전 중복 차단
      → 검증: 자동 추출 후 같은 굴절형이 두 번 들어오지 않음
- [x] `SelectionPanel.jsx` — 선택 목록에 중복 표시
      → 검증: 중복 항목에 배지가 뜨고 몇 번째와 겹치는지 보임
- [x] `GenerateModal.jsx` — 생성 전 중복 목록 경고
      → 검증: 완전 중복과 파생형 의심이 구분되어 표시됨
- [x] lint · 빌드 · 스모크 테스트 통과

## 판정 기대값

| 입력 | 유형 | 이유 |
| --- | --- | --- |
| `society` / `societies` | 완전 중복 | 굴절형. 정규화 후 같아진다 |
| `develop` / `developed` / `developing` | 완전 중복 | 굴절형 |
| `analysis` / `analyses` | 완전 중복 | 불규칙 복수 |
| `develop` / `development` | 파생형 | 접미사 파생 |
| `economy` / `economic` | 파생형 | 둘 다 가치 있을 수 있어 경고만 |
| `immerse` / `immersion` | 파생형 | 어간 끝 `e` 처리 필요 |
| `ration` / `rat` | **중복 아님** | 어근이 짧아지면 잘라내지 않는다 |
| `less` / `lesson` | **중복 아님** | 같은 이유 |
| `lose track of time` / `lose` | **중복 아님** | 어구는 전체 문자열로만 비교한다 |

---

# 단어장 불러오기 → 시험지 생성

이미 만들어 둔 단어장 XLSX 를 열어 ①②③ 을 건너뛰고 곧장 ④ 시험지 화면으로 간다.

## 배경

시험지 로직(`quizAllocate` · `quizBuild` · `quizClient`)은 `rows` 배열만 보고 동작한다.
`App.jsx` 의 진입 조건도 이미 `quiz: rows.length > 0` 이라 **`rows` 를 채우면 ④ 로 갈 수 있다.**
새 파이프라인은 필요 없다. 문제는 XLSX 왕복에서 필드가 새는 것뿐이다.

내보내는 9열에 없는데 시험지가 쓰는 것.

| 필드 | 쓰임 | 없으면 |
| --- | --- | --- |
| `surface` | `answer: row.surface`, `verbForm(surface, headword)` | PART IV 형태 다양성이 전부 '원형'으로 무너진다 |
| `properNoun` | `allocate()` 의 출제 제외 조건 | 고유명사가 시험에 나온다 |
| `passageNo`(숫자) | `passages.find(p => p.no === ...)` | 앞뒤 문장 확장 불가 |
| `passages` | `renderPartIVItem` 문맥 확장 | fallback 으로 문장 하나만 쓴다 (동작은 함) |

## 결정 사항

- 불러오는 대상은 **이 앱이 내보낸 XLSX 만.** 외부 엑셀은 거절 메시지를 띄운다.
- 지문 원문 파일은 **선택 사항.** 없어도 시험지는 나온다.
- 기존 작업이 있으면 **확인 후 덮어쓴다.**
- 왕복 정보는 **숨김 시트**에 넣는다. 보이는 `심화단어장` 시트는 한 칸도 바꾸지 않는다 —
  선생님이 열어보는 파일의 모양이 달라지면 안 된다.
- `_meta` 는 JSON 한 덩어리가 아니라 **표 형태**로 넣는다. 셀 32767자 제한에 걸리지 않고,
  깨졌을 때 눈으로 확인할 수 있다.
- 숨김 시트가 없는 **옛 파일은 역추적으로 살린다.** 못 살린 개수는 화면에 알린다 —
  조용히 넘어가면 PART IV 가 왜 단조로운지 아무도 모른다.

## 작업

- [x] `exportXlsx.js` — `_meta`(surface·properNoun·passageNo) · `_passages`(no·label·english) 숨김 시트 추가
      → 검증: veryHidden 상태로 왕복 확인. 보이는 시트는 9열·채움·굵게 그대로, 지문이 없으면 `_passages` 를 만들지 않는다
- [x] `src/lib/importXlsx.js` — 워크북 → `{ rows, passages, docTitle, warnings }`
      → 검증: 왕복 후 시험지가 읽는 필드가 원본과 같다 (confidence 는 담지 않는다)
- [x] surface 역추적 — `_meta` 없는 옛 파일용. `sentence` 안에서 `headword` 의 굴절형을 찾는다
      → 검증: 아래 판정 표 11건 통과
- [x] 이 앱 파일인지 판별 — `심화단어장` 시트와 9열 헤더가 맞는지
      → 검증: 빈 엑셀과 헤더가 바뀐 파일 모두 거절
- [x] `store.js` — `loadWordbook({ rows, passages, docTitle })` 액션
      → 검증: 불러온 rows 로 낸 배정·통계·PART IV 문항이 원본과 같다
- [x] `SetupPanel.jsx` — "단어장 불러오기" 진입점과 확인 패널
      → 검증: 코드 · 스모크 테스트까지
- [ ] 화면에서 직접 눌러 확인 — 불러오기 → 확인 패널 → 덮어쓰기 확인 → ④ 진입
      → 검증: 기존 작업이 있을 때만 덮어쓰기를 묻고, 넘어간 뒤 배정이 바로 보인다
- [x] 지문은 단어장 안에 함께 담긴다 — 따로 올릴 필요가 없어졌다
      → 검증: 지문 있으면 앞 문장이 붙고(39·37단어), 없으면 문장 하나만 쓴다(19·21단어)
- [x] `tools/smoke-test.mjs` 에 왕복 테스트 추가 — [8] 단어장 불러오기 27건
      → 검증: AI 호출 없이 통과
- [x] lint · 빌드 · 스모크 테스트 통과

## 판정 기대값 (surface 역추적)

| headword | sentence 안의 형태 | 결과 |
| --- | --- | --- |
| `develop` | `Developing countries face this.` | `Developing` |
| `society` | `Modern societies face pressure.` | `societies` |
| `analysis` | `These analyses were rejected.` | `analyses` |
| `rely` | `They relied on it.` | `relied` |
| `immerse` | `She immersed herself in it.` | `immersed` (묵음 e 처리) |
| `occur` | `It occurred twice.` | `occurred` |
| `lose track of` | `They lose track of time.` | `lose track of` |
| `buy` | `He bought a house.` | **못 찾음** — 불규칙은 규칙으로 되돌릴 수 없다 |
| `lose track of` | `He lost track of time.` | **못 찾음** — 어구의 첫 낱말이 불규칙 변화 |
| `rate` | `The rats multiplied.` | **못 찾음** — 오탐 방지 (rate → rat 으로 줄이지 않는다) |
| `rat` | `The ration was small.` | **못 찾음** — 같은 이유 |

못 찾은 것은 `headword` 를 그대로 surface 로 두고 `warnings.failed` 에 담아 화면에 알린다.

---

# 자동 표제어 추출 — 지문별 쿼터 · 난이도 순 (2026-09-17)

지문이 많을 때 앞 지문만 채워지던 문제를 고치고, 고르는 기준에 난이도를 넣는다.

## 배경

지문 18개에 100개를 요청하면 **앞 10개 지문에서 100개를 다 채우고 끝났다.**
한 번의 호출에 지문 전부와 "정확히 100개"만 넘겼기 때문이다. 부족분 재요청도 같은 프롬프트라
뒤쪽 지문은 끝내 차례가 오지 않았다. 난이도로 고르는 단계는 아예 없었다.

## 결정 사항

- 지문별 목표(쿼터)는 **분량(단어 수)에 비례**해 코드가 정한다. 모델에게 나누라고 부탁하지 않는다.
- 쿼터는 프롬프트 **앞머리 표와 각 지문 머리에 두 번** 적는다.
- 지문은 **3개씩 묶어 동시에** 부른다. 각 호출이 자기 지문만 본다.
- 쿼터의 **1.5배**를 받아 난이도로 추린다.
- 최종 선별은 **지문별 쿼터 먼저(골고루) → 남은 자리는 전체 난이도순(어려운 것 우선).**
- 자리 겹침 · 굴절형 중복은 **받을 때가 아니라 고를 때** 거른다.
- 난이도 점수가 같으면 **AI가 지문 안에서 나열한 순서**를 따른다. 지문 속 위치는 기준이 아니다.

## 작업

- [x] `aiClient.js` — `planQuotas`: 분량 비례 · 최대잉여법으로 합계 일치 · 목표 ≥ 지문 수면 0개 지문 없음
      → 검증: 지문 18개 · 100개 요청에서 18개 지문 전부 쿼터를 정확히 채움, 빈 지문 없음
- [x] `prompts.js` — 지문별 목표 표, `difficulty`(1~5) 기준표, 지문 안 어려운 순 나열 지시
      → 검증: 첫 실측에서 98/100 이 4~5로 몰려 순위 지시를 추가함
- [x] `aiClient.js` — `autoSelect` 를 지문 3개 묶음 · 동시 4개 · 쿼터 1.5배 요청으로
      → 검증: 1회 요청 30초
- [x] `src/lib/selectPlan.js` — `runSelection` · `pickByDifficulty` · `levelOf` 로 선별 규칙 분리
      → 검증: 후보 161개 중 100개 채택. 난이도 3 은 33개 중 1개, 5 는 43개 중 42개 채택
- [x] 부족분 재요청은 **쿼터를 못 채운 지문에만** (`MAX_ROUNDS` 3)
- [x] `Workspace.jsx` 와 `tools/select-diagnose.mjs` 가 같은 `runSelection` 을 쓴다
      → 검증: 도구가 `VOCA_API_BASE` 로 실제 `autoSelect` 를 부른다
- [x] `samples/테스트지문18.txt` 추가 — 지문 4개짜리 `샘플지문.docx` 로는 재현되지 않았다
- [x] lint · 빌드 · 스모크 테스트 통과 (2026-11-03 재확인)
- [ ] 스모크 테스트에 `planQuotas` · `pickByDifficulty` 판정 추가
      → 둘 다 AI 없이 돌릴 수 있는 순수 함수인데, 지금은 실측(AI 호출)으로만 확인했다
