/**
 * 추출된 평문을 지문 단위로 나누고, 각 지문에서 영어 본문과 한글 해석을 분리한다.
 */

const HANGUL = /[ㄱ-ㆎ가-힣]/g
const LATIN = /[A-Za-z]/g

/* ── 지문 번호 인식 ────────────────────────────────────────────────
 * 번호 표기는 문서마다 제각각이라 "이 모양이면 번호"라고 한 줄씩
 * 판정하면 본문 속 "3.14", 해석 안의 "1. 그는…", 객관식 보기까지
 * 전부 걸려든다. 패턴을 늘릴수록 오히려 더 잘게 부서진다.
 *
 * 그래서 판정을 두 단계로 나눈다.
 *   1) 알려진 표기를 모두 훑어 후보를 모으고, 표기 방식별로 묶는다.
 *   2) 각 묶음에서 번호가 오름차순으로 이어지는 가장 긴 부분열만 남기고,
 *      "문서 전체에 퍼져 있는가 / 번호가 끊기지 않는가 / 뒤에 영어가
 *      따라오는가"로 점수를 매겨 표기 하나를 고른다.
 * 오탐은 이 일관성 검사에서 걸러지므로, 표기를 더 추가해도 안전하다.
 */

/** 번호 앞에 붙는 말머리. 긴 것을 먼저 둬야 Exercise가 Ex로 잘리지 않는다. */
const MARKER_WORDS =
  'Exercise|Example|Ex|Passage|Practice|Problem|Question|Reading|Chapter|Lesson|Unit|Text|Test|Part|Set|No|Q|지문|문항|문제|본문|예제|유형'

const MARKER_PATTERNS = [
  {
    // [1]  【01】  <2>  (3)
    re: /^[[【〔<(]\s*(\d{1,3})\s*[\]】〕>)][.):]?\s*(.*)$/,
    read: (m) => ({ no: Number(m[1]), rest: m[2], style: 'bracket' }),
  },
  {
    // Exercise 01.   Passage 2)   지문 3   Q1
    re: new RegExp(`^(${MARKER_WORDS})\\s*[.:#]?\\s*(\\d{1,3})\\s*[.):\\]]?\\s*(.*)$`, 'i'),
    read: (m) => ({ no: Number(m[2]), rest: m[3], style: `word:${m[1].toLowerCase()}` }),
  },
  {
    // 제3강   제 5 회
    re: /^제\s*(\d{1,3})\s*([강회과장])\s*[.):]?\s*(.*)$/,
    read: (m) => ({ no: Number(m[1]), rest: m[3], style: `ko-ordinal:${m[2]}` }),
  },
  {
    // 01번
    re: /^(\d{1,3})\s*번[.):]?\s*(.*)$/,
    read: (m) => ({ no: Number(m[1]), rest: m[2], style: 'ko-no' }),
  },
  {
    // 1.   01.
    re: /^(\d{1,3})\s*\.\s*(.*)$/,
    read: (m) => ({ no: Number(m[1]), rest: m[2], style: 'dot' }),
  },
  {
    // 1)   01)
    re: /^(\d{1,3})\s*\)\s*(.*)$/,
    read: (m) => ({ no: Number(m[1]), rest: m[2], style: 'paren' }),
  },
  {
    // PR-21-01   21_기출 예제 01   1-3
    // 줄 전체가 짧은 꼬리표이고 끝이 번호인 경우. 번호 앞부분을 통째로 표기로 삼으므로
    // 앞부분이 글자 하나까지 같은 줄끼리만 한 묶음이 된다. "Page 3" 같은 쪽 번호를
    // 거르려고 앞부분에 숫자나 -, _ 가 있어야 한다.
    re: /^(?=.{3,30}$)(.*\D)(\d{1,3})$/,
    read: (m) => {
      const prefix = m[1]
      if (!/[\d_-]/.test(prefix) || !/[A-Za-z0-9가-힣]/.test(prefix)) return null
      return { no: Number(m[2]), rest: '', style: `id:${prefix}` }
    },
  },
]

/** 오인 소지가 적은 표기일수록 높다. 맨 숫자(dot)가 가장 위험하다. */
const STYLE_BONUS = { word: 30, 'ko-ordinal': 25, bracket: 20, id: 20, 'ko-no': 15, paren: 5, dot: 0 }
const styleBonus = (style) => STYLE_BONUS[style.split(':')[0]] ?? 0

export function classifyLine(line) {
  const hangul = (line.match(HANGUL) || []).length
  const latin = (line.match(LATIN) || []).length
  if (hangul === 0 && latin === 0) return 'other'
  if (hangul > 0 && hangul * 2 >= latin) return 'ko'
  if (latin > 0) return 'en'
  return 'other'
}

/**
 * 문항에 박히는 동그라미 번호 · 글자. ⓪①②③… ㉑… ㉱…, ⓐⓑ…, ⒶⒷ…, ⒜⒝…, ㉠㉡…, ㉮㉯…
 * 문장 삽입 문항은 "( ① )"처럼 괄호에 싸서 문장 사이에 끼워 넣고,
 * 어법·어휘 문항은 "①have" · "transport ⓐ them" 처럼 단어에 바로 붙인다. 모두 지문의 일부가 아니라
 * 문항 표시이므로 지문을 만들 때 걷어낸다. 남겨 두면 단어장의 출처 문장과 시험지 PART IV 문장에 그대로 찍힌다.
 * (동그라미 글자는 Week 08 검수에서 "transport ⓐ them" 으로 드러나 더했다)
 */
const CIRCLED =
  '\\u24EA\\u2460-\\u2473\\u3251-\\u325F\\u32B1-\\u32BF' + // 숫자
  '\\u249C-\\u24B5\\u24B6-\\u24CF\\u24D0-\\u24E9' + // ⒜… Ⓐ… ⓐ…
  '\\u3260-\\u327B' // ㉠… ㉮…
const INSERT_MARK = new RegExp(`[(（[]?\\s*[${CIRCLED}]\\s*[)）\\]]?`, 'g')

/**
 * 어휘 각주 줄. "*autonomy: 자율성  **earmarking: 지정 예산" 처럼 별표로 시작한다.
 * 지문 본문이 아니라 문항 딸림 정보인데, 한글만 걷어내면 "*autonomy: earmarking:"
 * 같은 잔해가 본문에 섞여 문장 경계를 무너뜨린다.
 */
const FOOTNOTE_LINE = /^\s*[*※†‡]/

/**
 * 객관식 보기 줄. "① precise ... ideology" 처럼 동그라미로 시작하고 문장부호로 끝나지 않는다.
 *
 * 문장을 마치는 부호가 있으면 본문으로 남긴다. 문장 삽입 문항의 "( ① ) Recent …" 는
 * 괄호로 시작하므로 애초에 여기 걸리지 않고, "① He was late." 같은 완결된 줄도 지키기 위해서다.
 */
const CHOICE_LINE = new RegExp(`^\\s*[${CIRCLED}]`)
const ENDS_SENTENCE = /[.!?]["'’”»)\]]*\s*$/

/**
 * 발문 줄. "1. 밑줄 친 … 가장 적절한 것은?" 처럼 한글로 묻고 끝난다.
 * 발문에 인용한 영어가 길면 줄 전체가 영어로 분류되어, 한글만 걷힌 인용 조각이 본문에 섞인다.
 */
const QUESTION_STEM = /[가-힣].*(?:것은|것을|것끼리|고르시오|쓰시오|하시오)\s*[?？.]?\s*(?:[[(][^\])]*[\])])?\s*$/

const CHOICE_ORDER = [...'①②③④⑤⑥⑦⑧⑨⑩']

/**
 * 지문 본문이 아니라 문항 장치인 줄의 위치.
 *
 * 선지가 완결된 영어 문장이면 CHOICE_LINE 만으로는 본문과 가를 수 없다. 그래서 발문
 * 바로 뒤에 ①②③… 이 줄머리에 차례로 셋 이상 이어지면 선지 묶음으로 본다. 발문 뒤라는
 * 조건과 셋 이상이라는 조건은, 무관한 문장 문항처럼 지문 문장 자체에 ①~⑤가 붙은 줄과
 * 첫 단어에 ①이 붙은 어법 지문을 지키기 위해서다.
 */
function apparatusLines(lines) {
  const skip = new Set()
  lines.forEach((line, i) => {
    if (FOOTNOTE_LINE.test(line) || QUESTION_STEM.test(line) || LABEL_ONLY_LINE.test(line)) skip.add(i)
    else if (CHOICE_LINE.test(line) && !ENDS_SENTENCE.test(line)) skip.add(i)
    if (!QUESTION_STEM.test(line)) return
    const block = []
    for (let j = i + 1; j < lines.length && block.length < CHOICE_ORDER.length; j++) {
      if (!lines[j]) continue
      if (!lines[j].startsWith(CHOICE_ORDER[block.length])) break
      block.push(j)
    }
    if (block.length >= 3) block.forEach((j) => skip.add(j))
  })
  return skip
}

/**
 * 순서 배열 문항의 단락 이름표. "(A) So, living in …" 처럼 단락 첫머리에 붙는다.
 * 빈칸이 아니라 이름표라 걷어내면 그만이다. 뒤에 대문자(또는 여는 따옴표)가 와야 이름표로 본다 —
 * 요약문의 "(A) conversation …" 같은 빈칸은 문장 가운데에 오고 뒤에 소문자가 온다.
 * (Week 07 검수: 출처 문장 26개가 "(A) …" · "(C) …" 로 시작했다)
 */
const PARAGRAPH_LABEL = /^\s*[(（]\s*[A-E]\s*[)）]\s+(?=["'“‘]?[A-Z])/

/** 순서 배열 문항 보기 위의 "(A)   (B)" 처럼 이름표만 있는 줄 */
const LABEL_ONLY_LINE = /^\s*(?:[(（]\s*[A-E]\s*[)）]\s*)+$/

export function stripParagraphLabel(text) {
  return String(text ?? '').replace(PARAGRAPH_LABEL, '')
}

/**
 * 문장 안에 남은 문항 장치 — 요약문 빈칸 "(A)" · "____(B)____", 밑줄 빈칸, 어법 고르기 "[is / are]".
 * 이런 문장이 출처 문장이 되면 단어장과 시험지 PART IV 에 빈칸이 그대로 찍힌다
 * (Week 09 검수: 요약문에만 나온 표제어 7개, 그중 intensify 가 PART IV 24번에 들어갔다).
 */
const BLANK_MARK = /[(（]\s*[A-E]\s*[)）]|_{3,}|\[[^\]/]+\/[^\]]+\]/g

/** 문장에 남은 빈칸 표시를 겹치지 않게 돌려준다 — ['(A)', '(B)'] 처럼. 없으면 빈 배열. */
export function questionBlanks(sentence) {
  const found = stripParagraphLabel(sentence).match(BLANK_MARK) || []
  const labels = found
    .map((m) => {
      const letter = m.match(/^[(（]\s*([A-E])\s*[)）]$/)
      if (letter) return `(${letter[1]})`
      return m.startsWith('[') ? m : '밑줄 빈칸'
    })
    // "____(A)____" 는 밑줄과 (A) 가 함께 걸린다. 이름이 있으면 밑줄은 따로 세지 않는다
    .filter((label, _, all) => label !== '밑줄 빈칸' || !all.some((l) => l.startsWith('(')))
  return [...new Set(labels)]
}

export const hasQuestionBlank = (sentence) => questionBlanks(sentence).length > 0

/**
 * 요약문 문장 — 빈칸 이름표 (A) · (B) 가 둘 이상 든 한 문장.
 * "The study above shows (A) conversation … may (B) personal growth." 처럼 지문 끝에 붙는 문항 장치라
 * 지문에 넣지 않는다(사용자 결정, Week 09 검수 뒤). 요약문에만 나온 말은 표제어 후보에도 오르지 않는다.
 * 연결어 · 빈칸 문항의 "(A)" 는 본문 문장마다 하나씩이라 걸리지 않는다 — 그런 문장은 본문이다.
 */
export function isSummarySentence(sentence) {
  return questionBlanks(sentence).filter((label) => /^\([A-E]\)$/.test(label)).length >= 2
}

/** 지문에서 요약문 문장을 뺀다. 요약문이 없으면 받은 글을 그대로 돌려준다. */
export function dropSummarySentences(english) {
  const text = String(english ?? '')
  const sentences = splitSentences(text)
  if (!sentences.some(isSummarySentence)) return text
  return sentences.filter((s) => !isSummarySentence(s)).join(' ').replace(/\s{2,}/g, ' ').trim()
}

/** 동그라미 번호 표시를 지우고 그 자리에 생긴 빈칸을 정리한다. */
export function stripInsertionMarks(text) {
  return String(text)
    .replace(INSERT_MARK, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** 한 줄에서 영어 부분만 남긴다 (영문 뒤에 괄호 해석이 붙은 경우 대비). */
export function stripKoreanInline(line) {
  return line
    .replace(/[(（[][^)）\]]*[ㄱ-ㆎ가-힣][^)）\]]*[)）\]]/g, '')
    .replace(/[ㄱ-ㆎ가-힣][^A-Za-z]*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** 1단계: 알려진 표기에 걸리는 줄을 모두 후보로 모은다. */
function detectMarkers(lines) {
  const hits = []
  lines.forEach((text, line) => {
    for (const pattern of MARKER_PATTERNS) {
      const m = text.match(pattern.re)
      if (!m) continue
      const hit = pattern.read(m)
      if (!hit) break
      const { no, rest, style } = hit
      if (!Number.isFinite(no) || no < 1 || no > 300) break
      // "3.14" 같은 소수는 번호가 아니라 값이다
      if (style === 'dot' && /^\d/.test(rest)) break
      hits.push({ line, no, rest: rest.trim(), style })
      break // 한 줄에는 한 가지 표기만 인정한다
    }
  })
  return hits
}

/** 번호가 오름차순으로 이어지는 가장 긴 부분열. n이 작아 O(n²)로 충분하다. */
function ascendingRun(items) {
  if (items.length < 2) return items.slice()
  const len = items.map(() => 1)
  const from = items.map(() => -1)
  let last = 0
  for (let i = 1; i < items.length; i++) {
    for (let j = 0; j < i; j++) {
      if (items[j].no < items[i].no && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1
        from[i] = j
      }
    }
    if (len[i] > len[last]) last = i
  }
  const run = []
  for (let i = last; i !== -1; i = from[i]) run.unshift(items[i])
  return run
}

/**
 * 지문 머리라면 번호 바로 뒤부터 영어 본문이다.
 *
 * 여기서 "바로 뒤"를 몇 줄까지로 보느냐가 중요하다. 몇 줄 앞까지 뒤지면
 * 해석문 속 "1번 지문은 …" 같은 줄도 (다음 지문의 영어를 보고) 지문 머리로
 * 통과해버린다. 그래서 번호 뒤에 남은 내용, 그게 비었으면 바로 다음
 * 비지 않은 줄, 딱 거기까지만 본다.
 */
function startsPassage(lines, idx, rest) {
  if (rest) return classifyLine(rest) === 'en'
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i]) return classifyLine(lines[i]) === 'en'
  }
  return false
}

function scoreRun(run, dropped, lines) {
  const n = run.length
  if (n < 2) return -Infinity
  const span = run[n - 1].line - run[0].line
  const withEnglish = run.filter((mk) => startsPassage(lines, mk.line, mk.rest)).length

  let score = n * 10 + styleBonus(run[0].style)
  if (run[0].no === 1) score += 15 // 1번부터 시작
  if (run[n - 1].no - run[0].no === n - 1) score += 20 // 번호가 끊기지 않음
  score -= dropped * 8 // 같은 표기에서 걸러낸 오탐이 많을수록 못 믿는다
  score += Math.round((span / Math.max(lines.length - 1, 1)) * 30) // 문서 전체에 퍼져 있어야 한다
  score += Math.round((withEnglish / n) * 40)
  if (span / (n - 1) < 2) score -= 40 // 간격이 두 줄도 안 되면 지문이 아니라 목록·보기다
  return score
}

/** 2단계: 표기 방식별로 묶어 점수를 매기고 가장 그럴듯한 하나를 고른다. */
function pickMarkers(lines) {
  const byStyle = new Map()
  for (const hit of detectMarkers(lines)) {
    if (!byStyle.has(hit.style)) byStyle.set(hit.style, [])
    byStyle.get(hit.style).push(hit)
  }
  const scored = []
  let best = null
  for (const [style, items] of byStyle) {
    const run = ascendingRun(items)
    const candidate = { style, items, run, score: scoreRun(run, items.length - run.length, lines) }
    scored.push(candidate)
    if (candidate.score >= 30 && (!best || candidate.score > best.score)) best = candidate
  }
  return best ? withSections(best, scored, lines) : null
}

/* ── 한 문서 안의 여러 묶음 ────────────────────────────────────────
 * "21_기출 예제 01~02" 다음에 "PR-21-01~08"이 오는 식으로, 한 문서 안에서 머리표가
 * 바뀌며 번호가 다시 1부터 시작하기도 한다. 표기를 하나만 고르면 다른 묶음의 지문은
 * 첫 번호 앞이라 버려지거나 앞 지문에 붙는다.
 *
 * 고른 표기와 종류가 같은(꼬리표끼리, 말머리끼리) 묶음 가운데 아래를 모두 지키는 것만 잇는다.
 *   - 걸러낸 오탐 없이 1부터 빠짐없이 이어진다
 *   - 모든 머리 뒤에 영어 지문이 따라온다
 *   - 다른 묶음과 줄 범위가 겹치지 않는다
 *   - 하나짜리 묶음은 문서 맨 앞에 있을 때만 잇는다. 그 자리는 잇지 않으면 버려지는
 *     내용이라 잘못 이어도 잃을 것이 없지만, 다른 자리에서는 멀쩡한 지문을 가른다.
 */
const SECTION_KINDS = new Set(['id', 'word'])
const kindOf = (style) => style.split(':')[0]

function withSections(best, scored, lines) {
  const sections = [best]
  if (SECTION_KINDS.has(kindOf(best.style))) {
    const candidates = scored
      .filter((c) => c !== best && kindOf(c.style) === kindOf(best.style))
      .filter((c) => c.items.length === c.run.length && c.run[0].no === 1 && c.run.at(-1).no === c.run.length)
      .filter((c) => c.run.every((mk) => startsPassage(lines, mk.line, mk.rest)))
      .sort((a, b) => b.run.length - a.run.length)
    for (const c of candidates) {
      const from = c.run[0].line
      const to = c.run.at(-1).line
      if (sections.some((s) => from <= s.run.at(-1).line && to >= s.run[0].line)) continue
      if (c.run.length === 1 && sections.some((s) => s.run[0].line < from)) continue
      sections.push(c)
    }
  }
  sections.sort((a, b) => a.run[0].line - b.run[0].line)
  return {
    style: sections.map((s) => s.style).join(' + '),
    run: sections.flatMap((s) => s.run),
    sections: sections.map((s) => ({ style: s.style, sample: lines[s.run[0].line], count: s.run.length })),
  }
}

function buildPassage(id, no, lines) {
  const en = []
  const ko = []
  const skip = apparatusLines(lines)
  for (const [i, line] of lines.entries()) {
    if (skip.has(i)) continue
    const kind = classifyLine(line)
    if (kind === 'en') {
      const cleaned = stripParagraphLabel(stripInsertionMarks(stripKoreanInline(line)))
      if (cleaned) en.push(cleaned)
    } else if (kind === 'ko') {
      ko.push(stripInsertionMarks(line))
    }
  }
  return {
    id,
    no,
    // 요약문 문장은 지문이 아니라 문항 장치다 — 표제어 후보 · 출처 문장 · PART IV 문맥에 들지 않게 뺀다
    english: dropSummarySentences(en.join(' ').replace(/\s{2,}/g, ' ').trim()),
    korean: ko.join('\n').trim(),
  }
}

/**
 * `markerSections` 는 번호 묶음마다 { style, sample, count } 이다. 묶음이 둘 이상이면
 * `markerStyle` 은 각 표기를 " + " 로 이은 것이다.
 * @returns {{ passages: Array, method: string, markerStyle: string|null, markerSections: Array, markerCount: number }}
 */
export function splitPassages(rawText) {
  const lines = String(rawText).split('\n').map((l) => l.trim())
  const best = pickMarkers(lines)

  // 1순위: 일관된 번호 표기를 찾았으면 그것으로 나눈다.
  if (best) {
    const passages = []
    best.run.forEach((marker, idx) => {
      const to = idx + 1 < best.run.length ? best.run[idx + 1].line : lines.length
      // 머리 줄은 번호를 떼어낸 나머지만 남긴다
      const slice = [marker.rest, ...lines.slice(marker.line + 1, to)]
      const p = buildPassage(`p${idx + 1}`, marker.no, slice)
      if (p.english) passages.push(p)
    })
    if (passages.length >= 2) {
      return {
        passages: renumber(passages),
        method: 'marker',
        markerStyle: best.style,
        markerSections: best.sections,
        markerCount: best.run.length,
      }
    }
  }

  // 2순위: 빈 줄로 나뉜 덩어리 + 한글 → 영어 전환점에서 나눈다.
  const passages = []
  let current = []
  let sawKoreanSinceEnglish = false
  let currentHasEnglish = false

  const flush = () => {
    if (!current.length) return
    const p = buildPassage(`p${passages.length + 1}`, passages.length + 1, current)
    if (p.english) passages.push(p)
    current = []
    sawKoreanSinceEnglish = false
    currentHasEnglish = false
  }

  for (const line of lines) {
    if (!line) {
      // 빈 줄: 이미 영어와 한글을 모두 본 상태면 지문이 끝난 것으로 본다
      if (currentHasEnglish && sawKoreanSinceEnglish) flush()
      continue
    }
    const kind = classifyLine(line)
    if (kind === 'en') {
      if (currentHasEnglish && sawKoreanSinceEnglish) flush()
      currentHasEnglish = true
      sawKoreanSinceEnglish = false
    } else if (kind === 'ko') {
      if (currentHasEnglish) sawKoreanSinceEnglish = true
    }
    current.push(line)
  }
  flush()

  if (passages.length) {
    return {
      passages: renumber(passages),
      method: 'heuristic',
      markerStyle: null,
      markerSections: [],
      markerCount: best?.run.length ?? 0,
    }
  }

  // 3순위: 통짜 한 덩어리
  const only = buildPassage('p1', 1, lines)
  return {
    passages: only.english ? [only] : [],
    method: 'single',
    markerStyle: null,
    markerSections: [],
    markerCount: best?.run.length ?? 0,
  }
}

/**
 * 통번호(no)와 표기(label)를 다시 매긴다.
 *
 * `no`는 파일이 몇 개든 전체에서 1부터 이어지는 번호다. 선택·행·AI 왕복이
 * 모두 이 숫자를 열쇠로 쓰므로 절대 문자열로 바꾸지 않는다.
 * 화면과 문서에 찍는 것은 `label`이고, 파일이 둘 이상일 때만
 * 파일 꼬리표를 앞에 붙여 "Ch3-2"처럼 구별한다.
 */
function renumber(passages) {
  const multiSource = new Set(passages.map((p) => p.sourceKey)).size > 1
  const seen = new Map()
  return passages.map((p, i) => {
    const sourceNo = (seen.get(p.sourceKey) || 0) + 1
    seen.set(p.sourceKey, sourceNo)
    return {
      ...p,
      // id 는 파일에 붙어 있어야 한다. 위치로 매기면 앞 파일을 뺐을 때 뒤 지문의 id 가
      // 밀려서, 이미 골라둔 표제어가 엉뚱한 지문에 달라붙는다.
      id: p.sourceKey ? `${p.sourceKey}-${sourceNo}` : `p${i + 1}`,
      no: i + 1,
      sourceNo,
      label: multiSource && p.sourceTag ? `${p.sourceTag}-${sourceNo}` : String(i + 1),
    }
  })
}

/* ── 파일 여러 개 ─────────────────────────────────────────────────
 * Chapter가 다르면 번호가 저마다 1부터 다시 시작한다. 그래서 파일을
 * 하나로 이어 붙여 나누면 "1번"이 여러 개 생겨 어느 파일 것인지 알 수 없다.
 * 파일별로 따로 나눈 뒤, 파일 이름에서 뽑은 꼬리표를 번호 앞에 붙인다.
 */

/** 파일 이름 속 단원 표시. "Chapter 3", "Ch.3", "Unit 2", "3강", "5주차" 등. */
const CHAPTER_TAG =
  /(?:^|[^A-Za-z0-9])(?:(Chapters?|Chap|Ch|Units?|Lessons?|Weeks?|Days?|Parts?|Sets?)\s*[.\-_]?\s*(\d{1,3})|(\d{1,3})\s*(강|과|회|장|일차|주차|단원))/i

/** Chapter/Chap/Ch 는 다 같은 뜻이라 Ch 로 줄인다. 나머지는 그대로 둔다. */
function shortWord(word) {
  const w = word.toLowerCase().replace(/s$/, '')
  if (w === 'chapter' || w === 'chap' || w === 'ch') return 'Ch'
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** 파일 이름에서 지문 번호 앞에 붙일 짧은 꼬리표를 뽑는다. */
export function sourceTag(name) {
  const base = String(name || '')
    .replace(/\.[^.]+$/, '')
    .trim()
  if (!base) return ''
  const m = base.match(CHAPTER_TAG)
  if (m) return m[1] ? `${shortWord(m[1])}${Number(m[2])}` : `${Number(m[3])}${m[4]}`
  // 단원 표시가 없으면 파일 이름을 그대로 쓰되, 표에 들어갈 만큼 짧게 줄인다.
  return base.length <= 14 ? base : base.slice(0, 14)
}

/** 같은 꼬리표가 겹치면 구별이 안 되므로 뒤에 번호를 붙인다. */
function uniqueTags(names) {
  const used = new Map()
  return names.map((name, i) => {
    const base = sourceTag(name) || `파일${i + 1}`
    const n = (used.get(base) || 0) + 1
    used.set(base, n)
    return n > 1 ? `${base}(${n})` : base
  })
}

/**
 * 여러 원본을 각각 나눈 뒤 하나의 목록으로 합친다. 원본이 하나뿐이면
 * label 이 그냥 "1", "2"라서 기존 동작과 같다.
 *
 * `key` 는 파일을 처음 읽을 때 한 번 붙여두고 계속 유지하는 값이다.
 * 지문 id 가 여기서 나오므로, 파일을 더하거나 빼도 남은 지문의 id 는 변하지 않는다.
 *
 * @param {Array<{key?: string, name: string, text: string}>} sources
 * @returns {{ passages: Array, files: Array }}
 */
export function splitMultiple(sources) {
  const list = (sources || []).filter((s) => String(s?.text || '').trim())
  const tags = uniqueTags(list.map((s) => s.name))
  const files = []
  const all = []
  list.forEach((src, i) => {
    const key = src.key || `s${i}`
    const { passages, method, markerStyle, markerSections } = splitPassages(src.text)
    files.push({ ...src, key, tag: tags[i], count: passages.length, method, markerStyle, markerSections })
    for (const p of passages) all.push({ ...p, source: src.name, sourceKey: key, sourceTag: tags[i] })
  })
  return { passages: renumber(all), files }
}

/** "Chapter1.docx 외 2개" — 파일이 여럿일 때 출처를 한 줄로 요약한다. */
export function filesLabel(files) {
  if (!files?.length) return ''
  return files.length === 1 ? files[0].name : `${files[0].name} 외 ${files.length - 1}개`
}

/** 인접한 두 지문을 합친다. */
export function mergePassages(passages, index) {
  if (index < 1 || index >= passages.length) return passages
  const prev = passages[index - 1]
  const cur = passages[index]
  const merged = {
    ...prev,
    english: `${prev.english} ${cur.english}`.replace(/\s{2,}/g, ' ').trim(),
    korean: [prev.korean, cur.korean].filter(Boolean).join('\n'),
  }
  const next = [...passages.slice(0, index - 1), merged, ...passages.slice(index + 1)]
  return renumber(next)
}

export function removePassage(passages, index) {
  return renumber(passages.filter((_, i) => i !== index))
}

/** 문장 단위 분리. 약어(Dr., e.g., U.S.)에서 잘리지 않도록 보호한다. */
const ABBREV = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|e\.g|i\.e|approx|Inc|Ltd|Co|Fig|No|cf)\.$/i

/**
 * 문장을 닫는 자리 — 마침표 뒤에 따옴표나 괄호가 따라올 수 있다.
 * 이것을 빠뜨리면 `… are." Then …` 이 한 문장으로 붙어버린다.
 */
const SENT_END = '[.!?]["\'’”»)\\]]*'

/**
 * 다음이 대문자(또는 여는 따옴표+대문자)로 시작할 때만 문장을 나눈다.
 * `"Stop!" he shouted.` 처럼 인용 뒤에 소문자가 이어지면 아직 한 문장이다.
 *
 * 동그라미 번호와 각주 별표(*)도 문장 첫머리로 인정한다. 지문을 만들 때 걷어내지만,
 * 각주가 본문 줄 끝에 붙어 있으면 줄 단위로는 걸러낼 수 없다. 이것을 빠뜨리면
 * "… in certain states. *autonomy: …" 에서 문장이 끊기지 않아 뒤따르는 요약문·보기까지
 * 한 문장으로 뭉치고, 출처 문장 칸에 지문 전체가 실린다.
 */
const NEXT_STARTS = `(?=["'“‘(（[]?\\s*[*※†‡A-Z0-9가-힣${CIRCLED}])`

export function splitSentences(text) {
  const out = []
  let buf = ''
  const parts = String(text).split(new RegExp(`(?<=${SENT_END})\\s+${NEXT_STARTS}`))
  const endsSentence = new RegExp(`${SENT_END}$`)
  for (const part of parts) {
    buf = buf ? `${buf} ${part}` : part
    const tail = buf.trimEnd()
    if (ABBREV.test(tail)) continue
    if (endsSentence.test(tail)) {
      out.push(tail)
      buf = ''
    }
  }
  if (buf.trim()) out.push(buf.trim())
  return out.length ? out : [String(text).trim()].filter(Boolean)
}

/** 문자 오프셋이 속한 문장을 돌려준다. */
export function sentenceAt(text, offset) {
  const sentences = splitSentences(text)
  let cursor = 0
  for (const s of sentences) {
    const start = text.indexOf(s, cursor)
    if (start === -1) continue
    const end = start + s.length
    if (offset >= start && offset < end) return s
    cursor = end
  }
  return sentences[0] || ''
}
