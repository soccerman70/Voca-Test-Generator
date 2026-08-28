/**
 * 앱 전역 상태.
 * 100개를 고르는 작업은 길어질 수 있으므로 새로고침에도 살아남도록 localStorage에 보존한다.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { sentenceAt } from './lib/passages.js'
import { guessPos, guessLevel } from './lib/posLite.js'

let seq = 0
const nextId = () => `s${Date.now().toString(36)}${(seq += 1).toString(36)}`

/**
 * 단어장·시험지 제목 최대 길이. 입력창의 maxLength 와 같은 값을 쓴다.
 * 시험지 헤더가 "2026 여름학기 · Week 3 · 어휘심화 SET B" 형태라 30자는 있어야 한다.
 */
export const DOC_TITLE_MAX = 30

const initial = {
  step: 'input', // input | select | result
  // 올린 파일 목록. [{ key, name, kind, text, tag, count, method, markerStyle }]
  // 파일이 둘 이상이면 지문 번호에 tag 를 붙여 "11강-1"처럼 구별한다.
  // 원문(text)까지 들고 있어야 파일을 더하거나 뺄 때 전체를 다시 나눌 수 있다.
  sourceFiles: [],
  passages: [],

  targetCount: 100,
  mode: 'manual', // manual | ai
  model: 'claude-sonnet-5',
  docTitle: '', // 엑셀 첫 줄과 파일 이름에 쓰는 단어장 제목

  focusedId: null,
  selections: [],

  rows: [],
  antonymStats: null,
  lastUsage: null,
  // 단어장을 확정한 시각. 시험지 화면으로 넘어가는 순간 찍히고, 표를 한 칸이라도 고치면 지워진다.
  confirmedAt: null,
}

export const useStore = create(
  persist(
    (set, get) => ({
      ...initial,

      reset: () => set({ ...initial }),

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
        set({
          rows,
          passages,
          sourceFiles: [],
          selections: [],
          focusedId: passages[0]?.id ?? null,
          docTitle,
          antonymStats: null,
          lastUsage: null,
          confirmedAt: Date.now(),
          step: 'quiz',
        }),

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
      setDocTitle: (docTitle) => set({ docTitle: String(docTitle).slice(0, DOC_TITLE_MAX) }),
      setMode: (mode) => set({ mode }),
      setModel: (model) => set({ model }),
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
        set({ rows, antonymStats, lastUsage, step: 'result', confirmedAt: null }),

      updateRow: (id, patch) =>
        set((s) => ({
          rows: s.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
          confirmedAt: null,
        })),

      removeRow: (id) =>
        set((s) => ({ rows: s.rows.filter((r) => r.id !== id), confirmedAt: null })),
    }),
    {
      name: 'jls-vocab-store',
      // v2 — 기본 모델을 Sonnet으로 내렸다. 저장된 상태가 옛 기본값(Opus)을 붙들고 있으면
      // 기본값을 바꿔도 이미 쓰던 브라우저에는 영영 반영되지 않으므로 한 번 덮어쓴다.
      // v3 — 파일 하나(fileInfo)에서 여러 파일(sourceFiles)로 바뀌었고, 지문에 label 이 생겼다.
      // 예전에 저장된 지문에는 label 이 없어 화면에 빈 번호가 찍히므로 입력 단계부터 다시 받는다.
      // v4 — 파일을 뒤에 더 올릴 수 있게 되면서 파일마다 원문(text)과 열쇠(key)를 들고 있어야 한다.
      // 그 전에 저장된 파일 목록에는 둘 다 없어 "파일 빼기"가 빈 지문을 만든다.
      version: 4,
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
        return next
      },
      partialize: (s) => ({
        step: s.step,
        sourceFiles: s.sourceFiles,
        passages: s.passages,
        targetCount: s.targetCount,
        mode: s.mode,
        model: s.model,
        docTitle: s.docTitle,
        focusedId: s.focusedId,
        selections: s.selections,
        rows: s.rows,
        antonymStats: s.antonymStats,
        confirmedAt: s.confirmedAt,
      }),
    }
  )
)

/** 선택 목록을 지문 순서 → 등장 순서로 정렬 */
export function sortSelections(selections) {
  return [...selections].sort((a, b) => a.passageNo - b.passageNo || a.start - b.start)
}
