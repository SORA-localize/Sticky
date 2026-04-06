import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import './App.css'

function App() {
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [clickThrough, setClickThrough] = useState(false)

  useEffect(() => {
    const unlisten = Promise.all([
      listen<boolean>('overlay://visibility', (event) => {
        setOverlayVisible(event.payload)
      }),
      listen<boolean>('overlay://clickthrough', (event) => {
        setClickThrough(event.payload)
      }),
    ])

    return () => {
      void unlisten.then((handlers) => {
        handlers.forEach((dispose) => dispose())
      })
    }
  }, [])

  return (
    <main className="overlay-shell">
      <article className="probe-note selected">
        <div className="selection-ring" />
        <p className="probe-label">overlay probe</p>
        <h1>sticky connectivity check</h1>
        <p className="probe-copy">
          透過前面レイヤー、グローバルショートカット、クリック透過切替の
          疎通確認用ビュー。
        </p>
        <ul className="probe-list">
          <li>Cmd + Shift + 1: overlay show / hide</li>
          <li>Cmd + Shift + 2: click-through toggle</li>
          <li>透明背景 + fullscreen + always on top</li>
        </ul>
      </article>

      <aside className="debug-panel">
        <p className="probe-label">runtime status</p>
        <div className="status-row">
          <span>overlay</span>
          <strong>{overlayVisible ? 'visible' : 'hidden'}</strong>
        </div>
        <div className="status-row">
          <span>click-through</span>
          <strong>{clickThrough ? 'on' : 'off'}</strong>
        </div>
      </aside>
    </main>
  )
}

export default App
