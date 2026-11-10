/**
 * 단어장을 확정하고 시험지 화면으로 넘어가기 직전의 점검.
 * 헤더의 ④ 칩과 3단계의 "단어시험지 만들기" 버튼이 함께 쓴다.
 *
 * 채워야 할 칸이 비어 있으면 알리고 진행 여부를 묻는다. 막지는 않는다 —
 * 일부러 비워두는 경우가 있고, 시험지로 갔다가 돌아와 고치면 확정이 다시 풀린다.
 */
export function confirmBeforeQuiz(rows) {
  const blank = rows.filter((r) => !String(r.headword || '').trim() || !String(r.meaning || '').trim()).length
  const missing = rows.filter((r) => r.missing).length
  if (!blank && !missing) return true

  const notes = []
  if (blank) notes.push(`표제어나 뜻이 빈 항목 ${blank}개`)
  if (missing) notes.push(`AI 응답이 누락된 항목 ${missing}개`)

  return confirm(`${notes.join('\n')}\n\n이 상태로 단어장을 확정하고 시험지 화면으로 넘어갈까요?`)
}
