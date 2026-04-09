# Phase 4 計画書: 保存基盤と自動処理

## 1. 対象フェーズ
- マスタープラン対応: `Phase 4: 保存基盤と自動処理`
- 主目的: sticky の保存モデルを SQLite 基盤へ接続し、autosave / cleanup / 再起動耐性を成立させる

---

## 2. SSOT 参照宣言
本計画書は以下を前提とする。

- `AI-Planning-Guidelines-Sticky.md`
- `マスタープラン.md`
- `要件定義.md`
- `画面一覧_状態遷移_DBスキーマ案.md`（スキーマ追記あり → §5 D-01 参照）
- `操作一覧表.md`
- `疎通確認結果.md`
- `plans/phase-3-session-operations.md`

本フェーズでは管理画面本体 UI を作らない。保存の成立を最優先とする。

---

## 3. フェーズ目的

1. `Cmd + S` と autosave が同一の保存経路を通る
2. SQLite に memo / session を保存・読み出しできる
3. 起動時に `is_open` が全リセットされ、空メモ/空セッションが cleanup される
4. 再起動後もデータが DB に保持される（「再起動耐性」= データ消失なし、デスクトップ自動復元ではない）

### `is_open` フラグの定義（このフェーズで固定）

| 値 | 意味 |
|---|---|
| `1` | 現在デスクトップ上に表示中 |
| `0` | 表示終了済み（閉じた/保存済み）→ Phase 5 の Home で参照可能 |

- 起動時は全件 `0` にリセット → デスクトップは空でスタートする
- 「前回開いていたセッションを自動復元」は Phase 5 の Home 機能として実装する
- Phase 4 ではデータが DB に残っていれば正常とみなす

---

## 4. 今回触る関連ファイル

| ファイル | 用途 |
|---|---|
| `app/src-tauri/Cargo.toml` | rusqlite / serde / chrono 追加 |
| `app/src-tauri/tauri.conf.json` | 変更なし（plugin 追加不要） |
| `app/src-tauri/src/lib.rs` | Tauri コマンド群・startup cleanup |
| `app/src/App.tsx` | 起動時ロード・保存経路統合・autosave |
| `app/src/App.css` | 変更なし（既存を壊さない） |

触らないもの:
- 管理画面本体 UI（Phase 5）
- auto close タイマー（Phase 6 へ）
- `is_dirty` 永続化（Phase 4 では起動時に全メモを dirty とみなす）

> 補足: Rust 側ファイルが 3 本になるが、Cargo.toml と tauri.conf.json は設定ファイルであり、実装ロジックは `lib.rs` に集中するため、ガイドライン §9 の 3 ファイル上限の精神に沿う。

---

## 5. 問題一覧（Issue List）

### D-01: DB スキーマにポジション/サイズカラムを追加

現状:
- `画面一覧_状態遷移_DBスキーマ案.md` の `memos` テーブルに位置・サイズカラムがない
- Phase 3 の `Memo` 型は `position: { x, y }` / `size: { width, height }` を持つ
- 永続化時にこれらが失われる

対応:
- `memos` テーブルに `pos_x REAL`, `pos_y REAL`, `width REAL`, `height REAL` を追加
- `画面一覧_状態遷移_DBスキーマ案.md` を更新する

確定スキーマ（Phase 4 採用版）:
```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  color_slot INTEGER NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  trashed_at TEXT
);

CREATE TABLE IF NOT EXISTS memos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 320,
  height REAL NOT NULL DEFAULT 240,
  slot_index INTEGER,
  is_open INTEGER NOT NULL DEFAULT 1,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  trashed_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  auto_close_minutes INTEGER NOT NULL DEFAULT 60,
  max_open_sessions INTEGER NOT NULL DEFAULT 5,
  max_open_memos INTEGER NOT NULL DEFAULT 15
);
```

---

### D-02: SQLite 接続とスキーマ初期化

現状:
- `app/src-tauri/src/lib.rs` に SQLite 接続がない
- メモ状態はメモリのみ（再起動で消える）

DB アクセス方式の選定:
- **`rusqlite` 直持ち**を採用する（`tauri-plugin-sql` は使わない）
- `tauri-plugin-sql` は JS 側から生 SQL を発行する方式であり、Rust 側で timestamp を生成・管理する本計画と設計が矛盾する
- `rusqlite` + `Mutex<Connection>` を Tauri State として管理し、全 DB 操作を Tauri コマンド経由に集約する

対応:
- `Cargo.toml` に `rusqlite` / `serde` / `serde_json` / `chrono` を追加する（`tauri-plugin-sql` は追加しない）
- `setup` 内で `rusqlite::Connection::open(db_path)` を呼び、`CREATE TABLE IF NOT EXISTS` を実行する
- DB ファイルパスは `app.path().app_data_dir()? + "sticky.db"`
- `app.manage(Mutex::new(conn))` で State に登録する

---

### D-03: Tauri コマンド群の実装

以下の Tauri コマンドを `lib.rs` に実装する。

| コマンド名 | 引数 | 動作 |
|---|---|---|
| `startup_cleanup` | なし | `is_open` 全件 0 リセット → 空メモ/空セッション 論理削除 |
| `load_sessions` | なし | `is_open = 1` の sessions + memos を全件返す |
| `upsert_session` | session 業務データ | sessions を upsert する（timestamp は Rust 側で生成） |
| `upsert_memo` | memo 業務データ | memos を upsert する（timestamp は Rust 側で生成） |
| `close_session` | session_id | session + 全 memo の `is_open = 0` を更新 |
| `trash_session` | session_id | session + 全 memo の `trashed_at` を現在時刻に設定（論理削除） |
| `trash_memo` | memo_id | memo の `trashed_at` を現在時刻に設定（論理削除） |

返却型は serde_json::Value またはカスタム Serialize 構造体を使う。

#### upsert の SQL 方針（timestamp 保全）

`INSERT OR REPLACE` は全列を上書きするため `created_at` が消える。代わりに以下を使う:

```sql
-- sessions
INSERT INTO sessions (id, color_slot, is_open, created_at, updated_at, last_active_at)
VALUES (?1, ?2, ?3, datetime('now'), datetime('now'), datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  color_slot      = excluded.color_slot,
  is_open         = excluded.is_open,
  updated_at      = datetime('now'),
  last_active_at  = datetime('now');

-- memos（同様に created_at を保全）
INSERT INTO memos (id, session_id, content, title, pos_x, pos_y, width, height,
                   slot_index, is_open, is_pinned, created_at, updated_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now'), datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  content    = excluded.content,
  title      = excluded.title,
  pos_x      = excluded.pos_x,
  pos_y      = excluded.pos_y,
  width      = excluded.width,
  height     = excluded.height,
  slot_index = excluded.slot_index,
  is_open    = excluded.is_open,
  is_pinned  = excluded.is_pinned,
  updated_at = datetime('now');
```

- `created_at` は INSERT 時のみ設定され、UPDATE では変更しない
- `last_active_at` は sessions upsert ごとに更新（将来の auto close 判定用として保持）
- `trashed_at` は trash 系コマンドでのみ更新し、upsert では触らない
- フロントエンドは timestamp を一切持たない・送らない

#### フロントエンドが渡す業務データの型

```ts
// Rust へ渡す payload（timestamp なし）
type SessionPayload = {
  id: string
  colorSlot: number
  isOpen: boolean
}

type MemoPayload = {
  id: string
  sessionId: string
  content: string
  title: string
  posX: number
  posY: number
  width: number
  height: number
  slotIndex: number | null
  isOpen: boolean
  isPinned: boolean
}
```

---

### D-04: title 再生成

保存時（明示保存・autosave 両方）、`title` を `content` の先頭 10 文字から生成する。

実装場所: フロントエンド（保存関数内）で生成し、コマンド引数に含めて渡す。

```ts
function generateTitle(content: string): string {
  return content.slice(0, 10)
}
```

---

### D-05: 保存経路の一本化

`Cmd + S`（明示保存）と autosave（5 分タイマー）が同じ `saveSessions()` 関数を呼ぶ。

```ts
async function saveSessions(sessions: Session[]) {
  for (const session of sessions.filter(s => s.isOpen)) {
    const sp: SessionPayload = {
      id: session.id,
      colorSlot: session.colorSlot,
      isOpen: session.isOpen,
    }
    await invoke('upsert_session', { session: sp })
    for (const memo of session.memos.filter(m => m.isVisible)) {
      const mp: MemoPayload = {
        id: memo.id,
        sessionId: session.id,
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
      await invoke('upsert_memo', { memo: mp })
    }
  }
}
```

呼び出し元:
- `handleSave()`（Cmd+S ハンドラ）: `saveSessions` 後に `handleCloseSession` or stay
- autosave タイマー: `saveSessions` のみ

---

### D-06: 起動時 cleanup

アプリ起動時に `startup_cleanup` コマンドを呼ぶ。

処理順序:
1. `sessions.is_open = 0`（全件）
2. `memos.is_open = 0`（全件）
3. `content = ''` のメモを論理削除（`trashed_at` 設定）
4. 全メモが削除済みのセッションを論理削除

実装場所: `lib.rs` の `startup_cleanup` コマンド（Rust 側で実行）

---

### S-04: 起動時ロード

`startup_cleanup` 完了後、`load_sessions` を呼んで DB からセッションを読み込み、React `sessions` state を初期化する。

```ts
useEffect(() => {
  (async () => {
    await invoke('startup_cleanup')
    const data = await invoke<SessionRow[]>('load_sessions')
    setSessions(buildSessionsFromRows(data))
  })()
}, [])
```

Phase 4 では「過去に保存されていたが is_open でないセッション」は対象外（管理画面から再表示するのは Phase 5）。

---

### D-08: 削除のゴミ箱移動永続化

現状の問題:
- Phase 3 のセッション削除確認は `handleCloseSession`（is_open=false）に流れており、「閉じる」と「削除」が同じ処理になっている
- `操作一覧表.md` §2.5 / `要件定義.md` §3 は削除 = `trashed_at` 設定（ゴミ箱移動）と定義している
- Phase 4 で DB が繋がる時点でこの混線を解消しなければ Phase 5 の管理画面が破綻する

対応:
- App.tsx の `handleDeleteConfirmed()` を修正し、削除と閉じるを分離する

```ts
// 現状（Phase 3）
const handleDeleteConfirmed = () => {
  if (deleteConfirm?.type === 'session') {
    handleCloseSession(deleteConfirm.sessionId)  // ← 閉じるを流用（誤り）
  } else {
    setSessions(... isVisible: false ...)
  }
  setDeleteConfirm(null)
}

// Phase 4 修正後
const handleDeleteConfirmed = async () => {
  if (!deleteConfirm) return
  if (deleteConfirm.type === 'session') {
    await invoke('trash_session', { sessionId: deleteConfirm.sessionId })
    setSessions(prev => prev.filter(s => s.id !== deleteConfirm.sessionId))
  } else {
    await invoke('trash_memo', { memoId: deleteConfirm.memoId })
    setSessions(prev => prev.map(s =>
      s.id !== deleteConfirm.sessionId ? s :
      { ...s, memos: s.memos.filter(m => m.id !== deleteConfirm.memoId) }
    ))
  }
  setSelection({ type: 'none' })
  setDeleteConfirm(null)
}
```

- セッション削除: DB で `trash_session` → state から除去（`handleCloseSession` は呼ばない）
- メモ削除: DB で `trash_memo` → state からメモを除去
- `is_open = 0` と `trashed_at` の両方が設定される（Rust 側で `trash_*` コマンドが両方を更新）

`trash_session` SQL:
```sql
UPDATE sessions SET is_open = 0, trashed_at = datetime('now') WHERE id = ?;
UPDATE memos SET is_open = 0, trashed_at = datetime('now') WHERE session_id = ?;
```

`trash_memo` SQL:
```sql
UPDATE memos SET is_open = 0, trashed_at = datetime('now') WHERE id = ?;
```

---

### D-09: キーハンドラの保存ロジック分離

現状の問題:
- `Cmd + S`（`isSaveShortcut`）と `Cmd + Enter`（`isCommitShortcut`）の処理がキーダウンハンドラ内に inline で書かれており、独立した関数がない
- Phase 4-2 で保存処理を `async` 化（`await invoke(...)`）するためには、キーハンドラの該当部分を非同期関数として切り出す必要がある
- 切り出しなしで `async/await` を inline に追加すると、keydown ハンドラ全体が肥大化し副作用が追いにくくなる

対応:
- 以下の async 関数を App コンポーネント内に切り出す

```ts
async function handleSaveAndClose(sessionId: string, memoId?: string) {
  // memoId あり → 対象メモを保存 + isVisible: false
  // memoId なし → セッション内全 isDirty メモを保存 + handleCloseSession
  await saveSessions(sessionsRef.current)
  if (memoId) {
    setSessions(prev => prev.map(...isVisible: false...))
  } else {
    await invoke('close_session', { sessionId })
    setSessions(prev => prev.filter(s => s.id !== sessionId))
  }
  setSelection({ type: 'none' })
}

async function handleSaveAndStay(sessionId: string, memoId?: string) {
  // memoId あり → 対象メモを保存（表示継続）
  // memoId なし → セッション内全 isDirty メモを保存（セッション継続）
  await saveSessions(sessionsRef.current)
  setSelection({ type: 'none' })
}
```

- キーハンドラの `isSaveShortcut` / `isCommitShortcut` 分岐は `handleSaveAndClose()` / `handleSaveAndStay()` 呼び出しに置き換える
- `editing` / `memo` / `session` の3ブランチ全てを更新する

---

### D-07: autosave

5 分ごとに `saveSessions` を呼ぶ。`isOpen` なセッションが 1 つ以上あり、いずれかのメモが `isDirty` の場合のみ実行する。

```ts
useEffect(() => {
  const id = setInterval(async () => {
    const hasDirty = sessionsRef.current.some(
      s => s.isOpen && s.memos.some(m => m.isVisible && m.isDirty)
    )
    if (!hasDirty) return
    await saveSessions(sessionsRef.current)
  }, 5 * 60 * 1000)
  return () => clearInterval(id)
}, [])
```

`sessionsRef` は Phase 3 で導入済みなのでそのまま流用する。

---

## 6. サブフェーズ

### Phase 4-1: Rust 側（SQLite 接続 + コマンド群 + startup cleanup）

対応Issue: D-01, D-02, D-03, D-06

触るファイル:
- `app/src-tauri/Cargo.toml`
- `app/src-tauri/tauri.conf.json`
- `app/src-tauri/src/lib.rs`

実装ステップ:
1. `Cargo.toml` に `rusqlite` / `serde` / `serde_json` / `chrono` を追加する（`tauri-plugin-sql` は追加しない）
2. `tauri.conf.json` は変更しない
3. `setup` 内で `rusqlite::Connection::open(db_path)` を呼び、`CREATE TABLE IF NOT EXISTS` を実行する。DB パスは `app.path().app_data_dir()?` を使う
4. `startup_cleanup` コマンドを実装する（is_open リセット → 空メモ/セッション 論理削除）
5. `load_sessions` / `upsert_session` / `upsert_memo` / `close_session` コマンドを実装する
6. `trash_session` / `trash_memo` コマンドを実装する（D-08）
7. upsert SQL は `ON CONFLICT DO UPDATE` を使い、`created_at` / `trashed_at` を保全する
8. `cargo check` でコンパイルエラーなしを確認する

Gate 条件:
- `cargo check` が通る
- アプリ起動時に `sticky.db` が生成され、3 テーブルが存在する
- `startup_cleanup` が全 is_open を 0 にリセットし、空エンティティを論理削除する
- `upsert_session` / `upsert_memo` を呼ぶと DB に行が挿入され、再呼び出しで `created_at` が変わらない
- `trash_session` を呼ぶと sessions + 配下 memos の `is_open=0` / `trashed_at` が設定される

---

### Phase 4-2: 保存経路の統合（明示保存 + 起動時ロード）

対応Issue: D-04, D-05, S-04

前提: Phase 4-1 完了後

触るファイル:
- `app/src/App.tsx`

実装ステップ:
1. `SessionPayload` / `MemoPayload` 型を定義する（timestamp なし業務データ型）
2. `generateTitle(content)` ヘルパーを追加する
3. `saveSessions(sessions)` 関数を実装する（upsert_session / upsert_memo を呼ぶ）
4. キーハンドラから `handleSaveAndClose()` / `handleSaveAndStay()` を切り出す（D-09）
   - `editing` / `memo` / `session` の3ブランチ全てで差し替える
   - これらを async 関数にし、内部で `saveSessions` を呼ぶ
5. `handleCloseSession` で `saveSessions` 後に `close_session` を呼ぶ
6. `handleDeleteConfirmed()` を修正し、削除を `trash_session` / `trash_memo` 経由にする（D-08）
7. 起動時 `useEffect` で `startup_cleanup → load_sessions → setSessions` を実行する
8. `buildSessionsFromRows()` 変換関数を実装する（DB行 → Session 型）

Gate 条件:
- `Cmd + S` で DB に保存される（SQLite を直接確認、`created_at` が初回から変わらない）
- セッションを閉じると DB の `is_open = 0` になる
- 削除確認から削除すると DB の `trashed_at` が設定され、state からも消える
- 削除と閉じるが DB 上で区別される（`trashed_at IS NULL` が閉じた状態、`NOT NULL` が削除）
- アプリを再起動するとデスクトップが空になる（is_open=1 が 0 件のため）
- 再起動前に保存した content が DB に残っている（`sqlite3 sticky.db` で確認）
- `title` が `content` 先頭 10 文字で保存されている
- Phase 3 の全キーボード操作・選択動作を壊していない

---

### Phase 4-3: autosave

対応Issue: D-07

前提: Phase 4-2 完了後

触るファイル:
- `app/src/App.tsx`

実装ステップ:
1. `setInterval` ベースの autosave を `useEffect([], [])` に追加する
2. `sessionsRef.current` を参照し、isOpen + isDirty 条件を確認する
3. 条件を満たす場合に `saveSessions` を呼ぶ
4. クリーンアップ（`clearInterval`）を返す

Gate 条件:
- 5 分経過後（テスト用に短縮可）に DB が更新される
- isDirty でないセッションのみの場合は保存が走らない
- autosave が Cmd+S の保存経路と同じ `saveSessions` を呼んでいる（コードレベルで確認）

---

## 7. Gate 条件（Phase 4 全体）

1. アプリ起動時に `sticky.db` が生成され、3 テーブルが存在する
2. `startup_cleanup` が起動時に実行され、is_open が全件 0 になる
3. `Cmd + S` でメモ内容が DB に保存される
4. セッションを閉じると `is_open = 0` が DB に反映される
5. 削除確認から削除すると `trashed_at` が設定される（is_open=0 だけの「閉じる」と区別される）
6. autosave が 5 分ごとに動き、明示保存と同じ `saveSessions` 経路を通る
7. `title` が `content` 先頭 10 文字で保存される
8. `upsert` を繰り返しても `created_at` が変わらない
9. `cargo check` + TypeScript 型エラーなし
10. Phase 3 の全操作（選択・編集・ドラッグ・リサイズ・削除確認）を壊していない

---

## 8. 回帰 / 副作用チェック

### Rust / Tauri
- `setup` が肥大化しないよう、DB 初期化処理は関数に切り出す
- Tauri コマンドの Mutex 競合に注意（DB コネクションを `Mutex<Connection>` で管理）
- `startup_cleanup` の論理削除が is_open セッションを誤って削除しないか確認する

### 保存経路
- `saveSessions` が session のみ更新し、memo を飛ばしていないか確認する
- `close_session` を呼ぶ前に `upsert_memo` が完了しているか（await の抜け漏れ）
- autosave と Cmd+S が同時に走った場合に競合しないか

### 状態管理
- `load_sessions` 後に `setSessions` が呼ばれるまでの間に別の event が sessions を変更しないか
- `startup_cleanup` 後に DB が空の場合に sessions が `[]` になることを確認する

### UI / UX
- 保存中の UI フリーズがないか（非同期 `invoke` が適切に await されているか）
- autosave 中に Cmd+S を押した場合に二重保存が発生しても整合性が壊れないか

---

## 9. DRY / KISS 評価

- `saveSessions` を1関数に集約することで、明示保存と autosave の重複ロジックを排除 → DRY
- `generateTitle` は pure function として分離 → テスト容易
- DB コネクションは `Mutex<Connection>` 1 つで管理し、スレッド間で共有 → KISS
- Phase 4 では管理画面を作らず、保存成立のみに集中する → スコープ KISS

---

## 10. MECE 検査

### 検査A: Issue → Phase 対応

| Issue | Phase |
|---|---|
| D-01: スキーマ追記（位置・サイズ）| 4-1（Rust スキーマ定義に含む） |
| D-02: SQLite 接続 | 4-1 |
| D-03: Tauri コマンド群（upsert/close/trash/cleanup/load）| 4-1 |
| D-04: title 再生成 | 4-2 |
| D-05: 保存経路一本化 | 4-2 |
| D-06: startup cleanup | 4-1（Rust）+ 4-2（呼び出し側） |
| D-07: autosave | 4-3 |
| D-08: 削除ゴミ箱移動永続化 | 4-1（trash コマンド）+ 4-2（handleDeleteConfirmed 修正） |
| D-09: キーハンドラ保存ロジック分離 | 4-2（handleSaveAndClose / handleSaveAndStay 切り出し） |
| S-04: 起動時ロード | 4-2 |

全 Issue に Phase が対応 → OK

### 検査B: SSOT 整合

- `画面一覧_状態遷移_DBスキーマ案.md` §4 のスキーマが Phase 4-1 で更新される（D-01）
- `操作一覧表.md` §2.5「削除確定してゴミ箱へ移動」→ D-08 の `trash_*` コマンドで対応
- `操作一覧表.md` §3「5分ごとの内部保存」→ D-07 で対応
- `操作一覧表.md` §3「アプリ起動時 is_open リセット + cleanup」→ D-06 で対応
- `AI-Planning-Guidelines-Sticky.md` §10「保存は更新保存」→ ON CONFLICT DO UPDATE で対応
- `is_open` の定義を本計画書 §3 で固定（現在表示中フラグ、デスクトップ自動復元ではない）
- auto close（`操作一覧表.md` §3）は Phase 4 では実装せず Phase 6 へ明示的に持ち越す

### 検査C: DRY / KISS

- 保存関数を autosave・Cmd+S・Close で共有 → 重複なし
- DB コネクション管理は 1 か所（lib.rs の State） → 二重管理なし
- 管理画面 UI を Phase 4 に入れない → スコープを最小化

---

## 11. セルフチェック結果

### SSOT整合
- [x] 要件定義を確認した
- [x] 状態遷移文書を確認した
- [x] 操作一覧を確認した
- [x] DB設計（スキーマ追記含む）と矛盾しない
- [x] 事前検討まとめと矛盾しない

### 変更範囲
- [x] 各サブフェーズの主目的は1つ
- [x] サブフェーズごとに触るファイル数は3以下
- [x] 新規ファイルなし（Cargo.toml/tauri.conf.json は設定ファイル）

### 状態・保存
- [x] 保存経路は `saveSessions` に一本化されている
- [x] autosave でも title 更新が漏れない（saveSessions 内で生成）
- [x] cleanup ルールを壊していない（startup_cleanup で対応）
- [x] is_open の扱いに矛盾がない（起動時リセット → load_sessions で is_open=1 のみ取得）

### UI / UX
- [x] クリックモデルに変更なし（Phase 3 から継続）
- [x] drag threshold を壊さない
- [x] 暫定UIやデバッグ要素を残さない

### Tauri / 疎通
- [x] tauri-plugin-sql の接続が高リスクのため Phase 4-1 で単独確認する
- [x] cargo check / 実機確認を Phase 4-1 Gate に含めた

### 判定
Phase 4-1 から着手可能。着手前に `画面一覧_状態遷移_DBスキーマ案.md` のスキーマを D-01 の内容に更新すること。

---

## 12. 変更履歴
- 2026-04-08: 骨組み計画として初版作成
- 2026-04-09: Phase 3 完了を受けて詳細計画へ全面改訂。D-01〜D-07, S-04 を追加。サブフェーズ 4-1〜4-3 を設計。位置/サイズカラムをスキーマに追加。auto close を Phase 6 へ明示移動。
- 2026-04-09: レビュー指摘を受けて3点を修正。(1) is_open フラグの定義を §3 で固定（現在表示中フラグ、デスクトップ自動復元ではない）し、「再起動耐性」= データ消失なしと再定義。(2) 削除と閉じるの混線を解消するため D-08 を追加し、trash_session / trash_memo コマンドと handleDeleteConfirmed 修正を明記。(3) timestamp 責務を Rust 側に集約し、INSERT OR REPLACE → ON CONFLICT DO UPDATE に変更、フロントエンドの payload 型も定義。
- 2026-04-09: レビュー指摘を受けてさらに2点を修正。(1) DB アクセス方式を rusqlite 直持ちに一本化（tauri-plugin-sql を除去）し、D-02 に選定理由を明記。(2) 現行コードに handleSave() が存在しない問題を D-09 として追加し、handleSaveAndClose / handleSaveAndStay の切り出しを Phase 4-2 実装ステップに組み込んだ。
