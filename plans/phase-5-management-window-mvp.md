# Phase 5 計画書: 管理画面 MVP

## 1. 対象フェーズ
- マスタープラン対応: `Phase 5: 管理画面 MVP`
- 主目的: 保存済みメモを確認・再表示・削除・復元・設定変更できる最小管理画面を成立させる

---

## 2. SSOT 参照宣言
本計画書は以下を前提とする。

- `AI-Planning-Guidelines-Sticky.md`
- `マスタープラン.md`
- `要件定義.md` §7.8, §7.9, §7.10, §7.11
- `画面ワイヤー仕様.md` §4〜§9
- `デザインシステム初版.md`
- `画面一覧_状態遷移_DBスキーマ案.md` §2.2〜§2.4, §4
- `plans/phase-4-persistence-and-autosave.md`

---

## 3. 前提条件（着手条件）
- Phase 4 完了: SQLite 永続化・autosave・startup_cleanup が動いている
- `sessions` / `memos` / `settings` テーブルが存在している
- メニューバーの `Open Home / Trash / Settings` が現状スタブ（無効）である

---

## 4. 今回触る関連ファイル（フェーズ全体）

| ファイル | 用途 |
|---|---|
| `app/src-tauri/src/lib.rs` | 管理ウィンドウ生成・メニュー有効化・DB コマンド追加 |
| `app/src/services/stickyDb.ts` | 管理画面用 DB 関数追加 |
| `app/src/App.tsx` | view 分岐追加・再表示イベント受信 |
| `app/src/Management.tsx` | 管理画面 React コンポーネント（新規） |
| `app/src/App.css` | 管理画面スタイル追記 |

触らないもの:
- `app/src-tauri/tauri.conf.json`（管理ウィンドウはコード側で動的生成する）
- デスクトップメモ UI の既存ロジック全般（回帰させない）

---

## 5. アーキテクチャ方針

### 5-1. 管理ウィンドウの実装方式

`tauri::WebviewWindowBuilder` でオンデマンドに管理ウィンドウを生成する。

- ラベル: `"management"`
- URL: 既存の `index.html` に `?view=management&tab=home`（or trash / settings）を付与
- サイズ: 最小 `960 x 680`（要件定義 §12 参照）
- 通常の macOS ウィンドウ（装飾あり・透過なし）

React 側は `new URLSearchParams(window.location.search).get('view')` で分岐し、`"management"` なら `Management` コンポーネントを描画する。これにより Tauri 固有 API への依存を最小化する。

```
App.tsx
  ├─ view === 'management' → <Management initialTab={tab} />
  └─ それ以外              → 既存のオーバーレイ UI
```

### 5-2. ウィンドウ間通信

管理画面 → デスクトップへの再表示は、管理ウィンドウ内の React から `invoke('reopen_session', {sessionId})` を呼ぶ。Tauri コマンド内で DB を更新し、`app.emit_to("main", "session://reopen", payload)` で overlay 側に通知する。

---

## 6. 問題一覧（Issue List）

### T-01: 管理ウィンドウの生成・表示制御
現状メニューの Open Home / Trash / Settings は `enabled: false` のスタブ。
Tauri 側で `WebviewWindowBuilder` を使ってウィンドウを動的生成し、すでに開いていれば前面に出す制御が必要。

### D-01: 管理画面用 DB クエリ未実装
現状の Tauri コマンドは overlay 用（open セッションのみ対象）。管理画面に必要な以下が未実装:
- `load_home`: 全非ゴミ箱 session + memo（content != '' のみ）を日時降順で取得
- `load_trash`: `trashed_at IS NOT NULL` のセッション/メモ一覧
- `restore_session`, `restore_memo`: `trashed_at = NULL` に戻す
- `permanent_delete_session`, `permanent_delete_memo`: 物理削除
- `move_memo`: `memos.session_id` を更新（セッション移動）
- `load_settings`, `save_settings`: `settings` テーブルの読み書き
- `reopen_session`: `sessions.is_open = 1` にしてデスクトップへ emit

### U-01: Home 画面実装
保存済みメモを「日時 > セッション > メモカード」構造で一覧表示する。キーワード検索（本文・タイトル対象）を持つ。

### U-02: Trash 画面実装
ゴミ箱内のセッション/メモ一覧を表示する。各項目から「復元」「完全削除」できる。

### U-03: Settings 画面実装
`auto_close_minutes`（5 / 10 / 30 / 60 分）をセレクタで変更できる。

### U-04: 再表示導線
管理画面 Home のメモから「デスクトップに開く」を実行すると、overlay に当該セッションが再表示される。再表示はセッション単位とする（MVP）。

### K-01: 空状態 UI
Home にメモが1件もない場合、初回起動時の案内 UI を表示する（要件定義 §7.8、画面ワイヤー §8 参照）。

---

## 7. サブフェーズ

### Phase 5-1: Tauri 管理ウィンドウ基盤

対応 Issue: T-01

目的: メニューの Open Home / Trash / Settings をクリックすると通常ウィンドウとして管理画面が開く

触るファイル:
- `app/src-tauri/src/lib.rs`（1 ファイル）

実装ステップ:
1. `open_management_window(app, tab: String)` ヘルパーを lib.rs に実装
   - ラベル `"management"` のウィンドウが既存なら `window.set_focus()`、なければ `WebviewWindowBuilder` で新規生成
   - URL: `http://localhost:5173?view=management&tab={tab}` (dev) / `tauri://localhost?view=management&tab={tab}` (prod)
   - 通常ウィンドウ設定: `transparent: false`, `decorations: true`, `always_on_top: false`
   - 最小サイズ: `960 x 680`
2. `on_menu_event` の `"open-home"`, `"open-trash"`, `"open-settings"` ハンドラを実装
3. メニュー項目の `enabled` を `true` に変更

Gate:
- メニューの `Open Home` でウィンドウが開く
- 既に開いているときに再クリックするとそのウィンドウが前面に出る
- overlay の挙動を壊していない

---

### Phase 5-2: 管理画面 DB クエリ追加

対応 Issue: D-01

目的: 管理画面が必要とするすべての DB 操作を Tauri コマンドと TS 関数として実装する

触るファイル:
- `app/src-tauri/src/lib.rs`（追加）
- `app/src/services/stickyDb.ts`（追加）

実装ステップ（lib.rs 側）:
1. `load_home` → sessions + memos を JOIN、trashed_at IS NULL かつ content != '' を日時降順で返す
2. `load_trash` → trashed_at IS NOT NULL のセッション/メモ一覧
3. `restore_session(session_id)` → `trashed_at = NULL`
4. `restore_memo(memo_id)` → `trashed_at = NULL`
5. `permanent_delete_session(session_id)` → 物理削除（関連メモも削除）
6. `permanent_delete_memo(memo_id)` → 物理削除（セッションが空になった場合はセッションも削除）
7. `move_memo(memo_id, target_session_id)` → `memos.session_id` を更新
8. `load_settings` → settings テーブルから id=1 を SELECT
9. `save_settings(auto_close_minutes)` → id=1 を UPDATE
10. `reopen_session(session_id)` → `sessions.is_open = 1`, `memos.is_open = 1` に更新し `app.emit_to("main", "session://reopen", {sessionId})` を emit
11. `invoke_handler` に全コマンドを追加

実装ステップ（stickyDb.ts 側）:
- 上記コマンドに対応する TS 関数を追加

Gate:
- 各コマンドが `cargo check` を通る
- `load_home` が実データを返せる（ `saveSessionsToDb` 後に呼んで確認）

---

### Phase 5-3: 管理画面 React 基盤 + Home タブ

対応 Issue: U-01, K-01

目的: 管理ウィンドウに Home タブが表示され、保存済みメモの一覧と検索が動く

触るファイル:
- `app/src/App.tsx`（view 分岐を追加）
- `app/src/Management.tsx`（新規）

実装ステップ:
1. App.tsx に view 判定を追加
   ```tsx
   const params = new URLSearchParams(window.location.search)
   const view = params.get('view')
   if (view === 'management') {
     const tab = params.get('tab') ?? 'home'
     return <Management initialTab={tab} />
   }
   // 以降は既存の overlay UI
   ```
2. Management.tsx を新規作成
   - タブ切替 state: `'home' | 'trash' | 'settings'`
   - Home タブ:
     - 上部: キーワード検索欄
     - 中央: 日時グループ > セッション見出し > メモカード群
     - 各メモカード: タイトル・本文プレビュー（3行）・更新時刻
     - 右クリックメニュー: `デスクトップに開く` / `ゴミ箱に移動`
     - 空状態 UI: メモ0件時に案内テキストとコマンド一覧を表示
   - Trash / Settings タブ: この時点ではプレースホルダー
3. スタイルは Management.tsx 内またはインラインで最小限定義（App.css への追記は 5-4 でまとめる）

Gate:
- `?view=management` で Management コンポーネントが描画される
- Home タブに `load_home` の結果が表示される
- キーワード検索でリストが絞り込まれる
- 空状態 UI が表示される
- overlay UI を壊していない

---

### Phase 5-4: Trash + Settings タブ

対応 Issue: U-02, U-03

目的: Trash タブで復元・完全削除が動く。Settings タブで auto_close_minutes が変更できる。

触るファイル:
- `app/src/Management.tsx`（追記）
- `app/src/App.css`（管理画面スタイル追記）

実装ステップ:
1. Trash タブを実装
   - `load_trash` 結果を一覧表示
   - 各項目に「復元」「完全削除」ボタン
   - 「復元」→ `restore_session` または `restore_memo` 呼び出し、リスト再取得
   - 「完全削除」→ `permanent_delete_*` 呼び出し、リスト再取得
2. Settings タブを実装
   - `load_settings` で現在値を取得
   - `auto_close_minutes` を `5 / 10 / 30 / 60 分` のセレクタで表示
   - 変更時に `save_settings` を呼ぶ
3. App.css に管理画面用スタイルを追記

Gate:
- Trash タブにゴミ箱内項目が表示される
- 復元後に Home タブで再び表示される（完全削除後は消える）
- Settings で auto_close_minutes を変更すると DB に保存される
- overlay UI を壊していない

---

### Phase 5-5: 再表示導線

対応 Issue: U-04

目的: 管理画面 Home から「デスクトップに開く」を実行すると、overlay にセッションが再表示される

触るファイル:
- `app/src/Management.tsx`（追記）
- `app/src/App.tsx`（`session://reopen` イベント受信追加）

実装ステップ:
1. Management.tsx の右クリックメニュー「デスクトップに開く」から `reopen_session(sessionId)` を呼ぶ
2. App.tsx に `listen('session://reopen', handler)` を追加
   - ハンドラ: `loadSessionsFromDb()` → `setSessions(...)` で state を再フレッシュ
   - overlay ウィンドウに `set_focus` は Tauri 側 `reopen_session` で対応済み
3. 上限チェック: セッション数・メモ数がすでに上限の場合は `limitWarning` を発火して開かない

Gate:
- 管理画面から「デスクトップに開く」でセッションがデスクトップに出現する
- 再表示時のスロット配置が空きスロットに収まる
- 上限到達時は警告演出が出て再表示されない
- overlay の既存操作を壊していない

---

## 8. Gate 条件（Phase 5 全体）

1. `Open Home / Trash / Settings` でそれぞれ対応タブが開く
2. Home タブに保存済みメモが日時グループ構造で一覧表示される
3. キーワード検索でメモを絞り込める
4. Home からメモを「ゴミ箱に移動」できる
5. Trash タブに削除済みメモが一覧表示される
6. Trash から「復元」「完全削除」が動く
7. Settings で `auto_close_minutes` を変更・保存できる
8. Home から「デスクトップに開く」でセッションが再表示される
9. overlay の既存操作（選択・編集・ドラッグ・リサイズ・ショートカット）を壊していない

---

## 9. 回帰 / 副作用チェック

### DB
- `load_home` が overlay の autosave 結果を正しく反映しているか
- `move_memo` 後に空になったセッションが DB から消えているか
- `permanent_delete_session` で memos も連鎖削除されているか
- `restore_session` で `trashed_at = NULL` になっているか
- `save_settings` が id=1 の行を UPDATE しているか（INSERT しないか）

### 管理ウィンドウ
- 同じメニュー項目を連続クリックしても重複ウィンドウが開かないか
- 管理ウィンドウを閉じた後に再度開けるか
- overlay の `always_on_top` が管理ウィンドウより前面にならないか

### overlay との干渉
- `session://reopen` を受け取った後、overlay の selection 状態が `none` にリセットされているか
- 上限チェックが再表示時に正しく働くか

---

## 10. MECE 検査

### 検査A: Issue → Phase 対応

| Issue | Phase |
|---|---|
| T-01 | 5-1 |
| D-01 | 5-2 |
| U-01, K-01 | 5-3 |
| U-02, U-03 | 5-4 |
| U-04 | 5-5 |

全 Issue に対応 Phase あり → OK

### 検査B: SSOT 整合
- 要件定義 §7.8: Home / Trash / Settings 3タブ構成 → 5-3〜5-4 で対応
- 要件定義 §7.9: ドラッグ&ドロップでセッション移動 → **MVP では右クリックメニューから `move_memo` で対応し、D&D は Phase 6 で検討**（仕様逸脱理由: D&D は実装コストが高く、移動操作自体は右クリックで成立するため）
- 要件定義 §7.10: ゴミ箱 30日自動削除 → **MVP では手動削除のみで対応し、自動削除は Phase 6 に持ち越す**（startup_cleanup で将来的に組み込み可能）
- 要件定義 §7.11: キーワード検索 → 5-3 でフロント側 filter として実装（SQL LIKE より実装コストが低く、MVP 規模では十分）
- 画面ワイヤー §4.2: 最小サイズ 960x680 → 5-1 の WebviewWindowBuilder で設定
- DBスキーマ §4: `trashed_at`, `is_open` フィールド → 既存スキーマを流用

### 検査C: DRY / KISS
- 管理画面は overlay と別コンポーネント（Management.tsx）として独立させ、状態を混在させない
- view 判定は `URLSearchParams` のみで行い、Tauri API への依存を増やさない
- 検索はフロント filter で実装し、DB クエリを複雑化させない（MVP 規模で十分）
- ゴミ箱自動削除・D&D セッション移動は Phase 6 に明示的に持ち越し、今回スコープを増やさない

---

## 11. セルフチェック結果

### SSOT整合
- [x] 要件定義 §7.8〜§7.11 を確認した
- [x] 状態遷移文書を確認した（管理画面は新規 view であり既存遷移と干渉しない）
- [x] 操作一覧を確認した（管理画面操作はデスクトップ操作と分離されている）
- [x] DBスキーマと矛盾していない
- [x] SSOT との逸脱2点（D&D / 自動削除）を理由付きで明記した

### 変更範囲
- [x] 各サブフェーズの主目的は1つ
- [x] 触るファイル数は3以下（各サブフェーズ）
- [x] 新規ファイルは1以下（Management.tsx のみ）

### 状態・保存
- [x] 管理画面側の DB 操作（restore, delete, move）は overlay の autosave と経路が独立している
- [x] `reopen_session` は既存の `is_open` フィールドを正しく使っている
- [x] settings の read/write は id=1 固定で一本化されている

### UI / UX
- [x] 管理画面は通常 macOS ウィンドウとして実装する（overlay とは別ウィンドウ）
- [x] overlay の選択・編集モデルを管理画面に持ち込まない

### Tauri / 疎通
- [x] 管理ウィンドウ生成は 5-1 で先に疎通確認する
- [x] ウィンドウ間通信（emit_to）は 5-5 で確認する

### 判定
Phase 5-1 から着手可能。

---

## 12. 変更履歴
- 2026-04-08: 骨組み初版作成
- 2026-04-11: SSOT 参照・Issue 分解・5 サブフェーズ・Gate 条件・MECE 検査を含む詳細計画へ展開
