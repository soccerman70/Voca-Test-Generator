// 구글 문서 · 드라이브 공개 링크에서 지문 파일을 받아오는 Vite 미들웨어

/**
 * 브라우저는 CORS 때문에 docs.google.com · drive.google.com 에서 직접 받지 못한다.
 * 이 서버가 대신 받아 바이트와 파일 이름만 돌려준다. 받은 파일은 브라우저에서
 * 직접 올린 파일과 같은 길(handleFiles)로 처리된다.
 *
 * 받은 주소를 그대로 열지 않는다. 링크에서 id 만 뽑아 구글 주소를 새로 만든다 —
 * 그래야 이 서버가 아무 주소나 대신 여는 통로가 되지 않는다.
 *
 * '링크가 있는 모든 사용자'로 공유된 것만 읽을 수 있다. 비공개 파일은 구글 로그인 연동이 필요하다.
 */

const ID = '[A-Za-z0-9_-]{10,}'
const MAX_BYTES = 20_000_000

const NOT_SHARED =
  '파일을 읽을 수 없습니다. 구글에서 공유 설정을 "링크가 있는 모든 사용자"로 바꾼 뒤 다시 시도해주세요.'
const UNKNOWN_LINK =
  '구글 문서(docs.google.com/document/…) 또는 구글 드라이브 파일(drive.google.com/file/…) 링크만 받을 수 있습니다.'

/**
 * 공유 링크 → { kind: 'doc' | 'file', id }. 알아볼 수 없으면 null.
 *  - 구글 문서    docs.google.com/document/d/{id}/edit…
 *  - 드라이브 파일 drive.google.com/file/d/{id}/view… · drive.google.com/open?id={id} · drive.google.com/uc?id={id}
 * 시트 · 슬라이드 · '웹에 게시' 링크(/d/e/…)는 지문 파일이 아니므로 받지 않는다.
 */
export function parseGoogleLink(input) {
  let url
  try {
    url = new URL(String(input).trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  if (url.hostname === 'docs.google.com') {
    const m = url.pathname.match(new RegExp(`^/document/(?:u/\\d+/)?d/(${ID})`))
    return m ? { kind: 'doc', id: m[1] } : null
  }

  if (url.hostname === 'drive.google.com') {
    const m = url.pathname.match(new RegExp(`^/(?:u/\\d+/)?file/d/(${ID})`))
    if (m) return { kind: 'file', id: m[1] }
    const q = url.searchParams.get('id') || ''
    if (/^\/(?:open|uc)$/.test(url.pathname) && new RegExp(`^${ID}$`).test(q)) return { kind: 'file', id: q }
  }

  return null
}

/**
 * 구글 문서는 docx 로 내보내 받는다. "파일 → 다운로드 → docx" 로 받아 올린 것과 똑같이 동작해야
 * 예측할 수 있다. 드라이브 파일은 원본 그대로 받는다.
 */
function downloadUrl({ kind, id }) {
  return kind === 'doc'
    ? `https://docs.google.com/document/d/${id}/export?format=docx`
    : `https://drive.google.com/uc?export=download&id=${id}`
}

/** Content-Disposition 에서 파일 이름을 꺼낸다. 한글 이름은 filename* (RFC 5987) 쪽에 담겨 온다. */
export function fileNameFrom(header) {
  const h = String(header || '')
  const star = h.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      /* 아래 filename= 으로 */
    }
  }
  const plain = h.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/i)
  return plain ? (plain[1] ?? plain[2]).trim() : ''
}

const EXT_BY_TYPE = {
  'text/plain': '.txt',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
}

/** 확장자로 형식을 가리므로 이름에 확장자가 없으면 응답 형식에서 붙인다. */
export function fileNameFor(kind, header, contentType) {
  const name = fileNameFrom(header) || (kind === 'doc' ? '구글 문서' : '구글 드라이브 파일')
  if (/\.(?:docx|pdf|txt|doc)$/i.test(name)) return name
  return name + (EXT_BY_TYPE[String(contentType).split(';')[0].trim()] || '')
}

async function downloadGoogleFile(input) {
  const link = parseGoogleLink(input)
  if (!link) throw new Error(UNKNOWN_LINK)

  const res = await fetch(downloadUrl(link), { redirect: 'follow' })
  const type = res.headers.get('content-type') || ''

  if (res.status === 404) throw new Error('파일을 찾을 수 없습니다. 링크가 맞는지 확인해주세요.')
  // 공유되지 않은 파일은 구글 로그인 페이지(HTML)로 넘어간다
  if (!res.ok || type.startsWith('text/html')) throw new Error(NOT_SHARED)

  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_BYTES) throw new Error('파일이 너무 큽니다 (20MB 초과).')

  return { name: fileNameFor(link.kind, res.headers.get('content-disposition'), type), type, bytes }
}

export function googleLink() {
  return {
    name: 'google-link',
    configureServer(server) {
      // GET /api/google?url=<공유 링크>
      server.middlewares.use('/api/google', async (req, res, next) => {
        if (req.method !== 'GET') return next()
        const url = new URL(req.url || '/', 'http://localhost').searchParams.get('url')

        try {
          const file = await downloadGoogleFile(url)
          res.statusCode = 200
          res.setHeader('Content-Type', file.type || 'application/octet-stream')
          // 한글 파일 이름이 헤더를 그대로 지나가지 못하므로 인코딩해 보낸다
          res.setHeader('X-File-Name', encodeURIComponent(file.name))
          res.setHeader('Cache-Control', 'no-store')
          res.end(file.bytes)
        } catch (err) {
          server.config.logger.error(`[google-link] ${err.message}`)
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}
