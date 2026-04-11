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

既存の `"management"` ウィンドウを再利用する場合でも、`Open Home / Trash / Settings` の各メニューは必ず対応タブを開く。

- 初回生成時は `?view=management&tab={tab}` を URL に含める
- 既存ウィンドウ再利用時は `set_focus()` だけで終わらせず、`management://open-tab` イベントで対象タブを通知する
- React 側は起動時の `initialTab` に加えて `management://open-tab` を購読し、既存ウィンドウ内のタブ state を切り替える
- URL の再書き換えは必須にしない。MVP では Tauri event を唯一の切替手段として固定する

### 5-2. ウィンドウ間通信

管理画面 → デスクトップへの再表示は、管理ウィンドウ内の React から `invoke('reopen_session', {sessionId})` を呼ぶ。Tauri コマンド内で DB を更新し、`app.emit_to("main", "session://reopen", payload)` で overlay 側に通知する。

管理画面内のタブ切替は別経路で扱う。

- Tauri → 管理画面: `management://open-tab`
- 管理画面 → overlay: `session://reopen`
- 復元 (`restore_session`, `restore_memo`) と再表示 (`reopen_session`) は別操作として維持する
- Trash からの「復元」は `trashed_at = NULL` に戻すだけで、`is_open = 0` のまま Home に戻す
- Desktop へ再表示したい場合は、復元後に Home から明示的に `デスクトップに開く` を実行する

---

## 6. 問題一覧（Issue List）

### T-01: 管理ウィンドウの生成・表示制御
現状メニューの Open Home / Trash / Settings は `enabled: false` のスタブ。
Tauri 側で `WebviewWindowBuilder` を使ってウィンドウを動的生成し、すでに開いていれば前面に出す制御が必要。

### D-01: 管理画面用 DB クエリ未実装
現状の Tauri コマンドは overlay 用（open セッションのみ対象）。ただし Home からの「ゴミ箱に移動」は既存の `trash_session` / `trash_memo` を再利用する前提とする。新規追加が必要なのは以下:
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

Home の表示対象には `is_open = 1` のセッションも含まれるため、「デスクトップに開く」導線は closed セッション専用として扱う。すでに open なセッションには同アクションを表示しない。

### U-05: セッション移動導線
要件上のセッション移動は Phase 5 でも成立させる。ただし MVP ではドラッグ&ドロップではなく、Home 上の右クリックメニューから移動先セッションを選ぶ方式に落とす。

### D-02: 再表示時スロット再配置責務の固定
`reopen_session` 時の空きスロット再割当責務を overlay 側に固定する。現行 `buildSessionsFromRows()` は DB の `slotIndex` / 座標をそのまま state 化するだけで、再配置ロジックは未実装である。Phase 5 では `session://reopen` 受信時の専用再配置処理を新規追加する。

### D-03: 再表示時の上限判定責務の固定
`reopen_session` の上限判定は Tauri / DB ではなく overlay 側の in-memory state を正とする。現行では open セッションが常時 DB 同期されておらず、未保存の表示中セッションを Rust 側で正しく数えられないため。

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
   - ラベル `"management"` のウィンドウが既存なら `window.emit("management://open-tab", { tab })` → `window.set_focus()`、なければ `WebviewWindowBuilder` で新規生成
   - URL: `http://localhost:5173?view=management&tab={tab}` (dev) / `tauri://localhost?view=management&tab={tab}` (prod)
   - 通常ウィンドウ設定: `transparent: false`, `decorations: true`, `always_on_top: false`
   - 最小サイズ: `960 x 680`
2. `on_menu_event` の `"open-home"`, `"open-trash"`, `"open-settings"` ハンドラを実装
3. メニュー項目の `enabled` を `true` に変更

Gate:
- メニューの `Open Home` でウィンドウが開く
- `Open Trash` / `Open Settings` で既存ウィンドウ再利用時も対応タブに切り替わる
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
3. `restore_session(session_id)` → `sessions.is_open = 0`, `memos.is_open = 0` を維持したまま `trashed_at = NULL`
4. `restore_memo(memo_id)` → `is_open = 0` を維持したまま `trashed_at = NULL`
5. `permanent_delete_session(session_id)` → 物理削除（関連メモも削除）
6. `permanent_delete_memo(memo_id)` → 物理削除（セッションが空になった場合はセッションも削除）
7. `move_memo(memo_id, target_session_id)` → `memos.session_id` を更新し、移動元セッションが空なら削除
8. `load_settings` → settings テーブルから id=1 を SELECT
9. `save_settings(auto_close_minutes)` → id=1 を UPDATE
10. `reopen_session(session_id)` → 上限チェックは持たず、`sessions.is_open = 1`, `memos.is_open = 1` に更新し `app.emit_to("main", "session://reopen", {sessionId})` を emit
11. Home からの削除導線は既存 `trash_session` / `trash_memo` を invoke する前提を明記し、新規コマンド化しない
12. `invoke_handler` に全コマンドを追加

実装ステップ（stickyDb.ts 側）:
- 上記コマンドに対応する TS 関数を追加
- 既存 `trashSessionInDb` / `trashMemoInDb` は Home から再利用する

Gate:
- 各コマンドが `cargo check` を通る
- `load_home` が実データを返せる（ `saveSessionsToDb` 後に呼んで確認）
- `restore_*` が「Home に戻すだけで Desktop には再表示しない」仕様になっている
- `move_memo` 後に空セッションが残らない
- `reopen_session` が上限判定を持たず、DB 更新 + event emit の責務に限定されている

---

### Phase 5-3: 管理画面 React 基盤 + Home タブ

対応 Issue: U-01, K-01, U-05

目的: 管理ウィンドウに Home タブが表示され、保存済みメモの一覧・検索・削除・セッション移動が動く

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
   - `management://open-tab` を購読し、既存ウィンドウ再利用時もタブ state を切り替える
   - Home タブ:
     - 上部: キーワード検索欄
     - 中央: 日時グループ > セッション見出し > メモカード群
     - 各メモカード: タイトル・本文プレビュー（3行）・更新時刻
     - 右クリックメニュー: `デスクトップに開く` / `ゴミ箱に移動` / `別セッションへ移動`
     - `session.is_open = 1` の項目では `デスクトップに開く` を非表示にし、必要なら `現在デスクトップ表示中` バッジを出す
     - `別セッションへ移動` は移動先セッション一覧をサブメニューまたはポップオーバーで表示し、MVP の正式導線とする
     - Home からの `ゴミ箱に移動` は既存 `trash_session` / `trash_memo` を呼ぶ
     - 空状態 UI: メモ0件時に案内テキストとコマンド一覧を表示
   - Trash / Settings タブ: この時点ではプレースホルダー
3. スタイルは Management.tsx 内またはインラインで最小限定義（App.css への追記は 5-4 でまとめる）

Gate:
- `?view=management` で Management コンポーネントが描画される
- Home タブに `load_home` の結果が表示される
- キーワード検索でリストが絞り込まれる
- Home から既存 `trash_*` コマンドでゴミ箱移動できる
- Home から `move_memo` を実行できる
- open セッションには `デスクトップに開く` が出ず、closed セッションにだけ出る
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
- 復元後に Home タブで再び表示されるが、Desktop には自動再表示しない（完全削除後は消える）
- Settings で auto_close_minutes を変更すると DB に保存される
- overlay UI を壊していない

---

### Phase 5-5: 再表示導線

対応 Issue: U-04, D-02, D-03

目的: 管理画面 Home から「デスクトップに開く」を実行すると、overlay にセッションが空きスロットへ再表示される

触るファイル:
- `app/src/Management.tsx`（追記）
- `app/src/App.tsx`（`session://reopen` イベント受信追加）

実装ステップ:
1. Management.tsx の右クリックメニュー「デスクトップに開く」は `session.is_open = 0` のときだけ表示し、その場合のみ `reopen_session(sessionId)` を呼ぶ
2. App.tsx に `listen('session://reopen', handler)` を追加
   - ハンドラ冒頭で overlay の in-memory state を基準に上限判定する
   - 上限超過時は `limitWarning` を発火し、DB を再読込せずに中断する
   - 上限内なら `loadSessionsFromDb()` で対象セッションを取得し、reopened 対象セッションだけに対して新規 `reassignReopenedSessionSlots(...)` を適用する
   - `reassignReopenedSessionSlots(...)` は `findAvailableSlotIndices()` と `getSlotPosition()` を使い、現在 open な他セッションを埋まっているスロットとして扱ったうえで、reopened セッション配下メモの `slotIndex` / `position` を再割当する
   - `buildSessionsFromRows()` はそのままでは再配置しないため、reopen 経路専用の state merge / slot reassignment を App.tsx か `sessionHelpers.ts` に新規実装する
   - `slot_index` の最終決定責務は overlay 側とし、Tauri はスロット番号を直接確定しない
   - overlay ウィンドウに `set_focus` は Tauri 側 `reopen_session` で対応済み
3. 必要に応じて再配置後の reopened セッションだけを `setSessions(...)` で既存 state に merge する
4. 上限チェックは overlay 側の `sessionsRef.current` を基準に行い、未保存の open セッション / メモも含めて判定する

Gate:
- 管理画面から「デスクトップに開く」でセッションがデスクトップに出現する
- すでに open なセッションには reopen 導線が出ず、重複 reopen が発生しない
- 再表示時のスロット配置が空きスロットに収まる
- 上限到達時は警告演出が出て再表示されない
- overlay の既存操作を壊していない

---

## 8. Gate 条件（Phase 5 全体）

1. `Open Home / Trash / Settings` でそれぞれ対応タブが開く
2. Home タブに保存済みメモが日時グループ構造で一覧表示される
3. キーワード検索でメモを絞り込める
4. Home からメモを「ゴミ箱に移動」できる
5. Home からメモを別セッションへ移動でき、空セッションが残らない
6. Trash タブに削除済みメモが一覧表示される
7. Trash から「復元」「完全削除」が動く
8. Settings で `auto_close_minutes` を変更・保存できる
9. Home から「デスクトップに開く」でセッションが空きスロットへ再表示される
10. すでに open なセッションに対しては reopen 導線が表示されない
11. overlay の既存操作（選択・編集・ドラッグ・リサイズ・ショートカット）を壊していない

---

## 9. 回帰 / 副作用チェック

### DB
- `load_home` が overlay の autosave 結果を正しく反映しているか
- `move_memo` 後に空になったセッションが DB から消えているか
- `permanent_delete_session` で memos も連鎖削除されているか
- `restore_session` で `trashed_at = NULL` になり、かつ `is_open = 0` のまま維持されているか
- `save_settings` が id=1 の行を UPDATE しているか（INSERT しないか）

### 管理ウィンドウ
- 同じメニュー項目を連続クリックしても重複ウィンドウが開かないか
- 管理ウィンドウを閉じた後に再度開けるか
- 既存管理ウィンドウ再利用時に `management://open-tab` でタブだけ切り替わるか
- overlay の `always_on_top` が管理ウィンドウより前面にならないか

### overlay との干渉
- `session://reopen` を受け取った後、overlay の selection 状態が `none` にリセットされているか
- 上限チェックが DB ではなく overlay の in-memory state 基準で正しく働くか
- 再表示したセッションが空きスロットへ再配置され、既存表示と衝突しないか
- `buildSessionsFromRows()` に依存せず、reopened セッションだけ `slotIndex` / `position` を再割当できているか
- すでに open なセッションに対して `reopen_session` が発火しない UI になっているか

---

## 10. MECE 検査

### 検査A: Issue → Phase 対応

| Issue | Phase |
|---|---|
| T-01 | 5-1 |
| D-01 | 5-2 |
| U-01, K-01, U-05 | 5-3 |
| U-02, U-03 | 5-4 |
| U-04, D-02, D-03 | 5-5 |

全 Issue に対応 Phase あり → OK

### 検査B: SSOT 整合
- 要件定義 §7.8: Home / Trash / Settings 3タブ構成 → 5-3〜5-4 で対応
- 要件定義 §7.9: ドラッグ&ドロップでセッション移動 → **MVP では右クリックメニューから `move_memo` で対応し、D&D は Phase 6 で検討**（仕様逸脱理由: D&D は実装コストが高く、移動操作自体は右クリックで成立するため。Phase 5 では UI 導線を明示して宙に浮かせない）
- 要件定義 §7.10: ゴミ箱 30日自動削除 → **MVP では手動削除のみで対応し、自動削除は Phase 6 に持ち越す**（startup_cleanup で将来的に組み込み可能）
- 要件定義 §7.11: キーワード検索 → 5-3 でフロント側 filter として実装（SQL LIKE より実装コストが低く、MVP 規模では十分）
- 画面ワイヤー §4.2: 最小サイズ 960x680 → 5-1 の WebviewWindowBuilder で設定
- DBスキーマ §4: `trashed_at`, `is_open` フィールド → 既存スキーマを流用
- 要件定義 §7.4: 再表示時も空きスロットへ配置 → 5-5 で overlay 側責務として固定し、`findAvailableSlotIndices()` を用いた reopen 専用再配置処理を新規実装する
- Home 一覧には open / closed の両方が載る → reopen 導線は closed セッション専用に制限し、既表示セッションへの重複 reopen を防ぐ
- 既存 `trash_session` / `trash_memo` が実装済み → Phase 5 では再利用し、新規コマンド追加を避ける

### 検査C: DRY / KISS
- 管理画面は overlay と別コンポーネント（Management.tsx）として独立させ、状態を混在させない
- view 判定は `URLSearchParams` のみで行い、Tauri API への依存を増やさない
- 既存ウィンドウのタブ切替は `management://open-tab` に一本化し、URL 再書き換えの責務を持ち込まない
- 検索はフロント filter で実装し、DB クエリを複雑化させない（MVP 規模で十分）
- ゴミ箱自動削除・D&D セッション移動は Phase 6 に明示的に持ち越し、今回スコープを増やさない
- 既存 `trash_*` コマンドを再利用し、削除経路を増やさない
- `reopen_session` は DB 更新と通知だけに限定し、上限判定とスロット再配置は overlay 側に寄せる

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
- [x] `restore_*` と `reopen_session` の責務を分離した
- [x] 再表示時スロット再配置の責務を overlay 側に固定した
- [x] 再表示時の上限判定を overlay の in-memory state 基準に固定した
- [x] open セッションには reopen 導線を出さない方針を固定した
- [x] settings の read/write は id=1 固定で一本化されている

### UI / UX
- [x] 管理画面は通常 macOS ウィンドウとして実装する（overlay とは別ウィンドウ）
- [x] overlay の選択・編集モデルを管理画面に持ち込まない
- [x] セッション移動 UI は MVP 導線（右クリック移動）まで固定した

### Tauri / 疎通
- [x] 管理ウィンドウ生成は 5-1 で先に疎通確認する
- [x] ウィンドウ間通信（emit_to）は 5-5 で確認する
- [x] Phase 6 持ち越し項目（D&D / 30日自動削除）を明示した

### 判定
Phase 5-1 から着手可能。

---

## 12. 変更履歴
- 2026-04-08: 骨組み初版作成
- 2026-04-11: SSOT 参照・Issue 分解・5 サブフェーズ・Gate 条件・MECE 検査を含む詳細計画へ展開
- 2026-04-11: レビュー反映。管理ウィンドウのタブ切替、右クリック移動 UI、再表示時スロット再配置責務、既存 `trash_*` 再利用、restore/reopen の責務分離を明文化
- 2026-04-11: 追加レビュー反映。reopen 専用 slot 再配置を新規実装前提へ修正し、上限判定を Tauri/DB ではなく overlay in-memory state 基準に変更
- 2026-04-11: 追加レビュー反映。Home に open セッションも表示する前提を維持しつつ、reopen 導線は closed セッション専用に固定
