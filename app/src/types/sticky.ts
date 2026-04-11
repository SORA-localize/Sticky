export type Selection =
  | { type: 'none' }
  | { type: 'memo'; sessionId: string; memoId: string }
  | { type: 'editing'; sessionId: string; memoId: string }
  | { type: 'session'; sessionId: string }

export type ResizeDirection = 'nw' | 'ne' | 'sw' | 'se'

export type Memo = {
  id: string
  content: string
  savedContent: string
  isPinned: boolean
  isVisible: boolean
  isDirty: boolean
  position: { x: number; y: number }
  size: { width: number; height: number }
  slotIndex: number | null
  editingKey: number
}

export type Session = {
  id: string
  colorSlot: number
  isOpen: boolean
  memos: Memo[]
}

export type DragInteraction = {
  type: 'drag'
  sessionId: string
  memoId: string
  startX: number
  startY: number
  originX: number
  originY: number
  active: boolean
}

export type SessionDragInteraction = {
  type: 'session-drag'
  sessionId: string
  startX: number
  startY: number
  memoOrigins: Record<string, { x: number; y: number }>
  active: boolean
}

export type ResizeInteraction = {
  type: 'resize'
  sessionId: string
  memoId: string
  direction: ResizeDirection
  startX: number
  startY: number
  originX: number
  originY: number
  originWidth: number
  originHeight: number
}

export type Interaction = DragInteraction | SessionDragInteraction | ResizeInteraction

export type ContextMenu = {
  sessionId: string
  x: number
  y: number
} | null

export type DeleteConfirm =
  | { type: 'session'; sessionId: string }
  | { type: 'memo'; sessionId: string; memoId: string }
  | null

export type SessionPayload = {
  id: string
  colorSlot: number
  isOpen: boolean
}

export type MemoPayload = {
  id: string
  sessionId: string
  content: string
  title: string
  posX: number
  posY: number
  width: number
  height: number
  slotIndex: number | null
  isOpen: boolean
  isPinned: boolean
}

export type MemoRow = {
  id: string
  sessionId: string
  content: string
  posX: number
  posY: number
  width: number
  height: number
  slotIndex: number | null
  isOpen: boolean
  isPinned: boolean
}

export type SessionRow = {
  id: string
  colorSlot: number
  isOpen: boolean
  memos: MemoRow[]
}
