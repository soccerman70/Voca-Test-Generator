/**
 * 표제어 선택을 몇 개만 바꿨을 때 표 전체를 다시 만들지 않기 위한 계획.
 *
 * 표의 줄 id 는 그 줄을 만든 선택의 id 와 같다(normalizeBatch 가 그대로 넘긴다). 그래서
 * 지금 선택과 지금 표를 id 로 맞대면 무엇이 새로 들어왔고 무엇이 빠졌는지 정확히 갈린다.
 * 남은 줄은 표에 있는 그대로 둔다 — 표에서 손으로 고친 파생어·유의어·반의어가 살아야 한다.
 *
 * id 가 어긋나도 같은 줄로 보는 경우가 있다. 지문에서 잘못 뺐다가 같은 낱말을 다시 고르면
 * 선택 id 가 새로 생기고, 엑셀에서 새로 넣은 줄도 선택과 id 가 다르다. 그래서 id 로 못 찾은
 * 선택은 같은 표현·같은 출처 문장의 줄을 한 번 더 찾는다.
 */

const keyOf = (x) => `${x.surface}\u0000${x.sentence}`

/**
 * @param {Array} sorted 지금 선택 — 표에 놓일 순서대로 (sortSelections)
 * @param {Array} rows   지금 표
 * @returns {{ entries: Array<{selection, row, regenerate}>, toGenerate: Array, added: number,
 *             retry: number, kept: number, removed: Array, changed: boolean }}
 *   entries 는 sorted 와 같은 순서다. row 는 이어 쓸 기존 줄(없으면 null),
 *   regenerate 는 AI 로 새로 만들어야 하는지다. AI 응답에서 빠졌던 줄(missing)도 다시 만든다.
 */
export function planRegeneration(sorted, rows) {
  const byId = new Map(rows.map((r) => [String(r.id), r]))
  const used = new Set()
  const match = new Array(sorted.length).fill(null)

  // 1) id 가 같은 줄부터 — 다른 선택의 줄을 표현이 같다는 이유로 가로채지 않게 먼저 묶는다
  sorted.forEach((sel, i) => {
    const row = byId.get(String(sel.id))
    if (row) {
      match[i] = row
      used.add(row)
    }
  })

  // 2) 남은 선택은 같은 표현·같은 출처 문장의 남은 줄을 찾는다
  const spare = new Map()
  for (const r of rows) {
    if (used.has(r)) continue
    if (!spare.has(keyOf(r))) spare.set(keyOf(r), [])
    spare.get(keyOf(r)).push(r)
  }
  sorted.forEach((sel, i) => {
    if (match[i]) return
    const row = spare.get(keyOf(sel))?.shift()
    if (row) {
      match[i] = row
      used.add(row)
    }
  })

  const entries = sorted.map((selection, i) => {
    const row = match[i]
    return { selection, row, regenerate: !row || Boolean(row.missing) }
  })
  const toGenerate = entries.filter((e) => e.regenerate).map((e) => e.selection)
  const removed = rows.filter((r) => !used.has(r))

  return {
    entries,
    toGenerate,
    added: entries.filter((e) => !e.row).length,
    retry: entries.filter((e) => e.row?.missing).length,
    kept: entries.filter((e) => !e.regenerate).length,
    removed,
    changed: toGenerate.length > 0 || removed.length > 0,
  }
}

/**
 * 계획대로 남길 줄과 새로 만든 줄을 선택 순서대로 엮는다.
 * 남긴 줄은 내용을 건드리지 않고, id·지문 번호만 지금 선택에 맞춘다
 * (다시 고른 낱말이면 id 가 바뀌었고, 지문 구성이 바뀌었으면 번호가 바뀌었다).
 *
 * @param {object} plan  planRegeneration 결과
 * @param {Array}  fresh 새로 만든 줄 — id 가 선택 id 와 같다
 */
export function mergeRows(plan, fresh) {
  const byId = new Map((fresh || []).map((r) => [String(r.id), r]))
  return plan.entries
    .map(({ selection: s, row, regenerate }) => {
      const made = regenerate ? byId.get(String(s.id)) : null
      if (made) return made
      // 다시 만들려던 줄을 못 받았으면 있던 줄이라도 남긴다 (빠졌던 줄은 빠진 채로)
      return row ? { ...row, id: s.id, passageNo: s.passageNo } : null
    })
    .filter(Boolean)
}
