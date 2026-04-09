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
4. アプリを再起動した後も保存済みセッションが open できる（管理画面経由は Phase 5）

---

## 4. 今回触る関連ファイル

| ファイル | 用途 |
|---|---|
| `app/src-tauri/Cargo.toml` | tauri-plugin-sql 追加 |
| `app/src-tauri/tauri.conf.json` | plugin 許可設定 |
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

対応:
- `tauri-plugin-sql` を `Cargo.toml` に追加する
- `setup` 内で DB ファイルを開き、`CREATE TABLE IF NOT EXISTS` を実行する
- DB ファイルパスは `app.path().app_data_dir()` + `sticky.db`

---

### D-03: Tauri コマンド群の実装

以下の Tauri コマンドを `lib.rs` に実装する。

| コマンド名 | 引数 | 動作 |
|---|---|---|
| `load_sessions` | なし | `is_open = 1` の sessions + memos を全件返す |
| `upsert_session` | Session データ | sessions を INSERT OR REPLACE する |
| `upsert_memo` | Memo データ | memos を INSERT OR REPLACE する |
| `close_session` | session_id | session の `is_open = 0` を更新、全 memo の `is_open = 0` を更新 |
| `delete_memo` | memo_id | memos の `trashed_at` を現在時刻に更新（論理削除） |
| `startup_cleanup` | なし | `is_open` 全件 0 リセット → 空メモ/空セッション 論理削除 |

返却型は serde_json::Value またはカスタム Serialize 構造体を使う。

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
    await invoke('upsert_session', { ... })
    for (const memo of session.memos.filter(m => m.isVisible)) {
      await invoke('upsert_memo', { ..., title: generateTitle(memo.content) })
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
1. `Cargo.toml` に `tauri-plugin-sql` + `serde` を追加する
2. `tauri.conf.json` の `plugins.sql` 許可設定を追加する
3. `setup` 内で DB パスを解決し、`Connection::open()` + `CREATE TABLE IF NOT EXISTS` を実行する
4. `startup_cleanup` コマンドを実装する（is_open リセット → 空メモ/セッション 論理削除）
5. `load_sessions` / `upsert_session` / `upsert_memo` / `close_session` / `delete_memo` コマンドを実装する
6. `cargo check` でコンパイルエラーなしを確認する

Gate 条件:
- `cargo check` が通る
- アプリ起動時に `sticky.db` が生成され、3 テーブルが存在する
- `startup_cleanup` が実行されても既存の is_open セッションに影響しない（初回は全件 0）
- `upsert_session` / `upsert_memo` を呼ぶと DB に行が挿入される

---

### Phase 4-2: 保存経路の統合（明示保存 + 起動時ロード）

対応Issue: D-04, D-05, S-04

前提: Phase 4-1 完了後

触るファイル:
- `app/src/App.tsx`

実装ステップ:
1. `generateTitle(content)` ヘルパーを追加する
2. `saveSessions(sessions)` 関数を実装する（upsert_session / upsert_memo を呼ぶ）
3. `handleSave()` から `saveSessions` を呼ぶよう変更する（Cmd+S 経路）
4. `handleCloseSession` でも `saveSessions` 後に `close_session` を呼ぶ
5. 起動時 `useEffect` で `startup_cleanup → load_sessions → setSessions` を実行する
6. `buildSessionsFromRows()` 変換関数を実装する（DB行 → Session 型）

Gate 条件:
- `Cmd + S` で DB に保存される（SQLite を直接確認）
- セッションを閉じると `is_open = 0` になる
- アプリを再起動すると sessions state が空で初期化される（is_open = 0 なので load 対象なし）
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

1. アプリ起動時に `sticky.db` が生成される
2. `startup_cleanup` が startup 時に実行される
3. `Cmd + S` でメモ内容が DB に保存される
4. セッションを閉じると `is_open = 0` が DB に反映される
5. autosave が 5 分ごとに動き、明示保存と同じ経路を通る
6. `title` が `content` 先頭 10 文字で保存される
7. `cargo check` + TypeScript 型エラーなし
8. Phase 3 の全操作（選択・編集・ドラッグ・リサイズ・削除確認）を壊していない

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
| D-01: スキーマ追記 | 4-1（Rust スキーマ定義に含む） |
| D-02: SQLite 接続 | 4-1 |
| D-03: Tauri コマンド群 | 4-1 |
| D-04: title 再生成 | 4-2 |
| D-05: 保存経路一本化 | 4-2 |
| D-06: startup cleanup | 4-1（Rust）+ 4-2（呼び出し側） |
| D-07: autosave | 4-3 |
| S-04: 起動時ロード | 4-2 |

全 Issue に Phase が対応 → OK

### 検査B: SSOT 整合

- `画面一覧_状態遷移_DBスキーマ案.md` §4 のスキーマが Phase 4-1 で更新される（D-01）
- `操作一覧表.md` §3「5分ごとの内部保存」→ D-07 で対応
- `操作一覧表.md` §3「アプリ起動時 is_open リセット + cleanup」→ D-06 で対応
- `AI-Planning-Guidelines-Sticky.md` §10「保存は更新保存」→ upsert で対応
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
