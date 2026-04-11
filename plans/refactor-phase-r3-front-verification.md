# Phase R3-front 確認チェックリスト

## 1. 対象
- 対象ブランチ: `refactor_app_architecture_phase_1`
- 対象フェーズ: `Phase R3-front: Tauri / DB I/O の service 分離`

---

## 2. このフェーズの変更点

- `App.tsx` から直接の `invoke(...)` 呼び出しを外した
- `app/src/services/stickyDb.ts` を追加した
- save / load / close / trash / startup cleanup の I/O を service 経由に統一した

---

## 3. 自動確認

実施コマンド:

```bash
cd app
npm run lint
npm run build
cd ..
cargo check --manifest-path app/src-tauri/Cargo.toml
```

期待結果:

- `npm run lint` が成功する
- `npm run build` が成功する
- `cargo check` が成功する

---

## 4. 手動確認

### 4-1. 起動時読込

- アプリ起動で例外が出ない
- 既存のセッション/メモが表示される

### 4-2. 保存導線

- `Cmd + S` 後に内容が保持される
- `Cmd + Enter` 後に内容が保持される
- 再起動後にも内容が残る

### 4-3. close / delete

- セッション close 後に再起動しても意図通り残る
- メモ削除後に再起動しても消えたまま
- セッション削除後に再起動しても消えたまま

---

## 5. DB 疎通確認

### 5-1. ログ確認

DEV 実行時に以下のログが出ることを確認する。

- `[DB] startup_cleanup done`
- `[DB] load_sessions:`
- `[DB] saveSessions:`
- `[DB] upsert_memo:`
- `[DB] trash_memo:`
- `[DB] trash_session:`

### 5-2. 再起動確認

最低限、以下を確認する。

1. 新規メモを作る
2. 内容を書く
3. 保存する
4. アプリを終了する
5. 再起動する
6. 内容が残っていることを確認する

### 5-3. 削除確認

1. 保存済みメモを削除する
2. アプリを再起動する
3. 削除対象が戻ってこないことを確認する

---

## 6. このフェーズで見るべき service 関数

- `startupCleanup`
- `loadSessionsFromDb`
- `saveSessionsToDb`
- `closeSessionInDb`
- `trashSessionInDb`
- `trashMemoInDb`

確認観点:

- `App.tsx` に `invoke(...)` が再侵入していないか
- logging と command 呼び出しが service 層に集まっているか
- frontend の UI state と DB I/O が分離されているか

---

## 7. このフェーズの完了条件

- 自動確認 3 件が成功
- `App.tsx` から直接の DB command 呼び出しが消えている
- 起動・保存・削除の DB 疎通確認手順が文書化されている

---

## 8. 次フェーズへの引き継ぎ

次は backend 側の `lib.rs` 分割に進む。

候補:

- `db.rs`
- `commands.rs`
- `window.rs`
- `shortcuts.rs`

---

## 9. 変更履歴

- 2026-04-09: 初版作成
