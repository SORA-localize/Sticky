# Click-Through Phase C1b 計画書: 明示トグルと復帰導線

## 1. SSOT 参照宣言

本計画は以下を参照し、矛盾しない範囲で進める。

- `AI-Planning-Guidelines-Sticky.md`
- `要件定義.md`
- `画面一覧_状態遷移_DBスキーマ案.md`
- `操作一覧表.md`
- `plans/clickthrough-redesign-plan.md`

補足:

- sticky 本体は `透明前面レイヤー + click-through` を本命とする
- 管理画面は通常 macOS window のまま扱う
- 今回は `C1b` のみを対象にし、自動遷移までは入れない

---

## 2. 今回触る関連ファイル

| ファイル | 用途 |
|---|---|
| `app/src/App.tsx` | 明示トグル UI と mode 表示 |
| `app/src-tauri/src/lib.rs` | 明示復帰経路の整理 |
| `plans/clickthrough-phase-c1b-plan.md` | 本計画書 |

---

## 3. 問題一覧

### U-22: `overlay / through` の明示切替が本番導線として未整理

現状:

- runtime badge で切替はできる
- ただし dev 的な見え方が強く、本番導線としては弱い

影響:

- ユーザーが「今 sticky が入力を受けるのか」を把握しづらい

### T-22: interactive への復帰導線が一部ショートカットに寄っている

現状:

- セッション追加や picker 表示時には interactive に戻せる
- ただし明示復帰の考え方が整理されていない

影響:

- 復帰操作が偶然の知識に依存しやすい

### K-22: `C1a` と `C2` の間にある小目的が親計画だけだと見えにくい

必要:

- `C1b` を独立して固定し、実装と確認を小さく閉じる

---

## 4. 修正フェーズ

### Phase C1b-1: 明示トグルの UI/導線整理

目的:

- `overlay / through` をワンボタンで意図的に切り替えられる状態にする

作業:

1. 現在のトグル表示を本番寄りの文言に整理する
2. 現在モードが分かる表示を残す
3. 明示切替の操作箇所を 1 つに絞る

Gate:

- ワンボタンで mode を切り替えられる
- 現在モードが画面上で分かる

### Phase C1b-2: interactive 復帰導線の明文化

目的:

- 「どう戻るか」を UI とショートカットの両面で曖昧にしない

作業:

1. 明示トグルで interactive に戻れることを保証する
2. セッション追加 / picker 表示での自動復帰を補助導線として位置付ける
3. 復帰条件を親計画と矛盾しない形にそろえる

Gate:

- 明示操作だけで interactive に戻れる
- 補助導線との役割分担が説明できる

---

## 5. Gate 条件

- `overlay / through` をワンボタンで切り替えられる
- 現在モードをユーザーが認識できる
- interactive への復帰がセッション追加ショートカットに依存しない
- `C2` の自動遷移を入れなくても成立する最小 UX になっている

---

## 6. 回帰 / 副作用チェック

自動確認:

- `cd app && npm run lint`
- `cd app && npm run build`
- `cargo check --manifest-path app/src-tauri/Cargo.toml`

手動確認:

1. ワンボタンで `overlay / through` を往復できる
2. `through` 中に背景アプリ本体を直接クリックできる
3. 明示トグルで `overlay` に戻せる
4. `Cmd + Option + Enter` と picker 表示でも overlay に戻れる

---

## 7. 変更履歴

- 2026-04-09: `C1b` を親計画から切り出し、明示トグルと復帰導線に絞った簡易計画を追加

---

## 8. MECE 検査結果

### 検査A: Issue → Phase 対応

- `U-22` → `Phase C1b-1`
- `T-22` → `Phase C1b-2`
- `K-22` → `Phase C1b-1`, `Phase C1b-2`
- すべての Phase は少なくとも 1 つの Issue に対応している

### 検査B: SSOT 整合

- `画面一覧_状態遷移_DBスキーマ案.md` の既存 state を増やさず、明示トグル導線だけを整理する
- `操作一覧表.md` の既存操作を破壊せず、復帰導線を補助的に明文化する
- click-through 本命方針は親計画 `plans/clickthrough-redesign-plan.md` と整合している

### 検査C: DRY / KISS

- mode 切替ロジックは既存の `overlayInputMode` 経路を再利用する
- 復帰経路を新規 state で増やさず、既存 command と UI トグルに寄せる
- `C2` の自動遷移はまだ入れず、今回は明示トグルだけに範囲を限定する
