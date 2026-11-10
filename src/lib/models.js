/**
 * 고를 수 있는 Claude 모델과 생각 깊이(effort). 화면의 선택 목록, 서버의 허용 목록,
 * 저장된 상태의 이전이 모두 이 목록을 본다. 바꿀 때는 여기만 고치면 된다.
 * 서버는 Windows 에서 셸을 거쳐 claude 를 부르므로, 인자로 나가는 값은 이 목록으로만 막는다.
 */
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (정확도 우선)' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (속도 우선)' },
]

/** 유의어 · 반의어 · 파생어 품질을 위해 Opus 5.5 가 기본이다 (2026-11-04) */
export const DEFAULT_MODEL = 'claude-opus-5-5'

export const isKnownModel = (id) => MODELS.some((m) => m.id === id)

/**
 * 예전에 저장된 모델 값을 지금 목록으로 옮긴다.
 * Opus 계열은 Opus 5.5 로, 그 밖에는 기본 모델로 둔다.
 */
export function upgradeModel(id) {
  if (isKnownModel(id)) return id
  if (/opus/i.test(String(id))) return 'claude-opus-5-5'
  return DEFAULT_MODEL
}

/** claude -p --effort — 답하기 전에 얼마나 생각할지 */
export const EFFORTS = [
  { id: 'low', label: 'low · 가장 빠름' },
  { id: 'medium', label: 'medium · 기본' },
  { id: 'high', label: 'high' },
  { id: 'xhigh', label: 'xhigh' },
  { id: 'max', label: 'max · 가장 느림' },
]

export const DEFAULT_EFFORT = 'medium'

export const isKnownEffort = (id) => EFFORTS.some((e) => e.id === id)

/**
 * 1단계에서 고르는 "AI 작업 방식". 선생님에게 모델 이름과 effort 는 낯선 말이라
 * 둘을 묶어 세 가지로 보인다. 원래의 두 선택 칸은 "고급 설정" 안에 남는다.
 * 보통이 기본값(DEFAULT_MODEL · DEFAULT_EFFORT)과 같아야 처음 켠 화면에서 "보통"이 골라져 있다.
 */
export const PRESETS = [
  { id: 'fast', label: '빠르게', model: 'claude-sonnet-5-5', effort: 'low', note: 'Sonnet 5.5 · 짧게 생각합니다. 가장 빠릅니다.' },
  { id: 'normal', label: '보통', model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, note: 'Opus 5.5 · 기본값입니다.' },
  {
    id: 'careful',
    label: '꼼꼼하게',
    model: 'claude-opus-5-5',
    effort: 'high',
    note: 'Opus 5.5 · 더 오래 생각합니다. 가장 느립니다.',
  },
]

/** 지금 모델 · effort 가 어느 묶음과 같은지. 고급 설정에서 따로 골랐으면 null */
export const presetOf = (model, effort) => PRESETS.find((p) => p.model === model && p.effort === effort) ?? null

/** 화면에 짧게 찍을 이름 — 묶음이면 그 이름, 아니면 "Opus 5.5 · high" */
export function aiLabel(model, effort) {
  const preset = presetOf(model, effort)
  if (preset) return preset.label
  const name = MODELS.find((m) => m.id === model)?.label.replace(/\s*\(.*\)$/, '') || model
  return `${name} · ${effort}`
}
