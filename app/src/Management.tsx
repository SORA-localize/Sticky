import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'

import { SESSION_COLOR_VARS } from './constants/sticky'
import {
  loadHomeFromDb,
  loadSettingsFromDb,
  loadTrashFromDb,
  moveMemoToSessionInDb,
  permanentDeleteMemoInDb,
  permanentDeleteSessionInDb,
  reopenSessionInDb,
  restoreMemoInDb,
  restoreSessionInDb,
  saveSettingsToDb,
  trashMemoInDb,
  trashSessionInDb,
} from './services/stickyDb'
import type { ManagementSessionRow, SettingsRow } from './types/sticky'

type ManagementTab = 'home' | 'trash' | 'settings'

type ManagementOpenTabPayload = {
  tab?: ManagementTab
}

type HomeContextMenuState = {
  x: number
  y: number
  sessionId: string
  memoId: string
} | null

const EMPTY_SETTINGS: SettingsRow = {
  autoCloseMinutes: 60,
  maxOpenSessions: 5,
  maxOpenMemos: 15,
}

function formatDateHeading(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function groupSessionsByDate(sessions: ManagementSessionRow[]) {
  const groups = new Map<string, ManagementSessionRow[]>()

  for (const session of sessions) {
    const key = formatDateHeading(session.updatedAt)
    const current = groups.get(key) ?? []
    current.push(session)
    groups.set(key, current)
  }

  return [...groups.entries()]
}

export function Management({ initialTab }: { initialTab: string }) {
  const defaultTab: ManagementTab =
    initialTab === 'trash' || initialTab === 'settings' ? initialTab : 'home'
  const [activeTab, setActiveTab] = useState<ManagementTab>(defaultTab)
  const [homeSessions, setHomeSessions] = useState<ManagementSessionRow[]>([])
  const [trashSessions, setTrashSessions] = useState<ManagementSessionRow[]>([])
  const [settings, setSettings] = useState<SettingsRow>(EMPTY_SETTINGS)
  const [keyword, setKeyword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState<HomeContextMenuState>(null)

  const refreshHome = useEffectEvent(async () => {
    const rows = await loadHomeFromDb()
    setHomeSessions(rows)
  })

  const refreshTrash = useEffectEvent(async () => {
    const rows = await loadTrashFromDb()
    setTrashSessions(rows)
  })

  const refreshSettings = useEffectEvent(async () => {
    const row = await loadSettingsFromDb()
    setSettings(row)
  })

  useEffect(() => {
    setIsLoading(true)
    const load = async () => {
      try {
        if (activeTab === 'home') {
          await refreshHome()
        } else if (activeTab === 'trash') {
          await refreshTrash()
        } else {
          await refreshSettings()
        }
      } finally {
        setIsLoading(false)
      }
    }

    void load()
  }, [activeTab])

  useEffect(() => {
    const unlisten = listen<ManagementOpenTabPayload>('management://open-tab', (event) => {
      if (event.payload.tab === 'home' || event.payload.tab === 'trash' || event.payload.tab === 'settings') {
        setActiveTab(event.payload.tab)
        setContextMenu(null)
      }
    })

    return () => {
      void unlisten.then((dispose) => dispose())
    }
  }, [])

  useEffect(() => {
    const handleWindowClick = () => {
      setContextMenu(null)
    }

    window.addEventListener('click', handleWindowClick)
    return () => window.removeEventListener('click', handleWindowClick)
  }, [])

  const filteredHomeSessions = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    if (!normalizedKeyword) {
      return homeSessions
    }

    return homeSessions
      .map((session) => ({
        ...session,
        memos: session.memos.filter((memo) => {
          const target = `${memo.title}\n${memo.content}`.toLowerCase()
          return target.includes(normalizedKeyword)
        }),
      }))
      .filter((session) => session.memos.length > 0)
  }, [homeSessions, keyword])

  const groupedHomeSessions = useMemo(
    () => groupSessionsByDate(filteredHomeSessions),
    [filteredHomeSessions],
  )

  const handleHomeContextMenu =
    (sessionId: string, memoId: string) => (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        sessionId,
        memoId,
      })
    }

  const handleReopenSession = async (sessionId: string) => {
    await reopenSessionInDb(sessionId)
    setContextMenu(null)
    await refreshHome()
  }

  const handleTrashSession = async (sessionId: string) => {
    await trashSessionInDb(sessionId)
    setContextMenu(null)
    await refreshHome()
  }

  const handleTrashMemo = async (memoId: string) => {
    await trashMemoInDb(memoId)
    setContextMenu(null)
    await refreshHome()
  }

  const handleMoveMemo = async (memoId: string, targetSessionId: string) => {
    await moveMemoToSessionInDb(memoId, targetSessionId)
    setContextMenu(null)
    await refreshHome()
  }

  const handleRestoreSession = async (sessionId: string) => {
    await restoreSessionInDb(sessionId)
    await refreshTrash()
    await refreshHome()
  }

  const handleRestoreMemo = async (memoId: string) => {
    await restoreMemoInDb(memoId)
    await refreshTrash()
    await refreshHome()
  }

  const handlePermanentDeleteSession = async (sessionId: string) => {
    await permanentDeleteSessionInDb(sessionId)
    await refreshTrash()
  }

  const handlePermanentDeleteMemo = async (memoId: string) => {
    await permanentDeleteMemoInDb(memoId)
    await refreshTrash()
  }

  const handleSaveSettings = async (nextAutoCloseMinutes: number) => {
    await saveSettingsToDb(nextAutoCloseMinutes)
    setSettings((current) => ({ ...current, autoCloseMinutes: nextAutoCloseMinutes }))
  }

  const activeContextSession = contextMenu
    ? homeSessions.find((session) => session.id === contextMenu.sessionId) ?? null
    : null
  const activeContextMemo = activeContextSession && contextMenu
    ? activeContextSession.memos.find((memo) => memo.id === contextMenu.memoId) ?? null
    : null
  const moveTargets = activeContextSession
    ? homeSessions.filter((session) => session.id !== activeContextSession.id)
    : []

  return (
    <main className="management-shell">
      <header className="management-header">
        <div>
          <p className="management-header__eyebrow">sticky management</p>
          <h1 className="management-header__title">Home / Trash / Settings</h1>
        </div>
        <div className="management-header__meta">
          <span>{settings.maxOpenSessions} sessions max</span>
          <span>{settings.maxOpenMemos} memos max</span>
        </div>
      </header>

      <nav className="management-tabs" aria-label="Management Tabs">
        {(['home', 'trash', 'settings'] as ManagementTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`management-tab ${activeTab === tab ? 'management-tab--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === 'home' ? (
        <section className="management-panel">
          <div className="management-toolbar">
            <input
              className="management-search"
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="Search title or content"
            />
          </div>

          {isLoading ? <p className="management-empty">Loading…</p> : null}

          {!isLoading && groupedHomeSessions.length === 0 ? (
            <div className="management-empty">
              <h2>No saved memos yet</h2>
              <p>Cmd+Option+Enter で 1-note session を開き、Cmd+Enter で閉じて保存できます。</p>
            </div>
          ) : null}

          <div className="management-groups">
            {groupedHomeSessions.map(([dateLabel, sessions]) => (
              <section key={dateLabel} className="management-group">
                <h2 className="management-group__title">{dateLabel}</h2>
                {sessions.map((session) => (
                  <article key={session.id} className="management-session">
                    <header className="management-session__header">
                      <div className="management-session__title">
                        <span
                          className="management-session__color"
                          style={{ background: SESSION_COLOR_VARS[session.colorSlot] }}
                        />
                        <div>
                          <strong>{session.id}</strong>
                          <div className="management-session__meta">
                            <span>{formatDateTime(session.updatedAt)}</span>
                            {session.isOpen ? <span>現在デスクトップ表示中</span> : <span>closed</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="management-action"
                        onClick={() => handleTrashSession(session.id)}
                      >
                        このセッションをゴミ箱
                      </button>
                    </header>

                    <div className="management-memo-grid">
                      {session.memos.map((memo) => (
                        <button
                          key={memo.id}
                          type="button"
                          className="management-memo-card"
                          onContextMenu={handleHomeContextMenu(session.id, memo.id)}
                        >
                          <span className="management-memo-card__time">{formatDateTime(memo.updatedAt)}</span>
                          <strong className="management-memo-card__title">{memo.title || '(untitled)'}</strong>
                          <span className="management-memo-card__content">{memo.content}</span>
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </section>
            ))}
          </div>

          {contextMenu && activeContextSession && activeContextMemo ? (
            <div
              className="management-context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              {!activeContextSession.isOpen ? (
                <button type="button" onClick={() => handleReopenSession(activeContextSession.id)}>
                  デスクトップに開く
                </button>
              ) : null}
              <button type="button" onClick={() => handleTrashMemo(activeContextMemo.id)}>
                このメモをゴミ箱
              </button>
              {moveTargets.length > 0 ? (
                <div className="management-context-menu__section">
                  <span>別セッションへ移動</span>
                  {moveTargets.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => handleMoveMemo(activeContextMemo.id, session.id)}
                    >
                      {session.id}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'trash' ? (
        <section className="management-panel">
          {isLoading ? <p className="management-empty">Loading…</p> : null}
          {!isLoading && trashSessions.length === 0 ? <p className="management-empty">Trash is empty.</p> : null}
          <div className="management-groups">
            {trashSessions.map((session) => (
              <article key={session.id} className="management-session management-session--trash">
                <header className="management-session__header">
                  <div className="management-session__title">
                    <span
                      className="management-session__color"
                      style={{ background: SESSION_COLOR_VARS[session.colorSlot] }}
                    />
                    <div>
                      <strong>{session.id}</strong>
                      <div className="management-session__meta">
                        <span>trashed {formatDateTime(session.trashedAt ?? session.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="management-inline-actions">
                    <button type="button" className="management-action" onClick={() => handleRestoreSession(session.id)}>
                      復元
                    </button>
                    <button
                      type="button"
                      className="management-action management-action--danger"
                      onClick={() => handlePermanentDeleteSession(session.id)}
                    >
                      完全削除
                    </button>
                  </div>
                </header>
                <div className="management-memo-grid">
                  {session.memos.map((memo) => (
                    <div key={memo.id} className="management-memo-card management-memo-card--trash">
                      <span className="management-memo-card__time">
                        {formatDateTime(memo.trashedAt ?? memo.updatedAt)}
                      </span>
                      <strong className="management-memo-card__title">{memo.title || '(untitled)'}</strong>
                      <span className="management-memo-card__content">{memo.content}</span>
                      <div className="management-inline-actions">
                        <button type="button" className="management-action" onClick={() => handleRestoreMemo(memo.id)}>
                          メモを復元
                        </button>
                        <button
                          type="button"
                          className="management-action management-action--danger"
                          onClick={() => handlePermanentDeleteMemo(memo.id)}
                        >
                          メモを完全削除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === 'settings' ? (
        <section className="management-panel management-panel--settings">
          {isLoading ? <p className="management-empty">Loading…</p> : null}
          {!isLoading ? (
            <label className="management-setting">
              <span>Auto close minutes</span>
              <select
                value={settings.autoCloseMinutes}
                onChange={(event) => void handleSaveSettings(Number(event.target.value))}
              >
                {[5, 10, 30, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
