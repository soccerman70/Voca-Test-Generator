import { STEPS } from '../lib/steps.js'

/**
 * 1단계 화면 상단의 작업 흐름 안내 스트립.
 *
 * 이건 방향 안내(direction)지 작업 자체가 아니므로, 한 줄에 눕히고 글자를 눌러
 * 배경으로 물러나게 했다. 클릭 동작은 없다.
 *
 * 칸은 헤더의 단계 칩과 같은 네 단계다(같은 STEPS 를 본다). 예전에는 01~07 일곱 칸이라
 * 헤더의 1~4 와 번호가 어긋나 "지금 몇 단계인지"를 두 번 세게 했다. 단계 안에서 하는 일은
 * 번호 없이 그 칸 아래에 차례로 적는다.
 */

/** 2단계의 두 갈래. 실제 설정 칸(표제어 선택 방식)과 같은 순서다. */
const SELECT_OPTIONS = [
  { key: 'manual', title: '직접 선택', icon: 'pencil' },
  { key: 'ai', title: 'AI 자동 추출', icon: 'sparkles' },
]

export default function WorkflowBanner() {
  return (
    <section className="wb" aria-label="이용 방법">
      <div className="wb-head">
        <span className="wb-tag">HOW IT WORKS</span>
      </div>

      <ol className="wb-flow">
        {STEPS.map((s, i) => (
          <li className="wb-cell" key={s.key}>
            {/* 첫 칸 앞에는 이어받을 것이 없다 */}
            {i > 0 && (
              <span className="wb-arrow">
                <ArrowIcon />
              </span>
            )}
            <div className="wb-body">
              <div className="wb-title">
                <span className="wb-num">{s.no}</span>
                <span className="wb-label">{s.label}</span>
              </div>
              {s.key === 'select' ? (
                <div className="wb-opts">
                  {SELECT_OPTIONS.map((o) => (
                    <span className="wb-opt" key={o.key}>
                      <span className="wb-opt-icon">
                        {o.icon === 'pencil' ? <PencilIcon /> : <SparklesIcon />}
                      </span>
                      {o.title}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="wb-guide">
                  {s.guide.map((g, j) => (
                    <span key={g}>
                      {j > 0 && <span className="wb-then">→</span>}
                      {g}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * 아이콘은 SetupPanel 의 dz-icon 과 같은 규격으로 맞춘다 —
 * 24 뷰박스, currentColor, strokeWidth 1.5. 크기는 CSS 에서 정한다.
 */
function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function SparklesIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
      <path d="M20 2v4" />
      <path d="M22 4h-4" />
      <circle cx="4" cy="20" r="2" />
    </svg>
  )
}

/** 칩 안에서 11px 로 그려지므로 다른 아이콘(1.5)보다 굵게 잡아야 선이 남는다. */
function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}
