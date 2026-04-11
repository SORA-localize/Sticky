import { invoke } from '@tauri-apps/api/core'

import { generateTitle } from '../domain/sessionHelpers'
import type { MemoPayload, Session, SessionPayload, SessionRow } from '../types/sticky'

export async function startupCleanup() {
  await invoke('startup_cleanup')
  console.log('[DB] startup_cleanup done')
}

export async function loadSessionsFromDb() {
  const rows = await invoke<SessionRow[]>('load_sessions')
  console.log('[DB] load_sessions:', rows.length, 'sessions')
  return rows
}

export async function trashSessionInDb(sessionId: string) {
  await invoke('trash_session', { sessionId })
  console.log('[DB] trash_session:', sessionId)
}

export async function trashMemoInDb(memoId: string) {
  await invoke('trash_memo', { memoId })
  console.log('[DB] trash_memo:', memoId)
}

export async function closeSessionInDb(sessionId: string) {
  await invoke('close_session', { sessionId })
  console.log('[DB] close_session:', sessionId)
}

function buildSessionPayload(session: Session): SessionPayload {
  return {
    id: session.id,
    colorSlot: session.colorSlot,
    isOpen: session.isOpen,
  }
}

function buildMemoPayload(sessionId: string, memo: Session['memos'][number]): MemoPayload {
  return {
    id: memo.id,
    sessionId,
    content: memo.content,
    title: generateTitle(memo.content),
    posX: memo.position.x,
    posY: memo.position.y,
    width: memo.size.width,
    height: memo.size.height,
    slotIndex: memo.slotIndex,
    isOpen: memo.isVisible,
    isPinned: memo.isPinned,
  }
}

export async function saveSessionsToDb(targetSessions: Session[]) {
  const openSessions = targetSessions.filter((session) => session.isOpen)
  console.log('[DB] saveSessions: sessions=', openSessions.map((session) => session.id))

  for (const session of openSessions) {
    const sessionPayload = buildSessionPayload(session)
    await invoke('upsert_session', { session: sessionPayload })
    console.log(
      '[DB] upsert_session:',
      sessionPayload.id,
      'colorSlot=',
      sessionPayload.colorSlot,
      'isOpen=',
      sessionPayload.isOpen,
    )

    for (const memo of session.memos.filter((currentMemo) => currentMemo.isVisible && currentMemo.content !== '')) {
      const memoPayload = buildMemoPayload(session.id, memo)
      await invoke('upsert_memo', { memo: memoPayload })
      console.log(
        '[DB] upsert_memo:',
        memoPayload.id,
        'title=',
        memoPayload.title,
        'content=',
        memoPayload.content.slice(0, 20),
      )
    }
  }

  console.log('[DB] saveSessions done')
}
