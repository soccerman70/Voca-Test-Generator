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
} from 'docx'

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

function header(title) {
  return [
    new Paragraph({
      children: [
        ui(title || '어휘 심화 TEST', { font: F_TITLE, bold: true, size: PT(12), color: NAVY }),
        ui('\t\t이름: ____________   학번: ____________', { size: PT(9) }),
      ],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY } },
      spacing: { after: 90 },
    }),
    new Paragraph({
      children: [ui('VOCABULARY TEST', { font: F_TITLE, bold: true, size: PT(16), color: NAVY })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
    }),
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
  I: '우리말에 해당하는 영어 단어 또는 어구를 쓰시오.',
  II: '다음 영영풀이에 해당하는 단어를 보기에서 고르시오.',
  III: '주어진 두 단어의 관계와 같도록 빈칸에 알맞은 단어를 쓰시오.',
  IV: '문장의 빈칸에 들어갈 동사를 보기에서 골라 바른 형태로 쓰시오.',
  V: '빈칸에 들어가기에 적절한 단어를 모두 고르시오.',
  VI: '글의 빈칸에 들어갈 낱말을 보기에서 고르시오.',
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
  const out = [partHead('II', INSTRUCTION.II), choiceBox(words)]

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
  const out = [partHead('III', INSTRUCTION.III)]
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
  const out = [partHead('V', INSTRUCTION.V)]
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
 * @param {object} data { title, partI, partIV, partIVTexts, gen }
 */
export function buildTestDoc(data) {
  const { title, partI, partIV, partIVTexts, gen } = data
  const children = [
    ...header(title),
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

export function buildAnswerDoc(data) {
  const { title, partI, partIV, partIVTexts, gen } = data
  const children = [
    new Paragraph({
      children: [ui(`${title || '어휘 심화 TEST'} — 정답 및 해설`, { font: F_TITLE, bold: true, size: PT(14), color: RED })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RED } },
      spacing: { after: 140 },
    }),
    ...answerPartOne(partI),
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
      children.push(
        ...card(16 + i, it.answer, [
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
          ['오답', it.wrongWhy],
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
