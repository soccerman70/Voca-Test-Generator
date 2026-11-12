/**
 * 시험지와 정답·해설지를 .docx 로 만든다.
 * 정본은 public/vocabulary_test_sample.pdf 다.
 *
 * 폰트는 세 갈래로 쓴다. docx 는 ascii(영문)와 eastAsia(한글) 폰트를 따로 지정할 수 있어,
 * 영문 본문에 한글이 섞여도 각자 제 서체로 그려진다.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  VerticalAlign,
  TableLayoutType,
  LineRuleType,
} from 'docx'
import { DEFAULT_TITLE } from './exportXlsx.js'
import { partThreeAnswers } from './quizRules.js'

/** 제목용 — 시험지 상단 타이틀과 대제목 */
const F_TITLE = { ascii: 'Noto Serif KR', eastAsia: 'Noto Serif KR', hAnsi: 'Noto Serif KR' }
/** 지시문·이름칸·각주 등 */
const F_UI = { ascii: 'Noto Sans KR', eastAsia: 'Noto Sans KR', hAnsi: 'Noto Sans KR' }
/** 영문 본문 — 섞인 한글은 Noto Sans KR 이 받는다 */
const F_BODY = { ascii: 'Lora', eastAsia: 'Noto Sans KR', hAnsi: 'Lora' }

const NAVY = '1F4E79'
const RED = 'C00000'
const HEAD_BG = 'D5E8F0'
const LINE = 'BFBFBF'

/**
 * 1쪽에 PART I~IV 를 담기 위한 치수.
 * 1440 twips = 1 inch. 720 이면 0.5 inch(12.7mm) 여백이다.
 * 줄간격 240 이 1.0줄이므로 228 은 0.95줄.
 */
const MARGIN = 720
/** A4 폭 11906 에서 좌우 여백을 뺀 본문 폭 */
const TEXT_WIDTH = 11906 - MARGIN * 2
/** 머리 줄 가운데 칸 — 14pt 굵은 `VOCABULARY TEST` 가 한 줄에 드는 폭 */
const HEAD_CENTER = 3100
/** 머리 줄 오른쪽 칸의 최소 폭 — `이름: ____________` */
const HEAD_RIGHT_MIN = 2300
const BODY_PT = 9.5
const LINE_SPACING = 228

/** pt → half-points */
const PT = (n) => Math.round(n * 2)

const t = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: F_BODY, size: PT(BODY_PT), ...o })
const ui = (text, o = {}) => t(text, { font: F_UI, ...o })
const para = (children, o = {}) =>
  new Paragraph({
    children: Array.isArray(children) ? children : [children],
    ...o,
    spacing: { line: LINE_SPACING, ...(o.spacing || {}) },
  })
const gap = (n = 60) => new Paragraph({ children: [], spacing: { after: n } })

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE }
const ALL_BORDERS = { top: border, bottom: border, left: border, right: border }

function cell(children, { width, bg, span } = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: bg ? { fill: bg } : undefined,
    columnSpan: span,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  })
}

const table = (rows) =>
  new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, borders: ALL_BORDERS })

/* ------------------------------------------------------------------ */
/* 공통 조각                                                           */
/* ------------------------------------------------------------------ */

/**
 * 10pt 글자의 폭을 twips 로 어림한다. 한글 1em, 빈칸 0.3em, 나머지 0.6em —
 * 실제보다 조금 넉넉하게 잡아 칸이 모자라 줄이 꺾이는 쪽보다 가운데에서 조금 비켜나는 쪽으로 틀린다.
 */
function headWidth(text, pt = 10) {
  const em = [...text].reduce((w, ch) => w + (/[ㄱ-ㆎ가-힣]/.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.6), 0)
  return Math.ceil(em * pt * 20)
}

/**
 * PART V 정답해설의 "오답" 줄 — `① enemy — 반대 방향 … / ③ acquaintance — …`.
 * 오답마다 틀린 이유를 한 마디씩 싣는다(시험지 검수 기준). reasons 가 없으면 빈 문자열.
 */
export function wrongReasons(it) {
  const answers = it.answers || []
  const reasons = Array.isArray(it.reasons) ? it.reasons : []
  return (it.choices || [])
    .map((c, k) => (answers.includes(k + 1) || !String(reasons[k] || '').trim() ? '' : `${'①②③④⑤'[k]} ${c} — ${String(reasons[k]).trim()}`))
    .filter(Boolean)
    .join(' / ')
}

/**
 * 시험지 머리 왼쪽 글 — `2026 {단어장 제목} 3반` 과 `Week 5`.
 * 연도 · 반 · 주차를 ④ 화면에서 채우면 그 값을, 비워 두면 손으로 쓸 빈칸을 넣는다.
 * 화면의 머리 미리보기와 docx 가 같은 글을 쓰도록 여기 하나만 둔다.
 *
 * 사람이 `3반` · `5주차` · `Week 5` · `2026년` 처럼 붙여 써도 `3반반` · `Week 5주차` 가 되지 않게 걷어낸다.
 *
 * 제목에 연도나 주차가 이미 들어 있으면(`2027 겨울학기 [실력반] WEEK 09`) 그것을 쓰고 제목에서 뺀다.
 * 그러지 않으면 `2026 2027 겨울학기 [실력반] WEEK 09 _____반  Week #` 처럼 두 번 찍힌다
 * (Week 07~09 검수에서 3주 연속 지적). 연도 칸은 올해로 미리 채워져 있어 사람이 고른 값이 아니므로
 * 제목 쪽이 이긴다. 화면은 fromTitle 을 보고 그 칸을 잠근다.
 *
 * @param {string} title 단어장 · 시험지 제목. 비면 기본 제목
 * @param {{year?: string, klass?: string, week?: string}} head
 * @returns {{ lead: string, week: string, fromTitle: {year: string, week: string} }}
 */
export function testHeadParts(title, head = {}) {
  const { year, rest, klass, week, fromTitle } = headFields(title, head)
  return {
    lead: `${year || '202__'} ${rest} ${klass || '_____'}반`,
    week: week || 'Week #',
    fromTitle,
  }
}

/**
 * 제목에 든 연도 · 주차를 머리 칸 값으로 옮겨 적는다. 제목이 없으면 머리 칸을 그대로 돌려준다.
 *
 * 제목에 연도가 있는 동안은 제목 값이 이기지만, 제목을 바꾸며 연도가 빠지면(`2027 겨울학기 완성반 Week02` →
 * `겨울학기 단어학습`) 머리 칸 값이 찍힌다. 그 칸이 기본값(올해 = 2026)이면 2027 겨울학기 시험지에 2026 이 찍힌다
 * (Week 02 검수). 주차도 같은 이유로 빠졌다(Week 01 시험지의 `Week #`). 그래서 제목이 바뀌기 직전 · 단어장을 불러올 때
 * 제목의 연도 · 주차를 머리 칸에 옮겨 둔다(store 의 setDocTitle · loadWordbook · replaceWordbook).
 */
export function headFromTitle(title, head = {}) {
  const { year, week } = splitTitleHead(title)
  const w = week.replace(/^(?:week|wk)\s*/i, '')
  return { ...head, ...(year ? { year } : {}), ...(w ? { week: w } : {}) }
}

/** 머리 칸 값 — 제목에서 뗀 연도 · 주차가 이기고, 붙여 쓴 `반` · `주차` · `Week` · `년` 은 걷는다. 비면 빈 문자열 */
function headFields(title, head = {}) {
  const clean = (v, re) => String(v ?? '').trim().replace(re, '').trim()
  const { rest, year: titleYear, week: titleWeek } = splitTitleHead(title)
  const week = clean(head.week, /^week\s*|주차$/gi)
  return {
    year: titleYear || clean(head.year, /년$/),
    rest: rest || DEFAULT_TITLE,
    klass: clean(head.klass, /반$/),
    week: titleWeek || (week ? `Week ${week}` : ''),
    fromTitle: { year: titleYear, week: titleWeek },
  }
}

/**
 * 정답 · 해설지 머리 — 시험지 머리와 같은 연도 · 제목 · 반 · 주차 (Week 03 검수: 정답해설에는 제목만 찍혀
 * 어느 반 몇 주차인지 알 수 없었다). 손으로 쓸 빈칸은 남기지 않는다 — 비운 칸은 뺀다.
 * `2027 겨울학기 단어학습 완성반 Week 03 — 정답 및 해설`
 */
export function answerHeadText(title, head = {}) {
  const { year, rest, klass, week } = headFields(title, head)
  return `${[year, rest, klass && `${klass}반`, week].filter(Boolean).join(' ')} — 정답 및 해설`
}

/**
 * 제목에서 연도(`2027`, `2027년`)와 주차(`WEEK 09`, `Week_9`, `9주차`)를 떼어 낸다.
 * 주차는 적힌 모양(`WEEK 09`)을 그대로 살린다 — `9주차` 만 `Week 9` 로 맞춘다.
 * 파일 이름에서 온 제목(`2027_겨울학기_[실력반]_WEEK_09`)처럼 밑줄로 이은 것도 읽는다.
 */
export function splitTitleHead(title) {
  let rest = String(title || '').trim()
  let year = ''
  let week = ''
  const y = rest.match(/(?:^|[\s_])(20\d{2})년?(?=[\s_]|$)/)
  if (y) {
    year = y[1]
    rest = rest.replace(y[0], ' ')
  }
  const w = rest.match(/(?:^|[\s_])(week|wk)[\s_.-]*(\d{1,2})(?=[\s_]|$)/i)
  const k = w ? null : rest.match(/(?:^|[\s_])(\d{1,2})\s*주차(?=[\s_]|$)/)
  if (w) {
    week = `${w[1].toLowerCase() === 'wk' ? 'Week' : w[1]} ${w[2]}`
    rest = rest.replace(w[0], ' ')
  } else if (k) {
    week = `Week ${k[1]}`
    rest = rest.replace(k[0], ' ')
  }
  rest = rest.replace(/^[\s_]+|[\s_]+$/g, '').replace(/\s{2,}/g, ' ')
  return { rest, year, week }
}

/**
 * 시험지 머리 — 한 줄에 연도 · 제목 · 반, 주차, VOCABULARY TEST, 이름칸을 놓는다.
 * `2026 {단어장 제목} _____반   Week #   VOCABULARY TEST   이름: ____________`
 * 비워 둔 칸은 선생님이 docx 에서 채우거나 손으로 쓴다.
 *
 * 단어장 제목은 0~30자라 길이가 제각각이다. 탭 정지로 맞추면 제목이 길 때 `Week #` 과
 * `VOCABULARY TEST` 가 다음 탭으로 밀려 줄이 깨지므로 테두리 없는 세 칸 표로 놓는다.
 * 왼쪽 글이 짧으면 양옆 칸을 같게 해 `VOCABULARY TEST` 를 쪽 가운데에 두고, 길면 왼쪽 칸을
 * 넓혀 한 줄을 지킨다(가운데 칸이 그만큼 오른쪽으로 비켜난다). 그래도 넘치면 왼쪽 칸 안에서 꺾인다.
 */
function header(title, head) {
  const { lead, week } = testHeadParts(title, head)
  const side = (TEXT_WIDTH - HEAD_CENTER) / 2
  const need = headWidth(`${lead}   ${week}`) + 120
  const left = Math.min(Math.max(side, need), TEXT_WIDTH - HEAD_CENTER - HEAD_RIGHT_MIN)
  const right = TEXT_WIDTH - HEAD_CENTER - left
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }

  const headCell = (children, width, alignment, margins) =>
    new TableCell({
      children: [new Paragraph({ children, alignment })],
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      // 바깥쪽 여백을 0 으로 두어 글자가 본문 좌우 끝선에 맞는다
      margins: { top: 0, bottom: 60, ...margins },
    })

  return [
    new Table({
      columnWidths: [left, HEAD_CENTER, right],
      width: { size: TEXT_WIDTH, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      borders: {
        top: none,
        left: none,
        right: none,
        insideHorizontal: none,
        insideVertical: none,
        bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY },
      },
      rows: [
        new TableRow({
          children: [
            headCell(
              [ui(lead, { size: PT(10) }), ui(`   ${week}`, { bold: true, size: PT(10), color: NAVY })],
              left,
              AlignmentType.LEFT,
              { left: 0, right: 120 }
            ),
            headCell(
              [ui('VOCABULARY TEST', { font: F_TITLE, bold: true, size: PT(14), color: NAVY })],
              HEAD_CENTER,
              AlignmentType.CENTER,
              { left: 0, right: 0 }
            ),
            headCell([ui('이름: ____________', { size: PT(10) })], right, AlignmentType.RIGHT, { left: 120, right: 0 }),
          ],
        }),
      ],
    }),
    // 표 아래 선과 PART I 사이 — 예전 머리 문단의 아래 여백(160)과 같게
    new Paragraph({ children: [], spacing: { before: 0, after: 0, line: 160, lineRule: LineRuleType.EXACT } }),
  ]
}

/** PART 머리 — 번호와 지시문 */
function partHead(no, instruction) {
  return new Paragraph({
    children: [
      ui(`PART ${no}`, { bold: true, size: PT(11), color: NAVY }),
      ui(`  ${instruction}`, { size: PT(9.5) }),
    ],
    spacing: { before: 140, after: 70 },
  })
}

/** 보기 줄 — `보기 • 단어 • 단어` */
function choiceBox(items) {
  return new Paragraph({
    children: [ui('보기   ', { bold: true, size: PT(9.5) }), t(items.map((w) => `• ${w}`).join('   '))],
    border: {
      top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      left: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      right: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    },
    spacing: { after: 100 },
    indent: { left: 60, right: 60 },
  })
}

const INSTRUCTION = {
  I: '우리말에 해당하는 영어 단어 또는 어구를 쓰시오. (표제어 쓰기)',
  II: '다음 영영풀이에 해당하는 단어를 보기에서 고르시오.',
  III: '주어진 두 단어의 관계와 같도록 빈칸에 알맞은 단어를 쓰시오.',
  IV: '문장의 빈칸에 들어갈 동사를 보기에서 골라 바른 형태로 쓰시오. (각 단어는 한 번씩만 쓸 것)',
  V: '빈칸에 들어가기에 적절한 단어를 모두 고르시오.',
  VI: '글의 빈칸에 들어갈 낱말을 보기에서 고르시오.',
}

/** 보기 · 문항에 두 낱말 이상의 어구가 있을 때의 지시문 — "단어" 대신 "말" */
const INSTRUCTION_PHRASE = {
  II: '다음 영영풀이에 해당하는 말을 보기에서 고르시오.',
  III: '주어진 두 말의 관계와 같도록 빈칸에 알맞은 말을 쓰시오.',
  V: '빈칸에 들어가기에 적절한 말을 모두 고르시오.',
}

const hasPhrase = (words) => words.some((w) => /\S\s+\S/.test(String(w ?? '').trim()))

/**
 * PART 지시문. II · III · V 는 보기 · 문항에 어구가 하나라도 있으면 "단어" 를 "말" 로 쓴다
 * (Week 02 검수 30번: 선지에 point of view · case in point 가 있는데 "적절한 단어를" 이었다. Week 01 은 "말을").
 * @param {'I'|'II'|'III'|'IV'|'V'|'VI'} part
 * @param {object} [result] 그 PART 의 AI 결과
 */
export function instructionOf(part, result) {
  const words =
    part === 'II'
      ? [...(result?.definitions || []).map((d) => d.headword), result?.distractor?.word]
      : part === 'III'
        ? (result?.items || []).flatMap((it) => [it.left, it.right, it.headword, it.answer, ...(it.accepted || [])])
        : part === 'V'
          ? (result?.items || []).flatMap((it) => it.choices || [])
          : []
  return INSTRUCTION_PHRASE[part] && hasPhrase(words) ? INSTRUCTION_PHRASE[part] : INSTRUCTION[part]
}

/* ------------------------------------------------------------------ */
/* 시험지                                                              */
/* ------------------------------------------------------------------ */

/** PART I — 2열 5행. 왼쪽 5문항, 오른쪽 5문항 */
function partOneTable(items) {
  const half = Math.ceil(items.length / 2)
  const head = ['No', '우리말 뜻', '영단어', 'No', '우리말 뜻', '영단어']

  const headRow = new TableRow({
    children: head.map((h, i) =>
      cell(new Paragraph({ children: [ui(h, { bold: true, size: PT(9) })], alignment: AlignmentType.CENTER }), {
        width: [6, 27, 17, 6, 27, 17][i],
        bg: HEAD_BG,
      })
    ),
    tableHeader: true,
  })

  const rows = []
  for (let i = 0; i < half; i += 1) {
    const L = items[i]
    const R = items[i + half]
    const pair = (item) =>
      item
        ? [
            cell(new Paragraph({ children: [t(item.no)], alignment: AlignmentType.CENTER })),
            cell(para(ui(item.prompt, { size: PT(9.5) }))),
            cell(para(t(''))),
          ]
        : [cell(para(t(''))), cell(para(t(''))), cell(para(t('')))]
    rows.push(new TableRow({ children: [...pair(L), ...pair(R)] }))
  }

  return table([headRow, ...rows])
}

function partTwo(gen) {
  const defs = gen?.result?.definitions || []
  const words = [...defs.map((d) => d.headword), gen?.result?.distractor?.word].filter(Boolean).sort()
  const out = [partHead('II', instructionOf('II', gen?.result)), choiceBox(words)]

  defs.forEach((d, i) => {
    out.push(
      para([t(`${11 + i}. `, { bold: true }), t('________________ : '), t(d.definition)], {
        spacing: { after: 70 },
      })
    )
  })
  return out
}

function partThree(gen) {
  const items = gen?.result?.items || []
  const out = [partHead('III', instructionOf('III', gen?.result))]
  items.forEach((it, i) => {
    out.push(
      para(
        [
          t(`${16 + i}. `, { bold: true }),
          t(`${it.left} : ${it.right} = ${it.headword} : `),
          t(it.hint ? `${it.hint}______________` : '________________'),
        ],
        { spacing: { after: 70 } }
      )
    )
  })
  return out
}

function partFour(partIV, texts) {
  const out = [partHead('IV', INSTRUCTION.IV), choiceBox(partIV.choices)]
  partIV.items.forEach((it, i) => {
    out.push(para([t(`${it.no}. `, { bold: true }), t(texts[i] || '')], { spacing: { after: 80 } }))
  })
  return out
}

function partFive(gen) {
  const items = gen?.result?.items || []
  const out = [partHead('V', instructionOf('V', gen?.result))]
  const marks = ['①', '②', '③', '④', '⑤']
  items.forEach((it, i) => {
    out.push(para([t(`${26 + i}. `, { bold: true }), t(it.sentence)], { spacing: { after: 45 } }))
    out.push(
      para(t((it.choices || []).map((c, k) => `${marks[k]} ${c}`).join('   ')), {
        spacing: { after: 95 },
        indent: { left: 240 },
      })
    )
  })
  return out
}

function partSix(gen, choices) {
  const story = String(gen?.result?.story || '')
  const out = [partHead('VI', INSTRUCTION.VI), choiceBox(choices || [])]

  // {31} 표시를 번호 + 빈칸으로 바꾼다
  const pieces = story.split(/(\{\d+\})/g)
  const children = pieces.map((piece) => {
    const m = piece.match(/^\{(\d+)\}$/)
    return m ? t(`${m[1]}. ________________ `, { bold: true }) : t(piece)
  })
  out.push(para(children, { spacing: { after: 80 } }))
  return out
}

/**
 * @param {object} data { title, head, partI, partINotes, partIV, partIVTexts, gen } — head 는 { year, klass, week }.
 *   gen 은 지금 규칙을 입힌 것(withCurrentRules)을 받는다 — 화면과 같은 힌트 · a(n) 이 찍힌다.
 */
export function buildTestDoc(data) {
  const { title, head, partI, partIV, partIVTexts, gen } = data
  const children = [
    ...header(title, head),
    partHead('I', INSTRUCTION.I),
    partOneTable(partI),
    ...partTwo(gen?.byPart?.II),
    ...partThree(gen?.byPart?.III),
    ...partFour(partIV, partIVTexts),
    new Paragraph({ children: [], pageBreakBefore: true }),
    ...partFive(gen?.byPart?.V),
    ...partSix(gen?.byPart?.VI, gen?.choices?.VI),
    gap(200),
    new Paragraph({
      children: [ui('— 수고하셨습니다 —', { size: PT(9.5), color: NAVY })],
      alignment: AlignmentType.CENTER,
    }),
  ]

  return new Document({
    sections: [
      {
        properties: { page: { margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
        children,
      },
    ],
  })
}

/* ------------------------------------------------------------------ */
/* 정답·해설지                                                          */
/* ------------------------------------------------------------------ */

/** 항목 하나를 카드처럼 — 정답 줄 + 설명 줄들 */
function card(no, answer, lines) {
  const out = [
    para([ui(`${no}. `, { bold: true, size: PT(10) }), ui(answer, { bold: true, size: PT(10), color: RED })], {
      spacing: { before: 120, after: 40 },
    }),
  ]
  for (const [label, value] of lines) {
    if (!value) continue
    out.push(
      para([ui(`${label} `, { size: PT(8.5), bold: true, color: NAVY }), t(value, { size: PT(9) })], {
        indent: { left: 240 },
        spacing: { after: 30 },
      })
    )
  }
  return out
}

function answerPartOne(partI) {
  const head = ['No', '정답', '품사', '뜻', '유의어', '출처']
  const headRow = new TableRow({
    children: head.map((h, i) =>
      cell(new Paragraph({ children: [ui(h, { bold: true, size: PT(9) })], alignment: AlignmentType.CENTER }), {
        width: [6, 22, 8, 26, 24, 14][i],
        bg: HEAD_BG,
      })
    ),
    tableHeader: true,
  })

  const rows = partI.map((q) =>
    new TableRow({
      children: [
        cell(new Paragraph({ children: [t(q.no)], alignment: AlignmentType.CENTER })),
        cell(para(t(q.answer, { bold: true, color: RED }))),
        cell(new Paragraph({ children: [ui(q.pos || '', { size: PT(9) })], alignment: AlignmentType.CENTER })),
        cell(para(ui(q.meaning || '', { size: PT(9) }))),
        cell(para(t(q.synonyms || '—', { size: PT(9) }))),
        cell(
          new Paragraph({
            children: [ui(String(q.passageLabel ?? q.passageNo), { size: PT(9) })],
            alignment: AlignmentType.CENTER,
          })
        ),
      ],
    })
  )

  return [partHead('I', '우리말 → 영어 쓰기'), table([headRow, ...rows])]
}

/**
 * PART I 채점 참고 — 정답 말고도 그 우리말에 들어맞는 말이 있는 문항 (PART I 점검, partOneNotes).
 * 정답해설의 유의어 칸에 있는 말이 학생 답으로 나오면 맞다고 할지 정해 두어야 한다 (Week 03 검수 5 · 7번).
 */
function gradingNotes(notes) {
  if (!notes?.length) return []
  return [
    para(ui('채점 참고', { size: PT(8.5), bold: true, color: NAVY }), { spacing: { before: 100, after: 30 } }),
    ...notes.map((n) => {
      const words = n.others.map((o) => o.word).join(' · ')
      const text = n.applied
        ? `뜻을 "${n.meaning}" 로 좁혔다 — ${words} 는 이 뜻에 맞지 않는다`
        : `${words} 도 "${n.meaning}" 에 들어맞는다 — 정답으로 인정할지 정해 둘 것`
      return para([t(`${n.no}. ${n.answer}  `, { size: PT(9), bold: true }), ui(text, { size: PT(9) })], {
        indent: { left: 240 },
        spacing: { after: 30 },
      })
    }),
  ]
}

export function buildAnswerDoc(data) {
  const { title, head, partI, partINotes, partIV, partIVTexts, gen } = data
  const children = [
    new Paragraph({
      children: [ui(answerHeadText(title, head), { font: F_TITLE, bold: true, size: PT(14), color: RED })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RED } },
      spacing: { after: 140 },
    }),
    ...answerPartOne(partI),
    ...gradingNotes(partINotes),
  ]

  // PART II
  const two = gen?.byPart?.II?.result
  if (two) {
    children.push(partHead('II', '영영풀이 매칭'))
    ;(two.definitions || []).forEach((d, i) => {
      children.push(...card(11 + i, d.headword, [['풀이', d.definition]]))
    })
    if (two.distractor) {
      children.push(
        para(
          [
            ui('미사용 보기  ', { size: PT(8.5), bold: true, color: NAVY }),
            t(two.distractor.word, { bold: true }),
            ui(`  ${two.distractor.reason || ''}`, { size: PT(9) }),
          ],
          { indent: { left: 240 }, spacing: { before: 80 } }
        )
      )
    }
  }

  // PART III
  const three = gen?.byPart?.III?.result
  if (three) {
    children.push(partHead('III', '어휘 관계 분석'))
    ;(three.items || []).forEach((it, i) => {
      // 힌트(두 글자)로 여러 말이 들어맞으면 모두 정답 — previous · prior · preceding (모두 정답)
      const answers = partThreeAnswers(it)
      children.push(
        ...card(16 + i, answers.length > 1 ? `${answers.join(' · ')} (모두 정답)` : answers[0] || '', [
          ['문항', `${it.left} : ${it.right} = ${it.headword} : ?`],
          ['관계', it.relation],
          ['형태', it.note],
        ])
      )
    })
  }

  // PART IV
  children.push(partHead('IV', '동사 형태 변형'))
  partIV.items.forEach((it, i) => {
    children.push(
      ...card(it.no, `${it.answer} (${it.base})`, [
        ['문항', partIVTexts[i]],
        ['출처', String(it.passageLabel ?? it.passageNo)],
      ])
    )
  })

  // PART V
  const five = gen?.byPart?.V?.result
  if (five) {
    children.push(partHead('V', '복수 정답 유의어 변별'))
    ;(five.items || []).forEach((it, i) => {
      const marks = ['①', '②', '③', '④', '⑤']
      const answers = (it.answers || []).map((n) => `${marks[n - 1]} ${(it.choices || [])[n - 1]}`).join(', ')
      children.push(
        ...card(26 + i, `정답 ${(it.answers || []).length}개 — ${answers}`, [
          // 오답마다 틀린 이유 한 마디 (버리는 오답 · 근접 오답 모두). 예전 결과는 wrongWhy 한 줄이다
          ['오답', wrongReasons(it) || it.wrongWhy],
          ['단서', (it.clues || []).join(' · ')],
          ['해석', it.translation],
        ])
      )
    })
  }

  // PART VI
  const six = gen?.byPart?.VI?.result
  if (six) {
    children.push(partHead('VI', '지문형 빈칸 서사'))
    const blanks = six.blanks || []
    children.push(
      para(
        [
          ui('정답  ', { size: PT(9), bold: true, color: NAVY }),
          t(blanks.map((b) => `${b.no} ${b.answer}`).join('   '), { bold: true, color: RED }),
        ],
        { spacing: { after: 70 } }
      )
    )
    blanks.forEach((b) => {
      children.push(...card(b.no, b.answer, [['단서', b.clue]]))
    })
    if (six.translation) {
      children.push(
        para(ui('전체 해석', { size: PT(9), bold: true, color: NAVY }), { spacing: { before: 160, after: 60 } })
      )
      children.push(para(ui(six.translation, { size: PT(9) })))
    }
  }

  return new Document({
    sections: [
      {
        properties: { page: { margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
        children,
      },
    ],
  })
}

/* ------------------------------------------------------------------ */

function safeName(text) {
  return String(text || '').replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '_') || '어휘심화'
}

export async function downloadDocx(doc, fileName) {
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 시험지가 여럿이면 파일 이름 끝에 번호를 붙인다. 문서 안의 제목은 그대로다. */
const numbered = (data) => (data.fileNo ? `_${data.fileNo}` : '')

export async function downloadTest(data) {
  await downloadDocx(buildTestDoc(data), `${safeName(data.title)}_시험지${numbered(data)}.docx`)
}

export async function downloadAnswers(data) {
  await downloadDocx(buildAnswerDoc(data), `${safeName(data.title)}_정답해설${numbered(data)}.docx`)
}
