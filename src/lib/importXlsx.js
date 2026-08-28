// 이 앱이 내보낸 단어장 XLSX 를 다시 읽어 rows·passages 로 되돌린다

import ExcelJS from 'exceljs'
import {
  COLUMNS,
  SHEET,
  META_SHEET,
  PASSAGE_SHEET,
  DEFAULT_TITLE,
} from './exportXlsx.js'
import { inflectionKey } from './duplicates.js'
import { tokenize, isPhrase } from './tokenize.js'

/** 셀 값 → 문자열. 서식 있는 글자와 수식 결과도 평문으로 꺼낸다. */
export function cellText(cell) {
  const v = cell?.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    if ('result' in v) return String(v.result ?? '')
    if ('text' in v) return String(v.text ?? '')
    return ''
  }
  return String(v)
}

/** 엑셀 불리언은 파일을 거치며 문자열이 되기도 한다. */
const toBool = (v) => v === true || String(v).toLowerCase() === 'true'

/**
 * 첫 행을 열 이름으로 삼아 표를 객체 배열로 읽는다.
 * row.values 는 빈 셀이 빠지는 성긴 배열이라 열이 밀린다. getCell 로 자리를 지정해 읽는다.
 */
function sheetTable(ws) {
  const headers = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cellText(cell)
  })

  const out = []
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r)
    const obj = {}
    let any = false
    for (let col = 1; col < headers.length; col += 1) {
      const key = headers[col]
      if (!key) continue
      const cell = row.getCell(col)
      const raw = cell?.value
      obj[key] = typeof raw === 'boolean' ? raw : cellText(cell)
      if (obj[key] !== '' && obj[key] !== undefined) any = true
    }
    if (any) out.push(obj)
  }
  return out
}

/** `development (명)` 한 줄씩 → [{ word, pos }] */
export function parseDerivatives(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)\s*\(([^)]*)\)$/)
      return m ? { word: m[1].trim(), pos: m[2].trim() } : { word: line }
    })
}

/** `evolve, grow` → [{ word }] */
export function parseWords(text) {
  return String(text || '')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
    .map((word) => ({ word }))
}

/**
 * _meta 가 없는 옛 파일에서 surface 를 되찾는다.
 *
 * surface 는 지문에 나온 그대로의 형태다. 이것이 없으면 verbForm 이 전부 '원형'을 돌려주어
 * PART IV 의 형태 다양성 규칙이 조용히 죽는다. 그래서 출처 문장에서 되짚어 본다.
 *
 * 규칙 기반이라 buy/bought 같은 불규칙은 못 잡는다. 못 잡으면 표제어를 그대로 두고
 * 몇 개를 못 찾았는지 호출부에 알린다 — 조용히 넘어가면 결과가 왜 나빠졌는지 알 방법이 없다.
 *
 * @returns {string|null} 찾은 형태. 못 찾으면 null.
 */
export function recoverSurface(headword, sentence) {
  const head = String(headword || '').trim()
  const text = String(sentence || '')
  if (!head || !text) return null

  // 원문에 그대로 있으면 더 볼 것이 없다 (대소문자만 다를 수 있다).
  // 낱말 경계를 반드시 확인한다 — 안 그러면 developing 에서 develop 만 잘라내 온다.
  const exact = findWholeWord(text, head)
  if (exact) return exact

  const words = tokenize(text).filter((t) => t.isWord)
  const key = inflectionKey(head)
  if (!key) return null

  if (!isPhrase(head)) {
    const keys = new Set([key, silentEKey(key)].filter(Boolean))
    const hit = words.find((t) => keys.has(inflectionKey(t.text)))
    return hit ? hit.text : null
  }

  // 어구는 같은 낱말 수만큼 창을 밀며 굴절을 뗀 형태끼리 견준다
  const size = head.trim().split(/\s+/).length
  for (let i = 0; i + size <= words.length; i += 1) {
    const window = words.slice(i, i + size)
    if (inflectionKey(window.map((t) => t.text).join(' ')) === key) {
      return text.slice(window[0].start, window[size - 1].end)
    }
  }
  return null
}

/**
 * 묵음 e 를 뗀 열쇠. immerse 는 그대로지만 immersed 는 immers 가 되어 서로 어긋난다.
 * create/created, produce/produced 처럼 흔한 부류라 이것 없이는 동사 상당수를 놓친다.
 *
 * 남는 길이가 4자 미만이면 만들지 않는다 — rate 를 rat 으로 줄이면 문장 속 rats 와 잘못 묶인다.
 * duplicates.js 의 MIN_STEM 과 같은 이유이고 같은 값이다.
 */
function silentEKey(key) {
  const stem = key.replace(/e$/, '')
  return stem !== key && stem.length >= 4 ? stem : ''
}

/** 양끝이 낱말 경계인 자리만 찾는다. 찾으면 원문의 표기 그대로 돌려준다. */
function findWholeWord(text, needle) {
  const isWordChar = (ch) => ch !== undefined && /[A-Za-z0-9]/.test(ch)
  const lower = text.toLowerCase()
  const target = needle.toLowerCase()

  for (let at = lower.indexOf(target); at !== -1; at = lower.indexOf(target, at + 1)) {
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + target.length])) {
      return text.slice(at, at + target.length)
    }
  }
  return null
}

/** 출처 칸이 "3" 이면 지문 번호를 알 수 있다. "11강-3" 이면 알 수 없다. */
function numericSource(source) {
  return /^\d+$/.test(String(source).trim()) ? Number(source) : undefined
}

/**
 * 워크북 → 앱 상태. 브라우저 API 를 쓰지 않아 Node 에서도 검증할 수 있다.
 *
 * 보이는 시트가 내용의 진실이다 — 선생님이 엑셀에서 고쳤을 수 있다.
 * _meta 는 사람이 고칠 수 없는 기술 필드만 맡는다.
 *
 * @returns {{rows, passages, docTitle, warnings}}
 * @throws {Error} 이 앱이 만든 파일이 아닐 때
 */
export function parseWorkbook(wb) {
  const ws = wb.getWorksheet(SHEET)
  if (!ws) throw new Error(`이 앱이 만든 단어장이 아닙니다. '${SHEET}' 시트가 없습니다.`)

  const header = COLUMNS.map((_, i) => cellText(ws.getRow(2).getCell(i + 1)))
  const expected = COLUMNS.map((c) => c.header)
  if (header.join('|') !== expected.join('|')) {
    throw new Error(`단어장 열 구성이 다릅니다. 이 앱이 내보낸 파일을 넣어 주세요.\n기대: ${expected.join(' · ')}`)
  }

  const colOf = {}
  COLUMNS.forEach((c, i) => {
    colOf[c.key] = i + 1
  })

  const metaWs = wb.getWorksheet(META_SHEET)
  const meta = new Map()
  if (metaWs) for (const m of sheetTable(metaWs)) meta.set(String(m.no), m)

  const rows = []
  const usedIds = new Set()
  const recovered = []
  const failed = []

  for (let r = 3; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r)
    const get = (key) => cellText(row.getCell(colOf[key])).trim()

    const headword = get('headword')
    const sentence = cellText(row.getCell(colOf.sentence)).trim()
    const meaning = get('meaning')
    // 표제어도 뜻도 문장도 없으면 빈 줄이다
    if (!headword && !meaning && !sentence) continue

    const source = get('source')
    const m = meta.get(get('no'))

    let surface = String(m?.surface || '').trim()
    if (!surface) {
      const found = recoverSurface(headword, sentence)
      if (found) {
        surface = found
        recovered.push(headword)
      } else {
        surface = headword
        failed.push(headword)
      }
    }

    let id = String(m?.id || '').trim()
    if (!id || usedIds.has(id)) id = `imp${rows.length + 1}`
    usedIds.add(id)

    const passageNo = m?.passageNo === undefined || m.passageNo === ''
      ? numericSource(source)
      : Number(m.passageNo)

    rows.push({
      id,
      headword,
      pos: get('pos'),
      meaning,
      derivatives: parseDerivatives(cellText(row.getCell(colOf.derivatives))),
      synonyms: parseWords(get('synonyms')),
      // confidence 는 생성 단계에서만 읽히므로 담지 않았다. 개수만 맞으면 배정에 지장이 없다.
      antonyms: parseWords(get('antonyms')).map((a) => ({ ...a, confidence: 0 })),
      sentence,
      surface,
      passageNo,
      passageLabel: String(m?.passageLabel || '').trim() || source,
      properNoun: toBool(m?.properNoun),
      normalizationNote: String(m?.normalizationNote || '').trim(),
      missing: toBool(m?.missing),
    })
  }

  if (!rows.length) throw new Error('단어장에 표제어가 하나도 없습니다.')

  const passageWs = wb.getWorksheet(PASSAGE_SHEET)
  const passages = passageWs
    ? sheetTable(passageWs).map((p, i) => ({
        id: String(p.id || `ip${i + 1}`),
        no: Number(p.no) || i + 1,
        label: String(p.label || i + 1),
        english: String(p.english || ''),
        korean: String(p.korean || ''),
      }))
    : []

  // 제목을 비운 채 내보내면 첫 줄이 기본 이름으로 시작한다. 그것은 사용자가 정한 제목이 아니다.
  const titleCell = cellText(ws.getRow(1).getCell(1)).trim()
  const docTitle = titleCell.startsWith(DEFAULT_TITLE) ? '' : titleCell

  return {
    rows,
    passages,
    docTitle,
    warnings: { metaMissing: !metaWs, recovered, failed },
  }
}

/** 브라우저에서 고른 파일 → 앱 상태 */
export async function readWordbook(file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  return parseWorkbook(wb)
}
