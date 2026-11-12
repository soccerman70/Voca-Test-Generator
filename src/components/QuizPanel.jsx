// 단어시험지 생성 화면 — 확정된 단어장을 6개 PART 에 나눠 담고 그 결과를 먼저 보여준다

import { useEffect, useMemo, useState } from 'react'
import { useStore, DOC_TITLE_MAX } from '../store.js'
import { allocate, verbForm, FORM_LABEL, PARTS, shortageAdvice } from '../lib/quizAllocate.js'
import { buildPartI, buildPartIV, renderPartIVItem } from '../lib/quizBuild.js'
import {
  generateQuizParts,
  answerCheckIssues,
  withCurrentRules,
  partOneNotes,
  answerExposures,
} from '../lib/quizClient.js'
import { downloadTest, downloadAnswers, testHeadParts, wrongReasons } from '../lib/exportDocx.js'
import { DEFAULT_TITLE } from '../lib/exportXlsx.js'
import { partThreeAnswers } from '../lib/quizRules.js'

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
    meanings: {}, // PART I 에서 좁혀 바꾼 뜻 { [rowId]: '차등적으로' } — 단어장 표는 그대로
    gen: null, // AI 가 만든 PART II · III · V · VI 와 PART I 점검
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
  const {
    rows,
    passages,
    model,
    effort,
    confirmedAt,
    docTitle,
    quizHead,
    quizzes,
    quizBusy,
    selections,
    addQuiz,
    updateQuiz,
    setQuizBusy,
    setStep,
  } = useStore()
  const stats = useMemo(() => allocate(rows).stats, [rows])
  const { parts, shortages, thirdDetail, ok, context, gen: storedGen } = quiz
  const meanings = useMemo(() => quiz.meanings || {}, [quiz.meanings])
  // 화면과 내려받는 문서는 지금 규칙(PART III 두 글자 힌트 · 인정 정답, 빈칸 앞 a(n))을 입힌 것을 쓴다
  const gen = useMemo(() => withCurrentRules(storedGen), [storedGen])

  // 못 채운 PART 마다 무엇이 모자라고 어떻게 채우는지. 화면은 처방(fix)을 모아 버튼을 고른다.
  const advice = useMemo(
    () => shortages.map((sh) => ({ sh, ...shortageAdvice(sh, stats, thirdDetail) })),
    [shortages, stats, thirdDetail]
  )
  const fixes = new Set(advice.map((a) => a.fix))
  const shortageId = `shortage-${quiz.id}`

  // 문항별로 앞뒤 문장을 몇 개까지 붙였는지. 맥락이 모자란지는 읽어봐야 알 수 있어 사람이 정한다.
  const adjust = (rowId, side, delta) =>
    updateQuiz(quiz.id, (q) => {
      const cur = q.context[rowId] || { before: 0, after: 0 }
      return { context: { ...q.context, [rowId]: { ...cur, [side]: Math.max(0, Math.min(2, cur[side] + delta)) } } }
    })

  const partI = useMemo(() => buildPartI(parts.I, 1, meanings), [parts.I, meanings])
  const partIV = useMemo(() => buildPartIV(parts.IV), [parts.IV])
  // 화면 문항과 내려받는 문서가 같은 글을 쓴다 — 앞뒤로 붙인 문장 · 표에서 고친 출처 문장까지
  const partIVTexts = useMemo(
    () => partIV.items.map((it) => renderPartIVItem({ ...it, ...(context[it.rowId] || {}) }, passages, rows).text),
    [partIV, context, passages, rows]
  )
  // 정답 말고도 학생이 쓸 만한 말이 있는 PART I 문항 (PART I 점검)
  const partINotes = useMemo(() => partOneNotes(gen?.byPart?.I?.result, partI, meanings), [gen, partI, meanings])
  // 다른 문항의 정답이 문항 글에 드러나는 곳 — 앞뒤 문장을 붙일 때마다 다시 본다
  const exposures = useMemo(
    () => answerExposures({ partI, partIV, partIVTexts, gen }),
    [partI, partIV, partIVTexts, gen]
  )

  /** PART I 뜻을 바꾸거나(text) 단어장 뜻으로 되돌린다(null) */
  const setMeaning = (rowId, text) =>
    updateQuiz(quiz.id, (q) => {
      const next = { ...(q.meanings || {}) }
      if (text) next[rowId] = text
      else delete next[rowId]
      return { meanings: next }
    })

  // AI 가 만드는 PART II·III·V·VI. 결과와 진행률은 store 에 두어 화면을 떠났다 와도 남는다.
  const genProgress = quizBusy[quiz.id]
  const genBusy = Boolean(genProgress)
  const [genError, setGenError] = useState('')

  /** only 가 PART 목록이면 그 PART 만 다시 만들고 나머지는 지금 결과를 둔다 (버튼 onClick 은 이벤트를 넘긴다) */
  const runGenerate = async (only) => {
    const id = quiz.id
    const list = Array.isArray(only) ? only : null
    setGenError('')
    try {
      const result = await generateQuizParts({
        parts,
        model,
        effort,
        meanings,
        onProgress: (p) => setQuizBusy(id, p),
        only: list,
        previous: list ? storedGen : null,
      })
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
    head: quizHead,
    // 시험지가 여럿이면 내려받는 파일 이름이 겹치지 않게 번호를 붙인다
    fileNo: quizzes.length > 1 ? quiz.no : null,
    partI,
    partINotes,
    partIV,
    partIVTexts,
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
      {/*
       * 위에 붙는 진행 막대. 4단계는 점검 → 배정 → PART IV → AI 문항 → 내보내기 순으로 길게 이어져
       * 마지막 내려받기 버튼이 한참 아래에 있었다. 지금 어디까지 왔는지와 다음에 누를 것 하나만 늘 보인다.
       */}
      <div className="quiz-bar">
        <ol className="qb-steps">
          <li className={ok ? 'done' : 'warn'}>
            <span className="qb-no">1</span>배정
            <em>{ok ? `${stats.required}문항` : `${shortages.length}개 PART 모자람`}</em>
          </li>
          <li className={gen ? 'done' : genBusy ? 'busy' : ok ? 'now' : ''}>
            <span className="qb-no">2</span>문항 만들기
            {genBusy && genProgress && (
              <em>
                {genProgress.done}/{genProgress.total} PART
              </em>
            )}
          </li>
          <li className={gen ? 'now' : ''}>
            <span className="qb-no">3</span>내려받기
          </li>
        </ol>
        <div className="qb-action">
          {!ok ? (
            <button
              className="btn sm"
              onClick={() => document.getElementById(shortageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            >
              모자란 PART 보기 ↓
            </button>
          ) : genBusy ? (
            <span className="hint">
              <span className="spinner dark" /> 문항을 만드는 중…
            </span>
          ) : !gen ? (
            <button className="btn primary sm" onClick={runGenerate}>
              문항 만들기
            </button>
          ) : (
            <>
              <button className="btn primary sm" onClick={() => save('test')} disabled={Boolean(saving)}>
                {saving === 'test' ? <span className="spinner" /> : '⬇'} 시험지
              </button>
              <button className="btn sm" onClick={() => save('answers')} disabled={Boolean(saving)}>
                {saving === 'answers' ? <span className="spinner dark" /> : '⬇'} 정답·해설지
              </button>
            </>
          )}
        </div>
      </div>

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
            <div className="shortage-box" id={shortageId}>
              <div>
                <strong>{shortages.length}개 PART 가 문항 수를 못 채웠습니다.</strong>
                {stats.usable < stats.required &&
                  ` 시험지 한 장에 표제어가 ${stats.required}개 필요한데 지금 ${stats.usable}개입니다.`}
              </div>
              <ul className="shortage-list">
                {advice.map(({ sh, text }) => (
                  <li key={sh.part}>
                    <b>
                      PART {sh.part} {sh.got}/{sh.need}
                    </b>{' '}
                    {text}
                  </li>
                ))}
              </ul>
              <div className="shortage-actions">
                {/*
                 * 표제어를 더 고르는 길은 2단계 선택에서 표가 나온 경우에만 연다. 엑셀로 불러온 단어장은
                 * 선택이 비어 있어, 2단계에서 몇 개 고르고 생성하면 표 전체가 새 결과로 바뀐다.
                 */}
                {fixes.has('more') &&
                  (selections.length ? (
                    <button className="btn sm" onClick={() => setStep('select')}>
                      ② 표제어 더 고르기 →
                    </button>
                  ) : (
                    <span className="hint">
                      불러온 단어장이라 엑셀에서 줄을 더한 뒤 ③ 화면의 <strong>고친 엑셀 불러오기</strong>로 올리면
                      됩니다.
                    </span>
                  ))}
                {fixes.has('fill') && (
                  <button className="btn sm" onClick={() => setStep('result')}>
                    ③ 단어장 표에서 채우기 →
                  </button>
                )}
                {/* 표제어 수 자체가 모자라면 배정을 다시 해도 채워지지 않으므로 권하지 않는다 */}
                {fixes.has('shuffle') && stats.usable >= stats.required && (
                  <button className="btn sm" onClick={reallocate} disabled={genBusy}>
                    배정 다시 하기
                  </button>
                )}
              </div>
              {fixes.has('more') && selections.length > 0 && (
                <p className="hint" style={{ margin: 0 }}>
                  더 고른 뒤에는 생성 창에서 <strong>바뀐 표제어만 생성</strong>을 고르면 새로 고른 것만 만듭니다.
                </p>
              )}
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
            조건이 까다로운 PART 부터 낱말을 나눠 담습니다. 같은 말은 형태만 달라도 한 시험지에 두 번 나오지
            않습니다. {quiz.seed == null ? '단어장 순서대로 배정했습니다.' : '단어장 순서를 무작위로 섞어 배정했습니다.'}
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
              단어장에 있는 뜻과 표제어로 그대로 만들어집니다. 어구는 낱말 수를 괄호로 알려줍니다. PART IV 문장에 나오는
              말은 되도록 넣지 않습니다(답이 보이므로).
            </p>
            <table className="quiz-preview">
              <tbody>
                {partI.map((q) => (
                  <tr key={q.rowId}>
                    <td className="qn">{q.no}</td>
                    <td>
                      {q.prompt}
                      {meanings[q.rowId] && <span className="qa-note"> · 바꾼 뜻</span>}
                    </td>
                    <td className="qa">{q.answer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PartOneChecks
              data={gen?.byPart?.I}
              hasGen={Boolean(gen)}
              notes={partINotes}
              busy={genBusy}
              onCheck={() => runGenerate(['I'])}
              onApply={setMeaning}
            />
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

            {/* 학생이 써야 하는 다른 문항의 정답이 글에 그대로 보이는 곳 (Week 03 검수 23 · 24 · 25번) */}
            {exposures.length > 0 && (
              <div className="notice-box">
                <strong>다른 문항의 정답이 글에 드러남 {exposures.length}건</strong> — {exposures.map((e) => e.text).join(' · ')}.
                PART IV 문항이면 붙인 앞뒤 문장을 떼거나 <strong>배정 다시 하기</strong>로 바꾸고, PART V · VI 면 그 PART 만
                다시 만드세요.
              </div>
            )}

            {partIV.items.map((it) => (
              <PartFourItem
                key={it.rowId}
                item={{ ...it, ...(context[it.rowId] || {}) }}
                passages={passages}
                rows={rows}
                warnings={exposures.filter((e) => e.rowId === it.rowId)}
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
            영영풀이 · 어휘 관계 · 유의어 고르기 · 글 빈칸 문항을 AI 가 만듭니다. 만든 문항은 아래에서 확인하고,
            마음에 들지 않으면 다시 만들 수 있습니다. PART I 은 우리말 뜻이 다른 낱말로도 읽히는지 함께 점검합니다
            (결과는 위 PART I 칸).
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
                <GeneratedPart
                  key={key}
                  partKey={key}
                  data={gen.byPart[key]}
                  choices={gen.choices[key]}
                  busy={genBusy}
                  onRegenerate={() => runGenerate([key])}
                />
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
          <HeadFields />
          <p className="hint" style={{ margin: 0 }}>
            A4 두 쪽 — 1쪽에 PART I~IV, 2쪽에 PART V~VI. 위에서 붙인 앞뒤 문장도 그대로 들어갑니다.
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

/**
 * 시험지 머리의 빈칸(연도 · 반 · 주차)과 제목을 채우는 칸, 그리고 docx 에 찍힐 머리 줄 미리보기.
 * 비워 둔 칸은 docx 에 손으로 쓸 빈칸으로 남는다. 제목은 1단계의 제목 칸과 같은 값이다 —
 * 단어장을 불러와 1단계를 건너뛴 경우에도 여기서 고칠 수 있어야 한다.
 */
function HeadFields() {
  const { docTitle, quizHead, setDocTitle, setQuizHead } = useStore()
  const { lead, week, fromTitle } = testHeadParts(docTitle, quizHead)
  // 제목에 연도 · 주차가 들어 있으면 그 칸은 제목 값을 쓴다 — 칸을 잠그고 무엇을 쓰는지 보여준다
  const field = (key, label, props) => {
    const taken = fromTitle[key]
    return (
      <div className={`field head-${key}`}>
        <label htmlFor={`head-${key}`}>{label}</label>
        <input
          id={`head-${key}`}
          type="text"
          value={taken || quizHead[key]}
          onChange={(e) => setQuizHead({ [key]: e.target.value })}
          disabled={Boolean(taken)}
          title={taken ? '제목에 들어 있는 값을 씁니다. 바꾸려면 제목을 고치세요' : undefined}
          {...props}
        />
      </div>
    )
  }

  return (
    <div className="head-fields">
      <div className="head-inputs">
        {field('year', '연도', { placeholder: '202__', maxLength: 4, inputMode: 'numeric' })}
        <div className="field head-title">
          <label htmlFor="head-title">제목</label>
          <input
            id="head-title"
            type="text"
            value={docTitle}
            maxLength={DOC_TITLE_MAX}
            onChange={(e) => setDocTitle(e.target.value)}
            placeholder={DEFAULT_TITLE}
          />
        </div>
        {field('klass', '반', { placeholder: '빈칸', maxLength: 10 })}
        {field('week', '주차', { placeholder: '빈칸', maxLength: 6 })}
      </div>
      <div className="head-preview" aria-label="시험지 머리 미리보기">
        <span className="hp-lead">{lead}</span>
        <span className="hp-week">{week}</span>
        <span className="hp-title">VOCABULARY TEST</span>
        <span className="hp-name">이름: ____________</span>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        비워 둔 칸은 시험지에 빈칸(202__ · _____반 · Week #)으로 남아 손으로 쓸 수 있습니다. 제목은 엑셀 첫 줄과
        내려받는 파일 이름에도 쓰입니다.
        {(fromTitle.year || fromTitle.week) &&
          ` 제목에 ${[fromTitle.year && '연도', fromTitle.week && '주차'].filter(Boolean).join(' · ')}가 들어 있어 그 값을 머리 칸에 옮겨 씁니다.`}
      </p>
    </div>
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
function GeneratedPart({ partKey, data, choices, busy, onRegenerate }) {
  if (!data) return null
  const bad = data.issues?.length > 0 || data.error

  return (
    <div className={`quiz-part${bad ? ' short' : ''}`}>
      <div className="qp-head">
        <span className="qp-no">PART {partKey}</span>
        <span className="qp-label">{PART_TITLE[partKey]}</span>
        {data.durationMs != null && <span className="qi-words">{Math.round(data.durationMs / 1000)}초</span>}
        {/* 검사에 걸린 PART 하나 때문에 네 PART 를 다 다시 만들지 않는다 */}
        <button
          className={`btn sm${bad ? '' : ' ghost'}`}
          style={{ marginLeft: 'auto' }}
          onClick={onRegenerate}
          disabled={busy}
          title="이 PART 만 다시 만듭니다. 다른 PART 는 그대로 둡니다"
        >
          이 PART 만 다시
        </button>
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
              → {partThreeAnswers(it).join(' · ')}
              {partThreeAnswers(it).length > 1 && ' (모두 정답)'} · {it.relation}
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
              {it.hard && <span className="qgen-tag">고난도</span>}
              {(it.choices || []).map((c, k) => {
                const isAnswer = (it.answers || []).includes(k + 1)
                // 정답은 파랑, 버리는 선지는 흐리게 — 근접 오답이 무엇인지 한눈에 보이게
                const role = (it.roles || [])[k]
                const style = isAnswer
                  ? { color: 'var(--primary)', fontWeight: 600 }
                  : role === '버림'
                    ? { textDecoration: 'line-through' }
                    : undefined
                return (
                  <span key={k} style={style} title={role ? `${role}${role === '버림' ? ' (반대 방향 쉬운 말)' : role === '근접' ? ' 오답' : ''}` : undefined}>
                    {`①②③④⑤`[k]} {c}
                    {'   '}
                  </span>
                )
              })}
            </p>
            <p className="qgen-line dim">오답 {wrongReasons(it) || it.wrongWhy}</p>
            {it.answerCheck && (
              <p className="qgen-line dim">
                {/* 만든 뒤 정답 없이 다시 풀어 본 결과. 걸린 것은 PART 머리의 검사 목록에도 뜬다 */}
                복수 정답 점검 —{' '}
                {it.answerCheck.error
                  ? `실패 (${it.answerCheck.error})`
                  : answerCheckIssues(it, '').length
                    ? '걸림 (위 검사 목록 참고)'
                    : '통과'}
              </p>
            )}
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

/**
 * PART I 점검 결과 — 정답 말고도 학생이 써 낼 만한 말이 있는 문항 (Week 03 검수 5 · 7번).
 * 흔한 말이 먼저 떠오르면(다르게 → differently) 좁힌 뜻을 제안하고 한 번에 바꾼다. 바꾼 뜻은 이 시험지에만 쓰이고
 * 단어장 표는 그대로다 — 표를 고치면 만든 시험지가 지워지기 때문이다.
 * 들어맞기만 하는 말이면(정서적인 → emotional) 채점 기준을 정하라고 알린다. 둘 다 정답해설에 채점 참고로 실린다.
 */
function PartOneChecks({ data, hasGen, notes, busy, onCheck, onApply }) {
  if (!hasGen) {
    return <p className="hint p1-check">문항을 만들 때 우리말 뜻이 다른 낱말로도 읽히는지 함께 점검합니다.</p>
  }
  if (!data || data.error) {
    return (
      <p className="hint p1-check">
        {data?.error ? `PART I 점검 실패 — ${data.error} ` : '이 시험지는 PART I 점검 없이 만들었습니다. '}
        <button className="btn sm" onClick={onCheck} disabled={busy}>
          PART I 점검
        </button>
      </p>
    )
  }
  if (!notes.length) {
    return <p className="hint p1-check">PART I 점검 — 다른 낱말로 읽힐 문항이 없습니다.</p>
  }

  return (
    <div className="notice-box p1-check">
      <strong>다른 낱말로도 쓸 수 있는 문항 {notes.length}개</strong>
      <ul className="p1-list">
        {notes.map((n) => {
          const words = n.others.map((o) => `${o.word}${o.why ? ` (${o.why})` : ''}`).join(' · ')
          return (
            <li key={n.rowId}>
              <b>{n.no}번</b> {n.answer} —{' '}
              {n.applied ? (
                <>
                  뜻을 &ldquo;{n.meaning}&rdquo; 로 바꿨습니다.{' '}
                  <button className="btn ghost sm" onClick={() => onApply(n.rowId, null)}>
                    단어장 뜻으로 되돌리기
                  </button>
                </>
              ) : n.likely ? (
                <>
                  &ldquo;{n.meaning}&rdquo; 을 보고 {words} 를 먼저 쓸 수 있습니다.
                  {n.suggestion ? (
                    <>
                      {' '}
                      <button className="btn sm" onClick={() => onApply(n.rowId, n.suggestion)}>
                        &ldquo;{n.suggestion}&rdquo; 로 바꾸기
                      </button>
                    </>
                  ) : (
                    ' 단어장 뜻을 고치거나 채점 기준을 정해 두세요.'
                  )}
                </>
              ) : (
                <>
                  {words} 도 &ldquo;{n.meaning}&rdquo; 에 들어맞습니다. 정답으로 인정할지 채점 기준을 정해 두세요.
                </>
              )}
            </li>
          )
        })}
      </ul>
      <span className="hint">
        정답해설에 채점 참고로 함께 실립니다. 바꾼 뜻은 이 시험지에만 쓰입니다 — 다음 시험지에도 이어지게 하려면 엑셀에서
        단어장 뜻을 &ldquo;차등적으로, 다르게&rdquo; 처럼 고쳐 두세요.
      </span>
    </div>
  )
}

/**
 * 문항 하나. 앞뒤 문장을 붙이고 뗄 수 있고, 40단어를 넘으면 알려준다.
 * rows 를 함께 넘겨야 표(엑셀)에서 고친 출처 문장이 지문 원문 대신 실린다 — 내려받는 문서(docData)와 같은 값을 쓴다.
 */
function PartFourItem({ item, passages, rows, warnings = [], onAdjust }) {
  const r = renderPartIVItem(item, passages, rows)
  return (
    <div className={`quiz-item${r.overLimit || warnings.length ? ' over' : ''}`}>
      <div className="qi-head">
        <span className="qi-no">{item.no}</span>
        <span className="qi-form">{FORM_LABEL[item.form]}</span>
        <span className="qi-answer">{item.answer}</span>
        <span className="qi-src">{item.passageLabel ?? item.passageNo}</span>
        <span className={`qi-words${r.overLimit ? ' over' : ''}`}>{r.words} / 40 단어</span>
      </div>

      <p className="qi-text">{r.text}</p>
      {warnings.map((w) => (
        <p key={w.text} className="qi-warn">
          {w.text}
        </p>
      ))}

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
