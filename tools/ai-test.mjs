/**
 * 실제 AI 엔드포인트 점검 (dev 서버가 떠 있어야 함).
 *   node tools/ai-test.mjs [포트]
 */
import mammoth from 'mammoth'
import { readFile } from 'node:fs/promises'
import { splitPassages, sentenceAt } from '../src/lib/passages.js'
import { planQuotas } from '../src/lib/aiClient.js'
import { tokenize, locateSurface } from '../src/lib/tokenize.js'

const PORT = process.argv[2] || '5181'
const BASE = `http://localhost:${PORT}/api/ai`

const { value: text } = await mammoth.extractRawText({ buffer: await readFile('samples/샘플지문.docx') })
const { passages } = splitPassages(text)

async function post(path, body) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error)
  return { data, secs: ((Date.now() - t0) / 1000).toFixed(1) }
}

/* ---- 1. 자동 표제어 추출 ---- */
console.log('\n=== /api/ai/select — 자동 표제어 추출 (12개 요청) ===')
// 지문별 목표 개수는 분량 비례로 나눠 실어 보낸다 — 화면과 같은 방식이다.
const quotas = planQuotas(passages, 12)
const { data: sel, secs: selSecs } = await post('select', {
  passages: passages
    .map((p, i) => ({ no: p.no, english: p.english, quota: quotas[i] }))
    .filter((p) => p.quota > 0),
  model: 'claude-opus-5',
})
console.log(`받은 항목: ${sel.items.length}개 · ${selSecs}초`)
console.log(`지문별 쿼터: ${passages.map((p, i) => `${p.no}:${quotas[i]}`).join(" · ")}`)
console.log(`지문별 응답: ${passages.map((p) => `${p.no}:${sel.items.filter((it) => Number(it.passageNo) === p.no).length}`).join(" · ")}`)

let matched = 0
for (const it of sel.items) {
  const p = passages.find((x) => x.no === Number(it.passageNo))
  const hit = p ? locateSurface(p.english, tokenize(p.english), it.surface) : null
  if (hit) matched += 1
  console.log(` ${hit ? '✓' : '✗'} 지문${it.passageNo}  ${JSON.stringify(it.surface).padEnd(28)} 난이도${it.difficulty ?? '-'}  ${it.reason || ''}`)
}
console.log(`지문에서 위치를 찾은 항목: ${matched}/${sel.items.length}`)

/* ---- 2. 정규화 + 파생어/유의어/반의어 ---- */
console.log('\n=== /api/ai/enrich — 정규화 규칙 집중 점검 ===')

const PROBES = [
  { p: 1, s: 'immersed', want: 'immerse', why: '수동태 과거분사 → 원형' },
  { p: 1, s: 'challenging', want: 'challenging', why: '형용사로 굳은 현재분사 → 유지' },
  { p: 1, s: 'achieving', want: 'achieve', why: '동명사 → 원형' },
  { p: 1, s: 'matches', want: 'match', why: '3인칭 현재 → 원형' },
  { p: 1, s: 'argued', want: 'argue', why: '현재완료 → 원형' },
  { p: 1, s: 'lose track of time', want: 'lose track of time', why: '어구 유지' },
  { p: 2, s: 'widening', want: 'widen', why: '현재분사(고착 아님) → 원형' },
  { p: 2, s: 'brought about', want: 'bring about', why: '완료형 구동사 → 원형' },
  { p: 3, s: 'distinctive', want: 'distinctive', why: '형용사 → 유지' },
  { p: 4, s: 'overreliance', want: 'overreliance', why: '명사 → 유지' },
]

const items = []
for (const probe of PROBES) {
  const p = passages.find((x) => x.no === probe.p)
  const hit = locateSurface(p.english, tokenize(p.english), probe.s)
  if (!hit) {
    console.log(` ! 지문${probe.p}에서 "${probe.s}" 를 찾지 못해 건너뜀`)
    continue
  }
  items.push({
    id: `t${items.length + 1}`,
    surface: p.english.slice(hit.start, hit.end),
    passageNo: p.no,
    sentence: sentenceAt(p.english, hit.start),
    _want: probe.want,
    _why: probe.why,
  })
}

const { data: enr, secs: enrSecs } = await post('enrich', {
  items: items.map(({ _want, _why, ...rest }) => rest),
  antonymTargetRatio: 0.4,
  model: 'claude-opus-5',
})
console.log(`받은 항목: ${enr.results.length}/${items.length}개 · ${enrSecs}초\n`)

let normOk = 0
let antonymCount = 0
for (const item of items) {
  const r = enr.results.find((x) => String(x.id) === item.id) || {}
  const ok = (r.headword || '').toLowerCase() === item._want.toLowerCase()
  if (ok) normOk += 1
  if ((r.antonyms || []).length) antonymCount += 1
  console.log(`${ok ? ' ok ' : 'FAIL'} ${item.surface}  →  ${r.headword}   (기대: ${item._want} · ${item._why})`)
  console.log(`      품사: ${r.pos || '-'}${r.normalizationNote ? ` · ${r.normalizationNote}` : ''}`)
  console.log(`      파생어: ${fmt(r.derivatives)}`)
  console.log(`      유의어: ${fmt(r.synonyms)}`)
  console.log(`      반의어: ${fmt(r.antonyms)}`)
}

console.log(`\n표제어 정규화 정확도: ${normOk}/${items.length}`)
console.log(`반의어 부여 비율: ${antonymCount}/${items.length} (${Math.round((antonymCount / items.length) * 100)}%, 목표 30~50%)`)
console.log(`최대 개수 위반 — 파생어: ${over(enr.results, 'derivatives')} · 유의어: ${over(enr.results, 'synonyms')} · 반의어: ${over(enr.results, 'antonyms')}`)

/* ---- 3. 상관어구 일반화 · 복수형 단수화 ---- */
console.log('\n=== /api/ai/enrich — 구문 틀 · 복수형 점검 ===')

const SYNTHETIC = [
  ['Not only my brother but also my sister',
    'Not only my brother but also my sister volunteered at the shelter last weekend.',
    'not only A but also B', '상관접속사 → 자리표시자 + 소문자'],
  ['either coffee or tea',
    'Guests may choose either coffee or tea after the meal.',
    'either A or B', '상관접속사 → 자리표시자'],
  ['too abstract to grasp',
    'The lecture was too abstract to grasp without any background knowledge.',
    'too 형용사 to 동사원형', '구문 틀 → 품사 자리표시자'],
  ['societies',
    'Urbanization has reshaped human societies over the past two centuries.',
    'society', '복수 → 단수'],
  ['opportunities',
    'Cities offer economic opportunities that rural areas cannot match.',
    'opportunity', '복수 → 단수'],
  ['phenomena',
    'Researchers have documented similar phenomena in several other regions.',
    'phenomenon', '불규칙 복수 → 단수'],
  ['cascading effects',
    'The loss of a single species can trigger cascading effects throughout a food web.',
    'cascading effect', '어구 안의 복수 → 단수'],
  ['means',
    'Language is a means of transmitting culture across generations.',
    'means', '항상 복수형인 명사 → 유지'],
  ['sift through',
    'Machine learning models can sift through enormous datasets in seconds.',
    'sift through', '구동사 → 유지(자리표시자 적용 안 함)'],
]

const synItems = SYNTHETIC.map(([surface, sentence], i) => ({
  id: `s${i + 1}`, surface, sentence, passageNo: 1,
}))

const { data: syn, secs: synSecs } = await post('enrich', {
  items: synItems, antonymTargetRatio: 0.4, model: 'claude-opus-5',
})
console.log(`받은 항목: ${syn.results.length}/${synItems.length}개 · ${synSecs}초\n`)

let synOk = 0
SYNTHETIC.forEach(([surface, , want, why], i) => {
  const r = syn.results.find((x) => String(x.id) === `s${i + 1}`) || {}
  const ok = (r.headword || '').trim() === want
  if (ok) synOk += 1
  console.log(`${ok ? ' ok ' : 'FAIL'} ${surface}  →  ${r.headword}   (기대: ${want} · ${why})`)
  if (!ok || /A|형용사/.test(want)) {
    console.log(`      품사: ${r.pos || '-'} · 파생어: ${fmt(r.derivatives)} · 유의어: ${fmt(r.synonyms)}`)
  }
})
console.log(`\n구문 틀·복수형 정확도: ${synOk}/${SYNTHETIC.length}`)

const allWords = [...enr.results, ...syn.results].flatMap((r) => [
  r.headword,
  ...(r.derivatives || []).map((d) => d.word),
  ...(r.synonyms || []).map((d) => d.word),
  ...(r.antonyms || []).map((d) => d.word),
])
// 자리표시자 A·B 를 걷어낸 뒤에도 대문자가 남아 있으면 위반
const upper = allWords.filter((w) => /[A-Z]/.test(String(w || '').replace(/\b[AB]\b/g, '')))
console.log(`소문자 표기 위반: ${upper.length}건${upper.length ? ` — ${upper.join(', ')}` : ''}`)

function fmt(list) {
  if (!Array.isArray(list) || !list.length) return '—'
  return list.map((d) => (d.pos ? `${d.word}(${d.pos})` : d.word) + (d.confidence ? ` [${d.confidence}]` : '')).join(', ')
}
function over(results, key) {
  return results.filter((r) => (r[key] || []).length > 2).length
}
