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
