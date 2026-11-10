import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store.js'
import { downloadXlsx, formatDerivatives, formatWords, parseDerivatives } from '../lib/exportXlsx.js'
import { readWordbook, isSameWork, compareRows, compareWork } from '../lib/importXlsx.js'
import { filesLabel } from '../lib/passages.js'
import { confirmBeforeQuiz } from '../lib/quizGate.js'
import { COLUMNS, columnWidths, domMeasure, loadTableFonts } from '../lib/columnWidths.js'
import { headwordOverlaps } from '../lib/duplicates.js'
import ImportNotes from './ImportNotes.jsx'
import WorkCompare from './WorkCompare.jsx'

export default function ResultTable() {
  const {
    rows,
    antonymStats,
    lastUsage,
    model,
    sourceFiles,
    passages,
    selections,
    docTitle,
    confirmedAt,
    quizzes,
    setStep,
    updateRow,
    removeRow,
    restoreRows,
    replaceWordbook,
  } = useStore()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // 엑셀에서 고친 단어장. 바로 바꾸지 않고 무엇이 달라지는지 먼저 보여준다.
  const [imported, setImported] = useState(null)
  const [reading, setReading] = useState(false)
  const [appliedName, setAppliedName] = useState('')
  const fileRef = useRef(null)

  /*
   * 칸 폭은 글을 실제 글꼴(Lora)로 재서 정한다. 글꼴을 받기 전에는 대체 글꼴로 재므로,
   * 받은 뒤 재는 함수를 새로 만들어 한 번 더 잰다.
   */
  const [measure, setMeasure] = useState(() => domMeasure())
  useEffect(() => {
    let alive = true
    loadTableFonts().then(() => alive && setMeasure(() => domMeasure()))
    return () => {
      alive = false
    }
  }, [])
  // 표가 들어갈 폭. 표가 화면보다 넓어지면 꺾여도 되는 칸(뜻 · 파생어 · 유의어 · 반의어)을 줄인다
  const wrapRef = useRef(null)
  const [available, setAvailable] = useState(Infinity)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const read = () => setAvailable(el.clientWidth || Infinity)
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const cols = useMemo(() => columnWidths(rows, measure, available), [rows, measure, available])

  /*
   * 줄 지우기는 확인 창 없이 바로 하고, 몇 초 동안 되돌리기를 띄운다.
   * 지우면 만든 시험지까지 함께 지워지므로(NO_QUIZZES) 지우기 직전 모습을 통째로 들고 있다가 돌려놓는다.
   * 지운 뒤에 표가 또 바뀌면(칸을 고치거나 다른 줄을 지우면) 돌려놓을 모습이 지금과 어긋나므로
   * 그 순간 되돌리기는 사라진다 — 연달아 지우면 마지막 것만 되돌린다.
   */
  const [undo, setUndo] = useState(null) // { snapshot, after, label, quizCount }
  const liveUndo = undo && undo.after === rows ? undo : null
  useEffect(() => {
    if (!undo) return undefined
    const timer = setTimeout(() => setUndo(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [undo])

  const removeWithUndo = (row) => {
    const s = useStore.getState()
    const snapshot = { rows: s.rows, quizzes: s.quizzes, activeQuizId: s.activeQuizId, confirmedAt: s.confirmedAt }
    removeRow(row.id)
    setUndo({
      snapshot,
      after: useStore.getState().rows,
      label: row.headword || row.surface,
      quizCount: s.quizzes.length,
    })
  }

  // 표를 다 고쳤으면 다음 일은 시험지다. 헤더의 ④ 칩과 같은 점검을 거친다.
  const goQuiz = () => {
    if (confirmBeforeQuiz(rows)) setStep('quiz')
  }

  // 패널을 띄운 채 표를 더 고칠 수도 있으므로 지금 표와 매번 다시 견준다
  const diff = useMemo(
    () => (imported?.sameWork ? compareRows(rows, imported.rows) : null),
    [imported, rows]
  )
  // 다른 작업의 파일이면 무엇이 밀려나는지 견줘 보인다 (1단계 불러오기와 같은 상자)
  const comparison = useMemo(
    () => (imported && !imported.sameWork ? compareWork({ rows, selections, passages, docTitle }, imported) : null),
    [imported, rows, selections, passages, docTitle]
  )

  /*
   * 검수용 거르기. 칩마다 지금 해당하는 줄 수를 세고, 누르면 그 순간의 줄 목록을 고정해 보여준다.
   * 목록을 고정하는 이유 — "뜻 없음"으로 거른 채 뜻을 치면 그 줄이 조건에서 빠져 치는 도중에 사라진다.
   * 칩을 다시 누르면 지금 상태로 새로 거른다.
   */
  // 유의어 · 반의어가 다른 표제어와 같은 줄. 칸 아래에 짚고, 거르기 칩으로도 고를 수 있다
  const overlaps = useMemo(() => headwordOverlaps(rows), [rows])
  const filterCtx = useMemo(() => ({ overlaps }), [overlaps])
  const filterCounts = useMemo(
    () => Object.fromEntries(ROW_FILTERS.map((f) => [f.key, rows.filter((r) => f.test(r, filterCtx)).length])),
    [rows, filterCtx]
  )
  const [rowFilter, setRowFilter] = useState('all')
  const [filterIds, setFilterIds] = useState(null) // 고정한 줄 id. null 이면 전체
  const [passageFilter, setPassageFilter] = useState('')
  const passageLabels = useMemo(() => [...new Set(rows.map(passageOf))], [rows])
  const pickFilter = (key) => {
    const def = ROW_FILTERS.find((f) => f.key === key)
    setRowFilter(key)
    setFilterIds(key === 'all' ? null : new Set(rows.filter((r) => def.test(r, filterCtx)).map((r) => r.id)))
  }
  // 번호는 표 전체에서의 번호 그대로 둔다 — 거르기는 보기만 바꾸고 엑셀 · 시험지는 언제나 표 전체다
  const shown = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => (!filterIds || filterIds.has(r.id)) && (!passageFilter || passageOf(r) === passageFilter))
  const filtering = Boolean(filterIds || passageFilter)

  const handleDownload = async () => {
    setSaving(true)
    setError('')
    try {
      // 지문까지 담아 두어야 나중에 이 파일만으로 시험지를 다시 낼 수 있다
      await downloadXlsx(rows, { title: docTitle, sourceName: filesLabel(sourceFiles), passages })
    } catch (err) {
      setError(`엑셀 저장 실패: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleImport = async (file) => {
    if (!file) return
    setError('')
    setImported(null)
    setAppliedName('')
    setReading(true)
    try {
      const parsed = await readWordbook(file)
      setImported({ name: file.name, ...parsed, sameWork: isSameWork(parsed.rows, passages) })
    } catch (err) {
      setError(`엑셀 불러오기 실패: ${err.message}`)
    } finally {
      setReading(false)
    }
  }

  const applyImport = () => {
    replaceWordbook({
      rows: imported.rows,
      passages: imported.passages,
      docTitle: imported.docTitle,
      sameWork: imported.sameWork,
    })
    setAppliedName(imported.name)
    setImported(null)
  }

  return (
    <div className="result-view">
      <div className="result-toolbar">
        <button className="btn ghost sm" onClick={() => setStep('select')}>
          ← 표제어 선택으로
        </button>
        <span className="count-pill">{rows.length}개 표제어</span>
        {antonymStats && (
          <span className="hint">
            반의어 {antonymStats.count}개 ({Math.round(antonymStats.ratio * 100)}%)
            {antonymStats.removed > 0 && ` · 비율 초과분 ${antonymStats.removed}개 정리됨`}
          </span>
        )}
        {confirmedAt && <span className="confirm-tag">확정됨 {formatStamp(confirmedAt)}</span>}
        {appliedName && <span className="hint">{appliedName} 반영됨</span>}
        <span className="grow" />
        {lastUsage && (
          <span className="hint">
            {model} · {Math.round(lastUsage.durationMs / 1000)}초
          </span>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          hidden
          onChange={(e) => {
            handleImport(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button
          className="btn"
          onClick={() => fileRef.current?.click()}
          disabled={reading}
          title="내려받은 엑셀을 고친 뒤 다시 올리면 그 내용으로 표를 바꿉니다"
        >
          {reading ? <span className="spinner dark" /> : '⬆'} 고친 엑셀 불러오기
        </button>
        <button className="btn" onClick={handleDownload} disabled={saving || !rows.length}>
          {saving ? <span className="spinner dark" /> : '⬇'} 엑셀(XLSX) 다운로드
        </button>
        <button className="btn primary" onClick={goQuiz} disabled={!rows.length}>
          단어시험지 만들기 →
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* 단어장이 바뀌면 만든 시험지는 모두 지워진다 (store 의 NO_QUIZZES) */}
      {quizzes.some((q) => q.gen) && (
        <div className="notice-box">
          문항까지 만든 단어시험지가 {quizzes.filter((q) => q.gen).length}개 있습니다. 표를 고치거나 엑셀을 다시 불러오면
          만든 시험지가 <strong>모두 지워집니다</strong>. 필요한 시험지는 먼저 ④ 화면에서 내려받아 두세요.
        </div>
      )}

      {imported && (
        <div className="panel">
          <div className="panel-title">
            고친 엑셀 불러오기
            <span className="count-pill">표제어 {imported.rows.length}개</span>
          </div>
          <div className="import-body">
            <p className="hint">
              {imported.name} · 지금 표 {rows.length}개 → {imported.rows.length}개
              {diff && ` · ${diffText(diff)}`}
            </p>

            {comparison && <WorkCompare cmp={comparison} keepsSelections />}
            {!imported.sameWork && !imported.passages.length && (
              <p className="hint">이 파일에는 지문이 없어 PART IV 는 출처 문장 하나만 씁니다.</p>
            )}

            <ImportNotes warnings={imported.warnings} />

            <div className="import-actions">
              {imported.sameWork ? (
                <button className="btn primary" onClick={applyImport}>
                  이 내용으로 표 바꾸기
                </button>
              ) : (
                <button className="btn danger" onClick={applyImport}>
                  다른 작업으로 바꾸기
                </button>
              )}
              <button className={imported.sameWork ? 'btn ghost' : 'btn'} onClick={() => setImported(null)}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}
      {filterCounts.missing > 0 && (
        <div className="notice-box">
          AI 응답에서 {filterCounts.missing}개 항목이 누락되어 원래 선택 그대로 채웠습니다 (아래 노란 줄). 해당 줄만 직접
          채우거나, 선택 화면으로 돌아가 생성 창에서 <strong>바뀐 표제어만 생성</strong>을 고르면 이 줄들만 다시
          만듭니다.
        </div>
      )}

      {/* 손볼 줄만 골라 보기. 해당하는 줄이 없는 칩은 숨긴다 */}
      <div className="row-filters" role="toolbar" aria-label="표 거르기">
        {ROW_FILTERS.filter((f) => f.key === 'all' || filterCounts[f.key] > 0 || f.key === rowFilter).map((f) => (
          <button
            key={f.key}
            className={`rf-chip${rowFilter === f.key ? ' on' : ''}`}
            onClick={() => pickFilter(f.key)}
            title={f.key === 'all' ? '모든 줄을 봅니다' : `${f.label}인 줄만 봅니다. 다시 누르면 지금 상태로 새로 거릅니다`}
          >
            {f.label}
            <span className="rf-count">{filterCounts[f.key]}</span>
          </button>
        ))}
        {passageLabels.length > 1 && (
          <select
            className="rf-passage"
            value={passageFilter}
            onChange={(e) => setPassageFilter(e.target.value)}
            aria-label="지문으로 거르기"
          >
            <option value="">지문 전체</option>
            {passageLabels.map((label) => (
              <option key={label} value={label}>
                지문 {label}
              </option>
            ))}
          </select>
        )}
        {filtering && (
          <span className="hint">
            {rows.length}줄 중 {shown.length}줄을 보고 있습니다
            {filterIds && ' · 고친 줄도 이 보기에서 빠지지 않습니다'}
          </span>
        )}
      </div>

      <div className="table-wrap" ref={wrapRef}>
        <table className="vocab" style={{ minWidth: cols.minTable }}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} style={c.key in cols.widths ? { width: cols.widths[c.key] } : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtering && !shown.length && (
              <tr>
                <td colSpan={10} className="rf-empty">
                  이 조건에 맞는 줄이 없습니다.{' '}
                  <button
                    className="btn ghost sm link"
                    onClick={() => {
                      pickFilter('all')
                      setPassageFilter('')
                    }}
                  >
                    모든 줄 보기
                  </button>
                </td>
              </tr>
            )}
            {shown.map(({ r, i }) => (
              <tr key={r.id} className={r.missing ? 'row-warn' : undefined}>
                <td className="num">{i + 1}</td>
                <td className="headword">
                  <AutoCell
                    className="hw"
                    value={r.headword}
                    onChange={(e) => updateRow(r.id, { headword: e.target.value })}
                  />
                  {r.normalizationNote && (
                    <span className="norm-note" title={`원문: ${r.surface}`}>
                      {r.surface} → {r.normalizationNote}
                    </span>
                  )}
                </td>
                <td className="center pos">
                  <input
                    className="cell-edit pos-input"
                    maxLength={2}
                    value={r.pos}
                    onChange={(e) => updateRow(r.id, { pos: e.target.value })}
                    title="품사 (명·동·형·부·전·접·대·구)"
                  />
                </td>
                <td>
                  <AutoCell
                    value={r.meaning || ''}
                    onChange={(e) => updateRow(r.id, { meaning: e.target.value })}
                    placeholder="—"
                  />
                </td>
                <td>
                  <AutoCell
                    value={formatDerivatives(r.derivatives)}
                    // 사람이 파생어를 고치면 "뺀 파생어" 메모는 더 맞지 않으므로 지운다
                    onChange={(e) =>
                      updateRow(r.id, { derivatives: parseDerivatives(e.target.value), droppedDerivatives: undefined })
                    }
                    placeholder="—"
                  />
                  {r.droppedDerivatives?.length > 0 && (
                    <span className="cell-note" title="생성 규칙(분사형 · 접두사를 뗀 말)에 맞지 않아 뺐습니다">
                      뺌: {r.droppedDerivatives.join(', ')}
                    </span>
                  )}
                </td>
                <td>
                  <AutoCell
                    value={formatWords(r.synonyms)}
                    onChange={(e) => updateRow(r.id, { synonyms: parseWords(e.target.value) })}
                    placeholder="—"
                  />
                  <OverlapNote hits={overlaps.get(r.id)} kind="유의어" />
                </td>
                <td>
                  <AutoCell
                    value={formatWords(r.antonyms)}
                    onChange={(e) => updateRow(r.id, { antonyms: parseWords(e.target.value) })}
                    placeholder="—"
                  />
                  <OverlapNote hits={overlaps.get(r.id)} kind="반의어" />
                </td>
                <td className="center">{r.passageLabel ?? r.passageNo}</td>
                <td className="sentence">{highlight(r.sentence, r.surface)}</td>
                <td className="center">
                  <button className="btn ghost sm" title="이 줄 삭제 (바로 되돌릴 수 있습니다)" onClick={() => removeWithUndo(r)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {liveUndo && (
        <div className="undo-toast" role="status">
          <span>
            ‘{liveUndo.label}’ 줄을 지웠습니다
            {liveUndo.quizCount > 0 && ` · 만든 시험지 ${liveUndo.quizCount}개도 함께 지워졌습니다`}
          </span>
          <button
            className="undo-btn"
            onClick={() => {
              restoreRows(liveUndo.snapshot)
              setUndo(null)
            }}
          >
            되돌리기
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 3단계 검수용 거르기. 100줄을 위에서부터 다 보지 않고 손볼 줄만 골라 본다.
 * edited 는 store 의 updateRow 가 표에서 칸을 고칠 때 남긴다.
 */
const ROW_FILTERS = [
  { key: 'all', label: '전체', test: () => true },
  { key: 'missing', label: 'AI 누락', test: (r) => Boolean(r.missing) },
  { key: 'noMeaning', label: '뜻 없음', test: (r) => !String(r.meaning || '').trim() },
  { key: 'noSynonym', label: '유의어 없음', test: (r) => !(r.synonyms || []).length },
  { key: 'changed', label: '원형으로 바뀜', test: (r) => Boolean(r.normalizationNote) },
  { key: 'antonym', label: '반의어 있음', test: (r) => (r.antonyms || []).length > 0 },
  { key: 'edited', label: '내가 고친 줄', test: (r) => Boolean(r.edited) },
  { key: 'overlap', label: '다른 표제어와 겹침', test: (r, ctx) => ctx.overlaps.has(r.id) },
  { key: 'dropped', label: '뺀 파생어', test: (r) => (r.droppedDerivatives || []).length > 0 },
]

/** 유의어 · 반의어 칸 아래의 짚음 — "= 79번 표제어 (blunted)" */
function OverlapNote({ hits, kind }) {
  const mine = (hits || []).filter((h) => h.kind === kind)
  if (!mine.length) return null
  return (
    <span className="cell-warn" title="같은 시험지에서 답이 겹칩니다. 다른 말로 바꾸는 것이 좋습니다">
      {mine.map((h) => `${h.word} = ${h.otherNo}번 표제어`).join(' · ')}
    </span>
  )
}

const passageOf = (r) => String(r.passageLabel ?? r.passageNo)

/** 되돌리기를 띄워 두는 시간 */
const UNDO_MS = 7000

/**
 * 내용에 맞춰 높이가 늘어나는 셀. 표 안에서 글자가 잘리지 않게 한다.
 *
 * 파생어·유의어·반의어 칸은 글자를 칠 때마다 목록으로 읽었다가 다시 글로 써서 보여준다.
 * 그 사이에 끝의 공백·줄바꿈·쉼표가 정리되어 사라지므로, 그대로 보여주면 "무시할 만큼"의
 * 띄어쓰기나 다음 줄·다음 낱말을 칠 수가 없다. 그래서 편집하는 동안에는 친 글자를 그대로
 * 보여주고(draft), 저장은 지금처럼 매번 하며, 칸을 떠날 때 정리된 모양으로 되돌린다.
 *
 * 높이는 글이 바뀔 때만이 아니라 칸 폭이 바뀔 때도 다시 맞춘다. 칸 폭은 글을 재서 정하므로
 * 글꼴을 받은 뒤나 다른 줄을 고친 뒤에 바뀔 수 있고, 그때 높이를 그대로 두면 꺾여 내려간 줄이 잘린다.
 */
function AutoCell({ value, onChange, placeholder, className = '' }) {
  const ref = useRef(null)
  const [draft, setDraft] = useState(null) // 편집 중일 때만 친 글자를 들고 있다
  const shown = draft ?? value

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = `${fitHeight(el)}px`
  }, [shown])

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const fit = () => {
      el.style.height = `${fitHeight(el)}px`
    }
    // 글꼴(Lora)을 받으면 같은 폭에서도 줄 수가 달라질 수 있다
    document.fonts?.ready.then(fit)
    if (typeof ResizeObserver === 'undefined') return undefined
    // 높이를 바꿔도 관찰이 다시 불리므로 폭이 바뀐 때만 맞춘다
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      fit()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <textarea
      ref={ref}
      className={`cell-edit auto ${className}`.trim()}
      rows={1}
      value={shown}
      onFocus={() => setDraft(value)}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(e)
      }}
      onBlur={() => setDraft(null)}
      placeholder={placeholder}
    />
  )
}

/**
 * 입력칸이 글을 다 보여줄 높이. scrollHeight 는 안쪽(내용 + 여백)만이고 box-sizing 이 border-box 라
 * 테두리를 더해야 한다. 예전에는 빼먹어 아래 2px 이 잘렸고, 꼬리가 긴 Lora(g · p · y)에서 드러났다.
 */
function fitHeight(el) {
  el.style.height = 'auto'
  return el.scrollHeight + el.offsetHeight - el.clientHeight
}

function diffText({ changed, added, removed }) {
  const parts = []
  if (changed) parts.push(`고친 줄 ${changed}개`)
  if (added) parts.push(`새 줄 ${added}개`)
  if (removed) parts.push(`지운 줄 ${removed}개`)
  return parts.length ? parts.join(' · ') : '지금 표와 내용이 같습니다'
}

function formatStamp(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function parseWords(text) {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((word) => ({ word }))
}

function highlight(sentence, surface) {
  if (!sentence || !surface) return sentence || ''
  const idx = sentence.toLowerCase().indexOf(String(surface).toLowerCase())
  if (idx === -1) return sentence
  return (
    <>
      {sentence.slice(0, idx)}
      <span className="mark">{sentence.slice(idx, idx + surface.length)}</span>
      {sentence.slice(idx + surface.length)}
    </>
  )
}
