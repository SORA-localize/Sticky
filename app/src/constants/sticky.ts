export const DRAG_THRESHOLD = 6
export const DEFAULT_WIDTH = 320
export const DEFAULT_HEIGHT = 240
export const MIN_WIDTH = 240
export const MIN_HEIGHT = 180
export const MAX_WIDTH = 520
export const MAX_HEIGHT = 420
export const MAX_OPEN_SESSIONS = 5
export const MAX_OPEN_MEMOS = 15

export const SESSION_COLOR_VARS = [
  'var(--session-red)',
  'var(--session-orange)',
  'var(--session-yellow)',
  'var(--session-green)',
  'var(--session-blue)',
]

// x: 5列を画面中央に配置（240px刻み、カード幅320pxと80px重なる設計）
// 1440px基準: 左端80px余白、右端80px余白、グリッド幅1280px
// y: 3段、行間243px（カード高240px、ほぼ隙間なし）
export const SLOT_PERCENTAGES = [
  { x: 0.17, y: 0.20 },
  { x: 0.33, y: 0.20 },
  { x: 0.50, y: 0.20 },
  { x: 0.67, y: 0.20 },
  { x: 0.83, y: 0.20 },
  { x: 0.17, y: 0.47 },
  { x: 0.33, y: 0.47 },
  { x: 0.50, y: 0.47 },
  { x: 0.67, y: 0.47 },
  { x: 0.83, y: 0.47 },
  { x: 0.17, y: 0.74 },
  { x: 0.33, y: 0.74 },
  { x: 0.50, y: 0.74 },
  { x: 0.67, y: 0.74 },
  { x: 0.83, y: 0.74 },
]
