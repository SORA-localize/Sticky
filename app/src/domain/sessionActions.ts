import type { Session } from '../types/sticky'

export function appendSession(sessions: Session[], session: Session) {
  return [...sessions, session]
}

export function upsertSession(sessions: Session[], nextSession: Session) {
  const withoutTarget = sessions.filter((session) => session.id !== nextSession.id)
  return [...withoutTarget, nextSession]
}

export function removeSession(sessions: Session[], sessionId: string) {
  return sessions.filter((session) => session.id !== sessionId)
}

export function removeMemo(sessions: Session[], sessionId: string, memoId: string) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : { ...session, memos: session.memos.filter((memo) => memo.id !== memoId) },
  )
}

export function closeMemo(sessions: Session[], sessionId: string, memoId: string) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          memos: session.memos.map((memo) =>
            memo.id !== memoId ? memo : { ...memo, isVisible: false },
          ),
        },
  )
}

export function closeSessionInState(sessions: Session[], sessionId: string) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          isOpen: false,
          memos: session.memos.map((memo) => ({ ...memo, isVisible: false })),
        },
  )
}

export function updateMemoContent(
  sessions: Session[],
  sessionId: string,
  memoId: string,
  updater: (content: string, savedContent: string) => { content?: string; savedContent?: string; isDirty: boolean },
) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          memos: session.memos.map((memo) => {
            if (memo.id !== memoId) {
              return memo
            }

            const next = updater(memo.content, memo.savedContent)
            return {
              ...memo,
              content: next.content ?? memo.content,
              savedContent: next.savedContent ?? memo.savedContent,
              isDirty: next.isDirty,
            }
          }),
        },
  )
}

export function updateMemoDirtyState(
  sessions: Session[],
  sessionId: string,
  memoId: string,
  nextValue: string,
) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          memos: session.memos.map((memo) =>
            memo.id !== memoId
              ? memo
              : {
                  ...memo,
                  isDirty: nextValue !== memo.savedContent,
                },
          ),
        },
  )
}

export function clearSessionSlotIndices(sessions: Session[], sessionId: string) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          memos: session.memos.map((memo) => ({ ...memo, slotIndex: null })),
        },
  )
}

export function clearMemoSlotIndex(sessions: Session[], sessionId: string, memoId: string) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          memos: session.memos.map((memo) =>
            memo.id !== memoId ? memo : { ...memo, slotIndex: null },
          ),
        },
  )
}

export function moveSessionMemos(
  sessions: Session[],
  sessionId: string,
  memoOrigins: Record<string, { x: number; y: number }>,
  deltaX: number,
  deltaY: number,
) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          memos: session.memos.map((memo) => {
            const origin = memoOrigins[memo.id]
            if (!origin) return memo
            return {
              ...memo,
              position: { x: origin.x + deltaX, y: origin.y + deltaY },
            }
          }),
        },
  )
}

export function moveMemo(
  sessions: Session[],
  sessionId: string,
  memoId: string,
  x: number,
  y: number,
) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          memos: session.memos.map((memo) =>
            memo.id !== memoId
              ? memo
              : {
                  ...memo,
                  position: { x, y },
                },
          ),
        },
  )
}

export function resizeMemo(
  sessions: Session[],
  sessionId: string,
  memoId: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          memos: session.memos.map((memo) =>
            memo.id !== memoId
              ? memo
              : {
                  ...memo,
                  position: { x, y },
                  size: { width, height },
                },
          ),
        },
  )
}

export function toggleSessionPinnedState(sessions: Session[], sessionId: string, pinned: boolean) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          memos: session.memos.map((memo) => ({ ...memo, isPinned: pinned })),
        },
  )
}

export function toggleMemoPinnedState(sessions: Session[], sessionId: string, memoId: string) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          memos: session.memos.map((memo) =>
            memo.id !== memoId ? memo : { ...memo, isPinned: !memo.isPinned },
          ),
        },
  )
}

export function incrementMemoEditingKey(sessions: Session[], sessionId: string, memoId: string) {
  return sessions.map((session) =>
    session.id !== sessionId
      ? session
      : {
          ...session,
          memos: session.memos.map((memo) =>
            memo.id !== memoId
              ? memo
              : {
                  ...memo,
                  editingKey: memo.editingKey + 1,
                },
          ),
        },
  )
}
