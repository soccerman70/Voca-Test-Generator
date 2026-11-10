/**
 * 작업 네 단계. 헤더의 단계 칩과 1단계 화면의 안내 줄이 이 목록 하나를 본다.
 * 둘이 따로 적혀 있으면 번호와 이름이 어긋난다 — 예전에는 헤더가 1~4, 안내 줄이 01~07 이었다.
 *
 * guide 는 안내 줄에만 쓰는, 그 단계 안에서 차례로 하는 일이다.
 */
export const STEPS = [
  { key: 'input', no: 1, label: '지문 입력', guide: ['지문 파일 · 교재 텍스트 올리기'] },
  { key: 'select', no: 2, label: '표제어 선택', guide: [] },
  { key: 'result', no: 3, label: '단어장 생성', guide: ['파생어·유의어·반의어 생성', '검수'] },
  { key: 'quiz', no: 4, label: '단어시험지 생성', guide: ['항목 배치', '파트별 문항 생성', '시험지 내려받기'] },
]

export const stepIndex = (key) => STEPS.findIndex((s) => s.key === key)
