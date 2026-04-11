import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  SESSION_COLOR_VARS,
  SLOT_PERCENTAGES,
} from '../constants/sticky'
import type { Selection, Session, SessionRow } from '../types/sticky'

export function generateTitle(content: string): string {
  return content.slice(0, 10)
}

export function buildSessionsFromRows(rows: SessionRow[]): Session[] {
  return rows.map((row) => ({
    id: row.id,
    colorSlot: row.colorSlot,
    isOpen: row.isOpen,
    memos: row.memos.map((memo) => ({
      id: memo.id,
      content: memo.content,
      savedContent: memo.content,
      isPinned: memo.isPinned,
      isVisible: memo.isOpen,
      isDirty: false,
      position: { x: memo.posX, y: memo.posY },
      size: { width: memo.width, height: memo.height },
      slotIndex: memo.slotIndex,
      editingKey: 0,
    })),
  }))
}

export function nextId(prefix: string, current: number) {
  return `${prefix}-${current.toString(36)}`
}

export function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 1440, height: 900 }
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

export function getSlotPosition(slotIndex: number) {
  const { width, height } = getViewportSize()
  const slot = SLOT_PERCENTAGES[slotIndex] ?? SLOT_PERCENTAGES[0]

  return {
    x: Math.round(Math.max(0, Math.min(width - DEFAULT_WIDTH, width * slot.x - DEFAULT_WIDTH / 2))),
    y: Math.round(Math.max(0, Math.min(height - DEFAULT_HEIGHT, height * slot.y - DEFAULT_HEIGHT / 2))),
  }
}

export function getOpenSessions(sessions: Session[]) {
  return sessions.filter((session) => session.isOpen)
}

export function getOpenMemos(sessions: Session[]) {
  return getOpenSessions(sessions).flatMap((session) =>
    session.memos.filter((memo) => memo.isVisible),
  )
}

export function findUnusedColorSlot(sessions: Session[]) {
  const usedSlots = new Set(getOpenSessions(sessions).map((session) => session.colorSlot))

  for (let index = 0; index < SESSION_COLOR_VARS.length; index += 1) {
    if (!usedSlots.has(index)) {
      return index
    }
  }

  return null
}

export function findAvailableSlotIndices(sessions: Session[], count: number) {
  const usedSlots = new Set(
    getOpenMemos(sessions)
      .map((memo) => memo.slotIndex)
      .filter((slotIndex): slotIndex is number => slotIndex !== null),
  )

  const available: number[] = []

  for (let index = 0; index < SLOT_PERCENTAGES.length; index += 1) {
    if (!usedSlots.has(index)) {
      available.push(index)
    }

    if (available.length === count) {
      return available
    }
  }

  return null
}

export function reassignReopenedSessionSlots(
  currentSessions: Session[],
  reopenedSession: Session,
) {
  const occupiedSessions = currentSessions.filter((session) => session.id !== reopenedSession.id)
  const slotIndices = findAvailableSlotIndices(occupiedSessions, reopenedSession.memos.length)

  if (slotIndices === null) {
    return null
  }

  return {
    ...reopenedSession,
    isOpen: true,
    memos: reopenedSession.memos.map((memo, index) => {
      const slotIndex = slotIndices[index]
      return {
        ...memo,
        isVisible: true,
        isDirty: false,
        slotIndex,
        position: getSlotPosition(slotIndex),
      }
    }),
  }
}

export function getEditingEntry(selection: Selection, sessions: Session[]) {
  if (selection.type !== 'editing') return null
  const session = sessions.find((currentSession) => currentSession.id === selection.sessionId)
  const memo = session?.memos.find((currentMemo) => currentMemo.id === selection.memoId)
  return session && memo ? { session, memo } : null
}

export function getSelectedEntry(selection: Selection, sessions: Session[]) {
  if (selection.type !== 'memo') return null
  const session = sessions.find((currentSession) => currentSession.id === selection.sessionId)
  const memo = session?.memos.find((currentMemo) => currentMemo.id === selection.memoId)
  return session && memo ? { session, memo } : null
}
