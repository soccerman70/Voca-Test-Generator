/**
 * 3단계 표의 칸 폭을 글자 폭을 재서 정한다.
 *
 * 예전에는 칸마다 고정 폭(표제어 156px, 품사 46px …)이었다. 그러면 `lose track of time` 같은 어구가
 * 두 줄로 꺾이고, 품사 칸은 입력칸 안쪽이 16px 남짓이라 "명 · 형" 이 반쯤 잘렸다. 칸에 들어갈 글을
 * 실제 글꼴로 재서, 가장 긴 것이 한 줄에 들어갈 만큼 주되 상한을 둔다(상한을 넘는 것만 꺾인다).
 * 출처 문장 칸은 폭을 정하지 않아 남는 자리를 모두 받는다.
 *
 * 글자 폭을 재는 함수(measure)는 밖에서 받는다 — 화면에서는 canvas, 스모크 테스트에서는 가짜를 쓴다.
 */

import { formatDerivatives, formatWords } from './exportXlsx.js'

/**
 * 표 본문 글꼴. global.css 의 --font-serif 와 같은 목록이어야 잰 폭과 그려진 폭이 맞는다.
 * Lora 에는 한글이 없어 한글은 다음 글꼴(Korean Adjusted → Pretendard → 맑은 고딕)이 그린다.
 */
export const SERIF_STACK = '"Lora Variable", Lora, "Korean Adjusted", Pretendard, "Malgun Gothic", serif'

/** 원형으로 바뀐 표제어 밑 메모(.norm-note)의 글꼴 — 한글이 섞여 UI 글꼴이다 */
const SANS_STACK = '"Inter Variable", Inter, "Korean Adjusted", Pretendard, "Malgun Gothic", sans-serif'

export const TABLE_FONTS = {
  headword: `600 15px ${SERIF_STACK}`,
  cell: `400 14px ${SERIF_STACK}`,
  note: `500 11px ${SANS_STACK}`,
}

/**
 * 칸 안쪽 여백(12 + 12, CSS 의 --s-sm) + 입력칸 여백(6 + 6) + 테두리(1 + 1).
 * 포커스 때 테두리가 2px 이 되어도 여백이 1px 줄어 같다. CSS 의 칸 여백을 바꾸면 여기도 바꾼다.
 */
const PAD = 38
/** 글꼴 렌더링 차이를 덮는 여유 — 모자라면 마지막 글자 하나가 다음 줄로 넘어간다 */
const SAFE = 8

/**
 * 칸 정의. fixed 는 고정 폭, 나머지는 rows 의 글을 재서 [min, max] 사이로 정한다.
 * width 가 없는 칸(sentence)은 남는 폭을 받는다.
 * wraps 인 칸은 꺾여도 되는 칸이다 — 표가 화면보다 넓어지면 이 칸들을 min 까지 줄인다.
 * 표제어는 한 줄이어야 하므로 줄이지 않는다.
 */
export const COLUMNS = [
  { key: 'num', label: '번호', fixed: 46 },
  // 표제어와, 원형으로 바뀌었으면 그 밑 메모(immersed → 수동태 과거분사)까지 한 줄에 들어가게 잰다
  {
    key: 'headword',
    label: '표제어',
    font: 'headword',
    min: 120,
    max: 340,
    texts: (r) => [r.headword, r.normalizationNote && { text: `${r.surface} → ${r.normalizationNote}`, font: 'note' }],
  },
  // 품사는 한 글자다. 입력칸 안쪽이 한글 한 글자보다 넉넉해야 잘리지 않는다
  { key: 'pos', label: '품사', fixed: 58 },
  { key: 'meaning', label: '뜻', font: 'cell', min: 110, max: 220, wraps: true, texts: (r) => [r.meaning] },
  {
    key: 'derivatives',
    label: '파생어',
    font: 'cell',
    min: 140,
    max: 300,
    wraps: true,
    texts: (r) => formatDerivatives(r.derivatives).split('\n'),
  },
  {
    key: 'synonyms',
    label: '유의어',
    font: 'cell',
    min: 120,
    max: 240,
    wraps: true,
    texts: (r) => [formatWords(r.synonyms)],
  },
  {
    key: 'antonyms',
    label: '반의어',
    font: 'cell',
    min: 110,
    max: 220,
    wraps: true,
    texts: (r) => [formatWords(r.antonyms)],
  },
  { key: 'source', label: '출처', fixed: 58 },
  // 남는 폭을 받는 칸. 화면이 좁으면 먼저 min 까지 줄고, 그래도 넘치면 꺾여도 되는 칸이 준다.
  // 그래도 넘치면 마지막으로 floor 까지 더 준다 — 짧은 낱말로 된 문장이라 좁아도 읽힌다
  { key: 'sentence', label: '출처 문장', min: 280, floor: 200 },
  { key: 'del', label: '', fixed: 40 },
]

/**
 * @param {Array} rows 표의 줄
 * @param {(text: string, font: string) => number} measure 글 한 줄의 폭(px)
 * @param {number} [available] 표가 쓸 수 있는 폭(px). 모르면 줄이지 않는다
 * @returns {{ widths: Record<string, number>, minTable: number }}
 *   widths 에는 폭을 정하는 칸만 들어 있다(sentence 는 없다). minTable 은 표의 최소 폭이다.
 */
export function columnWidths(rows, measure, available = Infinity) {
  const widths = {}
  // 꺾여도 되는 칸을 줄일 때의 하한. 그 칸에서 가장 긴 낱말 하나는 한 줄에 들어가야 한다 —
  // 그보다 좁히면 `comprehensi / vely` 처럼 낱말 중간에서 잘린다.
  const floors = {}
  const fit = (w) => w + PAD + SAFE
  for (const col of COLUMNS) {
    if (col.fixed) {
      widths[col.key] = col.fixed
      continue
    }
    if (!col.texts) continue
    let longest = 0
    let longestWord = 0
    for (const row of rows) {
      // 글 하나는 문자열(칸 글꼴로 잰다)이거나 { text, font }(다른 글꼴로 잰다)다
      for (const item of col.texts(row)) {
        const { text, font } = typeof item === 'object' && item ? item : { text: item, font: col.font }
        if (!text) continue
        longest = Math.max(longest, measure(String(text), TABLE_FONTS[font]))
        if (col.wraps) {
          for (const word of String(text).split(/\s+/)) {
            if (word) longestWord = Math.max(longestWord, measure(word, TABLE_FONTS[font]))
          }
        }
      }
    }
    widths[col.key] = Math.round(Math.min(col.max, Math.max(col.min, fit(longest))))
    if (col.wraps) floors[col.key] = Math.min(widths[col.key], Math.max(col.min, Math.round(fit(longestWord))))
  }
  const rest = COLUMNS.find((c) => !(c.key in widths))
  let restMin = rest?.min || 0
  const total = () => Object.values(widths).reduce((a, b) => a + b, 0) + restMin

  /*
   * 화면보다 넓으면 꺾여도 되는 칸을 넘친 만큼 줄인다. 각 칸이 하한 위로 가진 여유에 비례해 나눠 줄여,
   * 긴 글이 있는 칸일수록 많이 내준다. 다 줄여도 넘치면 그만큼은 가로로 밀어 본다.
   */
  const excess = total() - available
  if (excess > 0) {
    const flex = COLUMNS.filter((c) => c.wraps)
    const room = flex.reduce((sum, c) => sum + (widths[c.key] - floors[c.key]), 0)
    if (room > 0) {
      const ratio = Math.min(1, excess / room)
      for (const c of flex) {
        widths[c.key] = Math.floor(widths[c.key] - (widths[c.key] - floors[c.key]) * ratio)
      }
    }
    // 꺾여도 되는 칸을 다 줄여도 넘치면 남는 폭을 받는 칸(출처 문장)을 floor 까지 더 줄인다
    const still = total() - available
    if (still > 0 && rest?.floor) restMin = Math.max(rest.floor, restMin - still)
  }
  return { widths, minTable: total() }
}

/** 글자 폭을 재는 숨은 상자. 화면에 그리는 것과 같은 CSS 로 재야 폭이 맞는다. */
let probe = null

/**
 * 화면용 글자 폭 재기 — 숨은 span 에 실제로 그려서 잰다.
 *
 * canvas 의 measureText 는 쓰지 않는다. 한글은 size-adjust(92%)를 건 'Korean Adjusted' 로 그리는데
 * canvas 는 그 보정과 대체 글꼴 순서를 화면과 똑같이 따르지 않아, 한글 뜻이 실제보다 좁게 재졌다.
 * 그러면 칸이 모자라 "시간 가는 줄 모르다" 의 끝이 다음 줄로 넘어간다.
 *
 * 같은 글을 다시 재지 않도록 기억해 둔다 — 칸을 고칠 때마다 표 전체를 다시 재지만 새로 재는 것은 바뀐 글뿐이다.
 * 글꼴이 아직 안 받아졌으면 대체 글꼴로 재므로, 글꼴을 받은 뒤 새로 만들어 다시 재야 한다.
 */
export function domMeasure() {
  if (typeof document === 'undefined') return (text) => text.length * 8
  if (!probe) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;white-space:pre;pointer-events:none'
    document.body.appendChild(probe)
  }
  const cache = new Map()
  return (text, font) => {
    const key = `${font}\u0000${text}`
    if (!cache.has(key)) {
      const span = document.createElement('span')
      span.style.font = font
      span.textContent = text
      probe.appendChild(span)
      cache.set(key, span.getBoundingClientRect().width)
      span.remove()
    }
    return cache.get(key)
  }
}

/** 표 글꼴을 받아 둔다. 받은 뒤에 재야 Lora 의 실제 폭이 나온다. */
export function loadTableFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve()
  return Promise.all([
    document.fonts.load('600 15px "Lora Variable"', 'Aa'),
    document.fonts.load('400 14px "Lora Variable"', 'Aa'),
    document.fonts.load('14px "Korean Adjusted"', '가'),
  ]).catch(() => {})
}
