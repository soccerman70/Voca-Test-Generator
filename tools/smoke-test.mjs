/**
 * 브라우저 없이 핵심 로직만 점검한다.
 *   node tools/smoke-test.mjs
 */
import mammoth from 'mammoth'
import { readFile } from 'node:fs/promises'
import { splitPassages, splitSentences, sentenceAt } from '../src/lib/passages.js'
import { tokenize, surfaceOf, locateSurface } from '../src/lib/tokenize.js'
import { guessPos, guessLevel, summarize } from '../src/lib/posLite.js'
import { parseGoogleLink, fileNameFrom, fileNameFor } from '../server/googleLink.js'
import { allocate, verbForm } from '../src/lib/quizAllocate.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures += 1
}

/* 1. docx 추출 + 지문 분할 --------------------------------------- */
console.log('\n[1] docx 추출 · 지문 분할')
const buffer = await readFile('samples/샘플지문.docx')
const { value: text } = await mammoth.extractRawText({ buffer })
check('docx 텍스트 추출', text.length > 500, `${text.length}자`)

const { passages, method } = splitPassages(text)
check('지문 4개로 분할', passages.length === 4, `${passages.length}개 / method=${method}`)
check('영어 본문에 한글 없음', passages.every((p) => !/[가-힣]/.test(p.english)))
check('한글 해석 분리됨', passages.every((p) => /[가-힣]/.test(p.korean)))
check('지문 번호 표시 제거됨', passages.every((p) => !/^\d+\./.test(p.english)), passages[0].english.slice(0, 40))

/* 2. 토큰화 · 선택 ---------------------------------------------- */
console.log('\n[2] 토큰화 · 표제어 선택')
const p1 = passages[0]
const tokens = tokenize(p1.english)
check('토큰 원문 복원', tokens.map((t) => t.text).join('') === p1.english)

const wordTokens = tokens.filter((t) => t.isWord)
const single = surfaceOf(p1.english, tokens, wordTokens[0].i, wordTokens[0].i)
check('단일 단어 선택', single.surface === wordTokens[0].text, single.surface)

const phrase = surfaceOf(p1.english, tokens, wordTokens[2].i, wordTokens[4].i)
check('드래그 어구 선택', /\s/.test(phrase.surface), phrase.surface)

const trimmed = surfaceOf(p1.english, tokens, wordTokens[2].i - 1, wordTokens[4].i + 1)
check('양끝 공백·부호 잘라냄', trimmed.surface === phrase.surface, trimmed.surface)

/* 3. AI 응답 문자열 → 토큰 위치 되찾기 ---------------------------- */
console.log('\n[3] AI surface 매칭')
for (const probe of ['absorption', 'lose track of time', 'Absorption', 'effortless  control']) {
  const hit = locateSurface(p1.english, tokens, probe)
  check(`"${probe}" 위치 확인`, Boolean(hit), hit ? p1.english.slice(hit.start, hit.end) : '못 찾음')
}
check('없는 표현은 null', locateSurface(p1.english, tokens, 'quantum entanglement') === null)

/* 4. 문장 분리 · 출처 문장 --------------------------------------- */
console.log('\n[4] 문장 분리')
const sents = splitSentences(p1.english)
check('문장 4개', sents.length === 4, `${sents.length}개`)
const at = locateSurface(p1.english, tokens, 'effortless control')
check('출처 문장 추출', sentenceAt(p1.english, at.start).includes('effortless control'))
check(
  '약어에서 안 끊김',
  splitSentences('Dr. Kim arrived at 9 a.m. He was late.').length === 2,
  JSON.stringify(splitSentences('Dr. Kim arrived at 9 a.m. He was late.'))
)

/* 5. 품사 추정 (문맥) · 난이도 · 메타 집계 ------------------------ */
console.log('\n[5] 품사 추정 (문맥 기반)')
const POS_CASES = [
  ['absorption', 'a state of complete absorption in a challenging activity', '명사'],
  ['significantly', 'contributes significantly to overall well-being', '부사'],
  ['challenging', 'absorption in a challenging activity', '형용사'],
  ['lose track of time', 'they lose track of time and experience control', '어구'],
  ['immersed', 'individuals are immersed in a flow state', '동사'],
  ['matches', 'when the level of challenge matches the level of skill', '동사'],
  ['underpins', 'Biodiversity underpins the functioning of ecosystems', '동사'],
  ['safeguard', 'not merely a concern but an essential safeguard for civilization', '명사'],
  ['erode', 'an overreliance on inference may erode the interpretive judgment', '동사'],
  ['compelling', 'The most compelling results tend to emerge later', '형용사'],
  ['reshaped', 'Urbanization has dramatically reshaped human societies', '동사'],
  ['spring', 'New ideas often spring from the collision of disciplines', '동사'],
  ['pressing', 'one of the most pressing concerns of our time', '형용사'],
  ['degradation', 'housing shortages, environmental degradation, and inequality', '명사'],
]
let posOk = 0
for (const [word, sentence, want] of POS_CASES) {
  const got = guessPos(word, sentence)
  if (got === want) posOk += 1
  check(`${word} → ${want}`, got === want, got)
}
check('미상이 하나도 없음', POS_CASES.every(([w, s]) => guessPos(w, s) !== '미상'))
check('문장 없이도 미상 없음', ['erode', 'safeguard', 'underpins'].every((w) => guessPos(w) !== '미상'))
console.log(`  문맥 품사 정확도: ${posOk}/${POS_CASES.length}`)

console.log('\n[5-2] 난이도 추정')
check('기초 단어 → 하', guessLevel('match') === '하', guessLevel('match'))
check('짧지만 기초 아님 → 중 이상', guessLevel('erode') !== '하', guessLevel('erode'))
check('4음절 → 상', guessLevel('degradation') === '상', guessLevel('degradation'))
check('접사 있는 3음절 → 중', guessLevel('effortless') === '중', guessLevel('effortless'))
check('긴 어구 → 상', guessLevel('lose track of time') === '상', guessLevel('lose track of time'))
check('구동사 → 중', guessLevel('sift through') === '중', guessLevel('sift through'))
check('5음절 → 상', guessLevel('overreliance') === '상', guessLevel('overreliance'))

console.log('\n[5-3] 메타 집계')
const stats = summarize([
  { surface: 'absorption', passageNo: 1, pos: '명사', level: '중' },
  { surface: 'lose track of', passageNo: 1, pos: '어구', level: '상' },
  { surface: 'significantly', passageNo: 2, pos: '부사', level: '중' },
])
check('집계 총계', stats.total === 3)
check('어구 개수', stats.phrases === 1)
check('지문별 분포', JSON.stringify(stats.byPassage) === '[{"no":1,"count":2},{"no":2,"count":1}]')
check(
  '난이도 집계',
  JSON.stringify(stats.levelCounts) === '[{"level":"상","count":1},{"level":"중","count":2},{"level":"하","count":0}]',
  JSON.stringify(stats.levelCounts)
)

/* 6. 다른 형식의 지문 파일 --------------------------------------- */
console.log('\n[6] 번호 없는 파일 (빈 줄 구분)')
const noMarker = `${passages[0].english}\n${passages[0].korean}\n\n${passages[1].english}\n${passages[1].korean}`
const r2 = splitPassages(noMarker)
check('번호 없어도 2개로 분할', r2.passages.length === 2, `${r2.passages.length}개 / method=${r2.method}`)

// 올림포스 문항 꼴: 꼬리표 머리 → 지문 → 각주 → 문항 번호·발문 → 문장 선지.
// 머리표가 "예제 01~02"에서 "PR-21-01~03"으로 바뀌며 번호가 다시 1부터 시작하고,
// 지문 뒤의 문항 번호는 원본에서부터 1, 2, 1, 4, 3 으로 어긋나 있다.
console.log('\n[6-2] 꼬리표 머리 · 지문 뒤 발문')
const enBody = (k) => `Body ${k} opens with a claim about learning. It then explains the claim with care. Finally it ends here.`
const choices = (k) => [1, 2, 3, 4, 5].map((c) => `${'①②③④⑤'[c - 1]} Choice ${c} of item ${k} is a full sentence.`).join('\n\n')
const item = (head, k, qno) =>
  `${head}\n\n${enBody(k)}\n\n*claim: 주장\n\n${qno}. 밑줄 친 ends here가 다음 글에서 의미하는 바로 가장 적절한 것은?\n\n${choices(k)}`
const workbook = [
  'QN 21: 함축적 의미',
  item('21_기출 예제 01', 1, 1),
  item('21_기출 예제 02', 2, 2),
  item('PR-21-01', 3, 1),
  item('PR-21-02', 4, 4),
  item('PR-21-03', 5, 3),
].join('\n\n')
const r3 = splitPassages(workbook)
check('두 묶음 합쳐 5개', r3.passages.length === 5, `${r3.passages.length}개 / ${r3.markerStyle}`)
check('묶음마다 첫 머리 표시', r3.markerSections.map((s) => s.sample).join(',') === '21_기출 예제 01,PR-21-01',
  JSON.stringify(r3.markerSections))
check('지문마다 제 본문', r3.passages.every((p, i) => p.english === enBody(i + 1)), r3.passages.map((p) => p.english.slice(0, 12)).join(' / '))

// 발문이 앞서지 않은 ①~⑤ 줄은 무관한 문장 문항처럼 지문 자체일 수 있으니 남긴다.
const numbered = `1.\nIntro sentence here.\n① First claim is made.\n② Second claim follows.\n③ Third claim closes.\n\n2.\n${enBody(9)}`
const r4 = splitPassages(numbered)
check('발문 없는 ①~③ 문장은 지문으로 남김', r4.passages[0]?.english.includes('Third claim closes.'), r4.passages[0]?.english)

/* 7. XLSX 워크북 --------------------------------------------- */
console.log('\n[7] XLSX 생성')
const { buildWorkbook, COLUMNS } = await import('../src/lib/exportXlsx.js')
const sampleRows = [
  {
    id: 'r1', passageNo: 1, surface: 'immersed', sentence: sents[1],
    headword: 'immerse', normalizationNote: '수동태 과거분사', pos: '동', meaning: '몰두하다',
    // 두 번째 파생어는 뜻이 없는 옛 꼴 — 뜻을 달기 전에 만든 단어장도 그대로 오가야 한다
    derivatives: [{ word: 'immersion', pos: '명', meaning: '몰입' }, { word: 'immersive', pos: '형' }],
    synonyms: [{ word: 'absorb' }, { word: 'engross' }],
    antonyms: [],
  },
  {
    id: 'r2', passageNo: 1, surface: 'lose track of time', sentence: sents[1],
    headword: 'lose track of time', normalizationNote: '', pos: '구', meaning: '시간 가는 줄 모르다',
    derivatives: [], synonyms: [{ word: 'become unaware of time' }],
    antonyms: [{ word: 'keep track of time', confidence: 5 }],
  },
]
const wb = buildWorkbook(sampleRows, { title: '정상JLS 심화단어장 — 점검' })
const buf = await wb.xlsx.writeBuffer()
check('워크북 바이트 생성', buf.byteLength > 3000, `${buf.byteLength} bytes`)

const { default: ExcelJS } = await import('exceljs')
const reread = new ExcelJS.Workbook()
await reread.xlsx.load(buf)
const ws = reread.getWorksheet('심화단어장')
check('시트 이름', Boolean(ws))
const col = (key) => COLUMNS.findIndex((c) => c.key === key) + 1
check('열 구성', COLUMNS.map((c) => c.header).join(',') === '번호,표제어,품사,뜻,파생어,유의어,반의어,출처,출처 문장',
  COLUMNS.map((c) => c.header).join(','))
check('헤더 행', ws.getRow(2).getCell(col('meaning')).value === '뜻', String(ws.getRow(2).getCell(col('meaning')).value))
check('표제어 셀', ws.getRow(3).getCell(col('headword')).value === 'immerse', String(ws.getRow(3).getCell(col('headword')).value))
check('품사 한 글자', ws.getRow(3).getCell(col('pos')).value === '동', String(ws.getRow(3).getCell(col('pos')).value))
check('뜻 셀', ws.getRow(3).getCell(col('meaning')).value === '몰두하다', String(ws.getRow(3).getCell(col('meaning')).value))
check('어구 품사', ws.getRow(4).getCell(col('pos')).value === '구', String(ws.getRow(4).getCell(col('pos')).value))
check(
  '파생어 셀 줄바꿈',
  ws.getRow(3).getCell(col('derivatives')).value === 'immersion (명) 몰입\nimmersive (형)',
  JSON.stringify(ws.getRow(3).getCell(col('derivatives')).value)
)
check('파생어 셀 wrapText', ws.getRow(3).getCell(col('derivatives')).alignment?.wrapText === true)

const { parseDerivatives } = await import('../src/lib/exportXlsx.js')
const DERIV_CASES = [
  ['development (명) 발전', [{ word: 'development', pos: '명', meaning: '발전' }]],
  ['development (명)', [{ word: 'development', pos: '명' }]],
  ['development 발전', [{ word: 'development', pos: '', meaning: '발전' }]],
  ['make up (동) 구성하다', [{ word: 'make up', pos: '동', meaning: '구성하다' }]],
  ['erosion (명) 침식, erosive (형) 침식성의',
    [{ word: 'erosion', pos: '명', meaning: '침식' }, { word: 'erosive', pos: '형', meaning: '침식성의' }]],
  // 뜻 안의 쉼표는 구분자가 아니다
  ['development (명) 발전, 개발', [{ word: 'development', pos: '명', meaning: '발전, 개발' }]],
]
for (const [text, want] of DERIV_CASES) {
  const got = parseDerivatives(text)
  check(`파생어 읽기 "${text}"`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))
}

const { withShortMeaning } = await import('../src/lib/aiClient.js')
const shortOf = (meaning) => withShortMeaning({ word: 'w', pos: '명', meaning }).meaning
check('파생어 뜻은 첫 뜻만', shortOf('발전, 개발') === '발전', shortOf('발전, 개발'))
check('파생어 뜻의 괄호 설명 제거', shortOf('발전(發展)') === '발전', shortOf('발전(發展)'))
check('빈 뜻은 키를 두지 않음', !('meaning' in withShortMeaning({ word: 'w', pos: '명', meaning: ' ' })))
// 번호만 적는다. 칸 이름이 이미 "출처"라 "지문"을 덧붙일 이유가 없다.
check('출처 셀', ws.getRow(4).getCell(col('source')).value === '1', String(ws.getRow(4).getCell(col('source')).value))
check('반의어 셀', ws.getRow(4).getCell(col('antonyms')).value === 'keep track of time', String(ws.getRow(4).getCell(col('antonyms')).value))
check('빈 반의어는 공란', !ws.getRow(3).getCell(col('antonyms')).value)

const { shortPos } = await import('../src/lib/aiClient.js')
check('품사 축약 매핑', ['명사', '형용사', '어구', '부사'].map(shortPos).join('') === '명형구부',
  ['명사', '형용사', '어구', '부사'].map(shortPos).join(''))
check('이미 한 글자면 그대로', shortPos('동') === '동')

/* 8. 단어장 불러오기 (왕복) ----------------------------------- */
console.log('')
console.log('[8] 단어장 불러오기')
const { parseWorkbook, recoverSurface } = await import('../src/lib/importXlsx.js')
const { META_SHEET } = await import('../src/lib/exportXlsx.js')

const samplePassages = [{ id: 'p1', no: 1, label: '1', english: p1.english, korean: p1.korean }]
const reload = async (workbook) => {
  const w = new ExcelJS.Workbook()
  await w.xlsx.load(await workbook.xlsx.writeBuffer())
  return parseWorkbook(w)
}

const back = await reload(buildWorkbook(sampleRows, { title: '2026 여름 SET B', passages: samplePassages }))
check('행 개수 유지', back.rows.length === 2, `${back.rows.length}개`)
check('surface 복원', back.rows[0].surface === 'immersed', back.rows[0].surface)
check('passageNo 는 숫자', back.rows[0].passageNo === 1, JSON.stringify(back.rows[0].passageNo))
check('파생어 되읽기', JSON.stringify(back.rows[0].derivatives) ===
  JSON.stringify([{ word: 'immersion', pos: '명', meaning: '몰입' }, { word: 'immersive', pos: '형' }]),
  JSON.stringify(back.rows[0].derivatives))
check('유의어 되읽기', back.rows[0].synonyms.map((x) => x.word).join(',') === 'absorb,engross')
check('빈 반의어는 빈 배열', back.rows[0].antonyms.length === 0)
check('사용자 제목 살아남음', back.docTitle === '2026 여름 SET B', back.docTitle)
check('지문 함께 복원', back.passages.length === 1 && back.passages[0].english === p1.english)
check('완전한 파일은 경고 없음', !back.warnings.metaMissing && back.warnings.failed.length === 0,
  JSON.stringify(back.warnings))

// 제목을 비운 채 내보내면 첫 줄이 기본 이름이다. 그것은 사용자가 정한 제목이 아니다.
const noTitle = await reload(buildWorkbook(sampleRows, { title: '정상JLS 심화단어장 — 11강.docx' }))
check('기본 제목은 빈 제목으로', noTitle.docTitle === '', JSON.stringify(noTitle.docTitle))
check('지문 없으면 빈 배열', noTitle.passages.length === 0)

// _meta 가 없는 옛 파일 — 출처 문장에서 되짚는다
const oldFile = buildWorkbook(sampleRows, { title: '옛 파일' })
oldFile.removeWorksheet(oldFile.getWorksheet(META_SHEET).id)
const recovered = await reload(oldFile)
check('_meta 없음을 알린다', recovered.warnings.metaMissing)
check('출처 칸이 숫자면 지문 번호를 되찾는다', recovered.rows[0].passageNo === 1,
  JSON.stringify(recovered.rows[0].passageNo))
check('역추적으로 surface 복원', recovered.rows[0].surface === 'immersed',
  `${recovered.rows[0].surface} / 못 찾음 ${JSON.stringify(recovered.warnings.failed)}`)

const recoverCases = [
  ['develop', 'Developing countries face this.', 'Developing'],
  ['society', 'Modern societies face pressure.', 'societies'],
  ['analysis', 'These analyses were rejected.', 'analyses'],
  ['rely', 'They relied on it.', 'relied'],
  ['immerse', 'She immersed herself in it.', 'immersed'],
  ['occur', 'It occurred twice.', 'occurred'],
  ['lose track of', 'They lose track of time.', 'lose track of'],
  // 규칙으로 되돌릴 수 없는 것들 — 못 찾았다고 알리는 것이 맞다
  ['buy', 'He bought a house.', null],
  ['lose track of', 'He lost track of time.', null],
  // 잘못 묶이면 안 되는 것들
  ['rate', 'The rats multiplied.', null],
  ['rat', 'The ration was small.', null],
]
for (const [head, sentence, want] of recoverCases) {
  const got = recoverSurface(head, sentence)
  check(`역추적 ${head} / ${want === null ? '없음' : want}`, got === want, JSON.stringify(got))
}

const junk = new ExcelJS.Workbook()
junk.addWorksheet('Sheet1').addRow(['a', 'b'])
let rejected = ''
try { await reload(junk) } catch (e) { rejected = e.message }
check('남의 엑셀은 거절', rejected.includes('심화단어장'), rejected.slice(0, 34))

const wrongHeader = buildWorkbook(sampleRows, { title: 'x' })
wrongHeader.getWorksheet('심화단어장').getRow(2).getCell(2).value = '단어'
let headerMsg = ''
try { await reload(wrongHeader) } catch (e) { headerMsg = e.message }
check('열 구성이 다르면 거절', headerMsg.includes('열 구성'), headerMsg.slice(0, 22))

/* 9. 고친 엑셀 다시 불러오기 (3단계) ----------------------------- */
console.log('\n[9] 고친 엑셀 다시 불러오기')
const { isSameWork, compareRows } = await import('../src/lib/importXlsx.js')

const editRows = [
  ...sampleRows,
  {
    id: 'r3', passageNo: 1, surface: 'occurs', sentence: sents[2],
    headword: 'occur', normalizationNote: '3인칭 현재', pos: '동', meaning: '일어나다',
    derivatives: [{ word: 'occurrence', pos: '명' }], synonyms: [{ word: 'happen' }], antonyms: [],
  },
  {
    id: 'r4', passageNo: 1, surface: 'achieving', sentence: sents[3],
    headword: 'achieve', normalizationNote: '동명사', pos: '동', meaning: '이루다',
    derivatives: [], synonyms: [{ word: 'attain' }], antonyms: [],
  },
]
const exported = () => buildWorkbook(editRows, { title: '고침 점검', passages: samplePassages })
const sheetOf = (w) => w.getWorksheet('심화단어장')
const cellAt = (w, r, key) => sheetOf(w).getRow(r).getCell(col(key))
const surfaces = (parsed) => parsed.rows.map((r) => r.surface).join('|')
const diffOf = (parsed) => JSON.stringify(compareRows(editRows, parsed.rows))

const untouched = await reload(exported())
check('그대로면 차이 없음', diffOf(untouched) === '{"changed":0,"added":0,"removed":0}', diffOf(untouched))
check('같은 지문의 단어장', isSameWork(untouched.rows, samplePassages))

const otherPassages = [{ id: 'q1', no: 1, label: '1', english: passages[1].english }]
check('다른 지문이면 다른 작업', !isSameWork(untouched.rows, otherPassages))
check('지문 없는 파일도 문장으로 알아본다', isSameWork(noTitle.rows, samplePassages))

// 엑셀에서 뜻 한 칸을 고쳤다
const w1 = exported()
cellAt(w1, 5, 'meaning').value = '발생하다'
const edited = await reload(w1)
check('고친 칸을 읽는다', edited.rows[2].meaning === '발생하다', edited.rows[2].meaning)
check('고친 줄 1개', diffOf(edited) === '{"changed":1,"added":0,"removed":0}', diffOf(edited))

// 출처 칸 이름을 바꿨다 (Week10 검수: Week10-1 → W10-1) — 보이는 이름을 따르고, 어느 지문인지(passageNo)는 그대로
const w1s = buildWorkbook(editRows.map((r) => ({ ...r, passageLabel: 'Week10-1' })), { title: '출처 고침', passages: samplePassages })
cellAt(w1s, 3, 'source').value = 'W10-1'
const relabeled = await reload(w1s)
check('고친 출처 이름을 따른다', relabeled.rows[0].passageLabel === 'W10-1' && relabeled.rows[0].passageNo === 1,
  JSON.stringify([relabeled.rows[0].passageLabel, relabeled.rows[0].passageNo]))

// 첫 줄을 지우고 번호를 1부터 다시 매겼다 — 번호 1 의 _meta 는 지운 줄(immersed)의 것이고,
// 그 surface 는 새 1번 줄의 문장에도 들어 있다. 번호만 믿으면 정답이 immersed 로 바뀐다.
const w2 = exported()
sheetOf(w2).spliceRows(3, 1)
for (let k = 0; k < 3; k += 1) cellAt(w2, 3 + k, 'no').value = k + 1
const renumbered = await reload(w2)
check('번호를 다시 매겨도 형태가 제자리', surfaces(renumbered) === 'lose track of time|occurs|achieving',
  surfaces(renumbered))
check('번호를 다시 매겨도 id 가 제자리', renumbered.rows.map((r) => r.id).join(',') === 'r2,r3,r4',
  renumbered.rows.map((r) => r.id).join(','))
check('지운 줄 1개', diffOf(renumbered) === '{"changed":0,"added":0,"removed":1}', diffOf(renumbered))
check('짝 못 찾은 줄 없음', renumbered.warnings.unmatched.length === 0, JSON.stringify(renumbered.warnings.unmatched))

// 같은 문장에서 고른 두 줄의 번호를 맞바꿨다 — 표제어로 가려야 한다 (immerse ↔ immersed 는 묵음 e)
const w3 = exported()
cellAt(w3, 3, 'no').value = 2
cellAt(w3, 4, 'no').value = 1
const swapped = await reload(w3)
check('같은 문장의 두 줄도 표제어로 가려 잇는다',
  surfaces(swapped) === 'immersed|lose track of time|occurs|achieving', surfaces(swapped))

// 다른 문장으로 새 줄을 끼워 넣고 번호는 윗줄 것을 베꼈다
const w4 = exported()
sheetOf(w4).spliceRows(5, 0, ['2', 'urbanization', '명', '도시화', '', 'city growth', '', '2', passages[1].english.split('. ')[0] + '.'])
const inserted = await reload(w4)
check('새 줄은 다른 줄의 형태를 가져가지 않는다', inserted.rows[2].surface === 'Urbanization', inserted.rows[2].surface)
check('새 줄은 새 id', !editRows.some((r) => r.id === inserted.rows[2].id), inserted.rows[2].id)
check('윗줄은 제 형태 그대로', inserted.rows[1].surface === 'lose track of time', inserted.rows[1].surface)
check('새 줄 1개', diffOf(inserted) === '{"changed":0,"added":1,"removed":0}', diffOf(inserted))
check('새 줄을 알린다', inserted.warnings.unmatched.join(',') === 'urbanization', JSON.stringify(inserted.warnings.unmatched))
check('새 줄이 있어도 같은 작업', isSameWork(inserted.rows, samplePassages))

/* 10. 구글 링크 해석 ------------------------------------------- */
console.log('\n[10] 구글 링크 해석')
const DOC_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEF'
const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456'
const linkOf = (url) => JSON.stringify(parseGoogleLink(url))
const docLink = JSON.stringify({ kind: 'doc', id: DOC_ID })
const fileLink = JSON.stringify({ kind: 'file', id: FILE_ID })

check('구글 문서 편집 링크', linkOf(`https://docs.google.com/document/d/${DOC_ID}/edit?usp=sharing`) === docLink)
check('구글 문서 — 계정 번호 붙은 링크', linkOf(`https://docs.google.com/document/u/1/d/${DOC_ID}/edit`) === docLink)
check('구글 문서 — 앞뒤 공백', linkOf(`  https://docs.google.com/document/d/${DOC_ID}  `) === docLink)
check('드라이브 파일 보기 링크', linkOf(`https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`) === fileLink)
check('드라이브 open?id=', linkOf(`https://drive.google.com/open?id=${FILE_ID}`) === fileLink)
check('드라이브 uc?id=', linkOf(`https://drive.google.com/uc?id=${FILE_ID}&export=download`) === fileLink)
check('시트는 거절', parseGoogleLink(`https://docs.google.com/spreadsheets/d/${DOC_ID}/edit`) === null)
check('슬라이드는 거절', parseGoogleLink(`https://docs.google.com/presentation/d/${DOC_ID}/edit`) === null)
check("'웹에 게시' 링크는 거절", parseGoogleLink('https://docs.google.com/document/d/e/2PACX-1vT/pub') === null)
check('남의 주소는 거절', parseGoogleLink(`https://example.com/document/d/${DOC_ID}`) === null)
check('id 에 섞인 이상한 문자는 거절', parseGoogleLink('https://drive.google.com/open?id=abc/../../etc') === null)
check('주소가 아니면 거절', parseGoogleLink('그냥 글자') === null)

check('한글 파일 이름 (filename*)',
  fileNameFrom(`attachment; filename="____.docx"; filename*=UTF-8''${encodeURIComponent('11강 지문.docx')}`) === '11강 지문.docx')
check('filename= 만 있을 때', fileNameFrom('attachment; filename="passages.txt"') === 'passages.txt')
check('이름이 없으면 빈 문자열', fileNameFrom('') === '')
check('확장자 없는 이름은 형식에서 붙인다', fileNameFor('file', 'attachment; filename="지문"', 'text/plain; charset=utf-8') === '지문.txt')
check('이름 없는 구글 문서', fileNameFor('doc', '', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') === '구글 문서.docx')
check('확장자 있으면 그대로', fileNameFor('file', 'attachment; filename="a.PDF"', 'application/octet-stream') === 'a.PDF')

/* 11. 시험지 배정 시드 ------------------------------------------ */
console.log('\n[11] 시험지 배정 시드')
// 굴절 열쇠가 서로 겹치지 않도록 k 로 끝나는 만든 낱말을 쓴다 (zoraak, zorabk …)
const stemOf = (i) => `zor${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}k`
const VERB_FORMS = [(h) => h, (h) => `${h}s`, (h) => `${h}ing`, (h) => `${h}ed`, (h) => `${h}t`]
const quizRows = Array.from({ length: 70 }, (_, i) => {
  const kind = i % 7
  const stem = stemOf(i)
  const pos = ['동', '동', '형', '부', '명', '구', '명'][kind]
  const headword = pos === '구' ? `${stem} up` : stem
  const surface = pos === '동' ? VERB_FORMS[i % 5](stem) : headword
  return {
    id: `r${i}`,
    headword,
    surface,
    pos,
    meaning: `뜻${i}`,
    sentence: `They saw ${surface} there.`,
    passageNo: 1,
    derivatives: i % 2 === 0 ? [{ word: `${stem}ness`, pos: '명' }] : [],
    synonyms: i % 3 === 0 ? [{ word: 'alpha' }, { word: 'beta' }] : i % 3 === 1 ? [{ word: 'gamma' }] : [],
    antonyms: i % 4 === 0 ? [{ word: 'delta', confidence: 4 }] : [],
  }
})
const idsOf = (a) =>
  JSON.stringify(Object.fromEntries(Object.entries(a.parts).map(([k, v]) => [k, (k === 'III' ? v.all : v).map((r) => r.id)])))
const picked = (a) => Object.entries(a.parts).flatMap(([k, v]) => (k === 'III' ? v.all : v))

const plain = allocate(quizRows)
check('시드가 없으면 단어장 순서 그대로', idsOf(plain) === idsOf(allocate(quizRows, {})) && idsOf(plain) === idsOf(allocate(quizRows, { seed: undefined })))
check('같은 시드는 같은 배정', idsOf(allocate(quizRows, { seed: 7 })) === idsOf(allocate(quizRows, { seed: 7 })))
check('다른 시드는 다른 배정', idsOf(allocate(quizRows, { seed: 1 })) !== idsOf(allocate(quizRows, { seed: 2 })))
check('시드를 줘도 단어장 통계는 같다', JSON.stringify(allocate(quizRows, { seed: 3 }).stats) === JSON.stringify(plain.stats))

for (const seed of [11, 22, 33]) {
  const a = allocate(quizRows, { seed })
  const all = picked(a)
  check(`시드 ${seed} — 모든 PART 를 채움`, a.ok, JSON.stringify(a.shortages))
  check(`시드 ${seed} — 한 번 쓴 말은 다시 안 씀`, new Set(all.map((r) => r.headword)).size === all.length, `${all.length}개`)
  check(`시드 ${seed} — PART 조건 유지`,
    a.parts.IV.every((r) => r.pos === '동') &&
      a.parts.II.every((r) => r.pos === '형' || r.pos === '부') &&
      a.parts.V.every((r) => r.synonyms.length >= 2) &&
      a.parts.VI.every((r) => r.pos !== '구'))
  check(`시드 ${seed} — PART IV 형태가 모두 다름`,
    new Set(a.parts.IV.map((r) => verbForm(r.surface, r.headword))).size === 5,
    a.parts.IV.map((r) => verbForm(r.surface, r.headword)).join(','))
}

/* 12. 바뀐 표제어만 생성 ------------------------------------------------ */
console.log('\n[12] 바뀐 표제어만 생성 — 계획 · 엮기 · 반의어 비율')
const { planRegeneration, mergeRows } = await import('../src/lib/regenPlan.js')
const { enforceAntonymRatio } = await import('../src/lib/aiClient.js')

const sel = (id, surface, sentence = `S ${surface}.`, passageNo = 1) => ({ id, surface, sentence, passageNo })
const madeRow = (s, extra = {}) => ({
  id: s.id, passageNo: s.passageNo, surface: s.surface, sentence: s.sentence, headword: s.surface,
  derivatives: [], synonyms: [], antonyms: [], missing: false, ...extra,
})
const [sa, sb, sc, sd] = [sel('a', 'alpha'), sel('b', 'beta'), sel('c', 'gamma'), sel('d', 'delta')]
const oldRows = [
  madeRow(sa, { synonyms: [{ word: '손으로 고침' }] }),
  madeRow(sb),
  madeRow(sc, { missing: true }),
  madeRow(sd),
]
// beta 를 빼고, epsilon 을 새로 고르고, delta 는 뺐다가 다시 골라 id 가 바뀌었다
const se = sel('e', 'epsilon')
const sd2 = { ...sd, id: 'd2' }
const now = [sa, sc, sd2, se]
const plan = planRegeneration(now, oldRows)
check('새로 만들 것 = 새 선택 + 빠졌던 줄', plan.toGenerate.map((s) => s.id).join(',') === 'c,e', plan.toGenerate.map((s) => s.id).join(','))
check('셈 — 새 1 · 다시 1 · 남김 2', plan.added === 1 && plan.retry === 1 && plan.kept === 2, JSON.stringify([plan.added, plan.retry, plan.kept]))
check('뺀 줄은 지울 목록에', plan.removed.map((r) => r.id).join(',') === 'b', plan.removed.map((r) => r.id).join(','))
check('다시 고른 낱말은 같은 표현·문장의 줄을 이어 쓴다', plan.entries[2].row?.id === 'd' && !plan.entries[2].regenerate)

const fresh = [madeRow(sc, { headword: 'gamma-new' }), madeRow(se, { headword: 'epsilon-new' })]
const merged = mergeRows(plan, fresh)
check('엮은 표는 선택 순서', merged.map((r) => r.id).join(',') === 'a,c,d2,e', merged.map((r) => r.id).join(','))
check('남긴 줄의 손댄 내용은 그대로', merged[0].synonyms[0]?.word === '손으로 고침')
check('다시 만든 줄은 새 결과', merged[1].headword === 'gamma-new' && merged[3].headword === 'epsilon-new')
check('이어 쓴 줄은 지금 선택 id 를 받는다', merged[2].id === 'd2' && merged[2].headword === 'delta')

const unchanged = planRegeneration(oldRows.filter((r) => !r.missing).map((r) => sel(r.id, r.surface)), oldRows.filter((r) => !r.missing))
check('바뀐 것이 없으면 changed=false', !unchanged.changed && unchanged.toGenerate.length === 0)
check('id 를 가로채지 않는다 — 같은 표현 두 번', (() => {
  const twin1 = sel('t1', 'same', 'Same sentence.')
  const twin2 = sel('t2', 'same', 'Same sentence.')
  const p = planRegeneration([twin1, twin2], [madeRow(twin2)])
  return p.entries[1].row?.id === 't2' && p.entries[0].regenerate
})())

// 반의어 비율 — 남긴 줄은 세기만 하고 새 줄에서만 덜어낸다
const ant = (id, conf) => ({ id, headword: id, antonyms: [{ word: 'x', confidence: conf }] })
const noAnt = (id) => ({ id, headword: id, antonyms: [] })
// 남긴 줄 8개 중 3개에 반의어 — 새 줄 1개를 더해도 4/9 로 상한(50%) 안이다
const keepRows = [ant('k1', 1), ant('k2', 1), ant('k3', 1), noAnt('k4'), noAnt('k5'), noAnt('k6'), noAnt('k7'), noAnt('k8')]
const one = enforceAntonymRatio([ant('n1', 0.9)], keepRows)
check('새 줄 1개라도 표 전체 비율 안이면 반의어를 남긴다', one.rows[0].antonyms.length === 1 && one.stats.total === 9, JSON.stringify(one.stats))
// 남긴 줄 6개(반의어 3) + 새 줄 2개(둘 다 반의어) = 5/8 → 상한 4 를 1 넘는다
const over = enforceAntonymRatio([ant('n1', 0.9), ant('n2', 0.4)], keepRows.slice(0, 6))
check('넘치면 새 줄에서 확신 낮은 것부터', over.rows.find((r) => r.id === 'n2').antonyms.length === 0 && over.rows.find((r) => r.id === 'n1').antonyms.length === 1, JSON.stringify(over.stats))
const stuck = enforceAntonymRatio([ant('n1', 0.9)], [ant('k1', 1), ant('k2', 1), noAnt('k3')])
check('남긴 줄은 넘쳐도 건드리지 않는다', stuck.rows[0].antonyms.length === 0 && stuck.stats.removed === 1, JSON.stringify(stuck.stats))
const solo = enforceAntonymRatio([ant('n1', 0.9), noAnt('n2')])
check('keep 없이 부르면 예전과 같다', solo.stats.total === 2 && solo.rows[0].antonyms.length === 1, JSON.stringify(solo.stats))

/* 13. 시험지 머리 ---------------------------------------------- */
console.log('\n[13] 시험지 머리 — 연도 · 제목 · 반 · 주차')
const { testHeadParts } = await import('../src/lib/exportDocx.js')
const headOf = (title, head) => {
  const { lead, week } = testHeadParts(title, head)
  return JSON.stringify({ lead, week })
}
check('빈 칸은 손으로 쓸 빈칸으로', headOf('', {}) === JSON.stringify({ lead: '202__ 정상JLS 심화단어장 _____반', week: 'Week #' }), headOf('', {}))
check('채운 칸은 그 값으로', headOf('겨울학기', { year: '2026', klass: '3', week: '5' }) === JSON.stringify({ lead: '2026 겨울학기 3반', week: 'Week 5' }))
check('3반 · 5주차 · 2026년 처럼 붙여 써도 겹치지 않음',
  headOf('겨울학기', { year: '2026년', klass: '3반', week: '5주차' }) === JSON.stringify({ lead: '2026 겨울학기 3반', week: 'Week 5' }),
  headOf('겨울학기', { year: '2026년', klass: '3반', week: '5주차' }))
check('Week 5 · week5 도 Week 5', testHeadParts('t', { week: 'Week 5' }).week === 'Week 5' && testHeadParts('t', { week: 'week5' }).week === 'Week 5')
check('앞뒤 공백 · 공백뿐인 칸', headOf('  t  ', { year: ' ', klass: ' A ' }) === JSON.stringify({ lead: '202__ t A반', week: 'Week #' }), headOf('  t  ', { year: ' ', klass: ' A ' }))
// Week 07~09 검수: 제목에 연도 · 주차가 있으면 "2026 2027 겨울학기 … WEEK 09 _____반  Week #" 로 두 번 찍혔다
check('제목의 연도 · 주차를 머리 칸으로 옮긴다',
  headOf('2027 겨울학기 [실력반] WEEK 09', { year: '2026' }) === JSON.stringify({ lead: '2027 겨울학기 [실력반] _____반', week: 'WEEK 09' }),
  headOf('2027 겨울학기 [실력반] WEEK 09', { year: '2026' }))
check('제목에서 가져온 칸을 알린다', JSON.stringify(testHeadParts('2027 겨울학기 Week 9', {}).fromTitle) === JSON.stringify({ year: '2027', week: 'Week 9' }))
check('9주차 · 2027년 도 읽는다', headOf('2027년 겨울학기 9주차', {}) === JSON.stringify({ lead: '2027 겨울학기 _____반', week: 'Week 9' }), headOf('2027년 겨울학기 9주차', {}))
check('제목 가운데 숫자는 건드리지 않는다', headOf('수능 2000제', { year: '2026' }) === JSON.stringify({ lead: '2026 수능 2000제 _____반', week: 'Week #' }), headOf('수능 2000제', { year: '2026' }))

/* 14. 불러올 단어장을 지금 작업과 견주기 --------------------------- */
console.log('\n[14] 불러올 단어장 견주기 — week7 작업에 week6 단어장')
const { compareWork } = await import('../src/lib/importXlsx.js')
// week7: 지금 지문(p1)과 거기서 고른 표제어 / week6: 다른 지문의 문장과 표제어
const week7 = {
  docTitle: 'Week7',
  passages: samplePassages,
  selections: sampleRows.map((r) => ({ surface: r.surface })),
  rows: [],
}
const week6Rows = [
  { headword: 'erode', sentence: 'Coastal cliffs erode slowly over centuries.' },
  { headword: 'immerse', sentence: 'Divers immerse themselves in cold water.' },
  { headword: 'scarce', sentence: 'Fresh water is scarce in the desert.' },
]
const other = compareWork(week7, { docTitle: 'Week6', rows: week6Rows })
check('다른 지문이면 다른 작업', other.hasWork && !other.sameWork, JSON.stringify(other))
check('지금 작업 숫자', other.current.title === 'Week7' && other.current.selections === 2 && other.current.passages === 1, JSON.stringify(other.current))
check('출처 문장은 지금 지문에 0개', other.sentenceHits === 0)
check('겹치는 표제어 — 선택한 immersed 와 파일의 immerse 는 같은 말', other.sharedHeadwords === 1, String(other.sharedHeadwords))
const same = compareWork(week7, { docTitle: 'Week7', rows: sampleRows })
check('같은 지문의 단어장이면 같은 작업', same.sameWork && same.sentenceHits === sampleRows.length, JSON.stringify(same))
check('지금 작업이 비었으면 견줄 것이 없다', !compareWork({ rows: [], selections: [], passages: [] }, { rows: week6Rows }).hasWork)
check('표가 있으면 표의 표제어로 견준다',
  compareWork({ ...week7, rows: [{ headword: 'scarce', sentence: 'x' }] }, { rows: week6Rows }).sharedHeadwords === 1)

/* 15. AI 작업 방식 · 모자란 PART 처방 ------------------------------- */
console.log('\n[15] AI 작업 방식 묶음 · 모자란 PART 처방')
const { PRESETS, presetOf, aiLabel, DEFAULT_MODEL: DM, DEFAULT_EFFORT: DE } = await import('../src/lib/models.js')
check('기본값은 "보통"', presetOf(DM, DE)?.id === 'normal')
check('묶음마다 서로 다른 조합', new Set(PRESETS.map((p) => `${p.model}/${p.effort}`)).size === PRESETS.length)
check('묶음에 없는 조합은 null · 이름은 모델 · effort', presetOf('claude-opus-5-5', 'max') === null && aiLabel('claude-opus-5-5', 'max') === 'Opus 5.5 · max',
  aiLabel('claude-opus-5-5', 'max'))

const { shortageAdvice } = await import('../src/lib/quizAllocate.js')
const baseStats = { usable: 40, required: 35, verbs: 8, adjAdv: 8, withDerivatives: 5, withSynonyms: 9, withSynonyms2: 8, withAntonyms: 5 }
const third = { derivative: { got: 2, need: 2 }, synonym: { got: 1, need: 1 }, antonym: { got: 2, need: 2 } }
const adv = (part, stats = baseStats, detail = third, got = 0) => shortageAdvice({ part, got, need: 5 }, stats, detail)
check('IV — 동사가 모자라면 더 고르기', adv('IV', { ...baseStats, verbs: 2 }).fix === 'more' && adv('IV', { ...baseStats, verbs: 2 }).text.includes('3개 더'),
  adv('IV', { ...baseStats, verbs: 2 }).text)
check('IV — 동사는 충분하면 배정 다시', adv('IV').fix === 'shuffle')
check('III — 반의어 칸이 비었으면 표에서 채우기',
  adv('III', { ...baseStats, withAntonyms: 0 }, { ...third, antonym: { got: 0, need: 2 } }).fix === 'fill' &&
    adv('III', { ...baseStats, withAntonyms: 0 }, { ...third, antonym: { got: 0, need: 2 } }).text.startsWith('반의어가 달린 말 2개'),
  adv('III', { ...baseStats, withAntonyms: 0 }, { ...third, antonym: { got: 0, need: 2 } }).text)
check('V — 유의어 2개짜리가 모자라면 표에서 채우기', adv('V', { ...baseStats, withSynonyms2: 3 }).fix === 'fill')
check('II — 형용사 · 부사가 모자라면 더 고르기', adv('II', { ...baseStats, adjAdv: 1 }).fix === 'more')
check('I — 표제어 수 자체가 모자라면 더 고르기', adv('I', { ...baseStats, usable: 20 }, third, 3).fix === 'more' && adv('I', { ...baseStats, usable: 20 }, third, 3).text.includes('3개뿐'))
check('VI — 수는 충분하면 배정 다시', adv('VI').fix === 'shuffle')

/* 16. 3단계 표 칸 폭 -------------------------------------------- */
console.log('\n[16] 3단계 표 칸 폭 — 글을 재서 정하고, 좁으면 꺾여도 되는 칸만 줄인다')
const { columnWidths, COLUMNS: TABLE_COLUMNS } = await import('../src/lib/columnWidths.js')
const fakeMeasure = (text) => text.length * 8 // 글자 수에 비례하는 가짜 폭
const colRow = (extra = {}) => ({
  headword: 'lose track of time', surface: 'lose track of time', pos: '구', meaning: '시간 가는 줄 모르다',
  derivatives: [{ word: 'interdisciplinarity', pos: '명', meaning: '학제간 연구' }],
  synonyms: [{ word: 'comprehensively reconsider' }, { word: 'reshape' }], antonyms: [{ word: 'straightforwardly' }], ...extra,
})
const wide = columnWidths([colRow()], fakeMeasure)
// 표제어 18자 × 8 = 144 + 여백 46 = 190
check('표제어는 한 줄에 들어갈 폭', wide.widths.headword === 190, String(wide.widths.headword))
check('품사 · 번호는 고정 폭, 짧은 출처는 최소 폭', wide.widths.pos === 58 && wide.widths.num === 46 && wide.widths.source === 58)
// 지문 번호가 `Week9-10` 처럼 길면 출처 칸이 넓어져 문장 칸을 덮지 않는다 (Week 09 화면에서 겹쳐 보였다)
check('긴 지문 번호는 출처 칸을 넓힌다', columnWidths([colRow({ passageLabel: 'Week9-10' })], fakeMeasure).widths.source > 58)
check('출처 문장 칸은 폭을 정하지 않는다(남는 폭)', !('sentence' in wide.widths))
check('긴 글은 상한에서 멈춘다', wide.widths.synonyms === TABLE_COLUMNS.find((c) => c.key === 'synonyms').max, String(wide.widths.synonyms))

const tight = columnWidths([colRow()], fakeMeasure, 1100)
check('좁아도 표제어는 줄이지 않는다', tight.widths.headword === wide.widths.headword)
// interdisciplinarity 19자 × 8 + 46 = 198 — 파생어 칸은 이보다 좁아지지 않는다
check('줄여도 가장 긴 낱말 하나는 한 줄에', tight.widths.derivatives >= 198 && tight.widths.synonyms >= 'comprehensively'.length * 8 + 46,
  JSON.stringify(tight.widths))
check('꺾여도 되는 칸이 줄어 화면에 맞춘다', tight.minTable <= 1100 || tight.widths.meaning === 110, `${tight.minTable}`)

const cramped = columnWidths([colRow()], fakeMeasure, 900)
check('그래도 넘치면 출처 문장이 200까지 준다', cramped.minTable === Object.values(cramped.widths).reduce((a, b) => a + b, 0) + 200,
  `${cramped.minTable}`)
const empty = columnWidths([], fakeMeasure)
check('줄이 없으면 칸마다 최소 폭', empty.widths.headword === 120 && empty.widths.meaning === 110)
check('원형 메모까지 한 줄에 — 메모가 더 길면 표제어 칸이 넓어진다',
  columnWidths([colRow({ headword: 'bring', surface: 'brought about', normalizationNote: '완료형 과거분사' })], fakeMeasure).widths.headword ===
    Math.round('brought about → 완료형 과거분사'.length * 8 + 46))

/* 17. 생성 결과 점검 규칙 (Week 08 검수 기준) ---------------------- */
console.log('\n[17] 생성 결과 점검 — 파생어 규칙 · 다른 표제어와 겹침 · 지문 기호 · 프롬프트')
const { derivativeProblem } = await import('../src/lib/aiClient.js')
const dp = (head, word, pos = '형') => derivativeProblem({ word, pos }, head)
// Week 08 검수에서 지적한 다섯 개
check('분사형 — bias → biased', dp('bias', 'biased') === '분사형')
check('분사형 — gratification → gratifying', dp('gratification', 'gratifying') === '분사형')
check('접두사를 뗀 말 — unbearably → bear', dp('unbearably', 'bear', '동') === '접두사를 뗀 말')
check('접두사를 뗀 말 — invariably → vary', dp('invariably', 'vary', '동') === '접두사를 뗀 말')
check('접두사를 뗀 말 — precaution → caution', dp('precaution', 'caution', '명') === '접두사를 뗀 말')
// Week 08 검수가 굳은 형용사 gratifying 도 분사형으로 뺐다. 같은 기준을 따르면 interesting 도 빠진다
check('굳은 -ing 형용사도 분사형 — interest → interesting', dp('interest', 'interesting') === '분사형')
// 잡으면 안 되는 것
const keepOk = [
  ['success', 'succeed', '동'], ['excess', 'exceed', '동'], ['understand', 'understanding', '명'],
  ['deep', 'depth', '명'], ['die', 'death', '명'], ['relevant', 'irrelevant', '형'],
  ['unbearably', 'unbearable', '형'], ['precaution', 'precautionary', '형'], ['image', 'imagine', '동'],
  ['decide', 'decision', '명'], ['react', 'reaction', '명'], ['pronounce', 'pronunciation', '명'],
]
const wronglyCaught = keepOk.filter(([h, w, pos]) => dp(h, w, pos))
check('좋은 파생어는 잡지 않는다 (succeed · understanding · depth · death · irrelevant …)', wronglyCaught.length === 0,
  JSON.stringify(wronglyCaught))

const { headwordOverlaps } = await import('../src/lib/duplicates.js')
const ovRows = [
  { id: 'a', headword: 'accentuate', synonyms: [{ word: 'emphasize' }], antonyms: [{ word: 'diminish' }] },
  { id: 'b', headword: 'diminished', synonyms: [{ word: 'reduced' }, { word: 'blunted' }], antonyms: [] },
  { id: 'c', headword: 'blunted', synonyms: [{ word: 'dulled' }], antonyms: [] },
]
const ov = headwordOverlaps(ovRows)
check('유의어가 다른 표제어 — diminished 의 blunted = 3번', ov.get('b')?.[0]?.otherNo === 3 && ov.get('b')[0].kind === '유의어')
check('반의어가 다른 표제어(굴절형) — diminish = 2번 diminished', ov.get('a')?.[0]?.otherNo === 2 && ov.get('a')[0].kind === '반의어')
check('겹치지 않는 줄은 없다', !ov.has('c'))

const { stripInsertionMarks } = await import('../src/lib/passages.js')
check('지문의 동그라미 글자 — transport ⓐ them', stripInsertionMarks('Proteins transport ⓐ them.') === 'Proteins transport them.')
check('지문의 동그라미 대문자 · 한글', stripInsertionMarks('It was Ⓑ clear and ㉠ simple.') === 'It was clear and simple.')

const { buildEnrichPrompt } = await import('../server/prompts.js')
const promptItem = [{ id: 'x', surface: 'biased', passageNo: 1, sentence: 'A biased view.' }]
const withOthers = buildEnrichPrompt({ items: promptItem, others: ['blunted', 'diminished'] })
check('다른 표제어 목록이 프롬프트에 실린다', withOthers.includes('## 7)') && withOthers.includes('blunted, diminished'))
check('목록이 없으면 그 절도 없다', !buildEnrichPrompt({ items: promptItem }).includes('## 7)'))
check('유의어는 고3 수준까지 · 되도록 2개', withOthers.includes('되도록 2개') && withOthers.includes('고3'))
// 파생어는 "기본 1개" 로 줄였다가 너무 적다는 말에 되돌렸다 — 흔한 가족 말이 둘이면 2개 (speculate · speculative)
check('파생어 — 흔한 말이 2개 있으면 2개', withOthers.includes('2개 있으면 2개를 단다') && !withOthers.includes('기본은 1개'))

/* 18. 시험지 검수 반영 (Week 09) ----------------------------------- */
console.log('\n[18] 시험지 검수 반영 — 요약문 빼기 · 선택지 난이도 · 이야기 틀 · 힌트')
const { questionBlanks, hasQuestionBlank, stripParagraphLabel, splitPassages: splitP, isSummarySentence, dropSummarySentences } =
  await import('../src/lib/passages.js')
const summary = 'The study above shows (A) conversation with companions intensifies emotional response, suggesting that absence of alone time may (B) personal growth.'
check('요약문 빈칸 (A) · (B) 를 찾는다', questionBlanks(summary).join() === '(A),(B)', questionBlanks(summary).join())
check('밑줄로 감싼 ____(A)____ 도 (A) 하나', questionBlanks('was more ____(A)____ in those').join() === '(A)')
check('어법 고르기 [was / were] 도 빈칸', hasQuestionBlank('The data [was / were] collected.'))
check('보통 문장은 빈칸 아님', !hasQuestionBlank('Type A blood is common (see Table 2).'))
check('순서 배열 단락 이름표는 걷는다', stripParagraphLabel('(C) When large carnivores are lurking.') === 'When large carnivores are lurking.')
check('요약문 빈칸은 이름표가 아니다', stripParagraphLabel('(A) conversation with') === '(A) conversation with')

check('(A) · (B) 가 둘 든 한 문장은 요약문', isSummarySentence(summary) && isSummarySentence('was more ____(A)____ in those who were ____(B)____ of it.'))
check('연결어 빈칸 (A) 하나뿐인 본문 문장은 요약문이 아니다', !isSummarySentence('(A), the results showed a clear pattern.') && !isSummarySentence('In short (A) they won.'))

const summaryDoc = [
  '1. 다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?',
  'People who are never alone find it harder to learn. They miss the chance to reflect on themselves.',
  summary,
  '(A)\t\t(B)',
  '①\tavoiding\t……\tinhibit',
  '②\trecalling\t……\trestrain',
  '2. 다음 글의 순서로 가장 적절한 것은?',
  'Cities change all the time. Planners cannot freeze them.',
  '(A) So, living in groups offered advantages over other groups.',
  '(B) This is best seen in markets.',
].join('\n')
const sp = splitP(summaryDoc).passages
// 사용자 결정 (Week 09 검수 뒤) — 요약문 문장은 지문에 넣지 않는다. 요약문에만 나온 말은 표제어 후보에도 오르지 않는다
check('요약문 문장은 지문에 넣지 않는다', !/study above|intensifies/.test(sp[0]?.english || '') && /reflect on themselves\.$/.test(sp[0]?.english || ''), sp[0]?.english)
check('보기 · "(A) (B)" 줄도 본문에 없다', !/avoiding|\(A\)\s*\(B\)/.test(sp[0]?.english || ''), sp[0]?.english)
check('순서 배열 이름표는 본문에서 걷힌다', !/\([AB]\) /.test(sp[1]?.english || '') && /So, living/.test(sp[1]?.english || ''), sp[1]?.english)
check('옛 지문(엑셀 숨김 시트)의 요약문도 뺀다', dropSummarySentences(`Body one. Body two. ${summary}`) === 'Body one. Body two.')
check('요약문이 없으면 지문을 그대로 둔다', dropSummarySentences('Body one.  Body two.') === 'Body one.  Body two.')

const { renderPartIVItem: renderIV } = await import('../src/lib/quizBuild.js')
const ivPassage = { no: 9, english: `People who are never alone find it harder to learn. They miss the chance to reflect on themselves. ${summary}` }
// 옛 단어장에서 요약문 출처 문장을 엑셀로 고쳐 왔으면, 지문에 남은 요약문 대신 고친 문장을 쓴다
const fixedSummary = summary.replace('(A)', 'avoiding').replace('(B)', 'inhibit')
const ivFixed = renderIV({ passageNo: 9, sentence: fixedSummary, answer: 'intensifies', before: 0, after: 0 }, [ivPassage])
check('PART IV — 요약문 출처 문장을 고쳐 왔으면 고친 문장을 쓴다', !/\([AB]\)/.test(ivFixed.text) && ivFixed.text.includes('avoiding'), ivFixed.text)
const ivNext = renderIV({ passageNo: 9, sentence: 'They miss the chance to reflect on themselves.', answer: 'miss', before: 0, after: 1 }, [ivPassage])
check('PART IV — 뒤 문장을 붙여도 요약문은 붙지 않는다', !/\([AB]\)/.test(ivNext.text) && ivNext.atEnd, ivNext.text)
const ivLabel = renderIV({ passageNo: 1, sentence: 'So, living in groups offered advantages.', answer: 'offered', before: 0, after: 0 }, [{ no: 1, english: '(A) So, living in groups offered advantages. (B) This is best seen in markets.' }])
check('PART IV — 옛 지문의 단락 이름표를 찍지 않는다', !ivLabel.text.startsWith('('), ivLabel.text)

// 어법 · 어휘 문항 지문에는 일부러 틀린 말이 있다. 엑셀에서 출처 문장을 바로잡으면 PART IV 도 고친 문장을 써야 한다
// (11/12 완성반 Week03 24번이 지문 원문 "expends more energy" 로 실렸다)
const errS = [
  'Each group learns to tune into a niche of its own.',
  'Listeners tune into recognizable sounds, so the listener expends more energy.',
  'Other species do not ignore the energy they spend.',
  'That is why quiet places matter.',
]
const errPassage = { no: 10, english: errS.join(' ') }
const fixedRows = [
  { id: 'e1', passageNo: 10, surface: 'expends', sentence: errS[1].replace('more', 'less') },
  { id: 'e3', passageNo: 10, surface: 'species', sentence: errS[2].replace('ignore', 'waste') },
  { id: 'e4', passageNo: 10, surface: 'tune into', sentence: errS[1] }, // 같은 문장인데 이 줄은 안 고쳤다
]
const ivItem = (row, ctx = {}) => ({ rowId: row.id, passageNo: row.passageNo, sentence: row.sentence, answer: row.surface, before: 0, after: 0, ...ctx })
const ivOwn = renderIV(ivItem(fixedRows[0]), [errPassage], fixedRows)
check('PART IV — 표에서 고친 출처 문장을 쓴다', ivOwn.text === 'Listeners tune into recognizable sounds, so the listener _______________ less energy.', ivOwn.text)
const ivCtx = renderIV(ivItem(fixedRows[0], { after: 1 }), [errPassage], fixedRows)
check('PART IV — 붙이는 뒤 문장도 다른 줄에서 고친 대로', ivCtx.text.includes('waste the energy') && !ivCtx.text.includes('ignore'), ivCtx.text)
const ivShared = renderIV(ivItem(fixedRows[2]), [errPassage], fixedRows)
check('PART IV — 같은 문장을 다른 줄이 고쳤으면 고친 문장, 앞 문장의 같은 말에 끌리지 않는다',
  ivShared.text === 'Listeners _______________ recognizable sounds, so the listener expends less energy.', ivShared.text)
const ivGlued = renderIV(ivItem({ id: 'g', passageNo: 10, surface: 'expends', sentence: `${errS[0]} ${errS[1]}` }), [errPassage])
check('PART IV — 옛 분리 규칙으로 붙은 두 문장은 고친 문장으로 보지 않는다',
  ivGlued.text === 'Listeners tune into recognizable sounds, so the listener _______________ more energy.', ivGlued.text)

const blankVerb = { id: 'bv', headword: 'intensify', surface: 'intensifies', pos: '동', sentence: summary }
const verbRows = ['adapt', 'blossom', 'carry', 'drift', 'evolve'].map((w, i) => ({ id: `v${i}`, headword: w, surface: w, pos: '동', sentence: `They ${w} slowly.` }))
const alloc = allocate([blankVerb, ...verbRows])
check('PART IV 는 출처 문장에 빈칸이 남은 동사를 쓰지 않는다', !alloc.parts.IV.some((r) => r.id === 'bv') && alloc.parts.IV.length === 5)
check('빈칸이 남은 동사 수를 따로 센다', alloc.stats.blankVerbs === 1 && alloc.stats.verbs === 5, JSON.stringify({ v: alloc.stats.verbs, b: alloc.stats.blankVerbs }))
const fewVerbs = allocate([blankVerb, ...verbRows.slice(0, 4)])
const ivAdvice = shortageAdvice({ part: 'IV', got: 4, need: 5 }, fewVerbs.stats, fewVerbs.thirdDetail)
check('동사가 모자라면 빈칸 남은 문장을 고치라고 한다', ivAdvice.fix === 'fill' && ivAdvice.text.includes('빈칸'), ivAdvice.text)

const { uniqueHint, storyPatternIssues, isBeyondExamDistractor } = await import('../src/lib/quizRules.js')
// 사용자 결정 (Week 03 검수 20번) — 힌트는 두 글자까지. 거기서도 겹치는 말은 함께 정답으로 인정한다
const hPrev = uniqueHint('previous', ['prior', 'preceding', 'earlier'])
check('힌트 — subsequent 의 반의어는 prev 가 아니라 pr, previous · prior · preceding 모두 정답',
  hPrev.hint === 'pr' && hPrev.accepted.join() === 'previous,prior,preceding', JSON.stringify(hPrev))
const hShrink = uniqueHint('shrink', ['shorten'])
check('힌트 — shrink · shorten 은 sh 에서 멈추고 둘 다 정답', hShrink.hint === 'sh' && hShrink.accepted.join() === 'shrink,shorten', JSON.stringify(hShrink))
const hCom = uniqueHint('common', ['collective'])
check('힌트 — common · collective 는 co, 둘 다 정답', hCom.hint === 'co' && hCom.accepted.length === 2, JSON.stringify(hCom))
const hCa = uniqueHint('candid', ['cold'])
check('힌트 — 두 글자로 갈리면 하나만 정답', hCa.hint === 'ca' && hCa.accepted.join() === 'candid', JSON.stringify(hCa))
check('힌트 — 겹치는 말이 없으면 한 글자', uniqueHint('conceal', ['hide', 'conceal']).hint === 'c' && uniqueHint('conceal', ['hide']).accepted.join() === 'conceal')
check('힌트 — 정답이 다른 말의 앞부분이어도 두 글자, 둘 다 정답', uniqueHint('common', ['commonplace']).accepted.join() === 'common,commonplace')
const { resolveHints, checkPart: checkPartIII } = await import('../src/lib/quizClient.js')
const iii = { items: [{ id: 's1', kind: 'antonym', headword: 'stretch', answer: 'shrink', hint: 's', rivals: [] }] }
resolveHints(iii, { antonym: [{ id: 's1', antonyms: ['shrink', 'shorten'] }] })
check('힌트 — 단어장의 다른 반의어도 겹침으로 본다', iii.items[0].hint === 'sh' && iii.items[0].accepted.join() === 'shrink,shorten', JSON.stringify(iii.items[0]))
const oldIII = { items: [{ kind: 'antonym', headword: 'subsequent', answer: 'previous', hint: 'prev' }] }
check('힌트 — 세 글자 이상 드러난 옛 결과는 검사에 짚는다', checkPartIII('III', oldIII).some((x) => x.includes('prev___')))

// 사용자 결정 — 선택지는 고3(수능) 수준까지. 수능 어휘(adversary · harness)는 쓰고, 수능을 넘는 드문 말만 짚는다
check('오답 — 수능을 넘는 드문 말을 알아본다', ['mendicant', 'Junta', 'lapse into oblivion'].every(isBeyondExamDistractor))
check('오답 — 수능 어휘 · 쉬운 말은 통과', !['adversary', 'harness', 'stagnation', 'enemy', 'give up'].some(isBeyondExamDistractor))
const w09story = 'Elena Ruiz spent thirty years as a child psychologist in a coastal town. She watched children sort toys, and she treated each one with patience and respect.'
check('이야기 — "이름 spent N years as a 직업" 도입을 짚는다', storyPatternIssues(w09story).some((x) => x.includes('첫 문장')))
check('이야기 — 덕목으로 끝나면 짚는다', storyPatternIssues(w09story).some((x) => x.includes('마지막')))
check('이야기 — Dr. 같은 약어에서 첫 문장이 끊기지 않는다', storyPatternIssues('Dr. Mina Park had spent twelve years as an immunologist in Busan. She left.').some((x) => x.includes('첫 문장')))
check('이야기 — 장면으로 끝나면 통과', storyPatternIssues('At five in the morning, the dock was dark. Mara checked the ropes. She handed the boy his cap.').length === 0)

const { buildPartIIIPrompt, buildPartVPrompt, buildPartVIPrompt } = await import('../server/quizPrompts.js')
const qItem = { id: 'q', headword: 'stretch', pos: '동', meaning: '늘이다' }
const vPrompt = buildPartVPrompt({ items: [{ ...qItem, synonyms: ['extend', 'lengthen'], antonyms: ['shrink'] }] })
check('PART V — 선택지 낱말은 고3 이내 · 수능을 넘는 말 목록이 실린다', vPrompt.includes('고3(수능) 수준 이내') && vPrompt.includes('mendicant') && !vPrompt.includes('고2'))
// 시험지 검수: 오답이 모두 반대 방향이라 쉬운 반대말을 지우면 풀렸다 → 버리는 오답 1개 이상 + 근접 오답 정확히 1개
check('PART V — 버리는 오답 1개 이상 · 근접 오답 정확히 1개 · 검수 예시가 실린다',
  vPrompt.includes('문항마다 1개 이상') && vPrompt.includes('문항마다 정확히 1개') && vPrompt.includes('put off') && vPrompt.includes('"버림"'))
check('PART V — 근접 오답은 같은 방향 · 비슷한 형태, 문맥 · 연어 · 사실관계로 틀림', vPrompt.includes('형태가 비슷하지만') && vPrompt.includes('사실관계'))
check('PART V — 오답마다 틀린 이유(reasons)를 받는다', vPrompt.includes('"reasons"') && !vPrompt.includes('"wrongWhy"'))
check('PART V — 고난도 1~2문항을 hard 로 받는다', vPrompt.includes('고난도 문항 1~2개') && vPrompt.includes('"hard"'))
check('PART V — "쉬운 단어를 쓰지 마라" · "반대 방향 2개까지" 는 없다', !vPrompt.includes('쉬운 단어를 쓰지 마라') && !vPrompt.includes('많아야 2개'))

const { checkPart, answerCheckIssues } = await import('../src/lib/quizClient.js')
const vItem = (roles, answers, hard = false) => ({
  sentence: `The ${'word '.repeat(26)}_______________ here.`,
  choices: ['a', 'b', 'c', 'd', 'e'],
  answers,
  roles,
  reasons: roles.map((r) => (r === '정답' ? '' : '이유')),
  hard,
  clues: ['x', 'y'],
  answerCheck: { fits: answers, doubtful: [] },
})
const goodV = { items: [
  vItem(['버림', '정답', '근접', '정답', '정답'], [2, 4, 5], true),
  vItem(['정답', '버림', '근접', '버림', '정답'], [1, 5]),
  vItem(['버림', '정답', '버림', '근접', '버림'], [2]),
  vItem(['정답', '근접', '버림', '정답', '버림'], [1, 4]),
  vItem(['근접', '정답', '정답', '버림', '정답'], [2, 3, 5], true),
] }
check('PART V 검사 — 버림 1+ · 근접 1 · 이유 · 점검 통과 · 고난도 2 이면 걸리지 않는다', checkPart('V', goodV).length === 0, checkPart('V', goodV).join(' · '))
const allOpposite = { items: goodV.items.map((it, i) => (i === 2 ? { ...it, roles: ['버림', '정답', '버림', '버림', '버림'] } : it)) }
check('PART V 검사 — 근접 오답이 없으면(모두 반대 방향) 짚는다', checkPart('V', allOpposite).some((x) => x.includes('28번 — 근접 오답이 0개')))
const twoNear = { items: goodV.items.map((it, i) => (i === 1 ? { ...it, roles: ['정답', '근접', '근접', '버림', '정답'] } : it)) }
check('PART V 검사 — 근접 오답이 2개면 짚는다', checkPart('V', twoNear).some((x) => x.includes('27번 — 근접 오답이 2개')))
const noReason = { items: goodV.items.map((it, i) => (i === 0 ? { ...it, reasons: ['', '', '이유', '', ''] } : it)) }
check('PART V 검사 — 버리는 오답의 이유가 빠지면 짚는다', checkPart('V', noReason).some((x) => x.includes('26번 — 틀린 이유가 없는 오답: a')))
const noHard = { items: goodV.items.map((it) => ({ ...it, hard: false })) }
check('PART V 검사 — 고난도가 없으면 짚는다', checkPart('V', noHard).some((x) => x.includes('고난도 문항이 0개')))
// 복수 정답 점검 — 정답 없이 다시 풀어 본 결과를 정답과 견준다
const ac = (answerCheck) => answerCheckIssues({ choices: ['a', 'b', 'c', 'd', 'e'], answers: [2, 4], answerCheck }, '26번')
check('복수 정답 점검 — 오답을 답으로 고르면 짚는다', ac({ fits: [2, 3, 4], doubtful: [] }).some((x) => x.includes('③ c 도 답으로 읽힘')))
check('복수 정답 점검 — 애매하다고 한 오답을 짚는다', ac({ fits: [2, 4], doubtful: [{ choice: 1, why: '문맥상 가능' }] }).some((x) => x.includes('① a 가 답으로 읽힐 여지')))
check('복수 정답 점검 — 정답을 고르지 않으면 짚는다', ac({ fits: [2], doubtful: [] }).some((x) => x.includes('정답 ④ d')))
check('복수 정답 점검 — 정답과 같으면 통과', ac({ fits: [4, 2], doubtful: [] }).length === 0)
check('복수 정답 점검 — 점검이 실패하면 알린다', ac({ error: 'timeout' }).some((x) => x.includes('점검 실패')))
const { buildPartVCheckPrompt } = await import('../server/quizPrompts.js')
const vCheckPrompt = buildPartVCheckPrompt({ items: [{ id: 'v1', sentence: 'They _______________ it.', choices: ['a', 'b', 'c', 'd', 'e'] }] })
check('복수 정답 점검 프롬프트 — 정답을 싣지 않고 doubtful 을 받는다', vCheckPrompt.includes('id=v1') && vCheckPrompt.includes('① a') && vCheckPrompt.includes('doubtful') && !vCheckPrompt.includes('answers'))
const { wrongReasons } = await import('../src/lib/exportDocx.js')
check('정답해설 — 오답마다 이유 한 마디', wrongReasons({ choices: ['enemy', 'companion', 'acquaintance', 'partner', 'friend'], answers: [2, 4, 5], reasons: ['반대 방향', '', '그냥 아는 사이', '', ''] }) === '① enemy — 반대 방향 / ③ acquaintance — 그냥 아는 사이')

const viPrompt = buildPartVIPrompt({ items: [qItem], opening: 1, ending: 2 })
check('PART VI — 고른 도입 · 마무리 틀이 실린다', viPrompt.includes('대사') && viPrompt.includes('반전'))
check('PART VI — 소개 틀 · 교훈 마무리를 금한다', viPrompt.includes('spent/had spent N years') && viPrompt.includes('교훈'))
check('PART VI — "보편적 가치로 마무리" 는 없다', !viPrompt.includes('가치**로 마무리'))
const iiiPrompt = buildPartIIIPrompt({ derivative: [], synonym: [], antonym: [{ ...qItem, antonyms: ['shrink', 'shorten'] }] })
check('PART III — 같은 첫 글자 다른 답을 rivals 로 받는다', iiiPrompt.includes('rivals') && iiiPrompt.includes('shorten'))

/* 19. Week 03 시험지 검수 ------------------------------------------ */
console.log('\n[19] Week 03 시험지 검수 — a(n) · 정답해설 머리 · 정답 노출 · PART I 점검 · 옛 시험지')
const { neutralArticles } = await import('../src/lib/quizRules.js')
// 35번 "Mina noticed a ___" — 모음으로 시작하는 authenticity 가 후보에서 빠졌다
check('a(n) — "noticed a {35}" 는 a(n)', neutralArticles('Mina noticed a {35} in the old records.') === 'Mina noticed a(n) {35} in the old records.')
check('a(n) — An 은 A(n), an 도 a(n)', neutralArticles('An {31} began. It was an {32}.') === 'A(n) {31} began. It was a(n) {32}.',
  neutralArticles('An {31} began. It was an {32}.'))
check('a(n) — PART V 밑줄 빈칸도', neutralArticles('carried out a _______________ in which') === 'carried out a(n) _______________ in which')
check('a(n) — 이미 a(n) · 낱말 끝의 a · 형용사를 사이에 둔 a 는 그대로',
  neutralArticles('a(n) {35}, data {31}, a deliberate _____') === 'a(n) {35}, data {31}, a deliberate _____')
check('PART V · VI 프롬프트에 a(n) 규칙',
  buildPartVPrompt({ items: [{ ...qItem, synonyms: ['extend'], antonyms: [] }] }).includes('a(n)') && buildPartVIPrompt({ items: [qItem] }).includes('a(n)'))

const { answerHeadText } = await import('../src/lib/exportDocx.js')
// 정답해설 머리에 연도 · 반 · 주차가 빠졌다. 시험지 머리는 Week 03 으로 나왔다
const ah = answerHeadText('겨울학기 단어학습', { year: '2027', klass: '완성', week: '03' })
check('정답해설 머리 — 시험지와 같은 연도 · 반 · 주차', ah === '2027 겨울학기 단어학습 완성반 Week 03 — 정답 및 해설', ah)
check('정답해설 머리 — 비운 칸은 빈칸 없이 뺀다', answerHeadText('겨울학기 단어학습', { year: '2027' }) === '2027 겨울학기 단어학습 — 정답 및 해설')
check('정답해설 머리 — 제목의 연도 · 주차를 쓴다',
  answerHeadText('2027 겨울학기 [실력반] WEEK 09', { year: '2026' }) === '2027 겨울학기 [실력반] WEEK 09 — 정답 및 해설')

// 배정 — PART IV 문장에 나오는 말은 PART I 로 보내지 않고, PART IV 끼리도 서로의 정답 형태를 드러내지 않는다
const verb = (id, headword, surface, sentence) => ({ id, headword, surface, sentence, pos: '동', meaning: '뜻' })
const noun = (id, headword, sentence, pos = '명') => ({ id, headword, surface: headword, sentence, pos, meaning: '뜻' })
const ivRows = [
  verb('v1', 'induce', 'induced', 'Take emotions induced by television, for example.'),
  verb('v2', 'outweigh', 'outweigh', 'The benefits may outweigh the risks of heat.'),
  verb('v3', 'pinpoint', 'pinpointing', 'They succeed by pinpointing their audience with a unique value proposition.'),
  verb('v6', 'shape', 'shapes', 'Pinpointing the audience shapes a brand.'), // v3 의 정답 형태가 문장에 있다
  verb('v4', 'expend', 'expends', 'In finding a niche, the listener expends less energy.'),
  verb('v5', 'coin', 'coined', 'Haslam coined the term concept creep to describe harm.'),
]
const fillers = ['apple', 'banana', 'cherry', 'dragon', 'eagle', 'falcon', 'garden', 'harbor', 'island', 'jungle', 'kettle', 'lantern']
  .map((w, i) => noun(`f${i}`, w, `A sentence about the ${w}.`))
const w03 = allocate([
  ...ivRows,
  noun('n1', 'niche', 'In finding a niche, the listener expends less energy.'),
  noun('n2', 'value proposition', 'They succeed by pinpointing their audience with a unique value proposition.', '구'),
  noun('n3', 'concept creep', 'Haslam coined the term concept creep to describe harm.', '구'),
  noun('p1', 'set oneself apart', 'Brands set themselves apart.', '구'),
  noun('p2', 'look up to', 'Children look up to them.', '구'),
  ...fillers,
])
const ivIds = w03.parts.IV.map((r) => r.id)
check('PART IV — 다른 문항의 정답 형태가 든 문장의 동사는 고르지 않는다', ivIds.length === 5 && !ivIds.includes('v6'), ivIds.join(','))
const iHeads = w03.parts.I.map((r) => r.headword)
check('PART I — PART IV 문장에 나오는 말(value proposition · concept creep · niche)은 넣지 않는다',
  iHeads.length === 10 && !['value proposition', 'concept creep', 'niche'].some((w) => iHeads.includes(w)), iHeads.join(','))
check('PART I — 그래도 숨길 수 있는 어구는 먼저 넣는다', iHeads[0] === 'set oneself apart' && iHeads[1] === 'look up to', iHeads.join(','))

const { answerExposures, partOneNotes, buildPayloads: payloadsOf, withCurrentRules } = await import('../src/lib/quizClient.js')
const { buildPartI, buildPartIV: partIVOf } = await import('../src/lib/quizBuild.js')
const exIV = partIVOf([ivRows[4], ivRows[1]])
const exTexts = ['In finding a niche, the listener _______________ less energy.', 'The benefits may _______________ the risks; she expends little.']
const ex = answerExposures({ partI: buildPartI([noun('n1', 'niche', '')]), partIV: exIV, partIVTexts: exTexts })
check('정답 노출 — PART IV 문장의 PART I 정답(niche)', ex.some((e) => e.rowId === 'v4' && e.text.includes('PART I 1번 정답 niche')), JSON.stringify(ex.map((e) => e.text)))
check('정답 노출 — PART IV 다른 문항의 정답 형태(expends)', ex.some((e) => e.rowId === 'v2' && e.text.includes('PART IV 21번 정답 expends')), JSON.stringify(ex.map((e) => e.text)))
const exNiches = answerExposures({ partI: buildPartI([noun('n1', 'niche', '')]), partIV: partIVOf([]), gen: { byPart: { V: { result: { items: [{ sentence: 'Species occupy different niches _____ here.' }] } } } } })
check('정답 노출 — 굴절형(niches)도, PART V 문장도', exNiches.length === 1 && exNiches[0].text.startsWith('PART V 26번'), JSON.stringify(exNiches))
const exIII = answerExposures({ gen: { byPart: { III: { result: { items: [{ answer: 'previous', accepted: ['previous', 'prior', 'preceding'] }] } }, VI: { result: { story: 'She had no prior {31} at all.' } } } } })
check('정답 노출 — PART III 인정 정답(prior)이 PART VI 글에', exIII.length === 1 && exIII[0].text === 'PART VI 글에 PART III 16번 정답 prior 이(가) 드러남', JSON.stringify(exIII))
check('정답 노출 — 없으면 빈 목록', answerExposures({ partI: buildPartI([noun('f', 'apple', '')]), partIV: exIV, partIVTexts: exTexts.slice(0, 1) }).every((e) => !e.text.includes('apple')))

// 재료 — PART V · VI 에 PART I 정답을 쓰지 말라고, PART III 에는 PART IV 문장에 나오는 후보를 고르지 말라고 넘긴다
const pl = payloadsOf({
  ...w03.parts,
  III: { derivative: [], synonym: [{ ...noun('s1', 'calm', ''), synonyms: [{ word: 'serenity' }, { word: 'energy' }] }], antonym: [] },
})
check('재료 — V · VI 에 PART I 정답을 쓰지 말 낱말로', pl.V.avoid.join() === iHeads.join() && pl.VI.avoid.join() === iHeads.join(), pl.V.avoid.join())
check('재료 — III 후보 가운데 PART IV 문장에 나오는 말(energy)', JSON.stringify(pl.III.synonym[0].avoid) === '["energy"]', JSON.stringify(pl.III.synonym[0].avoid))
check('재료 — PART I 점검에 10문항', pl.I.items.length === 10 && pl.I.items[0].prompt && pl.I.items[0].answer === 'set oneself apart')
const viAvoid = buildPartVIPrompt({ items: [qItem], avoid: ['niche', 'concept creep'] })
check('PART VI 프롬프트 — 쓰지 말 낱말이 실린다', viAvoid.includes('글에 쓰지 말 낱말') && viAvoid.includes('concept creep'))
check('PART III 프롬프트 — 고르지 말 후보가 실린다', buildPartIIIPrompt({ derivative: [], synonym: [{ ...qItem, synonyms: ['extend'], avoid: ['extend'] }], antonym: [] }).includes('정답으로 고르지 말 것: extend'))

// PART I 점검 — 7번 "다르게" 는 differently 로 쓴다(뜻을 좁힘), 5번 "정서적인" 은 emotional 과 겹친다(채점 기준)
const { buildPartICheckPrompt } = await import('../server/quizPrompts.js')
const iPrompt = buildPartICheckPrompt({ items: [{ id: 'd1', no: 7, prompt: '다르게', answer: 'differentially', pos: '부', synonyms: 'differently' }] })
check('PART I 점검 프롬프트 — 다른 낱말 · likely · 좁힌 뜻을 받는다',
  iPrompt.includes('differently') && iPrompt.includes('"likely"') && iPrompt.includes('차등적으로') && iPrompt.includes('정서적인'))
const p1Rows = [
  { id: 'd1', headword: 'differentially', pos: '부', meaning: '다르게', synonyms: [{ word: 'differently' }] },
  { id: 'a1', headword: 'affective', pos: '형', meaning: '정서적인', synonyms: [{ word: 'emotional' }] },
  { id: 'c1', headword: 'causal', pos: '형', meaning: '인과적인', synonyms: [] },
]
const p1Check = { items: [
  { id: 'd1', others: [{ word: 'differently', likely: true, why: '훨씬 흔함' }], prompt: '차등적으로' },
  { id: 'a1', others: [{ word: 'emotional', likely: false }], prompt: '' },
  { id: 'c1', others: [{ word: 'Causal', likely: true }], prompt: '' }, // 정답 자신(굴절 · 대소문자)은 다른 말로 치지 않는다
] }
const notes = partOneNotes(p1Check, buildPartI(p1Rows))
check('PART I 점검 — 정답 자신은 빼고 두 문항', notes.length === 2, JSON.stringify(notes.map((n) => n.answer)))
check('PART I 점검 — 흔한 말이면 좁힌 뜻을 제안', notes[0]?.no === 1 && notes[0].likely && notes[0].suggestion === '차등적으로', JSON.stringify(notes[0]))
check('PART I 점검 — 들어맞기만 하면 채점 기준', notes[1]?.no === 2 && !notes[1].likely, JSON.stringify(notes[1]))
const narrowed = buildPartI(p1Rows, 1, { d1: '차등적으로' })
check('PART I — 바꾼 뜻으로 문항을 낸다', narrowed[0].prompt === '차등적으로' && narrowed[0].meaning === '차등적으로' && narrowed[1].prompt === '정서적인')
check('PART I — 바꾼 문항은 applied', partOneNotes(p1Check, narrowed, { d1: '차등적으로' })[0].applied === true)
check('PART I — 어구는 바꾼 뜻에도 낱말 수', buildPartI([{ id: 'x', headword: 'set oneself apart', meaning: '돋보이다' }], 1, { x: '자신을 돋보이게 하다' })[0].prompt === '자신을 돋보이게 하다 (3)')

// 그 전에 만든 시험지 — 다시 만들지 않고 내려받아도 지금 규칙(두 글자 힌트 · 인정 정답 · a(n))이 입혀진다
const oldGen = {
  payloads: { III: { antonym: [{ id: 'a', antonyms: ['prior', 'preceding'] }] } },
  byPart: {
    III: { result: { items: [{ id: 'a', kind: 'antonym', headword: 'subsequent', answer: 'previous', hint: 'prev', rivals: [] }] }, issues: ['옛 검사'] },
    VI: { result: { story: 'Mina noticed a {35} in the old records.' } },
  },
}
const nowGen = withCurrentRules(oldGen)
const nowIII = nowGen.byPart.III.result.items[0]
check('옛 시험지 — 힌트 pr · 세 말 모두 정답', nowIII.hint === 'pr' && nowIII.accepted.join() === 'previous,prior,preceding', JSON.stringify(nowIII))
check('옛 시험지 — a(n) · 옛 검사 다시 셈', nowGen.byPart.VI.result.story.includes('a(n) {35}') && !nowGen.byPart.III.issues.includes('옛 검사'))
check('옛 시험지 — 저장된 값은 그대로', oldGen.byPart.III.result.items[0].hint === 'prev' && oldGen.byPart.VI.result.story.includes(' a {35}'))

/* 20. Week 02 시험지 검수 ------------------------------------------ */
console.log('\n[20] Week 02 시험지 검수 — 머리 연도 · 어구가 있으면 "말"')
const { headFromTitle, instructionOf } = await import('../src/lib/exportDocx.js')
// 단어장 · 파일은 2027 인데 시험지 머리와 정답해설에 2026 — 제목을 "겨울학기 단어학습" 으로 바꾸며 연도가 빠지고 칸의 올해가 찍혔다
check('제목의 연도 · 주차를 머리 칸으로', JSON.stringify(headFromTitle('2027 겨울학기 완성반 Week02', { year: '2026', klass: '완성', week: '' })) ===
  JSON.stringify({ year: '2027', klass: '완성', week: '02' }), JSON.stringify(headFromTitle('2027 겨울학기 완성반 Week02', { year: '2026', klass: '완성', week: '' })))
check('제목에 없으면 칸 그대로', JSON.stringify(headFromTitle('겨울학기 단어학습', { year: '2027', klass: '완성', week: '03' })) === JSON.stringify({ year: '2027', klass: '완성', week: '03' }))
check('WEEK_09 · 9주차도 숫자만 옮긴다', headFromTitle('2027_겨울학기_[실력반]_WEEK_09', {}).week === '09' && headFromTitle('겨울학기 9주차', {}).week === '9')

// store — persist 가 window.localStorage 를 찾으므로 잠깐 메모리 저장소를 붙인다(다른 검사에 새지 않게 맨 끝에서)
const memStore = new Map()
globalThis.window = { localStorage: { getItem: (k) => memStore.get(k) ?? null, setItem: (k, v) => memStore.set(k, String(v)), removeItem: (k) => memStore.delete(k) } }
const { useStore } = await import('../src/store.js')
delete globalThis.window
const st = useStore.getState
st().setQuizHead({ year: '2026', klass: '', week: '' }) // 처음 채워지는 올해
st().loadWordbook({ rows: [{ id: 'w', headword: 'a' }], passages: [], docTitle: '2027 겨울학기 완성반 Week02' })
check('단어장을 불러오면 제목의 연도 · 주차가 칸에', st().quizHead.year === '2027' && st().quizHead.week === '02', JSON.stringify(st().quizHead))
st().setQuizHead({ year: '2026' }) // 칸이 올해로 남아 있던 경우
st().setDocTitle('겨울학기 단어학습')
const lead02 = testHeadParts(st().docTitle, st().quizHead).lead
check('제목에서 연도를 지우면 그 연도가 머리에 남는다', lead02.startsWith('2027 겨울학기 단어학습') && st().quizHead.week === '02', lead02)
st().reset()
check('초기화해도 연도는 남고 반 · 주차는 비운다', st().quizHead.year === '2027' && !st().quizHead.week && !st().quizHead.klass, JSON.stringify(st().quizHead))
st().setQuizHead({ year: '2026' })
st().loadWordbook({ rows: [{ id: 'a', headword: 'a' }], passages: [], docTitle: '겨울학기 A' })
st().loadWordbook({ rows: [{ id: 'b', headword: 'b' }], passages: [], docTitle: '겨울학기 B' }) // A 가 보관된다 (연도 2026)
st().setQuizHead({ year: '2027' })
st().restorePrevWork()
check('되살려도 지금 연도', st().docTitle === '겨울학기 A' && st().quizHead.year === '2027', JSON.stringify([st().docTitle, st().quizHead]))

// 30번 선지에 point of view · case in point — "적절한 단어를" 이 아니라 "적절한 말을" (Week 01 과 같게)
const v02 = { items: [{ choices: ['exception', 'point of view', 'obstacle', 'case in point', 'contradiction'] }] }
check('PART V — 선지에 어구가 있으면 "적절한 말을"', instructionOf('V', v02) === '빈칸에 들어가기에 적절한 말을 모두 고르시오.', instructionOf('V', v02))
check('PART V — 낱말뿐이면 "적절한 단어를"', instructionOf('V', { items: [{ choices: ['outbreak', 'flare-up'] }] }) === '빈칸에 들어가기에 적절한 단어를 모두 고르시오.')
check('PART II · III 도 어구가 있으면 "말"',
  instructionOf('II', { definitions: [{ headword: 'reluctant' }], distractor: { word: 'at odds' } }).includes('해당하는 말을') &&
  instructionOf('III', { items: [{ left: 'hide', right: 'conceal', headword: 'absorb', answer: 'take in' }] }).startsWith('주어진 두 말의'))
check('PART III — 어구가 없으면 원래 문구', instructionOf('III', { items: [{ left: 'a', right: 'b', headword: 'c', answer: 'd' }] }) === '주어진 두 단어의 관계와 같도록 빈칸에 알맞은 단어를 쓰시오.')
check('PART I · IV · VI 은 그대로', instructionOf('VI', {}) === '글의 빈칸에 들어갈 낱말을 보기에서 고르시오.')

/* 21. 지문 나누기 — 장문 독해 (Week 07) --------------------------- */
console.log('\n[21] 지문 나누기 — 지문 뒤에 문항이 오는 장문 독해')
const { stripInsertionMarks: stripMarks } = await import('../src/lib/passages.js')
const body = (topic) => [`${topic} shapes how we live every day.`, `Most people never notice ${topic.toLowerCase()} at all.`, `Yet ${topic.toLowerCase()} changes slowly over time.`]
const titleChoices = ['① Blending In: When Tech Stops Feeling Like Tech', '② Digital Interfaces Are Becoming Too Complicated!', '③ Out-of-body Experience', '④ How Software Affects Work', '⑤ Wearable Technology']
const vocabChoices = '① (a) ② (b) ③ (c) ④ (d) ⑤ (e)'

// 수능완성 Ch13 — 지문 번호 "1." 뒤에 문항 번호 "<01>" "<02>" 가 따로 붙는다. 문항 번호가 더 많아 지문 번호로 잡히면 1번 지문이 버려졌다
const ch13 = [
  '1. [13강 기출 Practice]   다음 글을 읽고 물음에 답하시오.',
  'In design, people are no longer (a) aware of the technology. They (b) hidden the seams inside.',
  ...body('Seamlessness'),
  '*seamlessness: 이음매 없음',
  '<01> 윗글의 제목으로 가장 적절한 것은?', ...titleChoices,
  '<02> 밑줄 친 (a)~(e) 중에서 문맥상 낱말의 쓰임이 적절하지 않은 것은?', vocabChoices,
  '기술적 설계에서 이음매 없음을 향한 열망은 일상에 녹아드는 것을 목표로 한다.',
  '', '2. [13강 01~02]   다음 글을 읽고 물음에 답하시오.',
  'Young children already use sophisticated methods for deciding whom to trust.', ...body('Trust'),
  '<03> 윗글의 제목으로 가장 적절한 것은?', ...titleChoices,
  '<04> 밑줄 친 (a)~(e) 중에서 문맥상 낱말의 쓰임이 적절하지 않은 것은?', vocabChoices,
  '아이들은 누구를 믿을지 결정하기 위해 정교한 방법을 사용한다.',
  '', '3. [13강 03~05]   다음 글을 읽고 물음에 답하시오.',
  '(A) Sally decided to try to rest. Sally couldn\'t stay mad at her if (a) she tried.',
  '(B) His green eyes danced. (b) She used to wish she got his blond hair.', ...body('Family'),
  '<05> 주어진 글 (A)에 이어질 내용을 순서에 맞게 배열한 것으로 가장 적절한 것은?', '① (B)-(D)-(C) ② (C)-(B)-(D) ③ (C)-(D)-(B) ④ (D)-(B)-(C) ⑤ (D)-(C)-(B)',
  '<06> 밑줄 친 (a)~(e) 중에서 가리키는 대상이 나머지 넷과 다른 것은?', vocabChoices,
  '<07> 윗글에 관한 내용으로 적절하지 않은 것은?', '① Lucy는 Sally의 배 위로 뛰어올랐다.', '② Sally는 곱슬머리를 물려받았다.', '③ Lucy는 하이 파이브를 했다.',
  'Sally는 쉬어 보기로 결심했다.',
].join('\n')
const c13 = splitP(ch13)
check('Ch13 — 지문 번호 셋을 모두 찾는다', c13.passages.length === 3 && c13.markerStyle === 'dot', `${c13.passages.length}개 · ${c13.markerStyle}`)
check('Ch13 — 1번 지문이 살아 있다', /^In design, people are no longer aware/.test(c13.passages[0]?.english || ''), c13.passages[0]?.english)
check('Ch13 — 밑줄 표시 (a)~(e) 는 걷는다 (문장 첫머리 (b) She 포함)',
  !/\([a-e]\)/.test(c13.passages.map((p) => p.english).join(' ')) && /She used to wish/.test(c13.passages[2]?.english || ''))
check('Ch13 — 선지 · 순서 보기는 지문에 없다', !/Blending In|\(B\)-\(D\)/.test(c13.passages.map((p) => p.english).join(' ')))

// 장문 독해 문제집 — 지문 머리는 "[1~2]", "1." "2." 는 지문 뒤에 오는 문항 번호다. <보기> 문장과 [P1] 이름표도 있다
const workbook7 = [
  'WEEK 07. 장문 독해', '',
  '[1~2] 다음 글을 읽고, 물음에 답하시오.', 'Few pick up a novel and criticize it for being unreal.', ...body('Fiction'),
  '* scorn: 비웃음',
  '1. 윗글의 제목으로 가장 적절한 것은?', '① Drawn to the Unreal ② What True Stories Teach ③ The Science of Plot ④ Why We Read ⑤ Fiction Today',
  '2. 밑줄 친 (a)~(e) 중에서 문맥상 낱말의 쓰임이 적절하지 않은 것은?', vocabChoices,
  '[3~4] 다음 글을 읽고 물음에 답하시오.',
  '[P1] If human beings are naturally inclined to cooperate, why do relationships become competitive?',
  '[P2] Social dilemmas occur when members of a group are in conflict.', ...body('Cooperation'),
  '3. 윗글의 내용과 일치하지 않는 것을 모두 고른 것은?', '＜보기＞',
  '(a) Although human beings prefer cooperation, relationships become competitive.',
  '(b) Natural public goods remain sustainable only if used wisely.',
  '(c) The harvesting dilemma is worsened by a time delay.',
  '① (a), (b) ② (a), (c) ③ (b), (c) ④ (a), (b), (c) ⑤ (b)',
  '4. 윗글의 빈칸에 들어갈 말로 가장 적절한 것은?', '① cooperation pays ② greed wins ③ time heals ④ rules fail ⑤ none',
].join('\n')
const w7 = splitP(workbook7)
check('문제집 — 범위 머리 [1~2] [3~4] 로 지문 둘', w7.passages.length === 2, `${w7.passages.length}개 · ${w7.markerStyle}`)
check('문제집 — 첫 지문이 살아 있다', /^Few pick up a novel/.test(w7.passages[0]?.english || ''), w7.passages[0]?.english)
check('문제집 — <보기> 문장은 지문에 없다', !/Although human beings prefer|harvesting dilemma/.test(w7.passages[1]?.english || ''), w7.passages[1]?.english)
check('문제집 — [P1] 이름표는 걷는다', /^If human beings/.test(w7.passages[1]?.english || '') && !/\[P\d\]/.test(w7.passages[1]?.english || ''))

// 내신 시험지 — 낱문항 지문 "1." 사이에 "[3~4]" 묶음이 끼어 있다. 묶음 지문이 2번 지문에 붙으면 안 된다
const mixedExam = [
  '1. 다음 글의 주제로 가장 적절한 것은?', 'Historically, the walrus was hunted to near extinction.', ...body('Hunting'), ...titleChoices, '',
  '2. 다음 글의 요지로 가장 적절한 것은?', 'The electronic exchange of data is now required.', ...body('Data'), ...titleChoices, '',
  '[3~4] 다음 글을 읽고, 물음에 답하시오.', 'A woman became subject to rumors at work.', ...body('Rumor'),
  '3. 윗글의 제목으로 가장 적절한 것은?', ...titleChoices,
  '4. 윗글의 요지로 가장 적절한 것은?', ...titleChoices, '',
  '5. 다음 글의 제목으로 가장 적절한 것은?', 'The shift from oral to literate culture changed memory.', ...body('Writing'), ...titleChoices,
].join('\n')
const mx = splitP(mixedExam)
check('내신 — 낱문항 지문과 묶음 지문을 모두 가른다', mx.passages.length === 4, mx.passages.map((p) => p.english.slice(0, 20)).join(' | '))
check('내신 — 묶음 지문이 앞 지문에 붙지 않는다', !/rumors/.test(mx.passages[1]?.english || '') && /^A woman became/.test(mx.passages[2]?.english || ''))

// 지문 번호가 따로 없고 지문 뒤에 문항 번호만 있는 문서 — 첫 문항 앞의 글이 첫 지문이다
const passageFirst = [
  'Many animals pursue a mixed strategy of accumulating fat.', ...body('Body size'),
  '1. 윗글의 제목으로 가장 적절한 것은?', ...titleChoices, '',
  'Writing of a commentary on Tolstoy, the critic agrees with Lenin.', ...body('Literature'),
  '2. 윗글의 제목으로 가장 적절한 것은?', ...titleChoices,
].join('\n')
const pf = splitP(passageFirst)
check('지문 → 문항 순서 — 첫 지문도 살린다', pf.passages.length === 2 && /^Many animals/.test(pf.passages[0]?.english || ''), pf.passages.map((p) => p.english.slice(0, 20)).join(' | '))

// 수능완성 Week 04~06 처럼 "1. [7강 기출 Practice] 발문" 다음에 지문이 오는 문서는 그대로
const headFirst = [1, 2, 3].flatMap((n) => [`${n}. [7강 0${n}] 다음 빈칸에 들어갈 말로 가장 적절한 것은?`, `Animals of group ${n} live here.`, ...body(`Topic${n}`), ...titleChoices, ''])
const hf = splitP(headFirst.join('\n'))
check('발문 뒤에 지문이 오는 문서는 그대로 "1." 로 나눈다', hf.passages.length === 3 && hf.markerStyle === 'dot' && /^Animals of group 1/.test(hf.passages[0].english), `${hf.passages.length}개 · ${hf.markerStyle}`)

check('밑줄 표시 (a) 는 걷고 대문자 (A) 는 둔다', stripMarks('people are no longer (a) aware of it.') === 'people are no longer aware of it.' && stripMarks('(A) conversation') === '(A) conversation')
check('[P2] 단락 이름표', stripParagraphLabel('[P2] Social dilemmas occur.') === 'Social dilemmas occur.')

console.log(`\n${failures === 0 ? '전체 통과' : `${failures}건 실패`}\n`)
process.exit(failures ? 1 : 0)
