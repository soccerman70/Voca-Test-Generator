/**
 * AI 자동 추출이 목표 개수를 채우고, 지문 전체에 고르게 퍼지는지 점검한다.
 * 선별 규칙은 화면과 같은 src/lib/selectPlan.js 를 그대로 쓴다 — 여기서 로직을 베끼지 않는다.
 *   node tools/select-diagnose.mjs [포트] [목표개수] [지문파일]
 *
 * 지문파일은 .docx 또는 .txt. 생략하면 samples/샘플지문.docx 를 쓴다.
 */
import mammoth from 'mammoth'
import { readFile } from 'node:fs/promises'
import { splitPassages } from '../src/lib/passages.js'
import { autoSelect, planQuotas } from '../src/lib/aiClient.js'
import { runSelection } from '../src/lib/selectPlan.js'

const PORT = process.argv[2] || '5180'
process.env.VOCA_API_BASE = `http://localhost:${PORT}`
const TARGET = Number(process.argv[3] || 50)
const SOURCE = process.argv[4] || 'samples/샘플지문.docx'

const text = SOURCE.endsWith('.docx')
  ? (await mammoth.extractRawText({ buffer: await readFile(SOURCE) })).value
  : await readFile(SOURCE, 'utf8')
const { passages } = splitPassages(text)

/** 화면과 똑같이 autoSelect 를 부른다 — 묶음 쪼개기·초과 표집까지 실제 경로 그대로다. */
async function request({ passages: ps, quotas, exclude }) {
  const { items } = await autoSelect({ passages: ps, quotas, exclude, model: 'claude-opus-5' })
  return items
}

const quotas = planQuotas(passages, TARGET)
console.log(`지문 ${passages.length}개 · 목표 ${TARGET}개`)
console.log(`쿼터: ${passages.map((p, i) => `지문${p.no}:${quotas[i]}`).join(' · ')}\n`)

const { added, rounds, drops, error } = await runSelection({
  passages,
  quotas,
  needed: TARGET,
  kept: [],
  request,
  onStage: ({ round, shortCount }) => console.log(`${round}차 — 배정 미달 지문 ${shortCount}개에 요청`),
})

if (error) console.log(`\n호출 실패: ${error.message}`)

const ok = added.length === TARGET
console.log(`\n${ok ? '통과' : '미달'} — 목표 ${TARGET}개 / 최종 ${added.length}개 · ${rounds}회 요청`)
console.log(
  `못 찾음 ${drops.notFound} · 자리 겹침 ${drops.clash} · 굴절형 중복 ${drops.duplicate} · 지문번호 불일치 ${drops.noPassage}`
)

const dup = new Set()
const repeated = added.filter((s) => {
  const key = s.surface.toLowerCase()
  if (dup.has(key)) return true
  dup.add(key)
  return false
})
console.log(`중복 표제어: ${repeated.length}${repeated.length ? ` — ${repeated.map((s) => s.surface).join(', ')}` : ''}`)

// 쿼터와 실제 분배를 나란히 놓아야 쏠림이 눈에 보인다
const actual = passages.map((p) => added.filter((s) => s.passageNo === p.no).length)
console.log(`지문별 쿼터 : ${passages.map((p, i) => `${p.no}:${quotas[i]}`).join(' · ')}`)
console.log(`지문별 실제 : ${passages.map((p, i) => `${p.no}:${actual[i]}`).join(' · ')}`)
console.log(`빈 지문: ${actual.filter((n) => n === 0).length}개 / ${passages.length}개`)
console.log(`난이도 분포: ${[5, 4, 3, 2, 1].map((d) => `${d}→${added.filter((s) => s.difficulty === d).length}`).join(' · ')}`)

process.exitCode = ok && !error ? 0 : 1
