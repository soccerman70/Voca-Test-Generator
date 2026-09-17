/**
 * claude-bridge — Vite 개발 서버 미들웨어
 *
 * 브라우저에서 온 요청을 받아 로컬에 설치된 Claude Code CLI를
 * 헤드리스 모드(claude -p)로 실행하고 결과 JSON을 돌려준다.
 * Anthropic API 키 없이 현재 로그인된 구독 계정으로 동작한다.
 *
 * 나중에 웹 배포로 옮길 경우 이 파일만 API 키 방식으로 교체하면 된다.
 */

import { spawn } from 'node:child_process'
import { buildSelectPrompt, buildEnrichPrompt } from './prompts.js'
import {
  buildPartIIPrompt,
  buildPartIIIPrompt,
  buildPartVPrompt,
  buildPartVIPrompt,
} from './quizPrompts.js'

const IS_WIN = process.platform === 'win32'
const CLAUDE_BIN = process.env.CLAUDE_BIN || (IS_WIN ? 'claude.cmd' : 'claude')

// Windows에서는 셸을 거쳐 실행되므로 인자로 나가는 값은 반드시 허용 목록으로 막는다.
const ALLOWED_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']
const DEFAULT_MODEL = 'claude-sonnet-5'

function safeModel(model) {
  return ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL
}

/** 한 번의 헤드리스 호출. 프롬프트는 stdin으로 넘겨 인자 따옴표 문제를 피한다. */
function runClaude(prompt, { model = DEFAULT_MODEL, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      safeModel(model),
      '--strict-mcp-config',
      '--exclude-dynamic-system-prompt-sections',
    ]

    const child = spawn(CLAUDE_BIN, args, {
      shell: IS_WIN, // Windows의 claude.cmd 는 셸을 통해야 실행된다
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`Claude 호출이 ${Math.round(timeoutMs / 1000)}초를 초과했습니다.`))
    }, timeoutMs)

    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`Claude CLI를 실행할 수 없습니다 (${CLAUDE_BIN}): ${err.message}`))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (code !== 0) {
        return reject(new Error(`Claude CLI 종료 코드 ${code}\n${stderr.slice(0, 800)}`))
      }

      let envelope
      try {
        envelope = JSON.parse(stdout)
      } catch {
        return reject(new Error(`CLI 응답을 해석할 수 없습니다:\n${stdout.slice(0, 800)}`))
      }

      if (envelope.is_error) {
        return reject(new Error(`Claude 오류: ${envelope.result || envelope.subtype}`))
      }

      resolve({
        text: envelope.result ?? '',
        usage: envelope.usage ?? null,
        durationMs: envelope.duration_ms ?? null,
        model,
      })
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

/** 모델이 코드펜스나 잡담을 섞어 보내도 JSON 객체를 건져낸다. */
function parseJsonLoose(text) {
  const trimmed = String(text).trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    /* 아래 폴백으로 진행 */
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      /* 계속 */
    }
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      /* 계속 */
    }
  }

  throw new Error(`JSON을 찾을 수 없습니다:\n${trimmed.slice(0, 800)}`)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 20_000_000) {
        reject(new Error('요청 본문이 너무 큽니다.'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(new Error(`요청 JSON 파싱 실패: ${err.message}`))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

/* ------------------------------------------------------------------ */
/* 라우트                                                              */
/* ------------------------------------------------------------------ */

const routes = {
  /** CLI가 설치돼 있고 호출 가능한지 확인 */
  async health() {
    const version = await new Promise((resolve) => {
      const child = spawn(CLAUDE_BIN, ['--version'], { shell: IS_WIN, windowsHide: true })
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      child.on('error', () => resolve(null))
      child.on('close', () => resolve(out.trim() || null))
    })
    return { ok: Boolean(version), version, bin: CLAUDE_BIN }
  },

  /** AI 자동 표제어 추출 */
  async select(body) {
    const { passages, model, exclude } = body
    if (!Array.isArray(passages) || !passages.length) throw new Error('지문이 없습니다.')
    // 지문별 목표 개수(quota)는 클라이언트가 분량 비례로 계산해 실어 보낸다.
    const quoted = passages
      .map((p) => ({ no: Number(p.no), english: String(p.english || ''), quota: Math.round(Number(p.quota) || 0) }))
      .filter((p) => p.english.trim() && p.quota > 0)
    if (!quoted.length) throw new Error('표제어 개수가 올바르지 않습니다.')

    const prompt = buildSelectPrompt({
      passages: quoted,
      exclude: Array.isArray(exclude) ? exclude.slice(0, 400) : [],
    })
    const { text, usage, durationMs } = await runClaude(prompt, { model })
    const parsed = parseJsonLoose(text)

    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      usage,
      durationMs,
    }
  },

  /**
   * 시험지 한 PART 생성. II·III·V·VI 만 AI 가 필요하다.
   * PART 마다 따로 부르는 것은 넷을 동시에 돌리기 위해서다.
   */
  async quiz(body) {
    const { part, payload, model } = body
    const build = {
      II: buildPartIIPrompt,
      III: buildPartIIIPrompt,
      V: buildPartVPrompt,
      VI: buildPartVIPrompt,
    }[String(part)]

    if (!build) throw new Error(`알 수 없는 PART: ${part}`)
    if (!payload) throw new Error('PART 재료가 없습니다.')

    const { text, usage, durationMs } = await runClaude(build(payload), { model })
    return { part, result: parseJsonLoose(text), usage, durationMs }
  },

  /** 표제어 정규화 + 파생어/유의어/반의어 생성 (한 배치) */
  async enrich(body) {
    const { items, antonymTargetRatio, model } = body
    if (!Array.isArray(items) || !items.length) throw new Error('항목이 없습니다.')

    const prompt = buildEnrichPrompt({ items, antonymTargetRatio })
    const { text, usage, durationMs } = await runClaude(prompt, { model })
    const parsed = parseJsonLoose(text)

    return {
      results: Array.isArray(parsed.results) ? parsed.results : [],
      usage,
      durationMs,
    }
  },
}

export function claudeBridge() {
  return {
    name: 'claude-bridge',
    configureServer(server) {
      server.middlewares.use('/api/ai', async (req, res, next) => {
        const route = (req.url || '/').split('?')[0].replace(/^\/+|\/+$/g, '')
        const handler = routes[route]
        if (!handler) return next()

        try {
          const body = req.method === 'POST' ? await readBody(req) : {}
          const startedAt = Date.now()
          const result = await handler(body)

          // 어디에 시간이 쓰이는지는 추측으로 알 수 없다. 왕복 시간과 토큰을 남겨 근거로 삼는다.
          if (result?.usage) {
            const u = result.usage
            const wall = ((Date.now() - startedAt) / 1000).toFixed(1)
            const out = u.output_tokens || 0
            server.config.logger.info(
              `[claude-bridge] ${route} ${wall}s · 입력 ${u.input_tokens || 0} · 출력 ${out}` +
                ` · 캐시읽기 ${u.cache_read_input_tokens || 0} · 캐시생성 ${u.cache_creation_input_tokens || 0}` +
                ` · ${(out / Math.max(Number(wall), 0.1)).toFixed(0)} tok/s`
            )
          }

          sendJson(res, 200, result)
        } catch (err) {
          server.config.logger.error(`[claude-bridge] ${route}: ${err.message}`)
          sendJson(res, 500, { error: err.message })
        }
      })
    },
  }
}
