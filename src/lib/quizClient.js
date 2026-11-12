/**
 * 시험지 PART II · III · V · VI 를 동시에 만들고, 받은 결과를 코드로 검사한다.
 *
 * 네 PART 는 서로 의존이 없어 기다릴 이유가 없다. 순차로 돌리면 네 배 걸린다.
 *
 * 규칙은 프롬프트로 걸지만 AI 가 늘 지키지는 않는다. 특히 PART III 의 어미 패턴 차단은
 * 어겨도 문장이 멀쩡해 보여서 눈으로는 놓치기 쉽다. 그래서 받은 뒤 여기서 다시 센다.
 * 검사는 막지 않고 알리기만 한다 — 고칠지는 화면에서 사람이 정한다.
 */

import { inflectionKey, findInflected, findWholeWord } from './duplicates.js'
import { apiBase } from './aiClient.js'
import { countWords, shuffleChoices, buildPartI } from './quizBuild.js'
import {
  isBeyondExamDistractor,
  storyPatternIssues,
  uniqueHint,
  HINT_MAX,
  partThreeAnswers,
  neutralArticles,
  STORY_OPENINGS,
  STORY_ENDINGS,
  CHOICE_ROLES,
} from './quizRules.js'

/**
 * AI 를 부르는 PART. I 은 단어장으로 조립되고 AI 는 다른 낱말로 읽힐 여지만 점검한다
 * (Week 03 검수: "다르게" 는 differently 로 쓴다). II · III · V · VI 는 AI 가 만든다.
 */
export const QUIZ_PARTS = ['I', 'II', 'III', 'V', 'VI']

async function post(body) {
  // 브라우저는 같은 출처, node 점검 도구는 VOCA_API_BASE (aiClient 와 같은 규칙)
  const res = await fetch(`${apiBase()}/api/ai/quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({ error: '응답을 해석할 수 없습니다.' }))
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

/* ------------------------------------------------------------------ */
/* 재료 만들기 — rows 를 프롬프트가 기대하는 모양으로                    */
/* ------------------------------------------------------------------ */

const words = (list) => (list || []).map((d) => d.word).filter(Boolean)
const withPos = (list) => (list || []).map((d) => (d.pos ? `${d.word} (${d.pos})` : d.word)).filter(Boolean)

const basic = (row) => ({ id: row.id, headword: row.headword, pos: row.pos, meaning: row.meaning })

/** 후보 가운데 PART IV 문장에 (굴절형으로라도) 나오는 말 — 정답으로 고르면 PART IV 가 답을 보여준다 */
const shownIn = (sentences, candidates) =>
  candidates.map((w) => w.replace(/\s*\([^)]*\)$/, '')).filter((w) => sentences.some((s) => findInflected(w, s)))

/**
 * @param {object} meanings PART I 에서 사람이 좁혀 바꾼 뜻 { [rowId]: '차등적으로' }
 */
export function buildPayloads(parts, startNo = 31, meanings = {}) {
  const ivSentences = parts.IV.map((r) => r.sentence || '')
  // PART I 정답은 학생이 쓰는 말이다. 다른 PART 의 글에 나오면 답이 드러난다
  const partIAnswers = parts.I.map((r) => r.headword).filter(Boolean)
  const withAvoid = (item, list) => ({ ...item, avoid: shownIn(ivSentences, list) })
  return {
    I: {
      items: buildPartI(parts.I, 1, meanings).map((q) => ({
        id: q.rowId,
        no: q.no,
        prompt: q.prompt,
        answer: q.answer,
        pos: q.pos,
        synonyms: q.synonyms,
      })),
    },
    II: { items: parts.II.map(basic) },
    III: {
      derivative: parts.III.derivative.map((r) => withAvoid({ ...basic(r), derivatives: withPos(r.derivatives) }, withPos(r.derivatives))),
      synonym: parts.III.synonym.map((r) => withAvoid({ ...basic(r), synonyms: words(r.synonyms) }, words(r.synonyms))),
      antonym: parts.III.antonym.map((r) => withAvoid({ ...basic(r), antonyms: words(r.antonyms) }, words(r.antonyms))),
    },
    V: {
      items: parts.V.map((r) => ({ ...basic(r), synonyms: words(r.synonyms), antonyms: words(r.antonyms) })),
      avoid: partIAnswers,
    },
    VI: {
      items: parts.VI.map(basic),
      startNo,
      // 이야기의 도입 · 마무리 틀을 매번 다르게 고른다 (Week 07~09 가 모두 같은 틀이었다)
      opening: Math.floor(Math.random() * STORY_OPENINGS.length),
      ending: Math.floor(Math.random() * STORY_ENDINGS.length),
      avoid: partIAnswers,
    },
  }
}

/**
 * PART III 유의어 · 반의어 문항의 첫 글자 힌트(두 글자까지)와 인정할 정답을 정한다.
 * 같은 관계가 되는 다른 말은 AI 가 rivals 에 적은 것과 단어장의 같은 칸 후보를 합쳐 본다.
 * 받은 결과를 고쳐 쓴다 — 화면과 docx 가 같은 힌트 · 같은 정답을 쓰도록.
 */
export function resolveHints(result, payload) {
  const candidates = new Map()
  for (const it of payload?.synonym || []) candidates.set(String(it.id), it.synonyms || [])
  for (const it of payload?.antonym || []) candidates.set(String(it.id), it.antonyms || [])
  for (const it of result?.items || []) {
    if (it.kind !== 'synonym' && it.kind !== 'antonym') continue
    const rivals = [...(Array.isArray(it.rivals) ? it.rivals : []), ...(candidates.get(String(it.id)) || [])]
    const { hint, accepted, clash } = uniqueHint(it.answer, rivals)
    if (!hint) continue
    it.hint = hint
    it.accepted = accepted
    it.hintClash = clash
  }
  return result
}

/**
 * 저장된 AI 결과에 지금 규칙을 다시 입힌 사본 — PART III 힌트(두 글자)와 인정 정답, PART V · VI 빈칸 앞 a(n).
 * 규칙을 바꾸기 전에 만든 시험지도 문항을 다시 만들지 않고 내려받기만 하면 맞는다.
 * 받은 값은 건드리지 않는다. 몇 번을 입혀도 결과가 같다.
 */
export function withCurrentRules(gen) {
  if (!gen?.byPart) return gen
  const byPart = { ...gen.byPart }
  const three = byPart.III?.result
  if (Array.isArray(three?.items)) {
    const result = resolveHints({ ...three, items: three.items.map((it) => ({ ...it })) }, gen.payloads?.III)
    byPart.III = { ...byPart.III, result, issues: checkIII(result) }
  }
  const five = byPart.V?.result
  if (Array.isArray(five?.items)) {
    byPart.V = { ...byPart.V, result: { ...five, items: five.items.map((it) => ({ ...it, sentence: neutralArticles(it.sentence) })) } }
  }
  const six = byPart.VI?.result
  if (six?.story) byPart.VI = { ...byPart.VI, result: { ...six, story: neutralArticles(six.story) } }
  return { ...gen, byPart }
}

/* ------------------------------------------------------------------ */
/* 검사                                                                */
/* ------------------------------------------------------------------ */

/**
 * 파생 어미를 **계열**로 묶는다.
 *
 * 글자 그대로 비교하면 assumption(-ption)과 evolution(-ution)이 다른 어미로 보인다.
 * 하지만 학생 눈에는 둘 다 같은 -tion 명사화이고, 보기를 베끼는 것만으로 풀린다.
 * 명세가 `assume : assumption = perceive : perception` 을 막는 이유가 이것이다.
 * 그래서 철자가 아니라 파생 방식이 같은지를 본다.
 */
const FAMILY = [
  [/(?:ation|ition|ution|ption|ction|sion|tion)$/, '-tion 명사화'],
  [/(?:ability|ibility|ity|ety)$/, '-ity 명사화'],
  [/(?:ancy|ency|ance|ence)$/, '-ance 명사화'],
  [/ment$/, '-ment 명사화'],
  [/ness$/, '-ness 명사화'],
  [/(?:ship|hood|dom)$/, '-ship 명사화'],
  [/ism$/, '-ism 명사화'],
  [/(?:ist|er|or)$/, '행위자 명사'],
  [/age$/, '-age 명사화'],
  [/ure$/, '-ure 명사화'],
  [/(?:able|ible)$/, '-able 형용사'],
  [/ive$/, '-ive 형용사'],
  [/(?:ical|ic)$/, '-ic 형용사'],
  [/(?:ious|eous|ous)$/, '-ous 형용사'],
  [/ful$/, '-ful 형용사'],
  [/less$/, '-less 형용사'],
  [/(?:ary|ory)$/, '-ary 형용사'],
  [/(?:ize|ise|ify|ate|en)$/, '동사화'],
  [/(?:ally|ly)$/, '-ly 부사화'],
  [/y$/, '-y 파생'],
]

/** 어근이 3자 미만으로 남으면 어미로 보지 않는다 (age 자체가 -age 가 되는 것을 막는다). */
export function suffixOf(word) {
  const w = String(word || '').toLowerCase()
  for (const [re, family] of FAMILY) {
    const m = w.match(re)
    if (m && w.length - m[0].length >= 3) return family
  }
  return ''
}

function checkII(result, payload) {
  const issues = []
  const defs = result?.definitions || []
  if (defs.length !== payload.items.length) issues.push(`풀이가 ${defs.length}개 (${payload.items.length}개여야 함)`)

  for (const d of defs) {
    const n = countWords(d.definition)
    if (n < 8 || n > 24) issues.push(`${d.headword} — 풀이가 ${n}단어 (10~20 권장)`)
    const stem = String(d.headword || '').toLowerCase().slice(0, 5)
    if (stem && String(d.definition || '').toLowerCase().includes(stem)) {
      issues.push(`${d.headword} — 풀이에 표제어가 그대로 드러남`)
    }
  }

  const dw = result?.distractor?.word
  if (!dw) issues.push('distractor 가 없음')
  else if (defs.some((d) => inflectionKey(d.headword) === inflectionKey(dw))) {
    issues.push(`distractor(${dw}) 가 정답과 겹침`)
  }
  return issues
}

function checkIII(result) {
  const issues = []
  const items = result?.items || []
  if (items.length !== 5) issues.push(`문항이 ${items.length}개 (5개여야 함)`)

  const kinds = items.map((i) => i.kind)
  if (kinds.filter((k) => k === 'derivative').length !== 2) issues.push('파생어 문항이 2개가 아님')
  if (kinds.filter((k) => k === 'synonym').length !== 1) issues.push('유의어 문항이 1개가 아님')
  if (kinds.filter((k) => k === 'antonym').length !== 2) issues.push('반의어 문항이 2개가 아님')

  for (const it of items) {
    if (it.kind === 'derivative') {
      const a = suffixOf(it.right)
      const b = suffixOf(it.answer)
      // 어미가 같으면 보기를 베끼는 것만으로 풀린다 — 문항이 무의미해진다
      if (a && b && a === b) {
        issues.push(`${it.headword} — 보기(${it.right})와 정답(${it.answer})이 둘 다 ${a}`)
      }
      if (/ly$/i.test(it.answer || '')) issues.push(`${it.headword} — 정답이 단순 -ly 파생(${it.answer})`)
      if (it.hint) issues.push(`${it.headword} — 파생어 문항에는 첫 글자를 주지 않는다`)
    } else if (!it.hint) {
      issues.push(`${it.headword} — 첫 글자 힌트가 없음`)
    } else if (!String(it.answer || '').toLowerCase().startsWith(String(it.hint).toLowerCase())) {
      issues.push(`${it.headword} — 힌트(${it.hint})가 정답(${it.answer})의 앞부분과 다름`)
    } else if (it.hint.length > HINT_MAX) {
      // 힌트는 두 글자까지 — 겹치는 말은 함께 정답으로 인정한다 (resolveHints)
      issues.push(`${it.headword} — 힌트가 ${it.hint}___ 로 ${it.hint.length}글자 드러남 (${HINT_MAX}글자까지)`)
    }
  }
  return issues
}

function checkV(result) {
  const issues = []
  const items = result?.items || []
  if (items.length !== 5) issues.push(`문항이 ${items.length}개 (5개여야 함)`)

  const counts = []
  items.forEach((it, index) => {
    const n = countWords(it.sentence)
    if (n < 20 || n > 45) issues.push(`${n}단어 문장 (25~40 권장)`)
    const blanks = (String(it.sentence || '').match(/_{5,}/g) || []).length
    if (blanks !== 1) issues.push(`빈칸이 ${blanks}개인 문장이 있음`)
    if ((it.choices || []).length !== 5) issues.push(`선택지가 ${(it.choices || []).length}개인 문항이 있음`)
    const answers = it.answers || []
    if (!answers.length) issues.push('정답이 없는 문항이 있음')
    if (answers.some((n2) => n2 < 1 || n2 > 5)) issues.push('정답 번호가 1~5 범위를 벗어남')
    if ((it.clues || []).length < 2) issues.push(`문맥 단서가 ${(it.clues || []).length}개 (2개 이상 필요)`)
    counts.push(answers.length)

    // 선택지는 고3(수능) 수준까지 — 수능 범위를 넘는 드문 말로 짚어 둔 오답이 다시 나왔는지
    const wrong = (it.choices || []).filter((_, k) => !answers.includes(k + 1))
    const rare = wrong.filter(isBeyondExamDistractor)
    if (rare.length) issues.push(`오답 ${rare.join(', ')} — 수능 범위를 넘는 드문 말`)

    if (answers.length > 3) issues.push(`정답이 ${answers.length}개인 문항이 있음 (1~3개)`)

    /*
     * 오답이 모두 반대 방향이면 쉬운 반대말을 지우고 남은 것을 다 고르면 풀린다(시험지 검수 06-30 · 07-26).
     * 버리는 오답(반대 방향 쉬운 말) 1개 이상, 근접 오답(같은 방향 · 비슷한 형태) 정확히 1개.
     */
    const no = `${26 + index}번`
    const roles = Array.isArray(it.roles) ? it.roles : []
    if (roles.length !== 5) {
      issues.push(`${no} — 선택지 표시(roles)가 없음`)
    } else {
      if (roles.some((r, k) => (r === '정답') !== answers.includes(k + 1))) {
        issues.push(`${no} — 정답 번호와 선택지 표시(roles)가 어긋남`)
      }
      if (roles.some((r) => !CHOICE_ROLES.includes(r))) issues.push(`${no} — 모르는 선택지 표시(${roles.join('·')})`)
      if (!roles.includes('버림')) issues.push(`${no} — 버리는 오답이 없음`)
      const near = roles.filter((r) => r === '근접').length
      if (near !== 1) issues.push(`${no} — 근접 오답이 ${near}개 (1개여야 함)`)
    }

    // 정답해설에 오답마다 틀린 이유를 한 마디씩 싣는다
    const reasons = Array.isArray(it.reasons) ? it.reasons : []
    const missing = (it.choices || []).filter((_, k) => !answers.includes(k + 1) && !String(reasons[k] || '').trim())
    if (missing.length) issues.push(`${no} — 틀린 이유가 없는 오답: ${missing.join(', ')}`)

    // 출제 뒤 정답 없이 다시 풀어 본 결과 — 오답을 답으로 고르거나 애매하다고 했으면 다른 정답으로 읽힐 여지가 있다
    issues.push(...answerCheckIssues(it, no))
  })

  if (counts.length && new Set(counts).size < 2) {
    issues.push(`정답 개수가 ${counts.join('·')} 로 흩어지지 않음 (1~3개로 섞여야 함)`)
  }
  // 고난도는 5문항 가운데 1~2문항 (20~30%)
  const hard = items.filter((it) => it.hard === true).length
  if (items.length && (hard < 1 || hard > 2)) issues.push(`고난도 문항이 ${hard}개 (1~2개)`)
  return issues
}

function checkVI(result, payload) {
  const issues = []
  const story = String(result?.story || '')
  const n = countWords(story.replace(/\{\d+\}/g, 'x'))
  if (n < 80 || n > 125) issues.push(`본문이 ${n}단어 (90~110 권장)`)

  const marks = story.match(/\{(\d+)\}/g) || []
  if (marks.length !== payload.items.length) issues.push(`본문의 빈칸 표시가 ${marks.length}개`)

  const blanks = result?.blanks || []
  if (blanks.length !== payload.items.length) issues.push(`정답이 ${blanks.length}개`)

  issues.push(...storyPatternIssues(story))

  // 빈칸이 한곳에 몰리지 않아야 한다
  const positions = marks.map((m) => story.indexOf(m))
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i] - positions[i - 1] < 40) {
      issues.push('빈칸이 서로 너무 가까움')
      break
    }
  }
  return issues
}

/** PART I 점검은 응답이 빠지지 않았는지만 센다. 걸린 문항은 partOneNotes 가 화면 · 정답해설에 싣는다 */
function checkI(result, payload) {
  const got = new Set((result?.items || []).map((c) => String(c.id)))
  const missing = payload.items.filter((it) => !got.has(String(it.id)))
  return missing.length ? [`점검 결과에 ${missing.map((it) => `${it.no}번`).join(' · ')} 이(가) 없음`] : []
}

const CHECK = { I: checkI, II: checkII, III: checkIII, V: checkV, VI: checkVI }

/**
 * PART I 에서 정답 말고도 학생이 쓸 만한 말이 있는 문항 (PART I 점검 결과 + 지금 문항).
 * - likely: 정답보다 흔하거나 쉬워 학생이 먼저 쓸 말이 있다 → 뜻을 좁히기를 권한다 (Week 03 7번 "다르게" → differently)
 * - 아니면 들어맞기는 하는 말이다 → 채점 기준을 정해 둔다 (Week 03 5번 "정서적인" → emotional)
 * 뜻을 바꿔도 점검 결과는 바꾸기 전 뜻에 대한 것이므로 applied 로 따로 알린다.
 *
 * @param {object} result PART I 점검 결과 { items: [{ id, others: [{word, likely, why}], prompt }] }
 * @param {Array} partI buildPartI 결과 (바꾼 뜻이 들어간 것)
 * @param {object} meanings 사람이 바꾼 뜻 { [rowId]: text }
 */
export function partOneNotes(result, partI, meanings = {}) {
  const byId = new Map((result?.items || []).map((c) => [String(c.id), c]))
  const notes = []
  for (const q of partI || []) {
    const c = byId.get(String(q.rowId))
    const answerKey = inflectionKey(q.answer)
    const others = (Array.isArray(c?.others) ? c.others : [])
      .filter((o) => o && String(o.word || '').trim() && inflectionKey(o.word) !== answerKey)
      .map((o) => ({ word: String(o.word).trim(), likely: o.likely === true, why: String(o.why || '') }))
    if (!others.length) continue
    notes.push({
      no: q.no,
      rowId: q.rowId,
      answer: q.answer,
      meaning: q.meaning,
      others,
      likely: others.some((o) => o.likely),
      suggestion: String(c.prompt || '').replace(/\s*\(\d+\)\s*$/, '').trim(),
      applied: Boolean(meanings?.[q.rowId]),
    })
  }
  return notes
}

/**
 * 다른 문항의 정답이 문항 글에 드러나는지 (Week 03 검수: PART IV 23 · 24 · 25번에 PART I 정답 value proposition ·
 * niche · concept creep 이 그대로 나왔다). 학생이 써야 하는 정답만 본다.
 *   - PART I 정답, PART III 정답(인정하는 말 모두) — 굴절형까지
 *   - PART IV 정답 형태(원형과 다를 때) — 그 형태 그대로. 원형은 보기에 이미 있다
 * 보는 글: PART IV 문항(앞뒤로 붙인 문장 포함) · PART V 문장 · PART VI 글.
 * 앞뒤 문장은 화면에서 사람이 붙이므로 그때마다 다시 본다.
 *
 * @returns {Array<{ where: string, rowId?: string, text: string }>}
 */
export function answerExposures({ partI = [], partIV = { items: [] }, partIVTexts = [], gen } = {}) {
  const texts = [
    ...partIV.items.map((it, i) => ({ where: `PART IV ${it.no}번`, rowId: it.rowId, text: partIVTexts[i] || '' })),
    ...(gen?.byPart?.V?.result?.items || []).map((it, i) => ({ where: `PART V ${26 + i}번`, text: it.sentence || '' })),
    ...(gen?.byPart?.VI?.result?.story
      ? [{ where: 'PART VI', text: String(gen.byPart.VI.result.story).replace(/\{\d+\}/g, '___') }]
      : []),
  ]
  const answers = [
    ...partI.map((q) => ({ label: `PART I ${q.no}번 정답`, words: [q.answer], inflected: true })),
    ...(gen?.byPart?.III?.result?.items || []).map((it, i) => ({
      label: `PART III ${16 + i}번 정답`,
      words: partThreeAnswers(it),
      inflected: true,
    })),
    ...partIV.items
      .filter((it) => it.answer && String(it.answer).toLowerCase() !== String(it.base).toLowerCase())
      .map((it) => ({ label: `PART IV ${it.no}번 정답`, words: [it.answer], inflected: false })),
  ]

  const out = []
  for (const t of texts) {
    for (const a of answers) {
      for (const w of a.words) {
        const found = a.inflected ? findInflected(w, t.text) : findWholeWord(t.text, w)
        if (!found) continue
        out.push({ where: t.where, rowId: t.rowId, text: `${t.where} 글에 ${a.label} ${w} 이(가) 드러남${found.toLowerCase() === w.toLowerCase() ? '' : ` (${found})`}` })
        break
      }
    }
  }
  return out
}

/**
 * PART V 복수 정답 점검 결과(it.answerCheck)를 정답과 견준다.
 * - 오답을 fits 로 골랐다 → 다른 정답으로 읽힌다
 * - 오답을 doubtful 로 짚었다 → 답으로 읽힐 여지가 있다
 * - 정답을 fits 에서 뺐다 → 정답이 문맥에 약하다
 */
export function answerCheckIssues(it, no) {
  const check = it.answerCheck
  if (!check) return []
  if (check.error) return [`${no} — 복수 정답 점검 실패 (${check.error})`]
  const answers = it.answers || []
  const choice = (n) => `${'①②③④⑤'[n - 1] || n} ${(it.choices || [])[n - 1] ?? ''}`
  const out = []
  for (const n of check.fits || []) {
    if (!answers.includes(n)) out.push(`${no} — ${choice(n)} 도 답으로 읽힘 (다시 풀어 본 결과)`)
  }
  for (const d of check.doubtful || []) {
    if (!answers.includes(d.choice)) out.push(`${no} — ${choice(d.choice)} 가 답으로 읽힐 여지: ${d.why || ''}`)
  }
  for (const n of answers) {
    if ((check.fits || []).includes(n)) continue
    // 정답을 애매하다고 했으면 그 이유를 붙인다 — 정답이 문맥에 약하다는 뜻이다
    const doubt = (check.doubtful || []).find((d) => d.choice === n)
    out.push(`${no} — 정답 ${choice(n)} 를 다시 풀 때 ${doubt ? `확신하지 못함: ${doubt.why}` : '고르지 않음'}`)
  }
  return out
}

/** 받은 PART 하나를 검사한다 — 점검 도구와 스모크 테스트가 쓴다 */
export const checkPart = (part, result, payload) => CHECK[part](result, payload)

/** PART 를 넘나드는 중복. 한 PART 안에서는 배정 단계에서 이미 막았다. */
function crossCheck(byPart) {
  const issues = []
  const seen = new Map()

  const note = (word, where) => {
    const key = inflectionKey(word)
    if (!key) return
    if (seen.has(key) && seen.get(key) !== where) {
      issues.push(`${word} — ${seen.get(key)} 와 ${where} 에 겹쳐 나옴`)
    } else {
      seen.set(key, where)
    }
  }

  const dw = byPart.II?.result?.distractor?.word
  if (dw) note(dw, 'PART II distractor')
  for (const it of byPart.III?.result?.items || []) for (const a of partThreeAnswers(it)) note(a, 'PART III 정답')
  for (const it of byPart.V?.result?.items || []) {
    for (const n of it.answers || []) note((it.choices || [])[n - 1], 'PART V 정답')
  }
  for (const b of byPart.VI?.result?.blanks || []) note(b.answer, 'PART VI 정답')

  return issues
}

/**
 * 만든 PART V 를 정답을 알려 주지 않고 AI 에게 다시 풀게 해, 문항마다 answerCheck 를 붙인다.
 * 점검이 실패해도 문항은 살린다 — 실패한 사실을 answerCheck.error 로 남겨 검사에 짚는다.
 */
export async function checkPartVAnswers(result, { model, effort }) {
  const items = (result?.items || []).filter((it) => Array.isArray(it.choices) && it.choices.length)
  if (!items.length) return result
  try {
    const { result: checked } = await post({
      part: 'VCHECK',
      payload: { items: items.map((it, i) => ({ id: String(it.id ?? i), sentence: it.sentence, choices: it.choices })) },
      model,
      effort,
    })
    const byId = new Map((checked?.items || []).map((c) => [String(c.id), c]))
    items.forEach((it, i) => {
      const c = byId.get(String(it.id ?? i))
      it.answerCheck = c
        ? {
            fits: (c.fits || []).map(Number).filter((n) => n >= 1 && n <= 5),
            doubtful: (c.doubtful || []).filter((d) => d && Number(d.choice) >= 1).map((d) => ({ choice: Number(d.choice), why: String(d.why || '') })),
          }
        : { error: '점검 결과에 이 문항이 없음' }
    })
  } catch (err) {
    for (const it of items) it.answerCheck = { error: err.message }
  }
  return result
}

/* ------------------------------------------------------------------ */
/* 실행                                                                */
/* ------------------------------------------------------------------ */

/**
 * 네 PART 를 동시에 만든다.
 * 하나가 실패해도 나머지는 살린다 — 다시 만들 때 성공한 것까지 버릴 이유가 없다.
 *
 * only 를 주면 그 PART 만 다시 만들고 나머지는 previous(지난 결과) 그대로 둔다.
 * 검사에 걸린 PART 하나 때문에 멀쩡한 셋까지 버리지 않게 한다.
 */
export async function generateQuizParts({ parts, model, effort, startNo = 31, onProgress, signal, only, previous, meanings }) {
  const targets = only?.length ? QUIZ_PARTS.filter((p) => only.includes(p)) : QUIZ_PARTS
  const fresh = buildPayloads(parts, startNo, meanings)
  // 다시 만들지 않는 PART 는 지난 재료를 그대로 둔다 (VI 의 도입 · 마무리 틀도)
  const payloads = previous?.payloads
    ? Object.fromEntries(QUIZ_PARTS.map((p) => [p, targets.includes(p) ? fresh[p] : previous.payloads[p] || fresh[p]]))
    : fresh
  const byPart = previous && only?.length ? { ...previous.byPart } : {}
  let done = 0

  const report = () => onProgress?.({ done, total: targets.length })
  report()

  await Promise.all(
    targets.map(async (part) => {
      if (signal?.aborted) return
      try {
        const { result, usage, durationMs } = await post({ part, payload: payloads[part], model, effort })
        if (part === 'III') resolveHints(result, payloads.III)
        // 빈칸 바로 앞 관사는 a(n) — "a ___" 는 첫소리가 다른 보기를 지운다 (Week 03 검수 35번)
        if (part === 'V') for (const it of result?.items || []) it.sentence = neutralArticles(it.sentence)
        if (part === 'VI' && result) result.story = neutralArticles(result.story)
        // PART V 는 만든 뒤 정답 없이 한 번 더 풀어 복수 정답을 점검한다 (시험지 검수 기준)
        if (part === 'V') await checkPartVAnswers(result, { model, effort })
        byPart[part] = {
          result,
          usage,
          durationMs,
          issues: CHECK[part](result, payloads[part]),
        }
      } catch (err) {
        byPart[part] = { error: err.message, issues: [] }
      } finally {
        done += 1
        report()
      }
    })
  )

  // PART VI 보기는 정답 순서와 어긋나게 섞는다
  const viBlanks = byPart.VI?.result?.blanks || []
  const viChoices = shuffleChoices(viBlanks.map((b) => b.answer))

  return {
    byPart,
    payloads,
    choices: { VI: viChoices },
    crossIssues: crossCheck(byPart),
    failed: QUIZ_PARTS.filter((p) => byPart[p]?.error),
  }
}
