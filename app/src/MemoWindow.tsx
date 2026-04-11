import { useEffect, useMemo, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

function MemoWindow() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const memoId = params.get('memoId') ?? 'memo-draft'
  const [content, setContent] = useState('')
  const [isPinned, setIsPinned] = useState(false)
  const appWindow = getCurrentWindow()

  useEffect(() => {
    let mounted = true
    void appWindow.isAlwaysOnTop().then((value) => {
      if (mounted) {
        setIsPinned(value)
      }
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        void appWindow.close()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      mounted = false
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [appWindow])

  const togglePin = async () => {
    const nextPinned = !isPinned
    setIsPinned(nextPinned)
    await appWindow.setAlwaysOnTop(nextPinned)
  }

  return (
    <main className="memo-window-shell">
      <article className="memo-window-card">
        <header
          className="memo-window-card__header"
          onPointerDown={() => {
            void appWindow.startDragging()
          }}
        >
          <div>
            <p className="memo-window-card__eyebrow">sticky memo</p>
            <h1 className="memo-window-card__title">{memoId}</h1>
          </div>
          <div className="memo-window-card__actions">
            <button
              type="button"
              className={`memo-window-card__action ${isPinned ? 'memo-window-card__action--active' : ''}`}
              onClick={(event) => {
                event.stopPropagation()
                void togglePin()
              }}
            >
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              type="button"
              className="memo-window-card__action"
              onClick={(event) => {
                event.stopPropagation()
                void appWindow.close()
              }}
            >
              Close
            </button>
          </div>
        </header>

        <section className="memo-window-card__body">
          <textarea
            className="memo-window-card__editor"
            autoFocus
            placeholder="Write and jump back to work."
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
          />
        </section>

        <footer className="memo-window-card__footer">
          <span>{isPinned ? 'Pinned above other apps' : 'Normal window'}</span>
          <span>Cmd+W to close</span>
        </footer>
      </article>
    </main>
  )
}

export default MemoWindow
