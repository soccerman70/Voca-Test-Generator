import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store.js'
import { downloadXlsx, formatDerivatives, formatWords, parseDerivatives } from '../lib/exportXlsx.js'
import { readWordbook, isSameWork, compareRows } from '../lib/importXlsx.js'
import { filesLabel } from '../lib/passages.js'
import ImportNotes from './ImportNotes.jsx'

export default function ResultTable() {
  const {
    rows,
    antonymStats,
    lastUsage,
    model,
    sourceFiles,
    passages,
    docTitle,
    confirmedAt,
    setStep,
    updateRow,
    removeRow,
    replaceWordbook,
  } = useStore()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // 엑셀에서 고친 단어장. 바로 바꾸지 않고 무엇이 달라지는지 먼저 보여준다.
  const [imported, setImported] = useState(null)
  const [reading, setReading] = useState(false)
  const [appliedName, setAppliedName] = useState('')
  const fileRef = useRef(null)

  // 패널을 띄운 채 표를 더 고칠 수도 있으므로 지금 표와 매번 다시 견준다
  const diff = useMemo(
    () => (imported?.sameWork ? compareRows(rows, imported.rows) : null),
    [imported, rows]
  )

  const issues = useMemo(
    () => ({
      missing: rows.filter((r) => r.missing).length,
      noSynonym: rows.filter((r) => !r.synonyms.length).length,
      noMeaning: rows.filter((r) => !r.meaning).length,
      changed: rows.filter((r) => r.normalizationNote).length,
    }),
    [rows]
  )

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
        {issues.noMeaning > 0 && <span className="hint">뜻 없음 {issues.noMeaning}개</span>}
        {issues.noSynonym > 0 && <span className="hint">유의어 없음 {issues.noSynonym}개</span>}
        {issues.changed > 0 && <span className="hint">원형으로 바뀐 표제어 {issues.changed}개</span>}
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
        <button className="btn primary" onClick={handleDownload} disabled={saving || !rows.length}>
          {saving ? <span className="spinner" /> : '⬇'} 엑셀(XLSX) 다운로드
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

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

            {!imported.sameWork && (
              <div className="notice-box">
                지금 작업과 <strong>다른 지문</strong>에서 나온 단어장입니다. 표와 함께 지문도 이 파일의 것으로 바뀌고,
                2단계의 표제어 선택은 비워집니다.
                {!imported.passages.length && ' 이 파일에는 지문이 없어 PART IV 는 출처 문장 하나만 씁니다.'}
              </div>
            )}

            <ImportNotes warnings={imported.warnings} />

            <div className="import-actions">
              <button className="btn primary" onClick={applyImport}>
                이 내용으로 표 바꾸기
              </button>
              <button className="btn ghost" onClick={() => setImported(null)}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}
      {issues.missing > 0 && (
        <div className="notice-box">
          AI 응답에서 {issues.missing}개 항목이 누락되어 원래 선택 그대로 채웠습니다 (아래 노란 줄). 해당 줄만 직접
          채우거나, 선택 화면으로 돌아가 생성 창에서 <strong>바뀐 표제어만 생성</strong>을 고르면 이 줄들만 다시
          만듭니다.
        </div>
      )}

      <div className="table-wrap">
        <table className="vocab">
          <thead>
            <tr>
              <th style={{ width: 44 }}>번호</th>
              <th style={{ width: 156 }}>표제어</th>
              <th style={{ width: 46 }}>품사</th>
              <th style={{ width: 142 }}>뜻</th>
              <th style={{ width: 200 }}>파생어</th>
              <th style={{ width: 158 }}>유의어</th>
              <th style={{ width: 146 }}>반의어</th>
              <th style={{ width: 62 }}>출처</th>
              <th>출처 문장</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
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
                <td className="center">
                  <input
                    className="cell-edit"
                    style={{ textAlign: 'center' }}
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
                    onChange={(e) => updateRow(r.id, { derivatives: parseDerivatives(e.target.value) })}
                    placeholder="—"
                  />
                </td>
                <td>
                  <AutoCell
                    value={formatWords(r.synonyms)}
                    onChange={(e) => updateRow(r.id, { synonyms: parseWords(e.target.value) })}
                    placeholder="—"
                  />
                </td>
                <td>
                  <AutoCell
                    value={formatWords(r.antonyms)}
                    onChange={(e) => updateRow(r.id, { antonyms: parseWords(e.target.value) })}
                    placeholder="—"
                  />
                </td>
                <td className="center">{r.passageLabel ?? r.passageNo}</td>
                <td className="sentence">{highlight(r.sentence, r.surface)}</td>
                <td className="center">
                  <button className="btn ghost sm" title="이 줄 삭제" onClick={() => removeRow(r.id)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * 내용에 맞춰 높이가 늘어나는 셀. 표 안에서 글자가 잘리지 않게 한다.
 *
 * 파생어·유의어·반의어 칸은 글자를 칠 때마다 목록으로 읽었다가 다시 글로 써서 보여준다.
 * 그 사이에 끝의 공백·줄바꿈·쉼표가 정리되어 사라지므로, 그대로 보여주면 "무시할 만큼"의
 * 띄어쓰기나 다음 줄·다음 낱말을 칠 수가 없다. 그래서 편집하는 동안에는 친 글자를 그대로
 * 보여주고(draft), 저장은 지금처럼 매번 하며, 칸을 떠날 때 정리된 모양으로 되돌린다.
 */
function AutoCell({ value, onChange, placeholder, className = '' }) {
  const ref = useRef(null)
  const [draft, setDraft] = useState(null) // 편집 중일 때만 친 글자를 들고 있다
  const shown = draft ?? value

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [shown])

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
