import SetupPanel from './components/SetupPanel.jsx'
import Workspace from './components/Workspace.jsx'
import ResultTable from './components/ResultTable.jsx'
import QuizPanel from './components/QuizPanel.jsx'
import { useStore } from './store.js'
import { STEPS, stepIndex } from './lib/steps.js'
import { confirmBeforeQuiz } from './lib/quizGate.js'
import { version } from '../package.json'

/** 화면에 찍는 버전. package.json 이 원본이다. 끝자리가 0 이면 줄여 "1.0" 으로 보인다. */
const APP_VERSION = version.replace(/\.0$/, '')

export default function App() {
  const { step, passages, rows, prevWork, setStep, reset, restorePrevWork, dismissPrevWork } = useStore()

  const available = {
    input: true,
    select: passages.length > 0,
    result: rows.length > 0,
    // 시험지는 단어장이 있어야 낼 수 있다
    quiz: rows.length > 0,
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-logo">
            <img src="/logo-jls.png" alt="정상어학원 고등부" />
          </span>
        </div>

        <div className="brand-titles">
          <div className="brand-title-row">
            <h1>
              <img src="/vlist-title.png" alt="JLS 고등부 심화 단어장" />
            </h1>
            <span className="app-version" title={`버전 ${version}`}>
              v{APP_VERSION}
            </span>
          </div>
        </div>

        <div className="steps">
          <div className="step-track">
            {STEPS.map((s) => {
              const done = available[s.key] && stepIndex(s.key) < stepIndex(step)
              const state = step === s.key ? 'active' : done ? 'done' : ''
              return (
                <button
                  key={s.key}
                  className={`step-chip ${state}`.trim()}
                  disabled={!available[s.key]}
                  onClick={() => {
                    if (!available[s.key]) return
                    // 시험지로 넘어가는 순간 단어장이 확정된다. 빈 칸이 있으면 한 번 짚어준다.
                    if (s.key === 'quiz' && !confirmBeforeQuiz(rows)) return
                    setStep(s.key)
                  }}
                >
                  <span className="step-no">{s.no}</span>
                  <span className="step-label">{s.label}</span>
                </button>
              )
            })}
          </div>
          <button
            className="btn ghost sm"
            title="모든 작업 내용을 지우고 처음부터 시작합니다"
            onClick={() => {
              const ok = confirm(
                '지문·선택·생성 결과를 모두 지우고 처음부터 시작할까요?\n' +
                  '지운 작업은 화면 위 띠의 [되살리기]로 한 번 돌아올 수 있습니다.'
              )
              if (ok) reset()
            }}
          >
            초기화
          </button>
        </div>
      </header>

      {prevWork && <PrevWorkBar prev={prevWork} onRestore={restorePrevWork} onDismiss={dismissPrevWork} />}

      <main className="app-main">
        {step === 'input' && <SetupPanel />}
        {step === 'select' && <Workspace />}
        {step === 'result' && <ResultTable />}
        {step === 'quiz' && <QuizPanel />}
      </main>
    </div>
  )
}

/**
 * 작업을 통째로 바꾼 뒤(다른 단어장 불러오기 · 초기화) 헤더 아래에 남는 띠.
 * 경고를 넘겨 버렸거나 바꾼 뒤에야 알아차려도 되살릴 수 있게, 닫거나 다음에 또 바꿀 때까지 남는다.
 * 되살리면 지금 작업이 그 자리에 대신 보관되므로 잘못 눌러도 한 번 더 누르면 돌아온다.
 */
function PrevWorkBar({ prev, onRestore, onDismiss }) {
  const { title, counts, reason } = prev
  const what =
    [counts.selections && `표제어 선택 ${counts.selections}개`, counts.rows && `단어장 ${counts.rows}줄`]
      .filter(Boolean)
      .join(' · ') || `지문 ${counts.passages}개`

  return (
    <div className="prev-bar" role="status">
      <span className="prev-text">
        {reason} 전의 작업 <strong>{title ? `‘${title}’` : '(제목 없음)'}</strong> — {what} — 을 보관해 두었습니다.
      </span>
      <button className="btn sm" onClick={onRestore}>
        되살리기
      </button>
      <button className="btn ghost sm" onClick={onDismiss} title="보관한 작업을 지우고 이 띠를 닫습니다">
        보관 지우기
      </button>
    </div>
  )
}
