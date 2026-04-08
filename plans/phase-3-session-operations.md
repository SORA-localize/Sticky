# Phase 3 計画書: セッション操作の成立

## 1. 対象フェーズ
- マスタープラン対応: `Phase 3: セッション操作の成立`
- 主目的: 複数メモ / 複数セッションを前提とした sticky 独自の操作モデルを成立させる

---

## 2. SSOT 参照宣言
本計画書は以下の文書を参照し、これらと矛盾しない範囲で進める。

- `AI-Planning-Guidelines-Sticky.md`
- `マスタープラン.md`
- `要件定義.md`
- `事前検討まとめ.md`
- `画面一覧_状態遷移_DBスキーマ案.md`
- `操作一覧表.md`
- `画面ワイヤー仕様.md`
- `デザインシステム初版.md`
- `疎通確認結果.md`

本フェーズでは、保存基盤や autosave を広げず、`セッション生成 / セッション選択 / セッション単位操作` をメモリ上で成立させる。

---

## 3. 今回触る関連ファイル

本フェーズ全体で触る候補は以下。ただし実装時は `1サブフェーズ = 最大3ファイル` を守る。

| ファイル | 用途 |
|---|---|
| `app/src/App.tsx` | 選択モデル・state・操作ハンドラ・JSX |
| `app/src/App.css` | 新規スタイル |
| `app/src-tauri/src/lib.rs` | メニューバー導線のみ (Phase 3-5) |
| `app/src-tauri/tauri.conf.json` | 必要時のみ (Phase 3-5) |

触らないもの:
- SQLite / DBアクセス層
- 管理画面本体UI
- autosave / cleanup 実装

---

## 4. 問題一覧（Issue List）

### 完了済み Issues（Phase 3-1, 3-2）

| ID | 概要 | 対応フェーズ | 状態 |
|---|---|---|---|
| S-01 | 単一メモ state を Session[] 構造へ持ち上げ | 3-1 | ✅ 完了 |
| U-01 | `Cmd + Option + Enter` で1枚セッション新規生成 | 3-1 | ✅ 完了 |
| U-02 | `Cmd + Option + N` → 枚数選択UI → 複数枚生成 | 3-1 | ✅ 完了 |
| U-03 | color_slot の最小番号割り当て | 3-1 | ✅ 完了 |
| U-07 | 上限 5セッション / 15メモ の到達警告 | 3-1 | ✅ 完了 |
| U-08 | 15スロット前詰め配置 / 80px重なりレイアウト | 3-1 | ✅ 完了 |
| S-02 | session_selected と memo_selected の分離 | 3-2 | ✅ 完了 |
| U-04 | 右クリックメニュー（セッション文脈） | 3-2 | ✅ 完了 |

### 未完了 Issues（Phase 3-3〜3-5 対象）

#### A-01: 選択状態の分散管理 → グローバル Selection 型への移行

現状:
- `Session.selectionState: 'idle' | 'session_selected'`
- `Memo.uiState: 'idle' | 'memo_selected' | 'editing'`
- の2箇所に選択状態が分散しており、コマンド発行時の「何が選ばれているか」の判定が煩雑になる

目標:
```ts
type Selection =
  | { type: 'none' }
  | { type: 'memo';    sessionId: string; memoId: string }
  | { type: 'editing'; sessionId: string; memoId: string }
  | { type: 'session'; sessionId: string }
```
- 単一の `selection` state としてトップレベルに持つ
- `Session.selectionState` / `Memo.uiState` は削除し、`selection` から導出する
- コマンドハンドラ（Cmd+S 等）は `selection` の type を switch するだけで対象が確定する

#### U-09: Pin 機能の実装と `p` キーバインドの修正

現状バグ:
- `p` キーが誤って `session_selected` への遷移にバインドされている（要修正）

実装内容:
- `Memo` に `isPinned: boolean` フィールドを追加
- `memo_selected` または `editing` 状態のメモに対して `p` キーで `isPinned` をトグル
- 右クリックメニューに `このメモを固定 / 固定を解除` を追加（セッション文脈メニューとは別に、選択メモに対する項目として扱う）
- 固定メモは将来の auto close 対象外にする（Phase 4 で保証）

視覚表現:
- 固定中は画鋲アイコンまたは `📌` 相当の小バッジを右上に表示（シンプルな実装でよい）

#### S-03: セッション単位の一括操作

対象操作:
- `session_selected` 状態でのドラッグ: セッション内全メモを一括移動
- `Cmd + S`: 選択セッション内の `isDirty` メモを更新保存（Phase 3 ではメモリ上）
- `Cmd + Enter`: 選択セッションを保存して閉じる（`handleCloseSession` 呼び出し）
- `このセッションを閉じる`: 右クリックメニューから（既存 `handleCloseSession` で実装済みだが Gate 確認要）

補足:
- A-01 の移行完了後に実装する（グローバル Selection が確定していないと switch が書けない）
- 一括ドラッグのアンカー: ドラッグ開始時のポインタ位置と各メモの相対オフセットを記録

#### D-01: 削除確認モーダル

対象:
- `セッション削除確認`: 右クリック `このセッションを削除...` または `Delete` キー（session 選択中）
- `メモ削除確認`: `Delete` キー（memo 選択中）

実装内容:
- トップレベル state: `deleteConfirm: { type: 'session'; sessionId: string } | { type: 'memo'; sessionId: string; memoId: string } | null`
- モーダル JSX: 画面中央固定、2ボタン（削除 / キャンセル）
- 削除実行: セッション → `isOpen: false` + 全メモ `isVisible: false`（Phase 4 でゴミ箱へ）
- Esc / キャンセルボタンでモーダルを閉じる

#### U-06: 最小メニューバー導線

対象項目（仕様書 §9.1）:
- `New 1-Note Session`
- `Open Home`（スタブ: ログ or alert）
- `Open Trash`（スタブ）
- `Open Settings`（スタブ）
- セパレーター
- `Quit sticky`

実装:
- Tauri の `tauri::menu` API でメニューバーを構築
- `New 1-Note Session` → `session://open-single` イベント送出（既存と同じ）
- `Quit sticky` → `AppHandle::exit(0)` または `process::exit`

#### K-01: `p` キーバインド正規化（U-09 に統合）
誤バインドの除去と正しい pin トグル実装。U-09 で対処。

#### K-02: auto close の帰属（Phase 4 へ持ち越し）
`last_active_at` と保存基盤に依存するため、Phase 3 では実装しない。
Phase 3 では `isPinned` を持つことで将来の対象外フラグを準備するにとどめる。

---

## 5. サブフェーズ

### Phase 3-1: セッション state への持ち上げ ✅ 完了
対応Issue: S-01, U-01, U-02, U-03, U-07, U-08

### Phase 3-2: セッション選択と右クリックメニュー ✅ 完了
対応Issue: S-02, U-04

詳細は `plans/phase-3-1c-slot-and-warning.md` / `plans/phase-3-2-session-selection.md` を参照。

---

### Phase 3-3: グローバル Selection 移行 + Pin 機能
対応Issue: A-01, U-09

主目的: 選択状態の一本化と `p` キーの正規化

触るファイル:
- `app/src/App.tsx`（Selection 型定義・state・全ハンドラ更新、isPinned 追加）
- `app/src/App.css`（Pin バッジスタイル）

実装ステップ:
1. `Selection` 型を定義し `const [selection, setSelection] = useState<Selection>({ type: 'none' })` を追加
2. `Session.selectionState` を削除、`Memo.uiState` を削除
3. 各ハンドラを `selection` ベースに書き直す（`handleMemoClick`, `handleMemoDoubleClick`, `handleSelectSession`, `clearSelections` 等）
4. JSX のクラス判定を `selection` から導出するヘルパー関数に集約
5. `p` キーのバインドを session_selected → isPinned トグルへ修正
6. `Memo` に `isPinned: boolean` を追加、右クリックメニューに pin 項目追加
7. Pin バッジの視覚表現を追加

Gate 条件:
- `selection.type` が `none / memo / editing / session` の4種類のみ存在する
- `p` キーが `memo` または `editing` 状態のとき `isPinned` をトグルする
- `p` キーが `session` / `none` 状態では何も起きない
- 固定中メモに視覚バッジが表示される
- Phase 3-2 の右クリックメニュー動作を壊していない
- Phase 3-1 の全 Gate を壊していない

---

### Phase 3-4: セッション一括操作 + 削除確認モーダル
対応Issue: S-03, D-01

前提: Phase 3-3 完了後（グローバル Selection が確定していること）

主目的: セッション選択状態からの一括操作と削除フローの最小成立

触るファイル:
- `app/src/App.tsx`
- `app/src/App.css`

実装ステップ（S-03）:
1. `selection.type === 'session'` 中のポインターダウンでアンカーを記録
2. ポインタームーブで全メモの position を delta 分だけ更新
3. `Cmd + S` ハンドラを `selection.type` で switch（session → 全 isDirty メモを保存、memo → 対象メモのみ）
4. `Cmd + Enter` ハンドラを同様に switch（session → handleCloseSession 呼び出し）

実装ステップ（D-01）:
1. `deleteConfirm` state を追加
2. `Delete` キーハンドラで `selection.type` に応じてモーダルを開く
3. 右クリック `このセッションを削除...` で `deleteConfirm` をセット
4. モーダル JSX を追加（position: fixed, 画面中央）
5. 削除確定: セッション → `isOpen: false` + メモ全体 `isVisible: false`

Gate 条件:
- `session_selected` 状態でドラッグするとセッション内全メモがまとめて動く
- `Cmd + S` がセッション選択中はセッション内全 isDirty メモを対象にする
- `Cmd + S` がメモ選択中は対象メモのみを対象にする
- `Cmd + Enter` がセッション選択中はセッションを閉じる
- `Delete` がセッション選択中は削除確認モーダルを開く
- `Delete` がメモ選択中は削除確認モーダルを開く（メモ対象）
- `このセッションを削除...` で削除確認に入れる
- Esc / キャンセルでモーダルを閉じる（選択状態は維持）
- Phase 3-3 の全 Gate を壊していない

---

### Phase 3-5: 最小メニューバー導線
対応Issue: U-06

前提: Phase 3-4 完了後

主目的: macOS メニューバーから sticky の主要導線を呼べるようにする

触るファイル:
- `app/src-tauri/src/lib.rs`
- `app/src-tauri/tauri.conf.json`（必要時のみ）

実装ステップ:
1. `tauri::menu` で `New 1-Note Session / Open Home / Open Trash / Open Settings / Quit sticky` を構成
2. `New 1-Note Session` → `session://open-single` を emit（既存イベントと同一）
3. `Open Home / Trash / Settings` → 現時点ではスタブ（ログ出力または alert）
4. `Quit sticky` → `app.exit(0)`

Gate 条件:
- macOS メニューバーに sticky メニューが表示される
- `New 1-Note Session` でメモが生成される
- `Quit sticky` でアプリが終了する
- 前面レイヤーの既存動作を壊していない

---

## 6. Gate 条件（Phase 3 全体）

1. `Cmd + Option + Enter` で1枚セッションを新規生成できる
2. `Cmd + Option + N` から枚数選択UIを開き、指定枚数のセッションを生成できる
3. 開いているセッション同士で `colorSlot` が重複しない
4. 右クリックメニューから `このセッションを選択` で `session_selected` に入れる
5. `session_selected` 中はセッション内全メモに視覚表現（青枠）がある
6. `session_selected` 中のドラッグで全メモがまとめて移動できる
7. `Cmd + S` / `Cmd + Enter` が selection type に応じて正しく作用する
8. `p` キーが選択メモの `isPinned` をトグルする
9. `Delete` で削除確認モーダルが開き、確定 / キャンセルが動く
10. `このセッションを閉じる` でセッションがデスクトップから消える
11. メニューバーから `New 1-Note Session` と `Quit sticky` が動く
12. Phase 2 の単体メモ操作（選択・編集・ドラッグ・リサイズ・保存）を壊していない

---

## 7. 回帰 / 副作用チェック

### 状態管理
- A-01 移行後、`Session.selectionState` / `Memo.uiState` の参照残骸がないか（grep で確認）
- `clearSelections` 相当の処理が `setSelection({ type: 'none' })` に一本化されているか
- `selection.type === 'editing'` から `memo` への遷移（Esc / 範囲外クリック）が正しく動くか
- セッションを閉じた後に `selection` が `none` にリセットされるか

### UI / UX
- `session_selected` 中の一括ドラッグと個別ドラッグが混在しないか
- 右クリック後に誤って編集へ入らないか（`button !== 0` ガード確認）
- 削除確認モーダル表示中に背後のメモをクリックできないようにしているか
- Pin バッジがリサイズハンドルと重ならないか

### ショートカット
- `Cmd + S` / `Cmd + Enter` が `selection.type` を正しく switch しているか
- `p` キーが composition 中に反応しないか（isComposing ガード確認）
- `Delete` キーが編集中（textarea にフォーカスあり）に反応しないか

### Tauri / 前面レイヤー
- メニューバー追加で透過前面レイヤーの挙動が変わらないか
- `Quit sticky` 後の cleanup が不完全なメモを残さないか（Phase 3 ではメモリ上のみなので影響は限定的）

---

## 8. DRY / KISS 評価

- グローバル `selection` により、「何が選ばれているか」の判定が1箇所に集約される → DRY 改善
- `Memo.uiState` / `Session.selectionState` の削除により二重管理が解消 → DRY 改善
- 一括ドラッグのアンカー記録は既存の `DragInteraction` 型を拡張するのではなく、`selection.type === 'session'` の分岐で処理する → KISS 優先
- モーダルは単一の `deleteConfirm` state で session / memo を enum で切り替え → 追加 state を最小化

---

## 9. MECE 検査

### 検査A: Issue → Phase 対応
| Issue | Phase |
|---|---|
| S-01, U-01, U-02, U-03, U-07, U-08 | 3-1 ✅ |
| S-02, U-04 | 3-2 ✅ |
| A-01, U-09 | 3-3 |
| S-03, D-01 | 3-4 |
| U-06 | 3-5 |
| K-01 | U-09 に統合 |
| K-02 | Phase 4 持ち越し（明示） |

全 Issue に Phase が対応 → OK

### 検査B: SSOT 整合
- `操作一覧表.md` §2.2: セッション選択中の Cmd+S / Cmd+Enter / Delete → S-03, D-01 で対応
- `操作一覧表.md` §2.1: `p` キーの記載なし → U-09 実装後に `操作一覧表.md` を更新する（実装フェーズの作業）
- `画面ワイヤー仕様.md` §3.6: セッション選択時の全メモ青枠 → A-01 移行後も維持
- `画面ワイヤー仕様.md` §3.8: 削除確認モーダル → D-01 で対応

### 検査C: DRY / KISS
- 選択状態の一本化（A-01）: 複雑化ではなく整理 → KISS 改善
- Pin 機能（U-09）: Memo に boolean 1フィールド追加のみ → KISS
- モーダル state（D-01）: 専用グローバル state 1つ → 適切

---

## 10. セルフチェック結果

### SSOT整合
- [x] 要件定義を確認した
- [x] 状態遷移文書を確認した
- [x] 操作一覧を確認した
- [x] DB設計と矛盾しない範囲に対象を限定した（Phase 3 はメモリ上のみ）
- [x] 事前検討まとめと矛盾しない

### 変更範囲
- [x] 各サブフェーズの主目的は1つ
- [x] サブフェーズごとに触るファイル数は3以下
- [x] 新規ファイルなし（既存ファイルの更新のみ）

### 状態・保存
- [x] DB永続化と Session 操作を同時に進めない
- [x] autosave / cleanup は対象外として切り離した
- [x] auto close は Phase 4 へ明示的に持ち越した

### UI / UX
- [x] クリックモデルは現行 SSOT に従う
- [x] `p` キーの誤バインドを Issue として明示した
- [x] 削除モーダル中の背後操作禁止を回帰チェックに含めた

### Tauri / 疎通
- [x] メニューバー追加を独立サブフェーズ（3-5）に分離した
- [x] 前面レイヤーの回帰チェックを含めた

### 判定
Phase 3-3 から着手可能。

---

## 11. 変更履歴
- 2026-04-08: 初版作成（骨組み計画）
- 2026-04-08: 詳細計画へ更新（Phase 3-1 着手前）
- 2026-04-08: Phase 3-1 / 3-2 完了を反映。A-01（グローバル Selection）・U-09（Pin / p キー修正）を追加。AI-Planning-Guidelines に準拠した構成へ全面改訂。
