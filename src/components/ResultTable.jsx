import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store.js'
import { downloadXlsx, formatDerivatives, formatWords } from '../lib/exportXlsx.js'
import { filesLabel } from '../lib/passages.js'

export default function ResultTable() {
  const { rows, antonymStats, lastUsage, model, sourceFiles, passages, docTitle, confirmedAt, setStep, updateRow, removeRow } =
    useStore()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
        <span className="grow" />
        {lastUsage && (
          <span className="hint">
            {model} · {Math.round(lastUsage.durationMs / 1000)}초
          </span>
        )}
        <button className="btn primary" onClick={handleDownload} disabled={saving || !rows.length}>
          {saving ? <span className="spinner" /> : '⬇'} 엑셀(XLSX) 다운로드
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}
      {issues.missing > 0 && (
        <div className="notice-box">
          AI 응답에서 {issues.missing}개 항목이 누락되어 원래 선택 그대로 채웠습니다 (아래 노란 줄). 해당 줄만 직접
          채우거나, 선택 화면으로 돌아가 다시 생성해주세요.
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
              <th style={{ width: 170 }}>파생어</th>
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

/** 내용에 맞춰 높이가 늘어나는 셀. 표 안에서 글자가 잘리지 않게 한다. */
function AutoCell({ value, onChange, placeholder, className = '' }) {
  const ref = useRef(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      className={`cell-edit auto ${className}`.trim()}
      rows={1}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  )
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

function parseDerivatives(text) {
  // 줄바꿈이 기본 구분자. 쉼표로 붙여 써도 받아준다.
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = chunk.match(/^(.*?)\s*\(([^)]*)\)$/)
      return m ? { word: m[1].trim(), pos: m[2].trim() } : { word: chunk, pos: '' }
    })
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
