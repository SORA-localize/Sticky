import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Management } from './Management'
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  DRAG_THRESHOLD,
  MAX_HEIGHT,
  MAX_OPEN_MEMOS,
  MAX_OPEN_SESSIONS,
  MAX_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  SESSION_COLOR_VARS,
} from './constants/sticky'
import {
  appendSession,
  clearMemoSlotIndex,
  clearSessionSlotIndices,
  closeMemo,
  closeSessionInState,
  incrementMemoEditingKey,
  moveMemo,
  moveSessionMemos,
  removeMemo,
  removeSession,
  resizeMemo,
  toggleMemoPinnedState,
  toggleSessionPinnedState,
  upsertSession,
  updateMemoContent,
  updateMemoDirtyState,
} from './domain/sessionActions'
import {
  buildSessionsFromRows,
  findAvailableSlotIndices,
  findUnusedColorSlot,
  getEditingEntry,
  getOpenMemos,
  getSelectedEntry,
  getSlotPosition,
  getOpenSessions,
  nextId,
  reassignReopenedSessionSlots,
} from './domain/sessionHelpers'
import type {
  ContextMenu,
  DeleteConfirm,
  Interaction,
  Memo,
  ResizeDirection,
  Selection,
  Session,
} from './types/sticky'
import {
  closeSessionInDb,
  loadSessionsFromDb,
  saveSessionsToDb,
  startupCleanup,
  trashMemoInDb,
  trashSessionInDb,
} from './services/stickyDb'
import './App.css'

type OverlayResumePayload = {
  resumePassThrough: boolean
}

function App() {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view')
  if (view === 'management') {
    const tab = params.get('tab') ?? 'home'
    return <Management initialTab={tab} />
  }
  return <OverlayApp />
}

function OverlayApp() {
  const [clickThrough, setClickThrough] = useState(false)
  const [overlayInputMode, setOverlayInputMode] = useState<'interactive' | 'pass-through'>('interactive')
  const [sessions, setSessions] = useState<Session[]>([])
  const [selection, setSelection] = useState<Selection>({ type: 'none' })
  const [isComposing, setIsComposing] = useState(false)
  const [isSessionPickerVisible, setIsSessionPickerVisible] = useState(false)
  const [limitWarning, setLimitWarning] = useState<'session' | 'memo' | null>(null)
  const limitWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null)
  const contextMenuRef = useRef<HTMLElement | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm>(null)

  const idCounterRef = useRef({ session: 1, memo: 1 })
  const editorRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const interactionRef = useRef<Interaction | null>(null)
  const dragExceededRef = useRef(false)
  const draftContentRef = useRef<Record<string, string>>({})
  const cardRefs = useRef<Record<string, HTMLElement | null>>({})
  const sessionPickerRef = useRef<HTMLDivElement | null>(null)
  const resumePassThroughRef = useRef(false)

  const sessionsRef = useRef<Session[]>([])
  const selectionRef = useRef<Selection>({ type: 'none' })
  const deleteConfirmRef = useRef<DeleteConfirm>(null)
  const handleDeleteConfirmedRef = useRef<() => void>(() => {})
  const isComposingRef = useRef(false)
  const isSessionPickerVisibleRef = useRef(false)

  const getMemoIdentity = (sessionId: string, memoId: string) => `${sessionId}:${memoId}`
  const openMemoCount = getOpenMemos(sessions).length
  const overlayModeLabel = clickThrough ? 'through' : 'overlay'
  const overlayModeHint = clickThrough
    ? 'Cmd+Opt+/ to return'
    : 'Click or press Cmd+Opt+/'
  const markResumePassThrough = (enabled = clickThrough) => {
    if (enabled) {
      resumePassThroughRef.current = true
    }
  }

  const triggerLimitWarning = (kind: 'session' | 'memo') => {
    if (limitWarningTimerRef.current !== null) {
      clearTimeout(limitWarningTimerRef.current)
    }
    setLimitWarning(kind)
    limitWarningTimerRef.current = setTimeout(() => {
      setLimitWarning(null)
      limitWarningTimerRef.current = null
    }, 900)
  }

  const handleMemoContextMenu =
    (sessionId: string) => (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsSessionPickerVisible(false)
      setContextMenu({ sessionId, x: event.clientX, y: event.clientY })
    }

  const handleSelectSession = (sessionId: string) => {
    setSelection({ type: 'session', sessionId })
    setContextMenu(null)
  }

  const handleCloseSession = (sessionId: string) => {
    setSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.id !== sessionId
          ? session
          : {
              ...session,
              isOpen: false,
              memos: session.memos.map((memo) => ({ ...memo, isVisible: false })),
            },
      ),
    )
    setSelection((prev) => {
      if (prev.type === 'none') return prev
      if ('sessionId' in prev && prev.sessionId === sessionId) return { type: 'none' }
      return prev
    })
    setContextMenu(null)
  }

  const handleDeleteConfirmed = useCallback(async () => {
    const deleteConfirm = deleteConfirmRef.current
    if (!deleteConfirm) return
    if (deleteConfirm.type === 'session') {
      await trashSessionInDb(deleteConfirm.sessionId)
      setSessions((prev) => removeSession(prev, deleteConfirm.sessionId))
    } else {
      const { sessionId, memoId } = deleteConfirm
      await trashMemoInDb(memoId)
      setSessions((prev) => removeMemo(prev, sessionId, memoId))
    }
    setSelection({ type: 'none' })
    setDeleteConfirm(null)
  }, [])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  useEffect(() => {
    deleteConfirmRef.current = deleteConfirm
  }, [deleteConfirm])

  useEffect(() => {
    isComposingRef.current = isComposing
  }, [isComposing])

  useEffect(() => {
    isSessionPickerVisibleRef.current = isSessionPickerVisible
  }, [isSessionPickerVisible])

  useEffect(() => {
    handleDeleteConfirmedRef.current = handleDeleteConfirmed
  }, [handleDeleteConfirmed])

  const createMemo = (slotIndex: number): Memo => {
    const memoId = nextId('memo', idCounterRef.current.memo++)
    draftContentRef.current[memoId] = ''

    return {
      id: memoId,
      content: '',
      savedContent: '',
      isPinned: false,
      isVisible: true,
      isDirty: false,
      position: getSlotPosition(slotIndex),
      size: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
      slotIndex,
      editingKey: 0,
    }
  }

  const createSession = (
    memoCount: number,
    previousSessions: Session[],
  ): { session: Session; limitHit: null } | { session: null; limitHit: 'session' | 'memo' } | null => {
    if (memoCount < 1) {
      return null
    }

    const openSessionCount = getOpenSessions(previousSessions).length
    const openMemoCount = getOpenMemos(previousSessions).length

    if (openSessionCount + 1 > MAX_OPEN_SESSIONS) {
      return { session: null, limitHit: 'session' }
    }

    if (openMemoCount + memoCount > MAX_OPEN_MEMOS) {
      return { session: null, limitHit: 'memo' }
    }

    const colorSlot = findUnusedColorSlot(previousSessions)
    const slotIndices = findAvailableSlotIndices(previousSessions, memoCount)

    if (colorSlot === null || slotIndices === null) {
      return { session: null, limitHit: 'memo' }
    }

    const sessionId = nextId('session', idCounterRef.current.session++)

    return {
      session: {
        id: sessionId,
        colorSlot,
        isOpen: true,
        memos: slotIndices.map((slotIndex) => createMemo(slotIndex)),
      } satisfies Session,
      limitHit: null,
    }
  }

  const getReopenLimitHit = (currentSessions: Session[], reopenedSession: Session) => {
    const openSessions = getOpenSessions(currentSessions)
    const openMemos = getOpenMemos(currentSessions)

    if (openSessions.length + 1 > MAX_OPEN_SESSIONS) {
      return 'session'
    }

    if (openMemos.length + reopenedSession.memos.length > MAX_OPEN_MEMOS) {
      return 'memo'
    }

    return null
  }

  const commitEditorValue = (sessionId: string, memoId: string) => {
    const textarea = editorRefs.current[memoId]
    const nextValue = textarea?.value ?? draftContentRef.current[memoId] ?? ''
    draftContentRef.current[memoId] = nextValue

    setSessions((currentSessions) =>
      updateMemoContent(currentSessions, sessionId, memoId, (_content, savedContent) => ({
        content: nextValue,
        isDirty: nextValue !== savedContent,
      })),
    )
  }

  const saveMemo = (sessionId: string, memoId: string) => {
    const textarea = editorRefs.current[memoId]
    const nextValue = textarea?.value ?? draftContentRef.current[memoId] ?? ''
    draftContentRef.current[memoId] = nextValue

    setSessions((currentSessions) =>
      updateMemoContent(currentSessions, sessionId, memoId, () => ({
        content: nextValue,
        savedContent: nextValue,
        isDirty: false,
      })),
    )
  }

  // Cmd+S: 保存して閉じる
  const handleSaveAndClose = async (sessionId: string, memoId?: string) => {
    // saveMemo で state を最新化してから saveSessions で DB へ書き込む
    if (memoId) saveMemo(sessionId, memoId)
    await saveSessionsToDb(sessionsRef.current)
    if (memoId) {
      // メモ単体を閉じる
      setSessions((prev) =>
        closeMemo(prev, sessionId, memoId),
      )
    } else {
      // セッションを閉じる
      await closeSessionInDb(sessionId)
      setSessions((prev) =>
        closeSessionInState(prev, sessionId),
      )
    }
    setSelection({ type: 'none' })
  }

  // Cmd+Enter: 保存して表示継続
  const handleSaveAndStay = async (sessionId: string, memoId?: string) => {
    if (memoId) saveMemo(sessionId, memoId)
    await saveSessionsToDb(sessionsRef.current)
    setSelection({ type: 'none' })
  }

  // 起動時: DB クリーンアップ → セッションロード
  useEffect(() => {
    ;(async () => {
      try {
        await startupCleanup()
        const rows = await loadSessionsFromDb()
        setSessions(buildSessionsFromRows(rows))
      } catch (e) {
        console.error('[DB] startup failed:', e)
      }
    })()
  }, [])

  const handleOpenSingleEvent = useEffectEvent((payload: OverlayResumePayload) => {
    const currentSessions = sessionsRef.current
    const result = createSession(1, currentSessions)

    markResumePassThrough(payload.resumePassThrough)
    setIsSessionPickerVisible(false)
    setContextMenu(null)

    if (!result) return
    if (result.limitHit) {
      triggerLimitWarning(result.limitHit)
      return
    }

    const newSession = result.session
    setSessions((prev) => appendSession(prev, newSession))
    setSelection({ type: 'memo', sessionId: newSession.id, memoId: newSession.memos[0].id })
  })

  const handleOpenPickerEvent = useEffectEvent((payload: OverlayResumePayload) => {
    markResumePassThrough(payload.resumePassThrough)
    setIsSessionPickerVisible(true)
    setSelection({ type: 'none' })
  })

  const handleOverlayClickthroughEvent = useEffectEvent((enabled: boolean) => {
    setClickThrough(enabled)
    setOverlayInputMode(enabled ? 'pass-through' : 'interactive')
  })

  const handleReopenSessionEvent = useEffectEvent(async (sessionId: string) => {
    const currentSessions = sessionsRef.current
    const rows = await loadSessionsFromDb()
    const reopenedRow = rows.find((row) => row.id === sessionId)

    if (!reopenedRow) {
      return
    }

    const reopenedSession = buildSessionsFromRows([reopenedRow])[0]
    const limitHit = getReopenLimitHit(currentSessions, reopenedSession)

    if (limitHit) {
      triggerLimitWarning(limitHit)
      return
    }

    const reassignedSession = reassignReopenedSessionSlots(currentSessions, reopenedSession)
    if (!reassignedSession) {
      triggerLimitWarning('memo')
      return
    }

    setSelection({ type: 'none' })
    setSessions((prev) => upsertSession(prev, reassignedSession))
  })

  const applyOverlayInputMode = useCallback(async (mode: 'interactive' | 'pass-through') => {
    try {
      await invoke('set_overlay_input_mode', { mode })
    } catch (error) {
      console.error('failed to set overlay input mode:', error)
    }
  }, [])

  useEffect(() => {
    const unlisten = Promise.all([
      listen<OverlayResumePayload>('session://open-single', (event) => {
        handleOpenSingleEvent(event.payload)
      }),
      listen<OverlayResumePayload>('session://open-picker', (event) => {
        handleOpenPickerEvent(event.payload)
      }),
      listen<{ sessionId: string }>('session://reopen', (event) => {
        void handleReopenSessionEvent(event.payload.sessionId)
      }),
      listen<boolean>('overlay://clickthrough', (event) => {
        handleOverlayClickthroughEvent(event.payload)
      }),
    ])

    return () => {
      void unlisten.then((handlers) => {
        handlers.forEach((dispose) => dispose())
      })
    }
  }, [])

  useEffect(() => {
    const needsInteractive =
      selection.type === 'editing' ||
      contextMenu !== null ||
      deleteConfirm !== null ||
      isSessionPickerVisible

    if (needsInteractive && overlayInputMode !== 'interactive') {
      if (overlayInputMode === 'pass-through') {
        resumePassThroughRef.current = true
      }
      void applyOverlayInputMode('interactive')
      return
    }

    if (
      !needsInteractive &&
      resumePassThroughRef.current &&
      overlayInputMode === 'interactive' &&
      selection.type === 'none'
    ) {
      resumePassThroughRef.current = false
      void applyOverlayInputMode('pass-through')
    }
  }, [
    contextMenu,
    deleteConfirm,
    isSessionPickerVisible,
    overlayInputMode,
    selection.type,
    applyOverlayInputMode,
  ])

  useEffect(() => {
    const editingEntry = getEditingEntry(selection, sessions)

    if (!editingEntry) {
      return
    }

    const editor = editorRefs.current[editingEntry.memo.id]
    if (!editor) {
      return
    }

    editor.focus()
    editor.setSelectionRange(editor.value.length, editor.value.length)
  }, [selection, sessions])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current
      if (!interaction) {
        return
      }

      if (interaction.type === 'session-drag') {
        const deltaX = event.clientX - interaction.startX
        const deltaY = event.clientY - interaction.startY
        const distance = Math.hypot(deltaX, deltaY)

        if (!interaction.active) {
          if (distance < DRAG_THRESHOLD) return
          interaction.active = true
          dragExceededRef.current = true
          // スロットを解放
          setSessions((currentSessions) => clearSessionSlotIndices(currentSessions, interaction.sessionId))
        }

        setSessions((currentSessions) =>
          moveSessionMemos(currentSessions, interaction.sessionId, interaction.memoOrigins, deltaX, deltaY),
        )
        return
      }

      if (interaction.type === 'drag') {
        const deltaX = event.clientX - interaction.startX
        const deltaY = event.clientY - interaction.startY
        const distance = Math.hypot(deltaX, deltaY)

          if (!interaction.active) {
            if (distance < DRAG_THRESHOLD) {
              return
            }

            interaction.active = true
            dragExceededRef.current = true

            setSessions((currentSessions) =>
              clearMemoSlotIndex(currentSessions, interaction.sessionId, interaction.memoId),
            )
          }

        setSessions((currentSessions) =>
          moveMemo(
            currentSessions,
            interaction.sessionId,
            interaction.memoId,
            interaction.originX + deltaX,
            interaction.originY + deltaY,
          ),
        )
        return
      }

      const deltaX = event.clientX - interaction.startX
      const deltaY = event.clientY - interaction.startY

      let nextX = interaction.originX
      let nextY = interaction.originY
      let nextWidth = interaction.originWidth
      let nextHeight = interaction.originHeight

      if (interaction.direction.includes('e')) {
        nextWidth = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, interaction.originWidth + deltaX),
        )
      }

      if (interaction.direction.includes('s')) {
        nextHeight = Math.min(
          MAX_HEIGHT,
          Math.max(MIN_HEIGHT, interaction.originHeight + deltaY),
        )
      }

      if (interaction.direction.includes('w')) {
        const rawWidth = interaction.originWidth - deltaX
        nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rawWidth))
        nextX = interaction.originX + (interaction.originWidth - nextWidth)
      }

      if (interaction.direction.includes('n')) {
        const rawHeight = interaction.originHeight - deltaY
        nextHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, rawHeight))
        nextY = interaction.originY + (interaction.originHeight - nextHeight)
      }

      setSessions((currentSessions) =>
        resizeMemo(
          currentSessions,
          interaction.sessionId,
          interaction.memoId,
          nextX,
          nextY,
          nextWidth,
          nextHeight,
        ),
      )
    }

    const handlePointerUp = () => {
      interactionRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  // autosave: 5分ごとに isDirty なセッションを保存
  const runAutosave = useEffectEvent(async () => {
    const current = sessionsRef.current
    const hasDirty = current.some((s) => s.isOpen && s.memos.some((m) => m.isVisible && m.isDirty))
    if (!hasDirty) return

    try {
      await saveSessionsToDb(current)
    } catch (e) {
      console.error('autosave failed:', e)
    }
  })

  useEffect(() => {
    const AUTOSAVE_INTERVAL = 5 * 60 * 1000
    const id = setInterval(() => {
      void runAutosave()
    }, AUTOSAVE_INTERVAL)
    return () => clearInterval(id)
  }, [])

  const handleWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const selection = selectionRef.current
    const sessions = sessionsRef.current
    const deleteConfirm = deleteConfirmRef.current
    const isComposing = isComposingRef.current
    const isSessionPickerVisible = isSessionPickerVisibleRef.current
    const editingEntry = getEditingEntry(selection, sessions)
    const selectedEntry = getSelectedEntry(selection, sessions)

    const isSaveShortcut = event.metaKey && event.key.toLowerCase() === 's'
    const isCommitShortcut = event.metaKey && event.key === 'Enter'

    // 削除確認モーダル表示中: Enter/Del → 確定、Esc → キャンセル、それ以外はブロック
    if (deleteConfirm !== null) {
      if (event.key === 'Enter' || event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        handleDeleteConfirmedRef.current()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDeleteConfirm(null)
        return
      }
      return
    }

    if (isSessionPickerVisible && !editingEntry) {
      if (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        setIsSessionPickerVisible(false)
        return
      }

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault()
        const memoCount = Number(event.key)
        const result = createSession(memoCount, sessions)

        if (!result) {
          setIsSessionPickerVisible(false)
          return
        }
        if (result.limitHit) {
          triggerLimitWarning(result.limitHit)
          setIsSessionPickerVisible(false)
          return
        }

        const newSession = result.session
        setSessions((prev) => appendSession(prev, newSession))
        setSelection({ type: 'memo', sessionId: newSession.id, memoId: newSession.memos[0].id })
        setIsSessionPickerVisible(false)
        return
      }

      return
    }

    if (editingEntry) {
      if (isSaveShortcut) {
        event.preventDefault()
        void handleSaveAndClose(editingEntry.session.id, editingEntry.memo.id)
        return
      }

      if (isCommitShortcut) {
        event.preventDefault()
        void handleSaveAndStay(editingEntry.session.id, editingEntry.memo.id)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        commitEditorValue(editingEntry.session.id, editingEntry.memo.id)
        setSelection({ type: 'none' })
      }

      return
    }

    if (isComposing) {
      return
    }

    if (selectedEntry && isSaveShortcut) {
      event.preventDefault()
      void handleSaveAndClose(selectedEntry.session.id, selectedEntry.memo.id)
      return
    }

    if (selectedEntry && isCommitShortcut) {
      event.preventDefault()
      void handleSaveAndStay(selectedEntry.session.id, selectedEntry.memo.id)
      return
    }

    if (selectedEntry && (event.key === 'Delete' || event.key === 'Backspace')) {
      if (selectedEntry.memo.isPinned) return
      event.preventDefault()
      markResumePassThrough()
      setDeleteConfirm({ type: 'memo', sessionId: selectedEntry.session.id, memoId: selectedEntry.memo.id })
      return
    }

    if (selection.type === 'session') {
      const { sessionId } = selection
      const targetSession = sessions.find((s) => s.id === sessionId)

      if (targetSession) {
        if (isSaveShortcut) {
          event.preventDefault()
          void handleSaveAndClose(sessionId)
          return
        }

        if (isCommitShortcut) {
          event.preventDefault()
          void handleSaveAndStay(sessionId)
          return
        }

        if (event.key === 'Delete' || event.key === 'Backspace') {
          const hasPinned = targetSession.memos.some((m) => m.isVisible && m.isPinned)
          if (hasPinned) return
          event.preventDefault()
          markResumePassThrough()
          setDeleteConfirm({ type: 'session', sessionId })
          return
        }

        if (event.key === 'p') {
          event.preventDefault()
          const allPinned = targetSession.memos.every((m) => !m.isVisible || m.isPinned)
          setSessions((currentSessions) =>
            toggleSessionPinnedState(currentSessions, sessionId, !allPinned),
          )
          return
        }
      }
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      if (contextMenuRef.current !== null) {
        setContextMenu(null)
        return
      }
      setSelection({ type: 'none' })
      return
    }

    if (
      (selection.type === 'memo' || selection.type === 'editing') &&
      event.key === 'p'
    ) {
      const { sessionId, memoId } = selection
      event.preventDefault()
      setSessions((currentSessions) => toggleMemoPinnedState(currentSessions, sessionId, memoId))
      return
    }

    if (selection.type === 'memo' && event.key === 'Enter') {
      const { sessionId, memoId } = selection
      event.preventDefault()
      markResumePassThrough()
      setSessions((currentSessions) => incrementMemoEditingKey(currentSessions, sessionId, memoId))
      setSelection({ type: 'editing', sessionId, memoId })
    }
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      handleWindowKeyDown(event)
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [])

  const handleMemoPointerDown =
    (sessionId: string, memoId: string) => (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return
      }

      setContextMenu(null)

      if (selection.type === 'editing' && selection.memoId !== memoId) {
        commitEditorValue(selection.sessionId, selection.memoId)
      }

      const targetSession = sessions.find((session) => session.id === sessionId)
      const targetMemo = targetSession?.memos.find((memo) => memo.id === memoId)

      if (!targetSession || !targetMemo) {
        return
      }

      // 編集中のメモはドラッグ開始しない
      if (selection.type === 'editing' && selection.memoId === memoId) {
        return
      }

      // セッション選択中にそのセッション内のメモを触った → 一括ドラッグ
      if (selection.type === 'session' && selection.sessionId === sessionId) {
        const memoOrigins: Record<string, { x: number; y: number }> = {}
        // pinned メモは一括ドラッグから除外（その場に留まる）
        for (const m of targetSession.memos.filter((m) => m.isVisible && !m.isPinned)) {
          memoOrigins[m.id] = { x: m.position.x, y: m.position.y }
        }
        interactionRef.current = {
          type: 'session-drag',
          sessionId,
          startX: event.clientX,
          startY: event.clientY,
          memoOrigins,
          active: false,
        }
        dragExceededRef.current = false
        return
      }

      // pin中のメモは個別ドラッグ不可
      if (targetMemo.isPinned) return

      interactionRef.current = {
        type: 'drag',
        sessionId,
        memoId,
        startX: event.clientX,
        startY: event.clientY,
        originX: targetMemo.position.x,
        originY: targetMemo.position.y,
        active: false,
      }
      dragExceededRef.current = false
    }

  const handleMemoClick =
    (sessionId: string, memoId: string) => (event: React.MouseEvent<HTMLElement>) => {
      if (dragExceededRef.current) {
        dragExceededRef.current = false
        return
      }

      event.stopPropagation()
      setSelection({ type: 'memo', sessionId, memoId })
    }

  const handleMemoDoubleClick =
    (sessionId: string, memoId: string) => (event: React.MouseEvent<HTMLElement>) => {
      if (dragExceededRef.current) {
        dragExceededRef.current = false
        return
      }

      event.stopPropagation()

      setSessions((currentSessions) => incrementMemoEditingKey(currentSessions, sessionId, memoId))
      setSelection({ type: 'editing', sessionId, memoId })
    }

  const handleShellPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const clickedInsideMemo = Object.values(cardRefs.current).some((card) =>
      card?.contains(event.target as Node),
    )
    const clickedInsidePicker = sessionPickerRef.current?.contains(event.target as Node) ?? false
    const clickedInsideContextMenu =
      contextMenuRef.current?.contains(event.target as Node) ?? false

    if (clickedInsideMemo || clickedInsidePicker || clickedInsideContextMenu) {
      return
    }

    setContextMenu(null)

    if (selection.type === 'editing') {
      commitEditorValue(selection.sessionId, selection.memoId)
    }

    setSelection({ type: 'none' })
    setIsSessionPickerVisible(false)
  }

  const handleResizePointerDown =
    (sessionId: string, memoId: string, direction: ResizeDirection) =>
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const targetSession = sessions.find((session) => session.id === sessionId)
      const targetMemo = targetSession?.memos.find((memo) => memo.id === memoId)
      if (!targetMemo || targetMemo.isPinned) {
        return
      }

      interactionRef.current = {
        type: 'resize',
        sessionId,
        memoId,
        direction,
        startX: event.clientX,
        startY: event.clientY,
        originX: targetMemo.position.x,
        originY: targetMemo.position.y,
        originWidth: targetMemo.size.width,
        originHeight: targetMemo.size.height,
      }
      dragExceededRef.current = true

      setSessions((currentSessions) => clearMemoSlotIndex(currentSessions, sessionId, memoId))
      setSelection({ type: 'memo', sessionId, memoId })
    }

  return (
    <main className="overlay-shell" onPointerDown={handleShellPointerDown}>
      {sessions
        .filter((session) => session.isOpen)
        .flatMap((session) =>
          session.memos
            .filter((memo) => memo.isVisible)
            .map((memo) => {
              const isSelected =
                (selection.type === 'memo' || selection.type === 'editing') &&
                selection.memoId === memo.id
              const isEditing = selection.type === 'editing' && selection.memoId === memo.id
              const isSessionSelected =
                selection.type === 'session' && selection.sessionId === session.id
              const showRing = isSelected || isSessionSelected

              return (
                <article
                  key={getMemoIdentity(session.id, memo.id)}
                  ref={(node) => {
                    cardRefs.current[getMemoIdentity(session.id, memo.id)] = node
                  }}
                  className={`memo-card ${isSelected ? 'memo-card--selected' : ''} ${isSessionSelected ? 'memo-card--session-selected' : ''} ${isEditing ? 'memo-card--editing' : ''} ${limitWarning ? 'memo-card--limit-warning' : ''}`}
                  style={{
                    transform: `translate(${memo.position.x}px, ${memo.position.y}px)`,
                    width: `${memo.size.width}px`,
                    height: `${memo.size.height}px`,
                    background: SESSION_COLOR_VARS[session.colorSlot],
                  }}
                  onPointerDown={handleMemoPointerDown(session.id, memo.id)}
                  onClick={handleMemoClick(session.id, memo.id)}
                  onDoubleClick={handleMemoDoubleClick(session.id, memo.id)}
                  onContextMenu={handleMemoContextMenu(session.id)}
                >
                  {showRing ? <div className="memo-card__ring" /> : null}

                  {memo.isPinned ? (
                    <div className="memo-card__pin" aria-label="固定中" />
                  ) : null}

                  <header className="memo-card__meta">
                    <span className="memo-card__badge">
                      {session.memos.length === 1 ? '1-note session' : `${session.memos.length}-note session`}
                    </span>
                    <span className="memo-card__status">
                      {isEditing
                        ? 'editing'
                        : memo.isDirty
                          ? 'dirty'
                          : clickThrough
                            ? 'click-through on'
                            : isSelected
                              ? 'selected'
                              : 'ready'}
                    </span>
                  </header>

                  <div className="memo-card__body">
                    {isEditing ? (
                      <textarea
                        key={`${memo.id}-${memo.editingKey}`}
                        ref={(node) => {
                          editorRefs.current[memo.id] = node
                        }}
                        className="memo-card__editor"
                        defaultValue={memo.content}
                        onChange={(event) => {
                          if (!isComposing) {
                            const nextValue = event.currentTarget.value
                            draftContentRef.current[memo.id] = nextValue

                            setSessions((currentSessions) =>
                              updateMemoDirtyState(currentSessions, session.id, memo.id, nextValue),
                            )
                          }
                        }}
                        onClick={(event) => event.stopPropagation()}
                        onCompositionStart={() => setIsComposing(true)}
                        onCompositionEnd={(event) => {
                          setIsComposing(false)
                          const nextValue = event.currentTarget.value
                          draftContentRef.current[memo.id] = nextValue

                          setSessions((currentSessions) =>
                            updateMemoDirtyState(currentSessions, session.id, memo.id, nextValue),
                          )
                        }}
                        onBlur={() => commitEditorValue(session.id, memo.id)}
                      />
                    ) : (
                      <p
                        className={`memo-card__placeholder ${memo.content ? '' : 'memo-card__placeholder--empty'}`}
                      >
                        {memo.content || 'ここにメモを書く'}
                      </p>
                    )}
                  </div>

                  {import.meta.env.DEV ? (
                    <footer className="memo-card__footer">
                      <span>click: select / dbl: edit / right-click: session menu</span>
                      <span>p: pin / Del: delete confirm / Esc: deselect</span>
                      <span>Cmd+S: save+close / Cmd+Enter: save+stay</span>
                    </footer>
                  ) : null}

                  {isSelected ? (
                    <>
                      <button
                        className="memo-card__handle memo-card__handle--nw"
                        aria-label="resize north west"
                        onPointerDown={handleResizePointerDown(session.id, memo.id, 'nw')}
                      />
                      <button
                        className="memo-card__handle memo-card__handle--ne"
                        aria-label="resize north east"
                        onPointerDown={handleResizePointerDown(session.id, memo.id, 'ne')}
                      />
                      <button
                        className="memo-card__handle memo-card__handle--sw"
                        aria-label="resize south west"
                        onPointerDown={handleResizePointerDown(session.id, memo.id, 'sw')}
                      />
                      <button
                        className="memo-card__handle memo-card__handle--se"
                        aria-label="resize south east"
                        onPointerDown={handleResizePointerDown(session.id, memo.id, 'se')}
                      />
                    </>
                  ) : null}
                </article>
              )
            }),
        )}

      {contextMenu ? (() => {
        const MENU_W = 192
        const MENU_H = 112
        const x = Math.min(contextMenu.x, window.innerWidth - MENU_W - 8)
        const y = Math.min(contextMenu.y, window.innerHeight - MENU_H - 8)
        return (
          <nav
            ref={contextMenuRef}
            className="context-menu"
            style={{ left: x, top: y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className="context-menu__item"
              type="button"
              onClick={() => handleSelectSession(contextMenu.sessionId)}
            >
              このセッションを選択
            </button>
            <hr className="context-menu__separator" />
            <button
              className="context-menu__item"
              type="button"
              onClick={() => handleCloseSession(contextMenu.sessionId)}
            >
              このセッションを閉じる
            </button>
            <button
              className="context-menu__item context-menu__item--danger"
              type="button"
              onClick={() => {
                setDeleteConfirm({ type: 'session', sessionId: contextMenu.sessionId })
                setContextMenu(null)
              }}
            >
              このセッションを削除...
            </button>
          </nav>
        )
      })() : null}

      {deleteConfirm ? (
        <div
          className="delete-confirm-overlay"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setDeleteConfirm(null)
          }}
        >
          <div className="delete-confirm" role="dialog" aria-modal="true">
            <p className="delete-confirm__title">
              {deleteConfirm.type === 'session'
                ? 'このセッションをゴミ箱に移動しますか？'
                : 'このメモをゴミ箱に移動しますか？'}
            </p>
            <div className="delete-confirm__actions">
              <button
                className="delete-confirm__btn"
                type="button"
                onClick={() => setDeleteConfirm(null)}
              >
                キャンセル
              </button>
              <button
                className="delete-confirm__btn delete-confirm__btn--danger"
                type="button"
                onClick={handleDeleteConfirmed}
              >
                削除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {limitWarning ? (
        <p className="limit-warning-badge" aria-live="assertive">
          {limitWarning === 'session'
            ? 'これ以上セッションは開けません'
            : `これ以上表示できません (${openMemoCount}/${MAX_OPEN_MEMOS})`}
        </p>
      ) : null}

      {isSessionPickerVisible ? (
        <div className="session-picker-layer">
          <section ref={sessionPickerRef} className="session-picker">
            <p className="session-picker__eyebrow">new session</p>
            <h2 className="session-picker__title">何枚で始める？</h2>
            <p className="session-picker__description">
              1〜9 を押すと、その枚数の新規セッションを作成します。
            </p>
            <div className="session-picker__grid">
              {Array.from({ length: 9 }, (_, index) => index + 1).map((count) => (
                <button
                  key={count}
                  className="session-picker__button"
                  type="button"
                  onClick={() => {
                    const result = createSession(count, sessions)
                    if (!result) {
                      setIsSessionPickerVisible(false)
                      return
                    }
                    if (result.limitHit) {
                      triggerLimitWarning(result.limitHit)
                      setIsSessionPickerVisible(false)
                      return
                    }
                    const newSession = result.session
                    setSessions((prev) => appendSession(prev, newSession))
                    setSelection({ type: 'memo', sessionId: newSession.id, memoId: newSession.memos[0].id })
                    setIsSessionPickerVisible(false)
                  }}
                >
                  <span className="session-picker__count">{count}</span>
                  <span className="session-picker__label">notes</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <button
        type="button"
        className={`overlay-mode-toggle ${clickThrough ? 'overlay-mode-toggle--through' : ''}`}
        aria-pressed={clickThrough}
        aria-label={`Overlay mode: ${overlayModeLabel}`}
        onClick={() => {
          const nextMode =
            overlayInputMode === 'interactive' ? 'pass-through' : 'interactive'
          void applyOverlayInputMode(nextMode)
        }}
      >
        <span className="overlay-mode-toggle__dot" />
        <span className="overlay-mode-toggle__content">
          <span className="overlay-mode-toggle__label">{overlayModeLabel}</span>
          <span className="overlay-mode-toggle__hint">{overlayModeHint}</span>
        </span>
      </button>
    </main>
  )
}

export default App
