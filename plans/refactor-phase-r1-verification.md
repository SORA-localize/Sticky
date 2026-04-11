# Phase R1 確認チェックリスト

## 1. 対象
- 対象ブランチ: `refactor_app_architecture_phase_1`
- 対象フェーズ: `Phase R1: Frontend の責務分離`

---

## 2. このフェーズの変更点

- `App.tsx` から以下を切り出した
  - `app/src/types/sticky.ts`
  - `app/src/constants/sticky.ts`
  - `app/src/domain/sessionHelpers.ts`
- `App.tsx` は UI とイベント接続により近い構成へ寄せた

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

### 4-1. 起動と表示

- アプリが起動する
- 既存 UI が崩れていない
- セッション色と配置が従来通りに見える

### 4-2. セッション生成

- `Cmd + Option + Enter` で 1-note session を生成できる
- `Cmd + Option + N` で picker を開ける
- picker の `1` から `9` で生成できる

### 4-3. 選択と編集

- クリック選択が動く
- ダブルクリック編集が動く
- `Enter` で編集開始できる
- `Esc` で選択解除または編集終了できる

### 4-4. 移動とサイズ変更

- ドラッグ移動できる
- リサイズハンドルが動く
- session drag が壊れていない

### 4-5. 保存と削除

- `Cmd + S` が動く
- `Cmd + Enter` が動く
- `Delete` / `Backspace` で削除確認が出る

---

## 5. このフェーズで見るべき変数・責務

### constants

- `DRAG_THRESHOLD`
- `DEFAULT_WIDTH`
- `DEFAULT_HEIGHT`
- `MIN_WIDTH`
- `MIN_HEIGHT`
- `MAX_WIDTH`
- `MAX_HEIGHT`
- `MAX_OPEN_SESSIONS`
- `MAX_OPEN_MEMOS`
- `SESSION_COLOR_VARS`
- `SLOT_PERCENTAGES`

確認観点:

- UI 側に同じ値のベタ書きが再発していないか

### types

- `Selection`
- `Memo`
- `Session`
- `Interaction`
- `SessionPayload`
- `MemoPayload`
- `SessionRow`

確認観点:

- `App.tsx` に型定義が戻っていないか
- payload と row の責務が混ざっていないか

### helper

- `generateTitle`
- `buildSessionsFromRows`
- `getSlotPosition`
- `getOpenSessions`
- `getOpenMemos`
- `findUnusedColorSlot`
- `findAvailableSlotIndices`
- `getEditingEntry`
- `getSelectedEntry`

確認観点:

- helper が React state や DOM へ依存していないか
- 純粋関数のまま保たれているか

---

## 6. このフェーズの完了条件

- 自動確認 3 件が成功
- `App.tsx` から型・定数・純粋 helper が分離されている
- 主要操作で回帰がない

---

## 7. 次フェーズへの引き継ぎ

次は `Phase R2` として、`setSessions` の散発更新を減らす方向へ進む。

優先候補:

- session / memo 更新 action の集中化
- save/close/delete/pin の状態遷移整理
- reducer か domain action への集約

---

## 8. 変更履歴

- 2026-04-09: 初版作成
