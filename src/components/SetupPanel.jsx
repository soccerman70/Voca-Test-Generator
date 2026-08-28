import { useCallback, useEffect, useRef, useState } from 'react'
import { extractText, fileKind } from '../lib/textExtract.js'
import { splitMultiple, mergePassages, removePassage } from '../lib/passages.js'
import { downloadText } from '../lib/exportXlsx.js'
import { readWordbook } from '../lib/importXlsx.js'
import { checkHealth } from '../lib/aiClient.js'
import { useStore, DOC_TITLE_MAX } from '../store.js'
import WorkflowBanner from './WorkflowBanner.jsx'

const SPLIT_LABEL = {
  marker: '지문 번호 표시를 기준으로 나눴습니다',
  heuristic: '한글 해석 위치를 기준으로 나눴습니다',
  single: '나눌 기준을 찾지 못해 하나의 지문으로 두었습니다',
}

/** 어떤 번호 표기를 기준으로 잡았는지 알려주면, 잘못 잡았을 때 바로 눈치챌 수 있다. */
const STYLE_SAMPLE = {
  bracket: '[1]',
  'ko-no': '1번',
  dot: '1.',
  paren: '1)',
}

/** 파일마다 한 번만 붙는 열쇠. 지문 id 가 여기서 나오므로 파일이 살아 있는 동안 변하지 않는다. */
let sourceSeq = 0
const nextSourceKey = () => `f${Date.now().toString(36)}${(sourceSeq += 1).toString(36)}`

function styleLabel(style) {
  if (!style) return ''
  const [kind, detail] = style.split(':')
  if (kind === 'word') return ` (${detail} 1 형식)`
  if (kind === 'ko-ordinal') return ` (제1${detail} 형식)`
  return STYLE_SAMPLE[kind] ? ` (${STYLE_SAMPLE[kind]} 형식)` : ''
}

export default function SetupPanel() {
  const {
    passages,
    targetCount,
    mode,
    model,
    docTitle,
    sourceFiles,
    rows,
    selections,
    loadPassages,
    loadWordbook,
    setPassages,
    setTargetCount,
    setDocTitle,
    setMode,
    setModel,
    setStep,
  } = useStore()

  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  // 읽어들인 파일들. PDF는 변환 결과를 사람이 손본 뒤에 넘기므로 여기서 한 번 멈춘다.
  // [{ name, kind, text, pageCount, needsReview }]
  const [drafts, setDrafts] = useState(null)
  const [textDraft, setTextDraft] = useState(null) // 붙여넣기 입력창 내용. null이면 닫힌 상태
  // 불러온 단어장. PDF 변환과 같은 이유로 여기서 한 번 멈춘다 — 무엇이 들어왔는지 보고 넘긴다.
  // { name, rows, passages, docTitle, warnings }
  const [imported, setImported] = useState(null)
  const [health, setHealth] = useState(null)
  const inputRef = useRef(null)
  const wordbookRef = useRef(null)

  useEffect(() => {
    checkHealth().then(setHealth)
  }, [])

  /**
   * 파일 목록 전체를 다시 나눠 담는다. 꼬리표와 번호가 파일 구성에 따라 달라지므로
   * 하나를 더하거나 뺄 때도 부분 갱신이 아니라 전체를 다시 계산한다.
   * @param {Array<{key?: string, name: string, text: string}>} sources
   */
  const ingest = useCallback(
    (sources) => {
      const { passages: found, files } = splitMultiple(sources)
      if (!found.length) {
        setError('영어 지문을 찾지 못했습니다. 파일 내용을 확인해주세요.')
        return
      }
      loadPassages({ passages: found, sourceFiles: files })
      setDrafts(null)
      setTextDraft(null)
      setError('')
    },
    [loadPassages]
  )

  /** 이미 올린 파일 뒤에 새 파일을 더한다. 갈아끼우지 않는다. */
  const handleFiles = useCallback(
    async (fileList) => {
      const picked = [...(fileList || [])]
      if (!picked.length) return
      setError('')

      const already = new Set(sourceFiles.map((f) => f.name))
      const fresh = picked.filter((f) => !already.has(f.name))
      const skipped = picked.length - fresh.length
      if (!fresh.length) {
        setError(`${picked.map((f) => f.name).join(', ')} 은(는) 이미 올린 파일입니다.`)
        return
      }

      try {
        const added = []
        for (const [i, file] of fresh.entries()) {
          const of = fresh.length > 1 ? ` (${i + 1}/${fresh.length})` : ''
          setBusy({ label: `${file.name} 읽는 중…${of}` })
          const kind = fileKind(file)
          const result = await extractText(file, ({ page, total }) =>
            setBusy({ label: `${file.name} PDF 텍스트 변환 중… ${page}/${total} 쪽${of}` })
          )
          added.push({
            key: nextSourceKey(),
            name: file.name,
            kind,
            text: result.text,
            pageCount: result.pageCount,
            // PDF는 줄바꿈이 어긋나기 쉬워 눈으로 확인시킨 뒤 넘긴다
            needsReview: kind === 'pdf',
          })
        }
        if (skipped) setError(`이미 올린 파일 ${skipped}개는 건너뛰었습니다.`)
        // 새로 넣은 PDF만 검토 대상이다. 이미 확정된 파일은 손대지 않는다.
        if (added.some((s) => s.needsReview)) setDrafts(added)
        else ingest([...sourceFiles, ...added])
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy(null)
      }
    },
    [ingest, sourceFiles]
  )

  /** 이미 만든 단어장 XLSX 를 읽는다. 바로 넘기지 않고 무엇이 들어왔는지 먼저 보여준다. */
  const handleWordbook = async (file) => {
    if (!file) return
    setError('')
    setImported(null)
    try {
      setBusy({ label: `${file.name} 읽는 중…` })
      const parsed = await readWordbook(file)
      setImported({ name: file.name, ...parsed })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const applyWordbook = () => {
    // 지문 입력·표제어 선택을 거치지 않는 경로라 지금까지의 작업이 전부 밀린다
    const working = rows.length || selections.length || sourceFiles.length
    if (working && !confirm('지금까지의 지문·표제어·단어장을 지우고 불러온 단어장으로 바꿀까요?')) return
    loadWordbook({ rows: imported.rows, passages: imported.passages, docTitle: imported.docTitle })
  }

  const removeSource = (key) => {
    const rest = sourceFiles.filter((f) => f.key !== key)
    // 마지막 파일을 빼면 지문만 비운다. 제목·개수 같은 설정까지 날릴 이유는 없다.
    if (rest.length) ingest(rest)
    else loadPassages({ passages: [], sourceFiles: [] })
    setError('')
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const patchDraft = (i, text) => setDrafts((list) => list.map((d, j) => (j === i ? { ...d, text } : d)))

  return (
    <div className="setup">
      <div className="setup-inner">
        <WorkflowBanner />

        {/* 1. 파일 입력 */}
        <div
          className={`dropzone${dragOver ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".docx,.pdf,.txt"
            multiple
            hidden
            onChange={(e) => {
              handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
          {busy ? (
            <>
              <div className="dz-icon">
                <span className="spinner dark" style={{ display: 'inline-block' }} />
              </div>
              <div className="dz-text">
                <div className="dz-main">{busy.label}</div>
              </div>
            </>
          ) : (
            <>
              <div className="dz-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M13.5 3v4.5a1 1 0 0 0 1 1H19" />
                  <path d="M19 9.2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6.3L19 9.2Z" />
                  <path d="M8.75 13.5h6.5M8.75 17h4" />
                </svg>
              </div>
              <div className="dz-text">
                <div className="dz-main">
                  {sourceFiles.length
                    ? `파일을 더 끌어다 놓으면 뒤에 추가됩니다 (현재 ${sourceFiles.length}개)`
                    : '지문 파일을 여기에 끌어다 놓거나 클릭해서 고르세요'}
                </div>
                <div className="dz-sub">
                  {sourceFiles.length
                    ? '이미 올린 파일은 그대로 두고 새 파일의 지문만 뒤에 붙입니다'
                    : '여러 개를 한 번에 올릴 수 있습니다 · .docx 권장 · .pdf 는 텍스트 변환 후 사용 · .txt 도 가능'}
                </div>
              </div>
              {/* 드롭존 전체가 파일 선택 버튼이므로 클릭이 위로 번지지 않게 막는다 */}
              <button
                className="btn sm dz-paste"
                onClick={(e) => {
                  e.stopPropagation()
                  setTextDraft('')
                }}
              >
                텍스트 붙여넣기
              </button>
            </>
          )}
        </div>

        {/* 이미 만든 단어장이 있으면 ①②③ 을 건너뛴다 */}
        <div className="setup-alt">
          <span>이미 만들어 둔 단어장이 있나요?</span>
          <input
            ref={wordbookRef}
            type="file"
            accept=".xlsx"
            hidden
            onChange={(e) => {
              handleWordbook(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <button className="btn ghost sm" disabled={Boolean(busy)} onClick={() => wordbookRef.current?.click()}>
            단어장 불러와서 시험지 만들기
          </button>
        </div>

        {error && <div className="error-box">{error}</div>}

        {/* 불러온 단어장 확인 */}
        {imported && (
          <div className="panel">
            <div className="panel-title">
              불러온 단어장
              <span className="count-pill">표제어 {imported.rows.length}개</span>
            </div>
            <div className="import-body">
              <p className="hint">
                {imported.name}
                {imported.docTitle && ` · 제목 “${imported.docTitle}”`}
                {imported.passages.length
                  ? ` · 지문 ${imported.passages.length}개도 함께 들어 있습니다`
                  : ' · 지문은 들어 있지 않습니다'}
              </p>

              {!imported.passages.length && (
                <p className="hint">
                  지문이 없어 PART IV 는 <strong>출처 문장 하나만</strong> 씁니다. 앞뒤 문장을 붙이지는 못하지만
                  시험지는 그대로 만들어집니다.
                </p>
              )}

              {imported.warnings.metaMissing && (
                <p className="hint">
                  형태 정보가 없는 예전 파일입니다. 출처 문장에서 되짚어
                  <strong> {imported.warnings.recovered.length}개</strong>를 찾았습니다.
                </p>
              )}

              {imported.warnings.failed.length > 0 && (
                <div className="notice-box">
                  <strong>{imported.warnings.failed.length}개</strong>는 지문에 나온 형태를 찾지 못해 표제어를 그대로
                  씁니다 — PART IV 의 형태 다양성이 그만큼 줄어듭니다.
                  <div className="import-failed">{imported.warnings.failed.join(' · ')}</div>
                </div>
              )}

              <div className="import-actions">
                <button className="btn primary" onClick={applyWordbook}>
                  이 단어장으로 시험지 만들기 →
                </button>
                <button className="btn ghost" onClick={() => setImported(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 2. PDF 변환 결과 확인 (특별 기능) */}
        {drafts && (
          <div className="panel pdf-panel">
            <div className="panel-title">
              PDF 텍스트 변환 결과
              <span className="count-pill">{drafts.filter((d) => d.needsReview).length}개 파일</span>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p className="hint" style={{ margin: 0 }}>
                PDF는 줄바꿈 정보가 정확하지 않을 수 있습니다. 아래에서 직접 고친 뒤 지문으로 넘기세요. 지문 사이는
                빈 줄로 띄우거나 <strong>1. 2. 3.</strong> 같은 번호를 붙이면 더 정확히 나뉩니다.
                {drafts.length > 1 && ' 파일별로 따로 나누므로 번호가 겹쳐도 괜찮습니다.'}
              </p>
              {drafts.map((d, i) =>
                d.needsReview ? (
                  <div key={d.name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="draft-head">
                      <span className="pno-badge">{d.name}</span>
                      <span className="hint">{d.pageCount}쪽</span>
                      <button
                        className="btn ghost sm"
                        onClick={() => downloadText(d.text, d.name.replace(/\.pdf$/i, '') + '.txt')}
                      >
                        TXT로 저장
                      </button>
                    </div>
                    <textarea value={d.text} onChange={(e) => patchDraft(i, e.target.value)} spellCheck={false} />
                  </div>
                ) : (
                  <p key={d.name} className="hint" style={{ margin: 0 }}>
                    {d.name} — 변환 없이 그대로 씁니다.
                  </p>
                )
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" onClick={() => ingest([...sourceFiles, ...drafts])}>
                  이 텍스트로 지문 만들기
                </button>
                <button className="btn ghost" onClick={() => setDrafts(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 2-b. 붙여넣은 텍스트 확인 */}
        {textDraft !== null && (
          <div className="panel paste-panel">
            <div className="panel-title">텍스트 붙여넣기</div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p className="hint" style={{ margin: 0 }}>
                복사한 지문을 아래에 붙여넣으세요. 지문 사이는 빈 줄로 띄우거나 <strong>1. 2. 3.</strong> 같은 번호를
                붙이면 더 정확히 나뉩니다.
              </p>
              <textarea
                autoFocus
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder="여기에 붙여넣기 (Ctrl+V)"
                spellCheck={false}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn primary"
                  disabled={!textDraft.trim()}
                  onClick={() =>
                    ingest([
                      ...sourceFiles,
                      { key: nextSourceKey(), name: pasteName(sourceFiles), kind: 'txt', text: textDraft },
                    ])
                  }
                >
                  이 텍스트로 지문 만들기
                </button>
                <button className="btn ghost" onClick={() => setTextDraft(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. 지문 미리보기 */}
        {passages.length > 0 && (
          <div className="panel">
            <div className="panel-title">
              지문 확인
              <span className="count-pill">{passages.length}개</span>
            </div>
            <div style={{ padding: '10px 14px 0' }}>
              {sourceFiles.length > 1 && (
                <p className="hint" style={{ margin: '0 0 4px' }}>
                  파일 {sourceFiles.length}개를 각각 나눴습니다. 파일마다 번호가 1부터 다시 시작하므로 지문 번호 앞에
                  파일 꼬리표를 붙여 구별합니다.
                </p>
              )}
              {sourceFiles.map((f) => (
                <p className="hint source-line" key={f.key}>
                  {sourceFiles.length > 1 && <strong>{f.tag}</strong>}
                  <span>
                    {f.name} · 지문 {f.count}개 · {SPLIT_LABEL[f.method] || ''}
                    {styleLabel(f.markerStyle)}
                  </span>
                  <button
                    className="btn ghost sm"
                    title="이 파일의 지문을 모두 뺍니다"
                    onClick={() => removeSource(f.key)}
                  >
                    파일 빼기
                  </button>
                </p>
              ))}
              <p className="hint" style={{ margin: '4px 0 0' }}>
                잘못 나뉜 지문은 아래에서 합치거나 지우세요.
              </p>
            </div>
            <div className="passage-preview-list">
              {passages.map((p, i) => (
                <div className="passage-preview" key={p.id}>
                  <header>
                    <span className="pp-no pno-badge">지문 {p.label}</span>
                    <span className="pp-meta">
                      {sourceFiles.length > 1 ? `${p.source} · ` : ''}
                      {countWords(p.english)} 단어{p.korean ? ' · 해석 있음' : ' · 해석 없음'}
                    </span>
                    <span className="pp-actions">
                      {/* 다른 파일의 지문과는 합치지 않는다 — 단원이 섞여버린다 */}
                      {i > 0 && passages[i - 1].sourceTag === p.sourceTag && (
                        <button className="btn ghost sm" onClick={() => setPassages(mergePassages(passages, i))}>
                          ↑ 위와 합치기
                        </button>
                      )}
                      <button className="btn ghost sm" onClick={() => setPassages(removePassage(passages, i))}>
                        삭제
                      </button>
                    </span>
                  </header>
                  <p>{p.english}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. 설정 */}
        {passages.length > 0 && (
          <div className="panel">
            <div className="panel-title">단어장 설정</div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="field">
                <label htmlFor="doc-title">
                  단어장 · 시험지 제목
                  <span className="field-count">
                    {docTitle.length} / {DOC_TITLE_MAX}
                  </span>
                </label>
                <input
                  id="doc-title"
                  type="text"
                  className="title-input"
                  maxLength={DOC_TITLE_MAX}
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="예) 2026 여름학기 · Week 3 · 어휘심화 SET B"
                />
                <span className="hint">
                  엑셀 첫 줄, 시험지 머리글, 내려받는 파일 이름에 들어갑니다. 비워두면 기본 제목을 씁니다.
                </span>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="target">총 표제어 개수</label>
                  <input
                    id="target"
                    type="number"
                    min={1}
                    max={500}
                    value={targetCount}
                    onChange={(e) => setTargetCount(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label>표제어 선택 방식</label>
                  <div className="mode-toggle">
                    <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>
                      직접 선택
                    </button>
                    <button className={mode === 'ai' ? 'on' : ''} onClick={() => setMode('ai')}>
                      AI 자동 추출
                    </button>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="model">AI 모델</label>
                  <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="claude-sonnet-5">Sonnet 5 (속도 우선)</option>
                    <option value="claude-opus-5">Opus 5 (정확도 우선)</option>
                  </select>
                </div>
              </div>

              <p className="hint" style={{ margin: 0 }}>
                {mode === 'manual'
                  ? '지문에서 단어를 클릭하거나 드래그해 표제어를 직접 고릅니다. 카드를 자유롭게 오가며 다시 클릭하면 선택이 해제됩니다.'
                  : `AI가 지문 전체에서 학습 가치가 높은 표현 ${targetCount}개를 골라 표시합니다. 그 뒤 직접 더하거나 뺄 수 있습니다.`}
              </p>

              <HealthLine health={health} />

              <div>
                <button className="btn primary cta" onClick={() => setStep('select')}>
                  {mode === 'manual' ? '표제어 선택 시작' : 'AI 추출 화면으로'} →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function HealthLine({ health }) {
  if (!health) return <p className="hint" style={{ margin: 0 }}>AI 연결 확인 중…</p>
  if (health.ok) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        ✅ Claude Code 구독 연결됨 ({health.version}) — API 키 없이 이 PC의 로그인 계정으로 생성합니다.
      </p>
    )
  }
  return (
    <div className="notice-box">
      ⚠️ Claude Code CLI를 찾지 못했습니다{health.error ? ` (${health.error})` : ''}. AI 자동 추출과 단어장 생성이
      동작하지 않습니다. 터미널에서 <strong>claude --version</strong> 이 실행되는지 확인해주세요.
    </div>
  )
}

/** 붙여넣기를 여러 번 해도 이름이 겹치지 않게 한다 (이름이 겹치면 추가가 막힌다). */
function pasteName(sourceFiles) {
  const n = sourceFiles.filter((f) => f.name.startsWith('붙여넣은 텍스트')).length
  return n ? `붙여넣은 텍스트 ${n + 1}` : '붙여넣은 텍스트'
}

function countWords(text) {
  return (text.match(/[A-Za-z0-9]+/g) || []).length
}
