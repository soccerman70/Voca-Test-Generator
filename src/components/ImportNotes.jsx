/**
 * 불러온 단어장에서 표제어 형태(surface)를 어떻게 되찾았는지 알린다.
 * 1단계(단어장 불러오기)와 3단계(고친 엑셀 불러오기)가 함께 쓴다.
 *
 * 조용히 넘어가면 PART IV 가 왜 단조로운지, 정답 형태가 왜 원형인지 아무도 모른다.
 */
export default function ImportNotes({ warnings }) {
  const { metaMissing, unmatched = [], recovered, failed } = warnings

  return (
    <>
      {metaMissing && (
        <p className="hint">
          형태 정보가 없는 예전 파일입니다. 출처 문장에서 되짚어
          <strong> {recovered.length}개</strong>를 찾았습니다.
        </p>
      )}

      {!metaMissing && unmatched.length > 0 && (
        <p className="hint">
          엑셀에서 새로 넣었거나 출처 문장을 고친 줄 <strong>{unmatched.length}개</strong>는 출처 문장에서 형태를
          다시 찾았습니다.
        </p>
      )}

      {failed.length > 0 && (
        <div className="notice-box">
          <strong>{failed.length}개</strong>는 지문에 나온 형태를 찾지 못해 표제어를 그대로 씁니다 — PART IV 의 형태
          다양성이 그만큼 줄어듭니다.
          <div className="import-failed">{failed.join(' · ')}</div>
        </div>
      )}
    </>
  )
}
