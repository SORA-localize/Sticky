# 開発状況メモ（次回開始時参照）

最終更新: 2026-04-11

---

## 現在のブランチ構成

| ブランチ | 役割 | 状態 |
|---|---|---|
| `main` | 基準線 | Phase 4 完了済み |
| `refactor_app_architecture_phase_1` | R0〜R3 リファクタ | feature_clickthrough_redesign に取り込み済み・remote push 未済 |
| `feature_window_model_redesign` | memo 1 window 比較実験 PoC | 比較結果として保管（下記参照） |
| `feature_clickthrough_redesign` | **現在の主作業ブランチ** | main 未マージ・13 commits ahead |

---

## フェーズ完了状況

| フェーズ | 内容 | 状態 |
|---|---|---|
| Phase 0 | 仕様固定 | ✅ 完了 |
| Phase 1 | 技術疎通確認 | ✅ 完了（下記 click-through 結論を含む） |
| Phase 2 | デスクトップメモ最小成立 | ✅ 完了 |
| Phase 3 | セッション操作成立 | ✅ 完了（3-1〜3-5 全サブフェーズ） |
| Phase 4 | 保存基盤と自動処理 | ✅ 完了（SQLite・autosave・cleanup） |
| **Phase 5** | **管理画面 MVP** | **❌ 未着手 ← 次のターゲット** |
| Phase 6 | UX 安定化 | ❌ 未着手 |

---

## click-through 実験の確定結果（Phase 1 疎通確認の一部）

### 何を確かめたか

「overlay として常前面に浮かせたまま、through 状態でもメモを直接クリックできるか」を検証した。

### 結論: C4 NO

- **C1a 完了**: Tauri ↔ React の overlay/through モードブリッジ成立
- **C1b 完了**: 明示トグル（Cmd+Opt+/・UI ボタン・tray アイコン）と操作後の自動 through 復帰成立
- **C2 プローブ実施**: through 状態（`set_ignore_cursor_events(true)`）でメモカードを叩いても `pointerdown` が JS に届かないことを実機で確認
- **C4 NO 確定**: `window 全体 on/off` 方式では through 中のメモ直接選択は OS レベルで原理的に不成立
- **採用方針**: 手動トグル（overlay ↔ through）+ tray アイコン状態表示 を最終形とする

### なぜ C4 NO か（技術的根拠）

macOS の `NSWindow.ignoresMouseEvents = true` は OS がウィンドウへのイベント配送そのものを止める。CSS の `pointer-events` は OS がウィンドウへ届けた後の話であるため、through 状態のまま特定要素だけ拾う方法は標準 Tauri API では存在しない。

代替技術（ObjC `hitTest` オーバーライド）は実現可能だが、メモカード座標を常時 Rust 側に同期する必要があり、コストに見合わないと判断した。

### 比較案（feature_window_model_redesign）の扱い

`memo 1 window` PoC は click-through 断念の対比として保管する。不採用理由の記録が目的であり、積極的な再開予定はない。削除は「なぜ捨てたか」の説明を docs に明記してから行う。

### 現在の click-through 実装状態

- overlay ↔ through の手動トグル: Cmd+Opt+/・右下 UI ボタン・tray アイコン左クリック
- tray アイコン: overlay 時は塗りつぶし、through 時はアウトライン（macOS メニューバー常駐）
- picker / session open / delete confirm / editing での自動 through 復帰

---

## 未整理の残件（feature_clickthrough_redesign ブランチ内）

- `app/src-tauri/Cargo.lock` が変更中（tray-icon / image-png feature 追加分）
- `dev-status.md` が未 commit
- main へのマージ前に Tauri 実機回帰確認が必要

---

## 次アクション

1. **dev-status.md / マスタープラン.md / clickthrough-redesign-plan.md を更新してコミット**
2. **未整理差分（Cargo.lock）をコミット**
3. **Tauri 実機回帰確認**（tray アイコン表示・overlay/through 切替・主要操作）
4. **feature_clickthrough_redesign → main にマージ**
5. **Phase 5 計画書（plans/phase-5-management-window-mvp.md）を確認・着手**

---

## 参照すべき計画書

| ファイル | 用途 |
|---|---|
| `plans/phase-5-management-window-mvp.md` | **次の作業計画書** |
| `plans/phase-4-persistence-and-autosave.md` | Phase 5 の前提参照 |
| `plans/phase-6-ux-stabilization.md` | 将来参照 |
| `plans/clickthrough-redesign-plan.md` | click-through 実験の経緯記録（縮退予定） |
| `AI-Planning-Guidelines-Sticky.md` | 開発ルール全般 |
| `マスタープラン.md` | フェーズ全体の管理 |
