/**
 * 고를 수 있는 Claude 모델. 화면의 선택 목록, 서버의 허용 목록, 저장된 상태의 이전이
 * 모두 이 목록을 본다. 모델을 바꿀 때는 여기만 고치면 된다.
 */
export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (속도 우선)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (정확도 우선)' },
]

export const DEFAULT_MODEL = 'claude-sonnet-5-5'

export const isKnownModel = (id) => MODELS.some((m) => m.id === id)

/**
 * 예전에 저장된 모델 값을 지금 목록의 같은 계열로 옮긴다.
 * 계열을 알 수 없으면 기본 모델로 둔다.
 */
export function upgradeModel(id) {
  if (isKnownModel(id)) return id
  if (/opus/i.test(String(id))) return 'claude-opus-5-5'
  return DEFAULT_MODEL
}
