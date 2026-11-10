/**
 * 파일 → 평문 텍스트 추출
 *  - .docx : mammoth 브라우저 빌드로 서식 없는 텍스트 추출
 *  - .pdf  : pdf.js 로 페이지별 텍스트 추출 (특별 변환 기능)
 *  - .txt  : 그대로 읽음
 *  - 구글 링크 : dev 서버가 받아온 파일을 File 로 감싸 위와 똑같이 읽음
 */

import mammoth from 'mammoth/mammoth.browser.js'
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export function fileKind(file) {
  const name = (file?.name || '').toLowerCase()
  if (name.endsWith('.docx')) return 'docx'
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.txt')) return 'txt'
  if (name.endsWith('.doc')) return 'doc-legacy'
  return 'unknown'
}

export async function extractFromDocx(file) {
  const arrayBuffer = await file.arrayBuffer()
  const { value, messages } = await mammoth.extractRawText({ arrayBuffer })
  return {
    text: normalizeWhitespace(value),
    warnings: messages.filter((m) => m.type === 'warning').map((m) => m.message),
  }
}

/**
 * PDF 텍스트 변환.
 * pdf.js 의 텍스트 아이템에는 줄바꿈 정보가 없으므로 y좌표로 줄을 복원하고,
 * 줄 끝 하이픈으로 잘린 단어는 다시 붙인다.
 */
export async function extractFromPdf(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages = []

  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()

    const rows = new Map()
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue
      const y = Math.round(item.transform[5])
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y).push({ x: item.transform[4], str: item.str })
    }

    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0]) // 위에서 아래로
      .map(([, parts]) =>
        parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.str)
          .join('')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean)

    pages.push({ no: n, text: dehyphenate(lines).join('\n') })
    onProgress?.({ page: n, total: pdf.numPages })
  }

  return {
    text: normalizeWhitespace(pages.map((p) => p.text).join('\n\n')),
    pageCount: pdf.numPages,
    pages,
  }
}

export async function extractFromTxt(file) {
  return { text: normalizeWhitespace(await file.text()), warnings: [] }
}

export async function extractText(file, onProgress) {
  const kind = fileKind(file)
  switch (kind) {
    case 'docx':
      return { kind, ...(await extractFromDocx(file)) }
    case 'pdf':
      return { kind, ...(await extractFromPdf(file, onProgress)) }
    case 'txt':
      return { kind, ...(await extractFromTxt(file)) }
    case 'doc-legacy':
      throw new Error('구형 .doc 파일은 지원하지 않습니다. .docx 로 다시 저장한 뒤 올려주세요.')
    default:
      throw new Error('지원하지 않는 형식입니다. .docx, .pdf, .txt 만 올릴 수 있습니다.')
  }
}

/**
 * 구글 문서 · 드라이브 공개 링크 → File.
 * 브라우저는 구글에서 직접 받지 못해(CORS) dev 서버(/api/google)가 대신 받는다.
 * 돌려받은 File 은 직접 올린 파일과 똑같이 extractText 로 읽는다.
 */
export async function fetchGoogleFile(link) {
  const res = await fetch(`/api/google?url=${encodeURIComponent(link)}`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `구글 링크를 읽지 못했습니다 (${res.status})`)
  }
  const name = decodeURIComponent(res.headers.get('X-File-Name') || '구글 파일')
  return new File([await res.blob()], name, { type: res.headers.get('Content-Type') || '' })
}

/* ------------------------------------------------------------------ */

/** 줄 끝 하이픈으로 분리된 단어를 되붙인다. (interna-\ntional → international) */
function dehyphenate(lines) {
  const out = []
  for (const line of lines) {
    const prev = out[out.length - 1]
    if (prev && /[A-Za-z]-$/.test(prev) && /^[a-z]/.test(line)) {
      out[out.length - 1] = prev.replace(/-$/, '') + line
    } else {
      out.push(line)
    }
  }
  return out
}

// 눈에 보이지 않아 소스에 직접 쓰지 않는다: NBSP, 폭 없는 문자, BOM
const NBSP = new RegExp(String.fromCharCode(0xa0), 'g')
const ZERO_WIDTH = new RegExp(
  `[${[0x200b, 0x200c, 0x200d, 0xfeff].map((c) => String.fromCharCode(c)).join('')}]`,
  'g'
)

function normalizeWhitespace(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(NBSP, ' ')
    .replace(ZERO_WIDTH, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
