# Phase 3-2 計画書: セッション選択と右クリックメニュー

## 1. 目的
右クリックメニューから `session_selected` へ入る導線を実装する。
セッション文脈の操作対象を明確にし、Phase 3-3 の一括操作の土台を作る。

## 2. SSOT 参照
- `操作一覧表.md` §2.1〜2.2
- `画面ワイヤー仕様.md` §3.6
- `plans/phase-3-session-operations.md` §5 Phase 3-2

## 3. 問題 / Issue
- **S-02**: `session_selected` 状態への遷移コードが存在しない（型定義のみある）
- **U-04**: 右クリックメニューが未実装

## 4. 実装内容

### 4-1. ContextMenu state

```ts
type ContextMenu = {
  sessionId: string
  x: number
  y: number
} | null

const [contextMenu, setContextMenu] = useState<ContextMenu>(null)
const contextMenuRef = useRef<HTMLElement | null>(null)
```

### 4-2. 右クリックハンドラ

```ts
const handleMemoContextMenu = (sessionId: string) => (event: React.MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  setContextMenu({ sessionId, x: event.clientX, y: event.clientY })
  setIsSessionPickerVisible(false)
}
```

### 4-3. handleMemoPointerDown の修正

右クリックでドラッグ操作が始まらないよう `event.button !== 0` の早期 return を追加する。
コンテキストメニュー表示中に別メモを左クリックしたとき自動でメニューを閉じる。

### 4-4. handleShellPointerDown の修正

コンテキストメニューの DOM ref が含まれていれば return。
それ以外（メモ外クリック）でメニューを閉じる。

### 4-5. Esc キーの修正

コンテキストメニューが開いているとき Esc で閉じる（clearSelections より先に判定）。
contextMenuRef.current で判定するため deps 追加不要。

### 4-6. session_selected 遷移

```ts
// 「このセッションを選択」押下時
setSessions((prev) =>
  clearSelections(prev).map((s) =>
    s.id !== sessionId ? s : { ...s, selectionState: 'session_selected' }
  )
)
setContextMenu(null)
```

### 4-7. 視覚表現

- `session_selected` のセッション内全メモに青枠（`.memo-card__ring`）を表示
- `memo.uiState === 'memo_selected' || editing || session.selectionState === 'session_selected'`
  のいずれかで ring を出す

### 4-8. memo_selected への戻り

既存の `handleMemoClick` が `clearSelections` → 対象メモを `memo_selected` に設定する流れなので、
追加実装不要。session_selected 中にメモをクリックすると自動的に session が idle に戻る。

### 4-9. コンテキストメニュー JSX

- `position: fixed` でクリック座標に配置
- 画面端で折り返す clamp 処理
- 項目:
  - `このセッションを選択`（→ session_selected）
  - セパレーター
  - `このセッションを閉じる`（Phase 3-3 スタブ）
  - `このセッションを削除...`（Phase 3-3 スタブ）

## 5. 対象ファイル

| ファイル | 変更内容 |
|---|---|
| `app/src/App.tsx` | ContextMenu 型・state、各ハンドラ修正、JSX 追加 |
| `app/src/App.css` | `.context-menu` スタイル |

## 6. Gate 条件

- メモ右クリックでセッション文脈メニューが開く
- `このセッションを選択` で `session_selected` に入る
- session_selected 中はセッション内全メモに青枠が出る
- session_selected 中にメモをシングルクリックで `memo_selected` に戻れる
- Esc / メモ外クリック でメニューが閉じる
- Phase 3-1 の既存 Gate を壊していない

## 7. スタブ範囲（Phase 3-3 へ持ち越し）

- `このセッションを閉じる` → メニューを閉じるだけ
- `このセッションを削除...` → メニューを閉じるだけ

## 8. 変更履歴
- 2026-04-08: 初版
