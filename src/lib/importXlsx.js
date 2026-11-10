// 이 앱이 내보낸 단어장 XLSX 를 다시 읽어 rows·passages 로 되돌린다

import ExcelJS from 'exceljs'
import {
  COLUMNS,
  SHEET,
  META_SHEET,
  PASSAGE_SHEET,
  DEFAULT_TITLE,
  toRowObjects,
  parseDerivatives,
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

/** 공백을 한 칸으로 — 지문의 줄바꿈이 문장·셀을 거치며 달라져도 같은 글로 본다. */
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim()

/**
 * 보이는 시트의 줄마다 _meta 의 줄을 하나씩 짝짓는다.
 *
 * 번호 칸만 믿으면 안 된다. 선생님이 엑셀에서 줄을 지우고 번호를 다시 매기거나, 새 줄을 끼워 넣으면
 * 번호가 가리키는 _meta 는 다른 표제어의 것이 된다. 그대로 쓰면 다른 줄의 surface 가 정답으로
 * 들어간다 — 에러 없이 시험지 정답만 틀린다.
 *
 * 그래서 _meta 의 surface 가 그 줄의 출처 문장 안에 실제로 있어야만 짝으로 인정한다.
 * 한 문장에서 표제어를 여럿 고른 경우 후보가 여럿이므로 점수로 확실한 짝부터 묶는다.
 *   표제어와 surface 의 굴절 열쇠가 같다(묵음 e 포함) +2, 번호가 같다 +1
 * 문장만 맞는 후보(0점)는 그 줄에 남은 후보가 하나뿐일 때만 받는다.
 *
 * @returns 보이는 줄과 같은 순서의 _meta 줄. 짝이 없으면 null.
 */
function matchMeta(visible, metaRows) {
  const metaKeys = metaRows.map((m) => inflectionKey(m.surface))
  const pairs = []
  visible.forEach((v, i) => {
    const sentence = squash(v.sentence)
    const key = inflectionKey(v.headword)
    const roots = new Set([key, key && silentEKey(key)].filter(Boolean))
    metaRows.forEach((m, j) => {
      const surface = squash(m.surface)
      if (!surface || !findWholeWord(sentence, surface)) return
      const score = (roots.has(metaKeys[j]) ? 2 : 0) + (String(m.no) === v.no ? 1 : 0)
      pairs.push({ i, j, score })
    })
  })

  const matched = visible.map(() => null)
  const taken = new Set()
  const take = ({ i, j }) => {
    matched[i] = metaRows[j]
    taken.add(j)
  }

  // 점수가 같으면 위쪽 줄이 먼저 가져간다
  pairs
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .forEach((p) => {
      if (!matched[p.i] && !taken.has(p.j)) take(p)
    })

  visible.forEach((_, i) => {
    if (matched[i]) return
    const left = pairs.filter((p) => p.i === i && !taken.has(p.j))
    if (left.length === 1) take(left[0])
  })
  return matched
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

  const visible = []
  for (let r = 3; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r)
    const get = (key) => cellText(row.getCell(colOf[key])).trim()

    const headword = get('headword')
    const sentence = cellText(row.getCell(colOf.sentence)).trim()
    const meaning = get('meaning')
    // 표제어도 뜻도 문장도 없으면 빈 줄이다
    if (!headword && !meaning && !sentence) continue

    visible.push({
      no: get('no'),
      headword,
      pos: get('pos'),
      meaning,
      derivatives: cellText(row.getCell(colOf.derivatives)),
      synonyms: get('synonyms'),
      antonyms: get('antonyms'),
      source: get('source'),
      sentence,
    })
  }

  if (!visible.length) throw new Error('단어장에 표제어가 하나도 없습니다.')

  const metaWs = wb.getWorksheet(META_SHEET)
  const metaFor = metaWs ? matchMeta(visible, sheetTable(metaWs)) : visible.map(() => null)

  // 짝지은 _meta 의 id 는 살린다 — 지금 표와 견줄 때 같은 줄로 알아보는 열쇠다.
  // 새 id 가 뒤쪽 줄의 id 와 부딪치지 않도록 미리 다 잡아 둔다.
  const reserved = new Set(metaFor.map((m) => String(m?.id || '').trim()).filter(Boolean))
  const usedIds = new Set()
  let seq = 0
  const freshId = () => {
    let id
    do {
      seq += 1
      id = `imp${seq}`
    } while (reserved.has(id) || usedIds.has(id))
    return id
  }

  const rows = []
  const unmatched = []
  const recovered = []
  const failed = []

  visible.forEach((v, i) => {
    const m = metaFor[i]
    if (metaWs && !m) unmatched.push(v.headword)

    let surface = String(m?.surface || '').trim()
    if (!surface) {
      const found = recoverSurface(v.headword, v.sentence)
      if (found) {
        surface = found
        recovered.push(v.headword)
      } else {
        surface = v.headword
        failed.push(v.headword)
      }
    }

    let id = String(m?.id || '').trim()
    if (!id || usedIds.has(id)) id = freshId()
    usedIds.add(id)

    const passageNo = m?.passageNo === undefined || m.passageNo === ''
      ? numericSource(v.source)
      : Number(m.passageNo)

    rows.push({
      id,
      headword: v.headword,
      pos: v.pos,
      meaning: v.meaning,
      derivatives: parseDerivatives(v.derivatives),
      synonyms: parseWords(v.synonyms),
      // confidence 는 생성 단계에서만 읽히므로 담지 않았다. 개수만 맞으면 배정에 지장이 없다.
      antonyms: parseWords(v.antonyms).map((a) => ({ ...a, confidence: 0 })),
      sentence: v.sentence,
      surface,
      passageNo,
      passageLabel: String(m?.passageLabel || '').trim() || v.source,
      properNoun: toBool(m?.properNoun),
      normalizationNote: String(m?.normalizationNote || '').trim(),
      missing: toBool(m?.missing),
    })
  })

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
    warnings: { metaMissing: !metaWs, unmatched, recovered, failed },
  }
}

/**
 * 불러온 단어장이 지금 작업과 같은 지문에서 나왔는지.
 *
 * 출처 문장이 지금 지문 안에 그대로 있는지로 본다. 줄을 지우거나 번호를 바꿔도, 숨김 시트가 없는
 * 옛 파일이어도 흔들리지 않는다. 엑셀에서 문장을 손본 줄이 있을 수 있어 절반 이상이면 같다고 본다.
 */
export function isSameWork(rows, passages) {
  const text = (passages || []).map((p) => squash(p.english)).join('\n')
  const sentences = rows.map((r) => squash(r.sentence)).filter(Boolean)
  if (!text || !sentences.length) return false
  const found = sentences.filter((s) => text.includes(s)).length
  return found * 2 >= sentences.length
}

/**
 * 불러올 단어장을 지금 작업과 견준다. 1단계 · 3단계 불러오기가 "다른 작업입니다" 경고와
 * 견줌 숫자를 보이는 데 함께 쓴다.
 *
 * 같은 작업인지는 isSameWork 와 같은 기준(출처 문장이 지금 지문 안에 절반 이상)이다.
 * 표제어가 몇 개 겹치는지는 사람이 보기 위한 숫자다 — 지금 표가 있으면 표의 표제어, 없으면
 * 2단계에서 고른 표현(굴절형일 수 있다)을 굴절 열쇠로 견준다.
 *
 * @param {{rows?: Array, selections?: Array, passages?: Array, docTitle?: string}} current 지금 작업
 * @param {{rows: Array, docTitle?: string}} incoming 불러올 단어장
 */
export function compareWork(current, incoming) {
  const rows = current.rows || []
  const selections = current.selections || []
  const passages = current.passages || []
  const text = passages.map((p) => squash(p.english)).join('\n')
  const sentenceHits = text ? incoming.rows.filter((r) => r.sentence && text.includes(squash(r.sentence))).length : 0

  // 고른 표현은 굴절형(immersed)이고 파일의 표제어는 원형(immerse)이라, 묵음 e 를 뗀 열쇠로 맞춘다
  const rootOf = (word) => {
    const key = inflectionKey(word)
    return silentEKey(key) || key
  }
  const mine = new Set((rows.length ? rows.map((r) => r.headword) : selections.map((s) => s.surface)).map(rootOf))
  mine.delete('')
  const sharedHeadwords = new Set(incoming.rows.map((r) => rootOf(r.headword)).filter((k) => k && mine.has(k))).size

  return {
    hasWork: rows.length > 0 || selections.length > 0 || passages.length > 0,
    sameWork: isSameWork(incoming.rows, passages),
    current: { title: current.docTitle || '', passages: passages.length, selections: selections.length, rows: rows.length },
    incoming: { title: incoming.docTitle || '', rows: incoming.rows.length },
    sentenceHits,
    sharedHeadwords,
  }
}

/**
 * 엑셀 시트에 보이는 칸만으로 만든 열쇠. 왕복에서 담지 않는 값(confidence 등)은 견주지 않는다.
 * 번호 칸은 줄 하나만 넘기므로 언제나 1이다 — 순서가 바뀐 것은 고친 것으로 치지 않는다.
 */
const visibleKey = (row) => JSON.stringify(toRowObjects([row])[0])

/**
 * 지금 표와 불러온 표의 차이. 같은 줄은 id 로 알아본다 (_meta 에 담겨 왕복한다).
 * @returns {{changed, added, removed}}
 */
export function compareRows(before, after) {
  const prev = new Map(before.map((r) => [r.id, visibleKey(r)]))
  let changed = 0
  let added = 0
  for (const r of after) {
    if (!prev.has(r.id)) added += 1
    else if (prev.get(r.id) !== visibleKey(r)) changed += 1
  }
  const ids = new Set(after.map((r) => r.id))
  const removed = before.filter((r) => !ids.has(r.id)).length
  return { changed, added, removed }
}

/** 브라우저에서 고른 파일 → 앱 상태 */
export async function readWordbook(file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  return parseWorkbook(wb)
}
