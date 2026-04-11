# Phase R0 確認チェックリスト

## 1. 対象
- 対象ブランチ: `refactor_app_architecture_phase_1`
- 対象フェーズ: `Phase R0: 安全柵の確立`

---

## 2. このフェーズの変更点

- `render` 中の ref 更新を廃止
- stale closure 回避を `useEffectEvent` ベースへ整理
- `App.tsx` の keydown / autosave / Tauri event 購読の安全性を改善
- `main` 保護前提の運用を計画書へ追記

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

### 4-1. 起動直後

- アプリが起動する
- 画面が表示される
- コンソールエラーが増えていない

### 4-2. セッション生成

- `Cmd + Option + Enter` で 1-note session を開ける
- `Cmd + Option + N` で session picker を開ける
- picker で `1` から `9` を押してセッションを生成できる
- `Esc` で picker を閉じられる

### 4-3. 選択と編集

- メモをクリックすると選択される
- ダブルクリックまたは `Enter` で編集に入れる
- 編集中に `Esc` で編集を抜けられる

### 4-4. 保存操作

- 選択中メモで `Cmd + S` が動作する
- 選択中メモで `Cmd + Enter` が動作する
- セッション選択中でも同系統の保存操作が壊れていない

### 4-5. 文脈操作

- 右クリックで context menu が開く
- `このセッションを選択` が動作する
- `Esc` で menu が閉じる

### 4-6. 削除操作

- `Delete` / `Backspace` で削除確認が開く
- `Esc` で削除確認を閉じられる
- `Enter` で削除確定できる

---

## 5. このフェーズで見るべき変数・状態

### React / Frontend

- `sessions`
- `selection`
- `deleteConfirm`
- `isComposing`
- `isSessionPickerVisible`
- `clickThrough`
- `interactionRef.current`
- `dragExceededRef.current`

確認観点:

- state 本体と ref の参照先がズレていないか
- keydown 中に古い state を読んでいないか
- autosave が空打ちし続けないか

### Environment

- `import.meta.env.DEV`

確認観点:

- DEV 専用 UI と event listener が本番条件に漏れていないか

---

## 6. このフェーズの完了条件

- 自動確認 3 件が成功
- 上記の主要手動操作で明確な回帰がない
- `main` には未反映で、作業はブランチ上に閉じている

---

## 7. 次フェーズへの引き継ぎ

次は `Phase R1` として、`App.tsx` から以下を切り出す。

- `types`
- `constants`
- 純粋 helper
- Tauri I/O

`App.tsx` は「画面合成とイベント接続」に寄せていく。

---

## 8. 変更履歴

- 2026-04-09: 初版作成
