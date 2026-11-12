/**
 * 앱 전역 상태.
 * 100개를 고르는 작업은 길어질 수 있으므로 새로고침에도 살아남도록 localStorage에 보존한다.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { sentenceAt } from './lib/passages.js'
import { guessPos, guessLevel } from './lib/posLite.js'
import { DEFAULT_MODEL, DEFAULT_EFFORT, upgradeModel } from './lib/models.js'
import { headFromTitle, splitTitleHead } from './lib/exportDocx.js'

let seq = 0
const nextId = () => `s${Date.now().toString(36)}${(seq += 1).toString(36)}`

/**
 * 단어장·시험지 제목 최대 길이. 입력창의 maxLength 와 같은 값을 쓴다.
 * 엑셀 첫 줄 · 파일 이름 · 시험지 머리(연도와 반 사이)에 들어간다. 연도 · 반 · 주차는 따로 받는다(quizHead).
 */
export const DOC_TITLE_MAX = 30

const initial = {
  step: 'input', // input | select | result
  // 올린 파일 목록. [{ key, name, kind, text, tag, count, method, markerStyle, markerSections }]
  // 파일이 둘 이상이면 지문 번호에 tag 를 붙여 "11강-1"처럼 구별한다.
  // 원문(text)까지 들고 있어야 파일을 더하거나 뺄 때 전체를 다시 나눌 수 있다.
  sourceFiles: [],
  passages: [],

  targetCount: 100,
  mode: 'manual', // manual | ai
  model: DEFAULT_MODEL,
  effort: DEFAULT_EFFORT, // claude -p --effort. 답하기 전에 얼마나 생각할지
  docTitle: '', // 엑셀 첫 줄과 파일 이름에 쓰는 단어장 제목
  // 시험지 머리의 빈칸. 비워 두면 docx 에 손으로 쓸 빈칸(202__ · _____반 · Week #)이 남는다.
  // 연도는 처음에만 올해로 미리 채운다. 학기 이름의 연도는 달력과 다를 수 있어(2026년 11월의 2027 겨울학기)
  // 한 번 정한 연도는 초기화 · 되살리기에도 남기고, 제목 · 불러온 단어장에 든 연도를 옮겨 적는다(keepYear · headFromTitle).
  quizHead: { year: String(new Date().getFullYear()), klass: '', week: '' },

  focusedId: null,
  selections: [],

  rows: [],
  antonymStats: null,
  lastUsage: null,
  // 단어장을 확정한 시각. 시험지 화면으로 넘어가는 순간 찍히고, 표를 한 칸이라도 고치면 지워진다.
  confirmedAt: null,

  // 만든 단어시험지 목록. [{ id, no, seed, createdAt, parts, shortages, ok, thirdDetail, context, gen }]
  // 시험지 화면은 탭을 옮기면 내려가므로 여기 두어야 AI 문항과 앞뒤 문장 조절이 살아남는다.
  quizzes: [],
  activeQuizId: null,
  // 생성 중인 시험지별 진행률. 보존하지 않는다 — 새로고침하면 요청 자체가 끊긴다.
  quizBusy: {},

  // 작업을 통째로 바꾸기 직전(다른 단어장 불러오기 · 초기화)의 작업 한 벌. 화면 위 띠의 "되살리기"로 돌아온다.
  // { reason, savedAt, title, counts: { passages, selections, rows }, state }
  prevWork: null,
}

/** 단어장이 바뀌면 만든 시험지는 더 이상 맞지 않는다. 단어장을 바꾸는 동작마다 함께 비운다. */
const NO_QUIZZES = { quizzes: [], activeQuizId: null }

/**
 * 작업 한 벌을 이루는 값. 모델 · effort 같은 설정과 생성 중 표시(quizBusy)는 작업이 아니라 빠진다.
 * 보관한 작업을 되살릴 때 이 값들만 통째로 돌려놓는다.
 */
const WORK_KEYS = [
  'step', 'sourceFiles', 'passages', 'targetCount', 'mode', 'docTitle', 'quizHead', 'focusedId',
  'selections', 'rows', 'antonymStats', 'lastUsage', 'confirmedAt', 'quizzes', 'activeQuizId',
]

const hasWork = (s) => s.rows.length > 0 || s.selections.length > 0 || s.passages.length > 0

/** 지금 쓰는 연도 — 제목에 든 연도가 있으면 그것(머리에 찍히는 값), 없으면 연도 칸 */
const currentYear = (s) => splitTitleHead(s.docTitle).year || s.quizHead?.year || initial.quizHead.year

/**
 * 지금 작업을 통째로 밀어내는 동작 직전에 한 벌 보관한다. 경고는 습관처럼 넘기게 되므로
 * 바꾼 뒤에도 돌아올 길을 남긴다. 보관할 것이 없으면(빈 작업) 이미 보관한 것을 그대로 둔다.
 * 칸은 하나다 — 새로 보관하면 그 전 것은 밀려난다.
 */
const keepPrev = (s, reason) => ({
  prevWork: hasWork(s)
    ? {
        reason,
        savedAt: Date.now(),
        title: s.docTitle || s.sourceFiles[0]?.name || '',
        counts: { passages: s.passages.length, selections: s.selections.length, rows: s.rows.length },
        state: Object.fromEntries(WORK_KEYS.map((k) => [k, s[k]])),
      }
    : s.prevWork,
})

export const useStore = create(
  persist(
    (set, get) => ({
      ...initial,

      // 초기화도 작업을 통째로 지우므로 한 벌 보관한다. 모델 · effort 설정은 예전처럼 기본값으로 돌아간다.
      // 연도는 남긴다 — 올해로 돌아가면 2027 겨울학기 시험지에 2026 이 찍힌다(Week 02 검수)
      reset: () =>
        set((s) => ({ ...initial, ...keepPrev(s, '초기화'), quizHead: { ...initial.quizHead, year: currentYear(s) } })),

      /**
       * 보관한 작업을 되살린다. 지금 작업은 버리지 않고 그 자리에 대신 보관한다 —
       * 되살리기를 잘못 눌러도 한 번 더 누르면 돌아온다.
       * 연도는 지금 값을 둔다 — 보관한 작업에는 미리 채운 올해가 들어 있을 수 있다.
       */
      restorePrevWork: () =>
        set((s) =>
          s.prevWork
            ? {
                ...s.prevWork.state,
                quizHead: { ...initial.quizHead, ...s.prevWork.state.quizHead, year: currentYear(s) },
                quizBusy: {},
                ...keepPrev({ ...s, prevWork: null }, '되살리기'),
              }
            : {}
        ),

      dismissPrevWork: () => set({ prevWork: null }),

      /* ---------------- 입력 ---------------- */

      /**
       * 파일 구성이 바뀔 때마다 (처음 올릴 때, 뒤에 더 올릴 때, 하나 뺄 때) 부른다.
       * 남아 있는 지문의 선택은 그대로 살리고 번호·표기만 새로 붙인다.
       * 파일이 늘면 "1번"이 "11강-1"로 바뀌므로 표기를 갱신하지 않으면 어긋난다.
       */
      loadPassages: ({ passages, sourceFiles = [] }) =>
        set((s) => {
          const byId = new Map(passages.map((p) => [p.id, p]))
          const selections = s.selections
            .filter((sel) => byId.has(sel.passageId))
            .map((sel) => {
              const p = byId.get(sel.passageId)
              return { ...sel, passageNo: p.no, passageLabel: p.label }
            })
          return {
            passages,
            sourceFiles,
            selections,
            // 지문 구성이 달라졌으면 이미 만든 표는 더 이상 맞지 않는다. 다시 생성해야 한다.
            rows: [],
            antonymStats: null,
            ...NO_QUIZZES,
            focusedId: passages.some((p) => p.id === s.focusedId) ? s.focusedId : passages[0]?.id ?? null,
            // 지문을 만들었다고 바로 넘기지 않는다. 같은 화면에서 미리보기로 분할을 확인하고
            // 개수·선택 방식·모델을 정한 뒤 "표제어 선택 시작" 버튼으로 넘어가는 것이 원래 흐름이다.
            step: 'input',
          }
        }),

      /**
       * 이미 만든 단어장 XLSX 를 그대로 받아 ④ 시험지 화면으로 간다.
       *
       * 지문 입력·표제어 선택을 거치지 않은 경로이므로 sourceFiles 와 selections 는 비운다.
       * 남겨두면 불러온 단어장과 아무 관계 없는 선택이 화면에 남아 어긋난다.
       * 불러오는 순간이 곧 확정이다 — 표를 고치면 updateRow 가 확정을 푼다.
       */
      loadWordbook: ({ rows, passages = [], docTitle = '' }) =>
        set((s) => ({
          ...keepPrev(s, '단어장 불러오기'),
          rows,
          passages,
          sourceFiles: [],
          selections: [],
          focusedId: passages[0]?.id ?? null,
          docTitle,
          // 단어장 제목(2027 겨울학기 완성반 Week02)의 연도 · 주차를 머리 칸에도 적어 둔다 — 제목을 바꿔도 남는다
          quizHead: headFromTitle(docTitle, s.quizHead),
          antonymStats: null,
          lastUsage: null,
          confirmedAt: Date.now(),
          step: 'quiz',
          ...NO_QUIZZES,
        })),

      /**
       * 3단계에서, 내보냈다가 엑셀에서 고친 단어장을 다시 받는다. 화면은 3단계에 머문다.
       *
       * 표는 파일 내용으로 통째로 바꾼다 — 보이는 시트가 내용의 진실이다.
       * 같은 지문에서 나온 단어장이면 지문·표제어 선택은 그대로 둔다. 다른 작업의 파일이면
       * loadWordbook 처럼 함께 바꾼다. 남겨두면 표와 상관없는 지문이 시험지 문맥에 쓰인다.
       * 반의어 통계와 생성 시간은 AI 가 만든 표에 대한 것이라 지운다.
       * 표가 바뀌었으니 확정도 풀린다 (updateRow 와 같은 규칙).
       */
      replaceWordbook: ({ rows, passages = [], docTitle = '', sameWork }) =>
        set((s) => ({
          rows,
          antonymStats: null,
          lastUsage: null,
          confirmedAt: null,
          step: 'result',
          ...NO_QUIZZES,
          quizHead: headFromTitle(docTitle || s.docTitle, s.quizHead),
          ...(sameWork
            ? { docTitle: docTitle || s.docTitle }
            : {
                // 다른 작업의 파일이면 지문 · 표제어 선택까지 밀려나므로 한 벌 보관한다
                ...keepPrev(s, '다른 단어장 불러오기'),
                passages,
                sourceFiles: [],
                selections: [],
                focusedId: passages[0]?.id ?? null,
                docTitle,
              }),
        })),

      setPassages: (passages) =>
        set((s) => {
          const byId = new Map(passages.map((p) => [p.id, p]))
          return {
            passages,
            // 지문 구성이 바뀌면 사라진 지문의 선택은 버리고, 남은 것은 번호를 다시 붙인다
            selections: s.selections
              .filter((sel) => byId.has(sel.passageId))
              .map((sel) => {
                const p = byId.get(sel.passageId)
                return { ...sel, passageNo: p.no, passageLabel: p.label }
              }),
            focusedId: byId.has(s.focusedId) ? s.focusedId : passages[0]?.id ?? null,
          }
        }),

      setTargetCount: (n) => set({ targetCount: Math.max(1, Math.min(500, Number(n) || 0)) }),
      /**
       * 바뀌기 직전 제목의 연도 · 주차를 머리 칸으로 옮긴다. 제목에 연도가 있는 동안은 제목 값이 머리에 찍히므로
       * 겉으로는 달라지지 않고, 제목에서 연도를 지우는 순간 그 연도가 칸에 남아 있다
       * (Week 02: `2027 겨울학기 완성반 Week02` 를 `겨울학기 단어학습` 으로 바꾸자 칸의 2026 이 찍혔다).
       */
      setDocTitle: (docTitle) =>
        set((s) => ({ docTitle: String(docTitle).slice(0, DOC_TITLE_MAX), quizHead: headFromTitle(s.docTitle, s.quizHead) })),
      setQuizHead: (patch) => set((s) => ({ quizHead: { ...s.quizHead, ...patch } })),
      setMode: (mode) => set({ mode }),
      setModel: (model) => set({ model }),
      setEffort: (effort) => set({ effort }),
      /**
       * 시험지 화면으로 넘어가는 것이 곧 단어장 확정이다.
       * 별도 확정 버튼을 두지 않는 대신, 표를 고치면 확정이 풀려(updateRow·removeRow)
       * 시험지와 단어장이 어긋난 채로 남지 않는다.
       */
      setStep: (step) => set(step === 'quiz' ? { step, confirmedAt: Date.now() } : { step }),
      setFocused: (id) => set({ focusedId: id }),

      /* ---------------- 표제어 선택 ---------------- */

      /** 토큰 구간을 표제어로 추가한다. 겹치는 기존 선택이 있으면 그것을 제거(언클릭)한다. */
      toggleRange: ({ passageId, from, to, start, end, surface, origin = 'manual' }) => {
        const state = get()
        const passage = state.passages.find((p) => p.id === passageId)
        if (!passage || !surface) return

        const overlapping = state.selections.filter(
          (sel) => sel.passageId === passageId && sel.start < end && start < sel.end
        )

        if (overlapping.length) {
          const ids = new Set(overlapping.map((o) => o.id))
          set({ selections: state.selections.filter((sel) => !ids.has(sel.id)) })
          return
        }

        const sentence = sentenceAt(passage.english, start)
        const selection = {
          id: nextId(),
          passageId,
          passageNo: passage.no,
          passageLabel: passage.label,
          from,
          to,
          start,
          end,
          surface,
          sentence,
          pos: guessPos(surface, sentence),
          level: guessLevel(surface),
          origin,
        }
        set({ selections: [...state.selections, selection] })
      },

      removeSelection: (id) => set((s) => ({ selections: s.selections.filter((sel) => sel.id !== id) })),

      clearSelections: () => set({ selections: [] }),

      clearSelectionsBy: (origin) =>
        set((s) => ({ selections: s.selections.filter((sel) => sel.origin !== origin) })),

      replaceSelections: (selections) => set({ selections }),

      /* ---------------- 결과 ---------------- */

      setRows: (rows, antonymStats, lastUsage) =>
        set({ rows, antonymStats, lastUsage, step: 'result', confirmedAt: null, ...NO_QUIZZES }),

      // edited — 사람이 표에서 고친 줄. 3단계 거르기의 "내가 고친 줄"이 본다. 엑셀에는 담지 않는다.
      updateRow: (id, patch) =>
        set((s) => ({
          rows: s.rows.map((r) => (r.id === id ? { ...r, ...patch, edited: true } : r)),
          confirmedAt: null,
          ...NO_QUIZZES,
        })),

      removeRow: (id) =>
        set((s) => ({ rows: s.rows.filter((r) => r.id !== id), confirmedAt: null, ...NO_QUIZZES })),

      /**
       * 줄 지우기를 되돌린다. snapshot 은 지우기 직전의 { rows, quizzes, activeQuizId, confirmedAt } 이다.
       * 줄을 지우면 만든 시험지까지 함께 지워지므로 그것도 돌려놓는다. 지운 뒤에 표가 또 바뀌었으면
       * 돌려놓을 모습이 지금과 맞지 않으므로, 부르는 쪽(ResultTable)이 그 전에 되돌리기를 거둔다.
       */
      restoreRows: ({ rows, quizzes, activeQuizId, confirmedAt }) => set({ rows, quizzes, activeQuizId, confirmedAt }),

      /* ---------------- 시험지 ---------------- */

      /** 새 시험지를 목록 끝에 더하고 그것을 연다. */
      addQuiz: (quiz) => set((s) => ({ quizzes: [...s.quizzes, quiz], activeQuizId: quiz.id })),

      /**
       * patch 는 객체이거나, 지금 시험지를 받아 바꿀 값을 돌려주는 함수다.
       * 생성 도중 단어장이 바뀌어 시험지가 지워졌다면 없는 id 라 아무 일도 없다.
       */
      updateQuiz: (id, patch) =>
        set((s) => ({
          quizzes: s.quizzes.map((q) =>
            q.id === id ? { ...q, ...(typeof patch === 'function' ? patch(q) : patch) } : q
          ),
        })),

      removeQuiz: (id) =>
        set((s) => {
          const quizzes = s.quizzes.filter((q) => q.id !== id)
          const activeQuizId = s.activeQuizId === id ? quizzes[quizzes.length - 1]?.id ?? null : s.activeQuizId
          return { quizzes, activeQuizId }
        }),

      setActiveQuiz: (id) => set({ activeQuizId: id }),

      setQuizBusy: (id, progress) =>
        set((s) => {
          const quizBusy = { ...s.quizBusy }
          if (progress) quizBusy[id] = progress
          else delete quizBusy[id]
          return { quizBusy }
        }),
    }),
    {
      name: 'jls-vocab-store',
      // v2 — 기본 모델을 Sonnet으로 내렸다. 저장된 상태가 옛 기본값(Opus)을 붙들고 있으면
      // 기본값을 바꿔도 이미 쓰던 브라우저에는 영영 반영되지 않으므로 한 번 덮어쓴다.
      // v3 — 파일 하나(fileInfo)에서 여러 파일(sourceFiles)로 바뀌었고, 지문에 label 이 생겼다.
      // 예전에 저장된 지문에는 label 이 없어 화면에 빈 번호가 찍히므로 입력 단계부터 다시 받는다.
      // v4 — 파일을 뒤에 더 올릴 수 있게 되면서 파일마다 원문(text)과 열쇠(key)를 들고 있어야 한다.
      // 그 전에 저장된 파일 목록에는 둘 다 없어 "파일 빼기"가 빈 지문을 만든다.
      // v5 — 모델이 5.5 세대로 바뀌고 effort 가 생겼다. 저장된 옛 이름(claude-sonnet-5 등)은 선택 목록에 없어
      // 그대로 두면 화면에 엉뚱한 값이 찍히고 서버는 말없이 기본 모델로 돌린다. upgradeModel 로 옮기고
      // (Opus 계열은 Opus 5.5, 나머지는 기본 Opus 5.5) effort 는 기본값(medium)으로 둔다.
      version: 5,
      migrate: (state, from) => {
        let next = from < 2 ? { ...state, model: initial.model } : state
        if (from < 4) {
          // fileInfo/splitMethod/splitStyle 은 partialize 에서 빠졌으므로 다음 저장 때 사라진다
          next = {
            ...next,
            sourceFiles: initial.sourceFiles,
            passages: initial.passages,
            selections: initial.selections,
            rows: initial.rows,
            step: initial.step,
          }
        }
        if (from < 5) next = { ...next, model: upgradeModel(next.model), effort: initial.effort }
        return next
      },
      partialize: (s) => ({
        step: s.step,
        sourceFiles: s.sourceFiles,
        passages: s.passages,
        targetCount: s.targetCount,
        mode: s.mode,
        model: s.model,
        effort: s.effort,
        docTitle: s.docTitle,
        quizHead: s.quizHead,
        focusedId: s.focusedId,
        selections: s.selections,
        rows: s.rows,
        antonymStats: s.antonymStats,
        confirmedAt: s.confirmedAt,
        quizzes: s.quizzes,
        activeQuizId: s.activeQuizId,
        prevWork: s.prevWork,
      }),
    }
  )
)

/** 선택 목록을 지문 순서 → 등장 순서로 정렬 */
export function sortSelections(selections) {
  return [...selections].sort((a, b) => a.passageNo - b.passageNo || a.start - b.start)
}
