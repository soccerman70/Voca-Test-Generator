/**
 * 브라우저 → Vite 미들웨어(/api/ai) → claude -p 구독 호출 클라이언트.
 * 배포로 옮길 때 교체할 지점은 이 파일 하나다.
 */

const ANTONYM_TARGET_RATIO = 0.4
const ANTONYM_MAX_RATIO = 0.5
const ANTONYM_MIN_RATIO = 0.3

/**
 * 브라우저에서는 같은 출처로 상대 경로를 쓴다.
 * node 로 도는 점검 도구(tools/*.mjs)는 출처가 없으므로 VOCA_API_BASE 로 dev 서버를 가리킨다.
 * 도구가 임포트 뒤에 포트를 정할 수 있어야 하므로 값은 부를 때마다 읽는다.
 */
function apiBase() {
  if (typeof window !== 'undefined') return ''
  return globalThis.process?.env?.VOCA_API_BASE || 'http://localhost:5180'
}

async function post(path, body) {
  const res = await fetch(`${apiBase()}/api/ai/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({ error: '응답을 해석할 수 없습니다.' }))
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

export async function checkHealth() {
  try {
    const res = await fetch(`${apiBase()}/api/ai/health`)
    if (!res.ok) return { ok: false, error: `상태 확인 실패 (${res.status})` }
    return await res.json()
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * 배치를 동시에 몇 개까지 던질지.
 * 배치끼리는 서로 의존이 없어 기다릴 이유가 없다. 실측(tools/bench-enrich.mjs)에서
 * 3개 동시 실행이 순차 대비 2.54배 — 이론 최대 3배의 85% — 로 나왔다.
 */
const CONCURRENCY = 4

/**
 * 지문 묶음 하나에 지문을 몇 개까지 넣을지.
 * 한 번에 전부 넣으면 모델이 앞 지문부터 개수를 채우다 목표에 도달해 뒤 지문을 비운다.
 * 묶음을 잘게 쪼개면 각 호출이 자기 지문만 보게 되어 그 쏠림이 원천적으로 사라진다.
 */
const SELECT_GROUP_SIZE = 3

/** 쿼터보다 넉넉히 받아 난이도로 추려낼 여유분 배수. */
export const SELECT_OVERSAMPLE = 1.5

const countWords = (text) => (String(text || '').match(/\S+/g) || []).length

/**
 * 지문 분량(단어 수)에 비례해 지문별 목표 개수를 나눈다.
 * 합계는 정확히 targetCount 가 되게 맞춘다 — 소수부가 큰 지문부터 남은 몫을 하나씩 준다.
 * 목표가 지문 수보다 많다면 어느 지문도 0개로 두지 않는다.
 */
export function planQuotas(passages, targetCount) {
  const weights = passages.map((p) => countWords(p.english))
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  if (!passages.length || targetCount <= 0) return passages.map(() => 0)
  // 분량을 잴 수 없으면 균등 분배로 되돌린다
  const exact = totalWeight
    ? weights.map((w) => (w / totalWeight) * targetCount)
    : passages.map(() => targetCount / passages.length)

  const quotas = exact.map((e) => Math.floor(e))
  let rest = targetCount - quotas.reduce((a, b) => a + b, 0)
  const byFraction = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; rest > 0; k += 1, rest -= 1) quotas[byFraction[k % quotas.length].i] += 1

  if (targetCount >= passages.length) {
    for (let i = 0; i < quotas.length; i += 1) {
      if (quotas[i] > 0) continue
      let fattest = 0
      for (let j = 1; j < quotas.length; j += 1) if (quotas[j] > quotas[fattest]) fattest = j
      if (quotas[fattest] <= 1) break
      quotas[fattest] -= 1
      quotas[i] += 1
    }
  }
  return quotas
}

/**
 * AI 자동 표제어 추출.
 *
 * 지문을 묶음으로 쪼개 동시에 호출한다. 각 호출에는 그 묶음 지문의 목표 개수가 박혀 나가므로
 * 앞쪽 지문 쏠림이 생기지 않는다. 최종 선별은 호출자가 난이도로 한다.
 *
 * @param quotas passages 와 같은 순서의 지문별 최종 목표 개수. 실제 요청은 oversample 배수만큼 더 한다.
 */
export async function autoSelect({
  passages,
  quotas,
  model,
  exclude = [],
  oversample = SELECT_OVERSAMPLE,
  groupSize = SELECT_GROUP_SIZE,
  concurrency = CONCURRENCY,
  onProgress,
  signal,
}) {
  const targets = []
  passages.forEach((p, i) => {
    const quota = Math.max(0, Math.round(quotas?.[i] ?? 0))
    if (quota > 0) targets.push({ no: p.no, english: p.english, quota: Math.ceil(quota * oversample) })
  })

  const usage = { inputTokens: 0, outputTokens: 0, cacheCreation: 0, durationMs: 0 }
  if (!targets.length) return { items: [], usage }

  const groups = []
  for (let i = 0; i < targets.length; i += groupSize) groups.push(targets.slice(i, i + groupSize))

  // 끝나는 순서는 뒤섞이지만 결과는 지문 순서를 지켜야 한다. 묶음별 자리를 미리 잡아두고 제자리에 채운다.
  const perGroup = new Array(groups.length).fill(null)
  let doneGroups = 0
  const report = () => onProgress?.({ group: doneGroups, groupCount: groups.length })
  report()

  let cursor = 0
  async function worker() {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= groups.length) return
      if (signal?.aborted) throw new Error('사용자가 취소했습니다.')

      const { items, usage: u, durationMs } = await post('select', {
        passages: groups[index],
        exclude,
        model,
      })

      if (u) {
        usage.inputTokens += u.input_tokens || 0
        usage.outputTokens += u.output_tokens || 0
        usage.cacheCreation += u.cache_creation_input_tokens || 0
      }
      usage.durationMs += durationMs || 0

      perGroup[index] = Array.isArray(items) ? items : []
      doneGroups += 1
      report()
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker))

  return { items: perGroup.flat(), usage }
}

/**
 * 표제어 정규화 + 파생어/유의어/반의어 생성.
 * 배치로 나눠 동시에 호출하고 진행률을 알린다.
 */
export async function enrichAll({ items, model, batchSize = 25, concurrency = CONCURRENCY, onProgress, signal }) {
  const batches = []
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize))
  }

  // 끝나는 순서는 뒤섞이지만 결과는 입력 순서를 지켜야 한다. 배치별 자리를 미리 잡아두고 제자리에 채운다.
  const perBatch = new Array(batches.length).fill(null)
  // durationMs 는 이제 벽시계가 아니라 각 배치 소요의 합이다. 동시 실행이라 실제 경과는 이보다 짧다.
  const usage = { inputTokens: 0, outputTokens: 0, cacheCreation: 0, durationMs: 0 }
  let doneItems = 0
  let doneBatches = 0

  const report = (phase) =>
    onProgress?.({
      phase,
      batch: doneBatches,
      batchCount: batches.length,
      done: doneItems,
      total: items.length,
    })

  report('running')

  let cursor = 0
  async function worker() {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= batches.length) return
      if (signal?.aborted) throw new Error('사용자가 취소했습니다.')

      const payload = batches[index].map((it) => ({
        id: it.id,
        surface: it.surface,
        passageNo: it.passageNo,
        sentence: it.sentence,
      }))

      const { results, usage: u, durationMs } = await post('enrich', {
        items: payload,
        antonymTargetRatio: ANTONYM_TARGET_RATIO,
        model,
      })

      if (u) {
        usage.inputTokens += u.input_tokens || 0
        usage.outputTokens += u.output_tokens || 0
        usage.cacheCreation += u.cache_creation_input_tokens || 0
      }
      usage.durationMs += durationMs || 0

      perBatch[index] = normalizeBatch(results, batches[index])
      doneItems += perBatch[index].length
      doneBatches += 1
      report('running')
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))

  const trimmed = enforceAntonymRatio(perBatch.flat())
  onProgress?.({
    phase: 'done',
    batch: batches.length,
    batchCount: batches.length,
    done: trimmed.rows.length,
    total: items.length,
  })

  return { rows: trimmed.rows, antonymStats: trimmed.stats, usage }
}

/**
 * 표제어·파생어·유의어·반의어는 모두 소문자로 표기한다.
 * 구문 틀의 자리표시자 A·B 는 단어가 아니라 기호이므로 대문자로 남긴다.
 */
function toLower(text) {
  return String(text).replace(/[A-Za-z]+/g, (w) => (w === 'A' || w === 'B' ? w : w.toLowerCase()))
}

/**
 * 관용구 안의 인칭 표현을 사전 표기로 되돌린다.
 *
 * 사전은 "at one's disposal"로 싣지, 지문에 나온 "at their disposal"을 그대로 싣지 않는다.
 * 프롬프트에도 같은 규칙을 넣었지만 AI가 매번 지키지는 않으므로 여기서 확실히 맞춘다.
 *
 * its·itself 는 건드리지 않는다. 사물을 가리키며 그 형태로 굳어진 관용구가 있어
 * (take its toll, run its course, in itself) 일괄로 바꾸면 오히려 틀린다.
 */
const REFLEXIVE = /\b(?:myself|yourselves|yourself|himself|herself|ourselves|themselves)\b/gi
const POSSESSIVE = /\b(?:my|your|his|her|our|their)\b/gi

export function normalizePronouns(phrase) {
  const text = String(phrase)
  // 한 단어짜리는 대명사 자체가 표제어일 수 있으므로 손대지 않는다
  if (!/\s/.test(text.trim())) return text
  return text.replace(REFLEXIVE, 'oneself').replace(POSSESSIVE, (m, offset, whole) => {
    // "her"만 소유격·목적격이 겹친다. 뒤에 이어지는 말이 없으면 목적격이다.
    // (catch her eye → catch one's eye / surprised her → 그대로)
    if (m.toLowerCase() === 'her' && !/\S/.test(whole.slice(offset + m.length))) return m
    return "one's"
  })
}

/** 품사는 한 글자로 표기한다. AI가 두 글자로 보내와도 여기서 줄인다. */
const POS_SHORT = {
  명사: '명', 동사: '동', 형용사: '형', 부사: '부',
  전치사: '전', 접속사: '접', 대명사: '대', 어구: '구',
  관사: '관', 감탄사: '감', 조동사: '조',
}

export function shortPos(pos) {
  const p = String(pos || '').trim()
  if (!p) return ''
  return POS_SHORT[p] || p.slice(0, 1)
}

/** 응답에서 빠진 항목을 메우고 형태를 정돈한다. */
function normalizeBatch(results, sent) {
  const byId = new Map((results || []).map((r) => [String(r.id), r]))
  return sent.map((item) => {
    const r = byId.get(String(item.id)) || {}
    // 고유명사는 AI가 보낸 대문자 표기를 그대로 살린다
    const properNoun = Boolean(r.properNoun)
    const cased = (text) => (properNoun ? String(text) : toLower(text))
    // 유의어·반의어도 표제어와 같은 표기를 따라야 하므로 함께 일반화한다
    const dictForm = (text) => normalizePronouns(cased(text))

    const raw = (r.headword || item.surface).trim()
    const headword = dictForm(raw)
    const note = (r.normalizationNote || '').trim()

    return {
      id: item.id,
      passageNo: item.passageNo,
      surface: item.surface,
      sentence: item.sentence,
      headword,
      // AI가 인칭을 그대로 뒀다면 여기서 바꾼 사실을 알려, 표에서 확인할 수 있게 한다
      normalizationNote: note || (headword !== cased(raw) ? '인칭 → 사전형' : ''),
      properNoun,
      pos: shortPos(r.pos),
      meaning: (r.meaning || '').trim(),
      derivatives: cleanEntries(r.derivatives, 2, cased),
      synonyms: cleanEntries(r.synonyms, 2, dictForm),
      antonyms: cleanEntries(r.antonyms, 2, dictForm).map((a) => ({ ...a, confidence: Number(a.confidence) || 0 })),
      missing: !byId.has(String(item.id)),
    }
  })
}

function cleanEntries(list, max, cased = toLower) {
  if (!Array.isArray(list)) return []
  return list
    .map((e) => (typeof e === 'string' ? { word: e } : e))
    .filter((e) => e && typeof e.word === 'string' && e.word.trim())
    .map((e) => ({ ...e, word: cased(e.word.trim()), pos: shortPos(e.pos) }))
    .slice(0, max)
}

/**
 * 반의어는 전체의 30~50%에만 달려야 한다.
 * 초과하면 confidence가 낮은 항목부터 떼어낸다.
 */
function enforceAntonymRatio(rows) {
  const withAntonyms = rows.filter((r) => r.antonyms.length > 0)
  const maxAllowed = Math.floor(rows.length * ANTONYM_MAX_RATIO)
  const minWanted = Math.ceil(rows.length * ANTONYM_MIN_RATIO)

  let removed = 0
  if (withAntonyms.length > maxAllowed) {
    const ranked = [...withAntonyms].sort(
      (a, b) => confidenceOf(a) - confidenceOf(b) || a.headword.localeCompare(b.headword)
    )
    const dropCount = withAntonyms.length - maxAllowed
    const dropIds = new Set(ranked.slice(0, dropCount).map((r) => r.id))
    rows = rows.map((r) => (dropIds.has(r.id) ? { ...r, antonyms: [], antonymTrimmed: true } : r))
    removed = dropCount
  }

  const finalCount = rows.filter((r) => r.antonyms.length > 0).length
  return {
    rows,
    stats: {
      count: finalCount,
      total: rows.length,
      ratio: rows.length ? finalCount / rows.length : 0,
      removed,
      belowMin: finalCount < minWanted,
      minWanted,
      maxAllowed,
    },
  }
}

function confidenceOf(row) {
  return Math.max(...row.antonyms.map((a) => a.confidence || 0), 0)
}
