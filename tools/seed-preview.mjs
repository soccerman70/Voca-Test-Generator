/** 화면 확인용: 샘플 상태를 localStorage에 심는 임시 페이지를 만든다. 인자: select | result */
import mammoth from 'mammoth'
import { readFile, writeFile } from 'node:fs/promises'
import { splitPassages, sentenceAt } from '../src/lib/passages.js'
import { tokenize, locateSurface } from '../src/lib/tokenize.js'
import { guessPos, guessLevel } from '../src/lib/posLite.js'

const MODE = process.argv[2] || 'select'
const { value: text } = await mammoth.extractRawText({ buffer: await readFile('samples/샘플지문.docx') })
const { passages, method } = splitPassages(text)

const PICKS = [
  [1, 'absorption', 'manual'], [1, 'lose track of time', 'manual'], [1, 'effortless', 'manual'],
  [1, 'immersed', 'ai'], [1, 'challenging', 'ai'],
  [2, 'reshaped', 'manual'], [2, 'brought about', 'ai'], [2, 'degradation', 'ai'], [2, 'pressing', 'manual'],
  [3, 'underpins', 'ai'], [3, 'cascading effects', 'manual'], [3, 'safeguard', 'ai'],
  [4, 'sift through', 'ai'], [4, 'erode', 'manual'], [4, 'compelling', 'ai'],
]

const selections = []
for (const [no, surface, origin] of PICKS) {
  const p = passages.find((x) => x.no === no)
  const hit = locateSurface(p.english, tokenize(p.english), surface)
  if (!hit) continue
  const sentence = sentenceAt(p.english, hit.start)
  selections.push({
    id: `seed${selections.length}`, passageId: p.id, passageNo: p.no,
    from: hit.from, to: hit.to, start: hit.start, end: hit.end,
    surface: p.english.slice(hit.start, hit.end),
    sentence,
    pos: guessPos(surface, sentence), level: guessLevel(surface), origin,
  })
}

// 결과 화면 확인용 더미 (AI 품질은 tools/ai-test.mjs 에서 따로 검증한다)
const ENRICHED = {
  absorption: ['명', '몰입', '', [['absorb', '동'], ['absorbent', '형']], ['engrossment', 'immersion'], []],
  'lose track of time': ['구', '시간 가는 줄 모르다', '', [], ['become unaware of time'], [['keep track of time', 5]]],
  effortless: ['형', '힘들이지 않는', '', [['effort', '명'], ['effortlessly', '부']], ['easy', 'smooth'], [['laborious', 4]]],
  immersed: ['동', '몰두하다', '수동태 과거분사', [['immersion', '명'], ['immersive', '형']], ['absorb', 'engross'], []],
  challenging: ['형', '힘든', '', [['challenge', '명']], ['demanding', 'difficult'], [['effortless', 4]]],
  reshaped: ['동', '재편하다', '과거형', [['reshaping', '명']], ['transform', 'remodel'], []],
  'brought about': ['구', '야기하다', '완료형 과거분사', [], ['cause', 'give rise to'], [['prevent', 4]]],
  degradation: ['명', '악화', '', [['degrade', '동'], ['degradable', '형']], ['deterioration', 'decline'], [['improvement', 4]]],
  pressing: ['형', '시급한', '', [['pressure', '명']], ['urgent', 'critical'], [['trivial', 3]]],
  underpins: ['동', '뒷받침하다', '3인칭 단수 현재형', [['underpinning', '명']], ['support', 'sustain'], [['undermine', 5]]],
  'cascading effects': ['구', '연쇄적인 영향', '', [], ['chain reactions', 'knock-on effects'], []],
  safeguard: ['명', '안전장치', '', [['safeguarding', '명']], ['protection', 'defense'], [['threat', 3]]],
  'sift through': ['구', '샅샅이 훑다', '', [], ['comb through', 'examine'], []],
  erode: ['동', '약화시키다', '', [['erosion', '명'], ['erosive', '형']], ['weaken', 'undermine'], [['strengthen', 5]]],
  compelling: ['형', '설득력 있는', '', [['compel', '동']], ['persuasive', 'convincing'], [['unconvincing', 4]]],
}

const rows = selections.map((s, i) => {
  const e = ENRICHED[s.surface.toLowerCase()] || null
  if (!e) {
    return { ...s, headword: s.surface, normalizationNote: '', pos: '', meaning: '', derivatives: [], synonyms: [], antonyms: [], missing: true }
  }
  const [pos, meaning, note, derivatives, synonyms, antonyms] = e
  return {
    id: s.id, passageNo: s.passageNo, surface: s.surface, sentence: s.sentence,
    headword: note ? baseForm(s.surface) : s.surface,
    normalizationNote: note, pos, meaning,
    derivatives: derivatives.map(([word, p]) => ({ word, pos: p })),
    synonyms: synonyms.map((word) => ({ word })),
    antonyms: antonyms.map(([word, confidence]) => ({ word, confidence })),
    missing: i === 8, // 누락 표시 UI 확인용
  }
})

function baseForm(s) {
  return { immersed: 'immerse', reshaped: 'reshape', 'brought about': 'bring about', underpins: 'underpin' }[s.toLowerCase()] || s
}

const antonymCount = rows.filter((r) => r.antonyms.length).length
const state = {
  state: {
    step: ['input', 'select', 'result'].includes(MODE) ? MODE : 'select',
    fileInfo: { name: '샘플지문.docx', kind: 'docx' }, rawText: text,
    passages, splitMethod: method, targetCount: 20, mode: 'manual', model: 'claude-opus-5-5',
    focusedId: passages[0].id, selections,
    rows: MODE === 'result' ? rows : [],
    antonymStats: MODE === 'result'
      ? { count: antonymCount, total: rows.length, ratio: antonymCount / rows.length, removed: 2, belowMin: false }
      : null,
  },
  version: 1,
}

await writeFile(
  'public/__seed.html',
  `<!doctype html><meta charset="utf-8"><script>
localStorage.setItem('jls-vocab-store', ${JSON.stringify(JSON.stringify(state))});
location.replace('/');
</script>`
)
console.log(`seed(${MODE}) 완료: 지문 ${passages.length}개, 선택 ${selections.length}개, 결과 ${state.state.rows.length}행`)
