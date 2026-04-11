import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import MemoWindow from './MemoWindow.tsx'

const params = new URLSearchParams(window.location.search)
const view = params.get('view')
const RootComponent = view === 'memo' ? MemoWindow : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
)
