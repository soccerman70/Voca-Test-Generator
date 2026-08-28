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
      → 검증: 화면에서 직접 눌러 확인 (남음)
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
