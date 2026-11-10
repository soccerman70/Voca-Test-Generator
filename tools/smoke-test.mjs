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

/* 바뀐 표제어만 생성 ------------------------------------------------ */
console.log('\n[10] 바뀐 표제어만 생성 — 계획 · 엮기 · 반의어 비율')
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
const plain = (id) => ({ id, headword: id, antonyms: [] })
// 남긴 줄 8개 중 3개에 반의어 — 새 줄 1개를 더해도 4/9 로 상한(50%) 안이다
const keepRows = [ant('k1', 1), ant('k2', 1), ant('k3', 1), plain('k4'), plain('k5'), plain('k6'), plain('k7'), plain('k8')]
const one = enforceAntonymRatio([ant('n1', 0.9)], keepRows)
check('새 줄 1개라도 표 전체 비율 안이면 반의어를 남긴다', one.rows[0].antonyms.length === 1 && one.stats.total === 9, JSON.stringify(one.stats))
// 남긴 줄 6개(반의어 3) + 새 줄 2개(둘 다 반의어) = 5/8 → 상한 4 를 1 넘는다
const over = enforceAntonymRatio([ant('n1', 0.9), ant('n2', 0.4)], keepRows.slice(0, 6))
check('넘치면 새 줄에서 확신 낮은 것부터', over.rows.find((r) => r.id === 'n2').antonyms.length === 0 && over.rows.find((r) => r.id === 'n1').antonyms.length === 1, JSON.stringify(over.stats))
const stuck = enforceAntonymRatio([ant('n1', 0.9)], [ant('k1', 1), ant('k2', 1), plain('k3')])
check('남긴 줄은 넘쳐도 건드리지 않는다', stuck.rows[0].antonyms.length === 0 && stuck.stats.removed === 1, JSON.stringify(stuck.stats))
const solo = enforceAntonymRatio([ant('n1', 0.9), plain('n2')])
check('keep 없이 부르면 예전과 같다', solo.stats.total === 2 && solo.rows[0].antonyms.length === 1, JSON.stringify(solo.stats))

console.log(`\n${failures === 0 ? '전체 통과' : `${failures}건 실패`}\n`)
process.exit(failures ? 1 : 0)
