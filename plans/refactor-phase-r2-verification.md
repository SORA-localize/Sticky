# Phase R2 確認チェックリスト

## 1. 対象
- 対象ブランチ: `refactor_app_architecture_phase_1`
- 対象フェーズ: `Phase R2: 状態遷移の集中管理`

---

## 2. このフェーズの変更点

- `App.tsx` に散っていた `setSessions(...)` の更新ロジックを action 関数へ集約した
- `app/src/domain/sessionActions.ts` を追加した
- 追加・削除・close・pin・move・resize・dirty 更新・editing 開始を action 経由へ寄せた

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

### 4-1. セッション追加と削除

- 単体セッション追加が動く
- picker からの追加が動く
- メモ削除が動く
- セッション削除が動く

### 4-2. close 動作

- メモ単体 close が動く
- セッション close が動く
- close 後に選択状態が破綻しない

### 4-3. pin 動作

- メモ pin トグルが動く
- セッション単位 pin スマートトグルが動く
- pin 中は削除不可のまま

### 4-4. move / resize

- 単体ドラッグが動く
- セッションドラッグが動く
- resize が動く
- slotIndex の解放が必要箇所で維持されている

### 4-5. 編集と dirty

- 編集開始が動く
- 入力中に dirty 状態が更新される
- 保存後に dirty が戻る

---

## 5. このフェーズで見るべき action

- `appendSession`
- `removeSession`
- `removeMemo`
- `closeMemo`
- `closeSessionInState`
- `updateMemoContent`
- `updateMemoDirtyState`
- `clearSessionSlotIndices`
- `clearMemoSlotIndex`
- `moveSessionMemos`
- `moveMemo`
- `resizeMemo`
- `toggleSessionPinnedState`
- `toggleMemoPinnedState`
- `incrementMemoEditingKey`

確認観点:

- 同じ更新ロジックが `App.tsx` に再複製されていないか
- action が React hook や DOM に依存していないか
- action 名が UI 操作ではなく状態遷移を表しているか

---

## 6. このフェーズの完了条件

- 自動確認 3 件が成功
- 主要な `setSessions(...)` 重複が action へ集約されている
- 主要操作に回帰がない

---

## 7. 次フェーズへの引き継ぎ

次は frontend 側の残タスクとして、以下のどちらかを選ぶ。

- `Phase R3-front`: Tauri I/O と save/load を service 層へ分離
- `Phase R3-back`: Rust 側を `db / commands / window / shortcuts` に分離

順番としては frontend の `services` 分離を先にやる方が差分を追いやすい。

---

## 8. 変更履歴

- 2026-04-09: 初版作成
