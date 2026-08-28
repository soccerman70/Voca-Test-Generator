/**
 * 브라우저 없이 핵심 로직만 점검한다.
 *   node tools/smoke-test.mjs
 */
import mammoth from 'mammoth'
import { readFile } from 'node:fs/promises'
import { splitPassages, splitSentences, sentenceAt } from '../src/lib/passages.js'
import { tokenize, surfaceOf, locateSurface } from '../src/lib/tokenize.js'
import { guessPos, guessLevel, summarize } from '../src/lib/posLite.js'

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

/* 7. XLSX 워크북 --------------------------------------------- */
console.log('\n[7] XLSX 생성')
const { buildWorkbook, COLUMNS } = await import('../src/lib/exportXlsx.js')
const sampleRows = [
  {
    id: 'r1', passageNo: 1, surface: 'immersed', sentence: sents[1],
    headword: 'immerse', normalizationNote: '수동태 과거분사', pos: '동', meaning: '몰두하다',
    derivatives: [{ word: 'immersion', pos: '명' }, { word: 'immersive', pos: '형' }],
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
  ws.getRow(3).getCell(col('derivatives')).value === 'immersion (명)\nimmersive (형)',
  JSON.stringify(ws.getRow(3).getCell(col('derivatives')).value)
)
check('파생어 셀 wrapText', ws.getRow(3).getCell(col('derivatives')).alignment?.wrapText === true)
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
  JSON.stringify([{ word: 'immersion', pos: '명' }, { word: 'immersive', pos: '형' }]),
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

console.log(`\n${failures === 0 ? '전체 통과' : `${failures}건 실패`}\n`)
process.exit(failures ? 1 : 0)
