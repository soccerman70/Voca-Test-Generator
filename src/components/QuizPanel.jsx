// 단어시험지 생성 화면 — 확정된 단어장을 6개 PART 에 나눠 담고 그 결과를 먼저 보여준다

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.js'
import { allocate, verbForm, FORM_LABEL, PARTS } from '../lib/quizAllocate.js'
import { buildPartI, buildPartIV, renderPartIVItem } from '../lib/quizBuild.js'
import { generateQuizParts } from '../lib/quizClient.js'
import { downloadTest, downloadAnswers } from '../lib/exportDocx.js'

let quizSeq = 0

/** allocate 결과 중 시험지마다 달라지는 것만. stats 는 배정과 상관없이 단어장에서 매번 계산한다. */
function allocationOf(rows, seed) {
  const { parts, shortages, ok, thirdDetail } = allocate(rows, { seed })
  return { parts, shortages, ok, thirdDetail }
}

/** 배정 하나를 시험지로 감싼다. 시드가 없으면 단어장 순서대로 배정한다. */
function makeQuiz(rows, seed, no) {
  return {
    id: `q${Date.now().toString(36)}${(quizSeq += 1).toString(36)}`,
    no,
    seed,
    createdAt: Date.now(),
    ...allocationOf(rows, seed),
    context: {}, // 문항별 앞뒤 문장 수 { [rowId]: { before, after } }
    gen: null, // AI 가 만든 PART II · III · V · VI
  }
}

const newSeed = () => Math.floor(Math.random() * 2 ** 31)

export default function QuizPanel() {
  const { rows, quizzes, activeQuizId, quizBusy, addQuiz, removeQuiz, setActiveQuiz, setStep } = useStore()

  // 시험지가 하나도 없으면 단어장 순서대로 배정한 첫 시험지를 만든다.
  // StrictMode 는 effect 를 두 번 돌리므로 store 를 직접 보고 한 번만 더한다.
  useEffect(() => {
    if (rows.length && !useStore.getState().quizzes.length) addQuiz(makeQuiz(rows, null, 1))
  }, [rows, quizzes.length, addQuiz])

  const quiz = quizzes.find((q) => q.id === activeQuizId) ?? quizzes[quizzes.length - 1]

  const deleteQuiz = (q) => {
    if (q.gen && !confirm(`시험지 ${q.no} — 만든 문항까지 함께 지울까요?`)) return
    removeQuiz(q.id)
  }

  return (
    <div className="setup quiz-view">
      <div className="setup-inner">
        {/* 만든 시험지 목록. 단어장이 바뀌면 모두 지워진다 */}
        <div className="quiz-tabs">
          {quizzes.map((q) => (
            <div key={q.id} className={`quiz-tab${q.id === quiz?.id ? ' on' : ''}`}>
              <button className="qt-name" onClick={() => setActiveQuiz(q.id)}>
                시험지 {q.no}
                <span className="qt-state">{quizBusy[q.id] ? '만드는 중' : q.gen ? '문항 있음' : '배정만'}</span>
              </button>
              <button
                className="qt-del"
                title="이 시험지를 지웁니다"
                aria-label={`시험지 ${q.no} 지우기`}
                disabled={Boolean(quizBusy[q.id])}
                onClick={() => deleteQuiz(q)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {quiz && <QuizBody key={quiz.id} quiz={quiz} />}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setStep('result')}>
            ← 단어장으로 돌아가기
          </button>
        </div>
      </div>
    </div>
  )
}

/** 고른 시험지 하나. 탭을 바꾸면 key 가 바뀌어 화면 안의 오류 표시 같은 것은 새로 시작한다. */
function QuizBody({ quiz }) {
  const { rows, passages, model, effort, confirmedAt, docTitle, quizzes, quizBusy, addQuiz, updateQuiz, setQuizBusy } =
    useStore()
  const stats = useMemo(() => allocate(rows).stats, [rows])
  const { parts, shortages, thirdDetail, ok, context, gen } = quiz

  // 문항별로 앞뒤 문장을 몇 개까지 붙였는지. 맥락이 모자란지는 읽어봐야 알 수 있어 사람이 정한다.
  const adjust = (rowId, side, delta) =>
    updateQuiz(quiz.id, (q) => {
      const cur = q.context[rowId] || { before: 0, after: 0 }
      return { context: { ...q.context, [rowId]: { ...cur, [side]: Math.max(0, Math.min(2, cur[side] + delta)) } } }
    })

  const partI = useMemo(() => buildPartI(parts.I), [parts.I])
  const partIV = useMemo(() => buildPartIV(parts.IV), [parts.IV])

  // AI 가 만드는 PART II·III·V·VI. 결과와 진행률은 store 에 두어 화면을 떠났다 와도 남는다.
  const genProgress = quizBusy[quiz.id]
  const genBusy = Boolean(genProgress)
  const [genError, setGenError] = useState('')

  const runGenerate = async () => {
    const id = quiz.id
    setGenError('')
    try {
      const result = await generateQuizParts({ parts, model, effort, onProgress: (p) => setQuizBusy(id, p) })
      updateQuiz(id, { gen: result })
    } catch (err) {
      setGenError(err.message)
    } finally {
      setQuizBusy(id, null)
    }
  }

  /** 문항을 아직 안 만들었으면 이 시험지의 배정을 바꾸고, 만들었으면 새 시험지로 더한다. */
  const reallocate = () => {
    const seed = newSeed()
    if (gen) addQuiz(makeQuiz(rows, seed, Math.max(...quizzes.map((q) => q.no)) + 1))
    else updateQuiz(quiz.id, { ...allocationOf(rows, seed), seed, context: {} })
  }

  // 화면에서 조절한 앞뒤 문장이 그대로 문서에 실려야 한다
  const docData = () => ({
    title: docTitle,
    // 시험지가 여럿이면 내려받는 파일 이름이 겹치지 않게 번호를 붙인다
    fileNo: quizzes.length > 1 ? quiz.no : null,
    partI,
    partIV,
    partIVTexts: partIV.items.map(
      (it) => renderPartIVItem({ ...it, ...(context[it.rowId] || {}) }, passages).text
    ),
    gen,
  })

  const [saving, setSaving] = useState('')
  const save = async (which) => {
    setSaving(which)
    setGenError('')
    try {
      await (which === 'test' ? downloadTest(docData()) : downloadAnswers(docData()))
    } catch (err) {
      setGenError(`문서 저장 실패: ${err.message}`)
    } finally {
      setSaving('')
    }
  }

  return (
    <>
      {/* 1. 단어장이 시험지를 감당할 수 있는지 */}
      <div className="panel">
        <div className="panel-title">
          단어장 점검
          <span className="count-pill">
            표제어 {stats.usable} → {stats.required}문항
          </span>
          {confirmedAt && <span className="confirm-tag">확정 {formatStamp(confirmedAt)}</span>}
        </div>
        <div className="quiz-body">
          <div className="quiz-stats">
            <Cell k="쓸 수 있는 표제어" v={stats.usable} sub={stats.total !== stats.usable ? `전체 ${stats.total}` : ''} />
            <Cell k="동사" v={stats.verbs} sub="IV 5개" warn={stats.verbs < 5} />
            <Cell k="형용사·부사" v={stats.adjAdv} sub="II 5개" warn={stats.adjAdv < 5} />
            <Cell k="어구" v={stats.phrases} sub="I 우선" />
            <Cell k="파생어" v={stats.withDerivatives} sub="III 2개" warn={stats.withDerivatives < 2} />
            <Cell k="유의어 1+" v={stats.withSynonyms} sub="III 1개" warn={stats.withSynonyms < 1} />
            <Cell k="유의어 2" v={stats.withSynonyms2} sub="V 5개" warn={stats.withSynonyms2 < 5} />
            <Cell k="반의어" v={stats.withAntonyms} sub="III 2개" warn={stats.withAntonyms < 2} />
          </div>

          {Object.keys(stats.verbForms).length > 0 && (
            <p className="hint" style={{ margin: 0 }}>
              동사 형태 —{' '}
              {Object.entries(stats.verbForms)
                .map(([form, n]) => `${FORM_LABEL[form]} ${n}`)
                .join(' · ')}
              {Object.keys(stats.verbForms).length < 5 && ' · 5종에 못 미치면 PART IV 에 같은 형태가 섞입니다'}
            </p>
          )}

          {!ok && (
            <div className="notice-box">
              <strong>{shortages.length}개 PART 가 문항 수를 못 채웠습니다.</strong>{' '}
              {shortages.map((s) => `PART ${s.part} ${s.got}/${s.need}`).join(' · ')} — 배정을 다시 해 보거나,
              표제어를 더 고른 뒤 다시 확정해주세요.
            </div>
          )}
        </div>
      </div>

      {/* 2. 어떤 낱말이 어느 PART 로 갔는지 */}
      <div className="panel">
        <div className="panel-title">
          PART 배정
          <span className="count-pill">{docTitle || '제목 없음'}</span>
        </div>
        <div className="quiz-body">
          <p className="hint" style={{ margin: 0 }}>
            까다로운 PART 가 먼저 가져갑니다 (IV → III → II → V → VI → I). 한 번 쓴 말은 굴절형이 같은 것까지
            다시 쓰지 않습니다. {quiz.seed == null ? '단어장 순서대로 배정했습니다.' : '단어장 순서를 무작위로 섞어 배정했습니다.'}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={reallocate} disabled={genBusy}>
              {gen ? '새 시험지로 다시 배정' : '배정 다시 하기'}
            </button>
            <span className="hint">
              {gen
                ? '이 시험지는 그대로 두고, 무작위로 다시 배정한 시험지를 위 목록에 더합니다.'
                : '아직 문항을 만들지 않았으므로 이 시험지의 배정을 무작위로 바꿉니다.'}
            </span>
          </div>

          {PARTS.map((p) => (
            <PartRow
              key={p.key}
              spec={p}
              items={p.key === 'III' ? parts.III.all : parts[p.key]}
              detail={p.key === 'III' ? thirdDetail : null}
              showForm={p.key === 'IV'}
            />
          ))}
        </div>
      </div>

      {/* 3. AI 없이 조립되는 PART */}
      {partI.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            PART I — 우리말 → 영어 쓰기
            <span className="count-pill">{partI.length}문항</span>
          </div>
          <div style={{ padding: 16 }}>
            <p className="hint" style={{ margin: '0 0 10px' }}>
              단어장에 있는 뜻과 표제어로 그대로 만들어집니다. 어구는 낱말 수를 괄호로 알려줍니다.
            </p>
            <table className="quiz-preview">
              <tbody>
                {partI.map((q) => (
                  <tr key={q.rowId}>
                    <td className="qn">{q.no}</td>
                    <td>{q.prompt}</td>
                    <td className="qa">{q.answer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {partIV.items.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            PART IV — 동사 형태 변형
            <span className="count-pill">{partIV.items.length}문항</span>
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="hint" style={{ margin: 0 }}>
              보기 · {partIV.choices.join(' / ')}
            </p>
            <p className="hint" style={{ margin: 0 }}>
              출처 문장을 그대로 쓰고 동사 자리를 빈칸으로 두었습니다. 그 문장만으로 뜻을 유추하기 어려우면 앞뒤
              문장을 붙이세요. 유추가 가능하면 붙이지 않는 편이 낫고, 한 문항은 40단어를 넘지 않아야 합니다.
            </p>

            {partIV.items.map((it) => (
              <PartFourItem
                key={it.rowId}
                item={{ ...it, ...(context[it.rowId] || {}) }}
                passages={passages}
                onAdjust={adjust}
              />
            ))}
          </div>
        </div>
      )}

      {/* 4. AI 가 만드는 PART */}
      <div className="panel">
        <div className="panel-title">
          PART II · III · V · VI
          <span className="count-pill">AI 생성</span>
        </div>
        <div className="quiz-body">
          <p className="hint" style={{ margin: 0 }}>
            영영풀이 · 어휘 관계 · 유의어 변별 · 서사 빈칸을 만듭니다. 네 PART 는 서로 의존이 없어 동시에
            처리합니다. 받은 결과는 규칙을 지켰는지 코드로 다시 검사합니다.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn primary" onClick={runGenerate} disabled={genBusy || !ok}>
              {genBusy ? <span className="spinner" /> : null}
              {genBusy ? '만드는 중…' : gen ? '다시 만들기' : '문항 만들기'}
            </button>
            {genBusy && genProgress && (
              <span className="hint">
                {genProgress.done} / {genProgress.total} PART 완료
              </span>
            )}
            {!ok && <span className="hint">배정이 모자라 아직 만들 수 없습니다.</span>}
          </div>

          {genError && <div className="error-box">{genError}</div>}

          {gen && (
            <>
              {gen.crossIssues.length > 0 && (
                <div className="notice-box">
                  <strong>PART 간 중복 {gen.crossIssues.length}건</strong> — {gen.crossIssues.join(' · ')}
                </div>
              )}
              {['II', 'III', 'V', 'VI'].map((key) => (
                <GeneratedPart key={key} partKey={key} data={gen.byPart[key]} choices={gen.choices[key]} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* 5. 내보내기 */}
      <div className="panel">
        <div className="panel-title">
          내보내기
          <span className="count-pill">docx</span>
        </div>
        <div className="quiz-body">
          <p className="hint" style={{ margin: 0 }}>
            A4 · 여백 1080 dxa · 제목 Noto Serif KR · 지시문 Noto Sans KR · 영문 본문 Lora. 1쪽에 PART I~IV,
            2쪽에 PART V~VI 가 들어갑니다. 화면에서 조절한 앞뒤 문장이 그대로 실립니다.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => save('test')} disabled={!gen || Boolean(saving)}>
              {saving === 'test' ? <span className="spinner" /> : '⬇'} 시험지
            </button>
            <button className="btn" onClick={() => save('answers')} disabled={!gen || Boolean(saving)}>
              {saving === 'answers' ? <span className="spinner dark" /> : '⬇'} 정답·해설지
            </button>
            {!gen && <span className="hint">문항을 먼저 만들어주세요.</span>}
          </div>
        </div>
      </div>
    </>
  )
}

function Cell({ k, v, sub, warn }) {
  return (
    <div className={`qs-cell${warn ? ' warn' : ''}`}>
      <div className="qs-k">{k}</div>
      <div className="qs-v">
        {v}
        {sub && <em>{sub}</em>}
      </div>
    </div>
  )
}

function PartRow({ spec, items, detail, showForm }) {
  const short = items.length < spec.need
  return (
    <div className={`quiz-part${short ? ' short' : ''}`}>
      <div className="qp-head">
        <span className="qp-no">PART {spec.key}</span>
        <span className="qp-label">{spec.label}</span>
        <span className={`qp-count${short ? ' short' : ''}`}>
          {items.length} / {spec.need}
        </span>
      </div>

      {detail && (
        <div className="qp-detail">
          파생 {detail.derivative.got}/{detail.derivative.need} · 유의 {detail.synonym.got}/{detail.synonym.need} ·
          반의 {detail.antonym.got}/{detail.antonym.need}
        </div>
      )}

      <div className="qp-words">
        {items.length === 0 ? (
          <span className="qp-empty">조건에 맞는 낱말이 없습니다</span>
        ) : (
          items.map((row) => (
            <span key={row.id} className="qp-word" title={row.sentence}>
              {row.headword}
              {showForm && <em>{FORM_LABEL[verbForm(row.surface, row.headword)]}</em>}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

const PART_TITLE = {
  II: '영영풀이 매칭',
  III: '어휘 관계 분석',
  V: '복수 정답 유의어 변별',
  VI: '지문형 빈칸 서사',
}

/** AI 가 만든 PART 하나. 규칙을 어긴 곳은 노란 선으로 알린다. */
function GeneratedPart({ partKey, data, choices }) {
  if (!data) return null
  const bad = data.issues?.length > 0 || data.error

  return (
    <div className={`quiz-part${bad ? ' short' : ''}`}>
      <div className="qp-head">
        <span className="qp-no">PART {partKey}</span>
        <span className="qp-label">{PART_TITLE[partKey]}</span>
        {data.durationMs != null && <span className="qi-words">{Math.round(data.durationMs / 1000)}초</span>}
      </div>

      {data.error && <div className="qp-detail" style={{ color: 'var(--semantic-down)' }}>{data.error}</div>}

      {data.issues?.length > 0 && (
        <div className="qp-detail">
          <strong>검사 {data.issues.length}건</strong> — {data.issues.join(' · ')}
        </div>
      )}

      {!data.error && <PartBody partKey={partKey} result={data.result} choices={choices} />}
    </div>
  )
}

function PartBody({ partKey, result, choices }) {
  if (partKey === 'II') {
    return (
      <div className="qgen">
        <div className="qgen-choices">
          보기 · {(result?.definitions || []).map((d) => d.headword).join(' / ')}
          {result?.distractor?.word && ` / ${result.distractor.word}`}
        </div>
        {(result?.definitions || []).map((d) => (
          <p key={d.id} className="qgen-line">
            <b>{d.headword}</b> — {d.definition}
          </p>
        ))}
        {result?.distractor && (
          <p className="qgen-line dim">
            distractor <b>{result.distractor.word}</b> — {result.distractor.reason}
          </p>
        )}
      </div>
    )
  }

  if (partKey === 'III') {
    return (
      <div className="qgen">
        {(result?.items || []).map((it, i) => (
          <p key={it.id || i} className="qgen-line">
            {it.left} : {it.right} = {it.headword} : <b>{it.hint ? `${it.hint}___` : '___'}</b>
            <span className="dim">
              {' '}
              → {it.answer} · {it.relation}
              {it.note ? ` · ${it.note}` : ''}
            </span>
          </p>
        ))}
      </div>
    )
  }

  if (partKey === 'V') {
    return (
      <div className="qgen">
        {(result?.items || []).map((it, i) => (
          <div key={it.id || i} className="qgen-block">
            <p className="qgen-line">{it.sentence}</p>
            <p className="qgen-line dim">
              {(it.choices || []).map((c, k) => {
                const isAnswer = (it.answers || []).includes(k + 1)
                return (
                  <span key={k} style={isAnswer ? { color: 'var(--primary)', fontWeight: 600 } : undefined}>
                    {`①②③④⑤`[k]} {c}
                    {'   '}
                  </span>
                )
              })}
            </p>
            <p className="qgen-line dim">단서 {(it.clues || []).join(' · ')}</p>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="qgen">
      <div className="qgen-choices">보기 · {(choices || []).join(' / ')}</div>
      <p className="qgen-line">{result?.story}</p>
      <p className="qgen-line dim">
        {(result?.blanks || []).map((b) => `${b.no} ${b.answer}`).join(' · ')}
      </p>
    </div>
  )
}

/** 문항 하나. 앞뒤 문장을 붙이고 뗄 수 있고, 40단어를 넘으면 알려준다. */
function PartFourItem({ item, passages, onAdjust }) {
  const r = renderPartIVItem(item, passages)
  return (
    <div className={`quiz-item${r.overLimit ? ' over' : ''}`}>
      <div className="qi-head">
        <span className="qi-no">{item.no}</span>
        <span className="qi-form">{FORM_LABEL[item.form]}</span>
        <span className="qi-answer">{item.answer}</span>
        <span className="qi-src">{item.passageLabel ?? item.passageNo}</span>
        <span className={`qi-words${r.overLimit ? ' over' : ''}`}>{r.words} / 40 단어</span>
      </div>

      <p className="qi-text">{r.text}</p>

      <div className="qi-actions">
        <button className="btn ghost sm" disabled={item.before >= 2 || r.atStart} onClick={() => onAdjust(item.rowId, 'before', 1)}>
          ← 앞 문장 붙이기
        </button>
        <button className="btn ghost sm" disabled={!item.before} onClick={() => onAdjust(item.rowId, 'before', -1)}>
          앞 문장 떼기
        </button>
        <span className="qi-gap" />
        <button className="btn ghost sm" disabled={!item.after} onClick={() => onAdjust(item.rowId, 'after', -1)}>
          뒤 문장 떼기
        </button>
        <button className="btn ghost sm" disabled={item.after >= 2 || r.atEnd} onClick={() => onAdjust(item.rowId, 'after', 1)}>
          뒤 문장 붙이기 →
        </button>
      </div>
    </div>
  )
}

function formatStamp(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
