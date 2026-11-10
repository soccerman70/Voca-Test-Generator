import { useCallback, useMemo, useState } from 'react'
import PassageCard from './PassageCard.jsx'
import SelectionPanel from './SelectionPanel.jsx'
import MetaPanel from './MetaPanel.jsx'
import GenerateModal from './GenerateModal.jsx'
import { useStore, sortSelections } from '../store.js'
import { filesLabel } from '../lib/passages.js'
import { findDuplicates } from '../lib/duplicates.js'
import { autoSelect, enrichAll, planQuotas } from '../lib/aiClient.js'
import { runSelection } from '../lib/selectPlan.js'
import { planRegeneration, mergeRows } from '../lib/regenPlan.js'

export default function Workspace() {
  const {
    passages,
    selections,
    targetCount,
    focusedId,
    model,
    effort,
    mode,
    sourceFiles,
    rows,
    lastUsage,
    setFocused,
    setTargetCount,
    toggleRange,
    removeSelection,
    clearSelections,
    clearSelectionsBy,
    replaceSelections,
    setStep,
    setRows,
  } = useStore()

  const [showKorean, setShowKorean] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMessage, setAiMessage] = useState('')
  const [aiError, setAiError] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [genBusy, setGenBusy] = useState(false)
  const [genProgress, setGenProgress] = useState(null)
  const [genError, setGenError] = useState('')
  // 이미 만든 표가 있을 때 — 'changed' 는 바뀐 표제어만, 'all' 은 표 전체를 새로 만든다
  const [genScope, setGenScope] = useState('all')

  const byPassage = useMemo(() => {
    const map = new Map(passages.map((p) => [p.id, []]))
    for (const sel of selections) {
      if (map.has(sel.passageId)) map.get(sel.passageId).push(sel)
    }
    return map
  }, [passages, selections])

  const duplicates = useMemo(() => findDuplicates(sortSelections(selections)), [selections])

  // 표가 이미 있으면 지금 선택과 맞대어 새로 만들 것·남길 것·지울 것을 가른다
  const regenPlan = useMemo(
    () => (rows.length ? planRegeneration(sortSelections(selections), rows) : null),
    [rows, selections]
  )

  /* ---------------- AI 자동 추출 ---------------- */

  /**
   * AI 자동 표제어 추출.
   *
   * 지문 분량에 비례해 지문별 쿼터를 정하고, 지문을 묶음으로 쪼개 동시에 묻는다.
   * 모은 후보에서 최종 표제어를 고르는 규칙은 src/lib/selectPlan.js 에 있다.
   */
  const runAutoSelect = useCallback(async () => {
    const kept = selections.filter((s) => s.origin !== 'ai')
    const needed = targetCount - kept.length
    if (needed <= 0) {
      setAiError(`이미 직접 고른 표제어가 ${kept.length}개라 목표(${targetCount}개)를 채웠습니다.`)
      return
    }

    setAiBusy(true)
    setAiError('')

    const quotas = planQuotas(passages, needed)

    const { added, rounds, drops, error } = await runSelection({
      passages,
      quotas,
      needed,
      kept,
      onStage: ({ round, shortCount }) =>
        setAiMessage(
          round === 1
            ? `AI가 지문 ${shortCount}개에서 ${needed}개를 고르는 중…`
            : `지문 ${shortCount}개가 배정량에 못 미쳐 더 고르는 중… (${round}차 시도)`
        ),
      request: async ({ passages: ps, quotas: qs, exclude }) => {
        const { items } = await autoSelect({
          passages: ps,
          quotas: qs,
          exclude,
          model,
          effort,
          onProgress: ({ group, groupCount }) =>
            setAiMessage(`AI가 지문을 분석하는 중… (묶음 ${group}/${groupCount})`),
        })
        return items
      },
    })

    replaceSelections([...kept, ...added])
    setAiBusy(false)

    if (error) {
      setAiError(`${error.message}${added.length ? ` (${added.length}개까지는 확보했습니다)` : ''}`)
      setAiMessage('')
      return
    }

    const notes = []
    if (drops.notFound) notes.push(`지문에서 못 찾음 ${drops.notFound}개`)
    if (drops.clash) notes.push(`이미 고른 자리와 겹침 ${drops.clash}개`)
    if (drops.duplicate) notes.push(`이미 고른 단어와 중복 ${drops.duplicate}개`)
    if (drops.noPassage) notes.push(`지문 번호 불일치 ${drops.noPassage}개`)
    const detail = notes.length ? ` (${notes.join(' · ')})` : ''

    if (added.length >= needed) {
      const used = new Set(added.map((s) => s.passageNo)).size
      setAiMessage(
        `AI가 지문 ${used}개에서 ${added.length}개를 골랐습니다${detail}. 직접 더하거나 뺄 수 있습니다.`
      )
    } else {
      setAiMessage(
        `${rounds}회 시도해 ${added.length}/${needed}개를 채웠습니다${detail}. ` +
          '지문에서 더 고를 만한 표현이 없다는 뜻입니다. 목표 개수를 줄이거나 지문을 더 넣어주세요.'
      )
    }
  }, [effort, model, passages, replaceSelections, selections, targetCount])

  /* ---------------- 생성 ---------------- */

  const runGenerate = useCallback(async () => {
    // 바뀐 표제어만 만들 때는 계획에 든 것만 AI 로 보내고, 나머지 줄은 표에 있는 그대로 남긴다
    const partial = genScope === 'changed' && regenPlan
    // 바뀐 것이 없으면 표를 건드리지 않고(확정도 그대로) 표로 돌아간다
    if (partial && !regenPlan.changed) {
      setModalOpen(false)
      setStep('result')
      return
    }
    const targets = partial ? regenPlan.toGenerate : sortSelections(selections)

    setGenBusy(true)
    setGenError('')
    setGenProgress({ batch: 0, batchCount: 0, done: 0, total: targets.length })

    try {
      const items = targets.map((s) => ({
        id: s.id,
        surface: s.surface,
        passageNo: s.passageNo,
        sentence: s.sentence,
      }))
      const keep = partial ? regenPlan.entries.filter((e) => !e.regenerate).map((e) => e.row) : []
      const { rows: fresh, antonymStats, usage } = await enrichAll({
        items,
        model,
        effort,
        keep,
        onProgress: setGenProgress,
      })
      const next = partial ? mergeRows(regenPlan, fresh) : fresh
      // AI는 숫자 번호(passageNo)만 주고받는다. 표와 시험지에 찍을 표기는 여기서 되붙인다.
      const labelByNo = new Map(passages.map((p) => [p.no, p.label]))
      setRows(
        next.map((r) => ({ ...r, passageLabel: labelByNo.get(r.passageNo) ?? String(r.passageNo) })),
        antonymStats,
        // 지우기만 했으면 AI 를 부르지 않았다. 표에 찍힌 생성 시간은 지난번 것을 그대로 둔다.
        items.length ? usage : lastUsage
      )
      setModalOpen(false)
    } catch (err) {
      setGenError(err.message)
    } finally {
      setGenBusy(false)
    }
  }, [effort, genScope, lastUsage, model, passages, regenPlan, selections, setRows, setStep])

  /* ---------------- 렌더 ---------------- */

  return (
    <div className="workspace">
      <div className="card-column">
        <div className="work-bar">
          <button className="btn ghost sm" onClick={() => setStep('input')} title="파일·설정 화면으로">
            ←
          </button>

          <div className="wb-info">
            <span className="wb-file">{filesLabel(sourceFiles) || '지문'}</span>
            <span className="wb-meta">
              지문 {passages.length}개 · 표제어 {selections.length}개 선택
            </span>
          </div>

          <span className="wb-divider" />

          <button className="btn sm" onClick={() => setFocused(null)}>
            모두 접기
          </button>
          <label className="wb-check">
            <input type="checkbox" checked={showKorean} onChange={(e) => setShowKorean(e.target.checked)} />
            한글 해석
          </label>

          <span className="wb-grow" />

          {selections.some((s) => s.origin === 'ai') && (
            <button className="btn ghost sm" onClick={() => clearSelectionsBy('ai')}>
              AI 선택만 지우기
            </button>
          )}
          <button className="btn primary sm" onClick={runAutoSelect} disabled={aiBusy}>
            {aiBusy ? <span className="spinner" /> : '✨'} AI 자동 추출
          </button>
        </div>

        {(aiMessage || aiError) && (
          <div className={aiError ? 'error-box' : 'notice-box'}>{aiError || aiMessage}</div>
        )}

        {mode === 'ai' && !selections.length && !aiBusy && !aiError && (
          <div className="notice-box">
            AI 자동 추출 모드입니다. 위의 <strong>✨ AI 자동 추출</strong> 버튼을 눌러 시작하세요.
          </div>
        )}

        {/* 카드만 스크롤한다 — 작업 바와 안내는 위에 고정 */}
        <div className="card-scroll">
          {passages.map((p) => (
            <PassageCard
              key={p.id}
              passage={p}
              selections={byPassage.get(p.id) || []}
              focused={focusedId === p.id}
              showKorean={showKorean}
              onFocus={setFocused}
              onToggleRange={toggleRange}
            />
          ))}
        </div>
      </div>

      <div className="side-column">
        <SelectionPanel
          selections={selections}
          targetCount={targetCount}
          onTargetCountChange={setTargetCount}
          onFocusPassage={setFocused}
          onRemove={removeSelection}
          onClear={clearSelections}
          onGenerate={() => {
            // 이미 만든 표가 있으면 창에서 "바뀐 표제어만 / 전체 다시"를 고르게 한다.
            // 지금 선택과 겹치는 줄이 하나라도 있으면 바뀐 것만 만드는 쪽이 기본이다 —
            // 시간과 비용이 덜 들고, 표에서 손으로 고친 내용이 남는다.
            setGenScope(regenPlan?.kept ? 'changed' : 'all')
            setGenError('')
            setModalOpen(true)
          }}
          canGenerate={selections.length > 0}
          duplicates={duplicates}
        />
      </div>

      <div className="side-column meta-panel-wrap">
        <MetaPanel selections={selections} passages={passages} onFocusPassage={setFocused} />
      </div>

      {modalOpen && (
        <GenerateModal
          selections={selections}
          targetCount={targetCount}
          model={model}
          busy={genBusy}
          progress={genProgress}
          error={genError}
          duplicates={duplicates}
          plan={regenPlan}
          scope={genScope}
          onScopeChange={setGenScope}
          onRemove={removeSelection}
          onConfirm={runGenerate}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}

