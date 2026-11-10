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
  const { step, passages, rows, setStep, reset } = useStore()

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
              if (confirm('지문·선택·생성 결과를 모두 지우고 처음부터 시작할까요?')) reset()
            }}
          >
            초기화
          </button>
        </div>
      </header>

      <main className="app-main">
        {step === 'input' && <SetupPanel />}
        {step === 'select' && <Workspace />}
        {step === 'result' && <ResultTable />}
        {step === 'quiz' && <QuizPanel />}
      </main>
    </div>
  )
}
