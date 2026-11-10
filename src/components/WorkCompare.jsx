/**
 * 불러올 단어장을 지금 작업과 나란히 보여준다. 1단계 · 3단계 불러오기 패널이 함께 쓴다.
 *
 * 예전에는 "지금까지의 작업을 지우고 바꿀까요?" 라는 늘 같은 확인 창 하나였다. 같은 지문의
 * 단어장이든 전혀 다른 주차의 것이든 문구가 같아 습관처럼 넘기게 되고, week7 을 만들다 week6 을
 * 불러와 표제어 선택을 통째로 잃었다. 무엇과 무엇이 바뀌는지 숫자로 보여주고, 다른 작업이면
 * 붉은 상자로 따로 세운다.
 *
 * @param {ReturnType<import('../lib/importXlsx.js').compareWork>} cmp
 * @param {boolean} keepsSelections 같은 작업일 때 표제어 선택이 남는 경로인가 (3단계 불러오기)
 */
export default function WorkCompare({ cmp, keepsSelections = false }) {
  if (!cmp.hasWork) return null
  const { current, incoming, sameWork, sharedHeadwords, sentenceHits } = cmp
  const lost = [
    current.passages && `지문 ${current.passages}개`,
    current.selections && `표제어 선택 ${current.selections}개`,
    current.rows && `단어장 ${current.rows}줄`,
  ]
    .filter(Boolean)
    .join(' · ')

  if (sameWork) {
    // 같은 지문의 단어장 — 3단계에서는 선택이 남으므로 따로 알릴 것이 없다
    if (keepsSelections) return null
    return (
      <div className="notice-box">
        지금 작업과 <strong>같은 지문</strong>에서 나온 단어장입니다. 표제어 선택 {current.selections}개와 단어장{' '}
        {current.rows}줄은 이 파일 내용으로 바뀝니다. 바꾼 뒤에도 화면 위 띠의 <strong>되살리기</strong>로 돌아올 수
        있습니다.
      </div>
    )
  }

  return (
    <div className="work-compare" role="alert">
      <div className="wc-head">지금 작업과 다른 단어장입니다</div>
      <table className="wc-table">
        <tbody>
          <tr>
            <th>지금 작업</th>
            <td className="wc-title">{current.title ? `‘${current.title}’` : '제목 없음'}</td>
            <td>{lost}</td>
          </tr>
          <tr>
            <th>불러올 파일</th>
            <td className="wc-title">{incoming.title ? `‘${incoming.title}’` : '제목 없음'}</td>
            <td>표제어 {incoming.rows}개</td>
          </tr>
        </tbody>
      </table>
      <p className="wc-facts">
        겹치는 표제어 <strong>{sharedHeadwords}개</strong> · 출처 문장 {incoming.rows}개 중{' '}
        <strong>{sentenceHits}개</strong>만 지금 지문에 있습니다.
      </p>
      <p className="wc-facts">
        바꾸면 지금 작업({lost})은 이 파일 내용으로 바뀝니다. 바꾼 뒤에도 화면 위 띠의{' '}
        <strong>되살리기</strong>로 한 번은 돌아올 수 있습니다.
      </p>
    </div>
  )
}
