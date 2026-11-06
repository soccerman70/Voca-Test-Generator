/**
 * 생성 시간의 병목을 재는 벤치 — 배치를 병렬로 돌릴 값어치가 있는지 숫자로 확인한다.
 *
 * 1) 배치 하나를 단독으로 돌려 기준 시간 T1 을 잡는다.
 * 2) 같은 크기 배치 N 개를 동시에 던져 총 시간 Tn 을 잰다.
 *
 * Tn 이 T1 에 가까우면 요청이 실제로 병렬 처리되는 것이고, N×T1 에 가까우면
 * 어딘가에서 직렬화되고 있어 코드를 병렬로 바꿔도 이득이 없다.
 *
 *   node tools/bench-enrich.mjs [포트] [배치크기] [동시개수] [모델]
 */
import mammoth from 'mammoth'
import { readFile } from 'node:fs/promises'
import { splitPassages, sentenceAt } from '../src/lib/passages.js'

const PORT = process.argv[2] || '5180'
const BATCH_SIZE = Number(process.argv[3] || 25)
const CONCURRENCY = Number(process.argv[4] || 3)
const MODEL = process.argv[5] || 'claude-sonnet-5-5'
const BASE = `http://localhost:${PORT}/api/ai`

const { value: text } = await mammoth.extractRawText({ buffer: await readFile('samples/샘플지문.docx') })
const { passages } = splitPassages(text)

/** 지문에서 실제로 등장한 단어를 뽑아 항목을 만든다. 배치마다 다른 단어를 써야 캐시 효과가 섞이지 않는다. */
function collectItems(count) {
  const items = []
  const seen = new Set()
  for (const p of passages) {
    for (const m of p.english.matchAll(/[A-Za-z]{6,}/g)) {
      const key = m[0].toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ surface: m[0], passageNo: p.no, sentence: sentenceAt(p.english, m.index) })
      if (items.length >= count) return items
    }
  }
  return items
}

const need = BATCH_SIZE * (CONCURRENCY + 1)
const pool = collectItems(need)
if (pool.length < need) {
  console.log(`! 지문에서 뽑은 단어가 ${pool.length}개뿐이라 부족한 만큼 앞에서 다시 씁니다 (id 는 모두 다름)`)
}

function batchAt(index) {
  return Array.from({ length: BATCH_SIZE }, (_, i) => {
    const src = pool[(index * BATCH_SIZE + i) % pool.length]
    return { id: `b${index}-${i}`, ...src }
  })
}

async function runBatch(index) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: batchAt(index), antonymTargetRatio: 0.4, model: MODEL }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error)
  return {
    secs: (Date.now() - t0) / 1000,
    count: data.results.length,
    out: data.usage?.output_tokens || 0,
    input: data.usage?.input_tokens || 0,
    cacheRead: data.usage?.cache_read_input_tokens || 0,
  }
}

console.log(`\n모델 ${MODEL} · 배치 ${BATCH_SIZE}개 항목 · 동시 ${CONCURRENCY}개\n`)

/* ---- 1. 기준: 배치 하나 단독 ---- */
console.log('[1] 배치 하나 단독 실행')
const solo = await runBatch(0)
console.log(
  `    ${solo.secs.toFixed(1)}초 · 결과 ${solo.count}개 · 출력 ${solo.out} 토큰 ` +
    `· 입력 ${solo.input} (캐시읽기 ${solo.cacheRead}) · ${(solo.out / solo.secs).toFixed(0)} tok/s\n`
)

/* ---- 2. 동시 N개 ---- */
console.log(`[2] 배치 ${CONCURRENCY}개 동시 실행`)
const t0 = Date.now()
const many = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => runBatch(i + 1)))
const wall = (Date.now() - t0) / 1000

many.forEach((r, i) => {
  console.log(`    배치 ${i + 1}: ${r.secs.toFixed(1)}초 · 출력 ${r.out} 토큰 · ${(r.out / r.secs).toFixed(0)} tok/s`)
})

const totalOut = many.reduce((s, r) => s + r.out, 0)
console.log(`    벽시계 총 ${wall.toFixed(1)}초 · 출력 합계 ${totalOut} 토큰\n`)

/* ---- 3. 판정 ---- */
const serialEstimate = solo.secs * CONCURRENCY
const speedup = serialEstimate / wall
console.log('[3] 판정')
console.log(`    순차로 돌렸다면 예상: ${serialEstimate.toFixed(1)}초 (${solo.secs.toFixed(1)} × ${CONCURRENCY})`)
console.log(`    실제 동시 실행:      ${wall.toFixed(1)}초`)
console.log(`    속도 향상:           ${speedup.toFixed(2)}배`)

if (speedup >= CONCURRENCY * 0.7) {
  console.log(`\n    → 요청이 제대로 병렬 처리된다. 배치 루프를 병렬로 바꿀 값어치가 있다.`)
} else if (speedup >= 1.3) {
  console.log(`\n    → 부분적으로만 병렬이다. 이득은 있지만 ${CONCURRENCY}배에는 못 미친다.`)
} else {
  console.log(`\n    → 어딘가에서 직렬화되고 있다. 코드를 병렬로 바꿔도 이득이 없다.`)
}
