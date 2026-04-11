# リファクタリング計画書: 開発原則・ブランチ運用・実行工程

## 1. 対象
- 対象プロジェクト: `Sticky`
- 対象コードベース:
  - `app/src` (React / TypeScript / Vite)
  - `app/src-tauri` (Tauri / Rust / SQLite)
- 主目的:
  - スパゲッティ化を未然に防ぐ
  - `DRY` / `KISS` を守りやすい構造へ早めに整える
  - 今後の AI 実装でも崩れにくい開発ガードレールを先に作る

---

## 2. 背景認識

現状はまだ小規模だが、以下の兆候がある。

- フロントエンドの責務が `app/src/App.tsx` に集中している
- Rust 側の責務が `app/src-tauri/src/lib.rs` に集中している
- UI state / 永続化 / ショートカット / ウィンドウ制御が横断的に結合している
- フロントとバックで定数・業務ルールが重複し始めている
- `lint` が通っておらず、変更の安全柵が弱い

この段階では「大規模リライト」ではなく、「今後増える機能を受け止められる構造化」が目的である。

---

## 3. 開発原則

### 3-1. 基本原則

- `KISS`: まず最小の責務分離を行い、抽象化は必要になった時だけ導入する
- `DRY`: 同じ業務ルール・定数・変換処理を複数箇所に持たない
- `YAGNI`: Phase で未使用の抽象化・汎用化・設定化は先に作らない
- `SSOT`: 真実の源泉を明確にし、状態や設定の二重管理を避ける
- `Small PRs`: 一度に複数の構造変更を混ぜない

### 3-2. フルスタック開発時の注意事項

- フロントで使う型と Rust command の payload/response は対応表を持つ
- フロントと DB の両方で使う業務ルールは「どちらが正か」を先に決める
- UI 都合の state と永続化データを混在させない
- command 名は「UI イベント」ではなく「業務操作」を表す
- SQLite schema の変更は、UI 側の都合だけで増やさない
- 画面操作の改善とデータモデル変更を同一 PR に混ぜない

### 3-3. 今回の構造原則

- React では「描画」「状態遷移」「Tauri I/O」を分離する
- Rust では「DB」「command」「window/app setup」を分離する
- `setSessions` の散発更新を減らし、状態遷移を集中管理する
- 共有定数は用途単位で集約し、ハードコードを増やさない
- デバッグログは残す場合でも責務境界の内側へ閉じ込める

---

## 4. Git / GitHub 運用方針

### 4-1. 基本方針

- `main` へ直接実装しない
- すべて `main` 最新から作業ブランチを切る
- 実装完了後は GitHub に push し、PR 経由で `main` に統合する
- リファクタリングは機能追加よりも PR 粒度を小さく保つ

補足:

- `main` は「触らない基準線」として残す
- 実際の作業は `refactor/...` ブランチを使う
- 作業ブランチは `main` のコピー環境として扱う
- 動作確認が取れた内容だけを `main` に統合する
- 通常は `main` とは別に「main のバックアップ用ブランチ」を増やす必要はない
- 理由は、`main` 自体がすでに未変更の基準線だからである

### 4-2. ブランチ命名規則

- 大きい計画単位: `refactor/<topic>`
- サブフェーズ単位: `refactor/<topic>-phase-<n>`
- 例:
  - `refactor/app-architecture`
  - `refactor/app-architecture-phase-1`
  - `refactor/tauri-structure-phase-1`

### 4-3. 実施手順

1. `main` へ移動する
2. `origin/main` を fetch する
3. `main` を最新 `origin/main` に合わせる
4. 新規ブランチを切る
5. そのブランチでリファクタする
6. `lint` / `build` / 必要な手動確認を行う
7. commit して push する
8. PR を作る
9. 問題なければ `main` へ統合する

### 4-4. この作業での役割分担

- Codex が実施できること:
  - ブランチ作成
  - リファクタ実装
  - `lint` / `build` / ローカル確認
  - commit 作成
  - push
  - PR 作成補助
- 前提:
  - GitHub 認証が通っていること
  - push 権限があること

### 4-5. 設計変更を試すときの分岐方針

- リファクタ途中で大きな構造変更案が出た場合、手作業でファイルコピーはしない
- 既存ブランチのその時点の commit を土台に、新しい派生ブランチを切って試す
- つまり「ファイルのコピー」ではなく「ブランチのコピー」を使う
- 仕様変更と単純リファクタを同じ commit に混ぜない

推奨例:

- `refactor_app_architecture_phase_1`
  - 既存リファクタの継続線
- `feature/window-model-redesign`
  - overlay 廃止や pin 中心 UX などの構造変更検証線

この運用の利点:

- 差分の意味が崩れない
- 試した案を安全に破棄できる
- 採用案だけを後から統合できる

---

## 5. 今回の完了定義

以下を満たしたら「初回リファクタリング成功」とみなす。

- `App.tsx` の責務が分割され、主要ロジックが別モジュールへ移動している
- `lib.rs` の責務が分割され、setup / DB / commands の境界が明確である
- `lint` が通る
- `build` が通る
- 主要操作の手動確認手順が文書化されている
- 今後の AI 実装時に従う構造ルールが文章化されている

---

## 6. 非目標

今回の計画では以下を主目的にしない。

- 新機能追加
- UI デザインの全面刷新
- SQLite schema の大幅再設計
- 状態管理ライブラリの即時導入
- テスト基盤の全面整備

必要なら後続フェーズで扱う。

---

## 7. リスク一覧

### R-01. 分割と同時に挙動が変わる
- 対策:
  - 1 PR 1 主目的を守る
  - 「構造変更」と「振る舞い変更」を分離する

### R-02. 過剰抽象化で逆に読みにくくなる
- 対策:
  - utility を乱立させない
  - 現時点で 2 回以上使うものだけ共通化候補にする

### R-03. フロントと Rust の責務境界が曖昧なまま残る
- 対策:
  - command ごとに責務を明文化する
  - UI 用 state はフロント、永続化ルールは Rust を基本線とする

### R-04. AI 実装で局所修正が積み重なり再汚染する
- 対策:
  - 事前に「どこへ書くべきか」の配置ルールを固定する
  - PR 前に「責務違反」を確認するレビュー項目を設ける

---

## 8. 目標アーキテクチャ

### 8-1. Frontend

```text
app/src/
  components/
  hooks/
  domain/
  services/
  types/
  constants/
  App.tsx
```

役割:

- `components/`: 表示部品
- `hooks/`: 画面固有の状態連携、イベント購読、autosave など
- `domain/`: Session / Memo の状態遷移ロジック
- `services/`: Tauri invoke や外部I/O
- `types/`: payload / row / domain 型
- `constants/`: 制約値・固定設定

### 8-2. Backend

```text
app/src-tauri/src/
  db.rs
  commands.rs
  window.rs
  shortcuts.rs
  lib.rs
  main.rs
```

役割:

- `db.rs`: 接続初期化、schema、SQL 操作
- `commands.rs`: Tauri command 公開面
- `window.rs`: menu / overlay / window 設定
- `shortcuts.rs`: global shortcut 登録とイベント発火
- `lib.rs`: wiring のみ

---

## 9. 実行フェーズ

### Phase R0: 安全柵の確立

目的:
- 構造変更前に最低限の品質ゲートを作る

対象:
- `lint` エラー解消
- `build` 成功維持
- 手動確認項目の最小整理

作業:
1. `react-hooks/refs` エラーを解消する
2. 依存配列の警告方針を整理する
3. 最小の確認チェックリストを `plans/` か `README` に追加する

Gate:
- `npm run lint` が通る
- `npm run build` が通る

### Phase R1: Frontend の責務分離

目的:
- `App.tsx` の集中を崩す

優先分離対象:
- 型定義
- 定数
- slot / layout 計算
- save/load の永続化経路
- Session/Memo 操作ロジック

推奨分割順:
1. `types` と `constants`
2. 純粋関数の helper 群
3. `services/tauri`
4. `domain/sessionState`
5. `hooks` への副作用移動
6. `App.tsx` を composition 中心へ縮小

Gate:
- `App.tsx` が「画面合成とイベント接続」が主責務になる
- 純粋関数は UI 依存を持たない
- Tauri invoke が UI 内に散らばらない

### Phase R2: 状態遷移の集中管理

目的:
- `setSessions` の散発更新を減らす

候補:
- `useReducer`
- もしくは domain action 関数の導入

方針:
- 新ライブラリ導入は後回し
- まず標準 React で整理する

対象 action 例:
- `createSession`
- `closeSession`
- `trashMemo`
- `togglePin`
- `moveMemo`
- `resizeMemo`
- `commitDraft`
- `saveMemo`

Gate:
- 状態変更ロジックの大半が一箇所に集まる
- UI コンポーネントから直接深いネスト更新を書かない

### Phase R3: Tauri / Rust 側の責務分離

目的:
- `lib.rs` を wiring 専用へ寄せる

分離対象:
- DB 初期化
- sessions / memos 操作 SQL
- window / menu 設定
- shortcut 登録
- overlay state

Gate:
- `lib.rs` が構成コード中心になる
- SQL が UI 初期化コードと同居しない

### Phase R4: SSOT と設定値の整理

目的:
- 定数・設定値・業務ルールの二重管理を減らす

対象候補:
- `MAX_OPEN_SESSIONS`
- `MAX_OPEN_MEMOS`
- デフォルトサイズ
- title 生成ルール
- cleanup 方針

決めること:
- フロントが持つ値
- Rust が持つ値
- DB settings が持つ値

Gate:
- 同一意味の定数が複数箇所にベタ書きされていない

### Phase R5: 開発ガードレール文書化

目的:
- 今後の AI 実装でも構造を維持する

文書化対象:
- どの責務をどのディレクトリへ置くか
- 変更時に避けるべきアンチパターン
- PR 前チェック項目
- ブランチ運用ルール

Gate:
- 新規機能追加時の配置判断が文書だけでできる

---

## 10. PR 分割方針

リファクタは以下の粒度で分ける。

- PR1: `lint` 修正と安全柵
- PR2: Frontend の型・定数・helper 分離
- PR3: Frontend 状態遷移の整理
- PR4: Rust 側の分割
- PR5: SSOT / 運用文書の整備

各 PR の原則:

- 1 PR 1 主目的
- 機能追加を混ぜない
- rename とロジック変更を必要以上に混在させない

---

## 11. レビュー観点

各 PR で以下を確認する。

- 同じ知識が複数ファイルに増えていないか
- 抽象化が先走っていないか
- 状態更新が UI に散っていないか
- Rust command が業務責務を表しているか
- フロントと DB の責務分担が崩れていないか
- 今回の変更でテスト/確認可能性が上がっているか

---

## 12. 実務フロー

この計画に従う実務フローは以下。

1. `main` を最新化
2. `refactor/...` ブランチを作成
3. Phase R0 から順に着手
4. 各フェーズごとに `lint` / `build` / 手動確認
5. commit
6. push
7. PR 作成
8. 問題なければ `main` へ統合
9. 次フェーズ用ブランチを `main` 最新から再度作成

---

## 13. 今回の初手推奨

最初に着手すべきなのは `Phase R0` である。

理由:

- 現在 `lint` が失敗しているため、以後のリファクタ品質を担保できない
- `App.tsx` の ref 同期問題を放置したまま分割すると、責務整理と不具合修正が混ざる
- 先に安全柵を作る方が、後続 PR のレビューと差分理解が圧倒的に楽になる

---

## 14. 変更履歴

- 2026-04-09: 初版作成
