# Phase 3-1c 計画書: slot 座標修正と生成失敗警告の最小実装

## 1. 対象

- マスタープラン対応: `Phase 3-1` の修正パッチ
- 主目的: slot 座標の画面外はみ出しを修正し、セッション生成失敗時に無反応状態を解消する

---

## 2. 修正対象の問題

### B-1: slot 座標が画面外にはみ出す

現状の `getSlotPosition` は SLOT_PERCENTAGES をカード中心座標として扱い、
`x = viewport.width * 0.1 - DEFAULT_WIDTH / 2` を計算する。

1440px 幅では slot 0 の x = -16px（画面外）、slot 4 の右端 = 1456px（画面外）。
1280px 幅ではさらに悪化する。

### B-2（文書側）: Phase 3 Gate と画面ワイヤー仕様が旧ショートカットのまま

`phase-3-session-operations.md` §8 Gate 1〜2、§9 回帰チェックが `Cmd + Shift + 1/2...9` のまま。
`画面ワイヤー仕様.md` §3.7「新規複数枚セッション」も同様。

### 補足: 生成失敗時に無反応

上限超過・スロット不足時に `createSession` が null を返しても UI 変化がゼロ。
仕様（要件定義 §7.2、画面ワイヤー仕様 §3.8）に定義された警告演出が未実装。

---

## 3. 修正内容

### 3-1: SLOT_PERCENTAGES の端値を修正 + getSlotPosition に clamp を追加

**変更前**:
```
x: [0.1, 0.3, 0.5, 0.7, 0.9]
```

**変更後**:
```
x: [0.13, 0.30, 0.50, 0.70, 0.87]
```

根拠:
- DEFAULT_WIDTH = 320px、想定最小安全幅 = 1280px（MacBook Air 13" 相当）
- 0.13 × 1280 − 160 = 6.4px（左端ギリギリ可）
- 0.87 × 1280 − 160 = 953.6px、右端 = 1273.6px < 1280px（可）

加えて、予期しない小画面や動的なリサイズへの安全網として clamp を追加する:
```ts
x: Math.round(Math.max(0, Math.min(width - DEFAULT_WIDTH, width * slot.x - DEFAULT_WIDTH / 2)))
y: Math.round(Math.max(0, Math.min(height - DEFAULT_HEIGHT, height * slot.y - DEFAULT_HEIGHT / 2)))
```

仕様書（要件定義 §7.4、画面ワイヤー仕様 §3.5）も `13%, 87%` に更新する。

### 3-2: createSession の返り値に失敗理由を追加し、最小警告 state を接続

`createSession` を `Session | null` から `{ session: Session | null; limitHit: 'session' | 'memo' | null }` に変更する。

App.tsx に `limitWarning: 'session' | 'memo' | null` state を追加する。
`createSession` が `limitHit !== null` を返したとき:
- `setLimitWarning(limitHit)` を呼ぶ
- `setTimeout(() => setLimitWarning(null), 900)` で自動消去する

警告 UI:
- memo カード全体の上に `position: fixed; inset: 0` の赤系半透明オーバーレイ
- `shake` アニメーション 900ms で自然に消える
- テキストは `これ以上セッションは開けません` / `これ以上メモは表示できません`
- pointer-events: none（操作を妨げない）

### 3-3: 文書修正（コード変更なし）

以下の3箇所を更新する:

1. `plans/phase-3-session-operations.md` §8 Gate 条件 1〜2
   - `Cmd + Shift + 1` → `Cmd + Option + Enter`
   - `Cmd + Shift + 2...9` → `Cmd + Option + N → picker で数字選択`

2. `plans/phase-3-session-operations.md` §9 回帰チェック（ショートカット項目）
   - 同様に旧記述を削除し新記述へ

3. `画面ワイヤー仕様.md` §3.7「新規複数枚セッション」
   - `Cmd + Shift + 2...9` → `Cmd + Option + N → picker`

---

## 4. 対象ファイル

| ファイル | 変更内容 |
|---|---|
| `app/src/App.tsx` | SLOT_PERCENTAGES 端値, getSlotPosition clamp, createSession 返り値, limitWarning state, 警告 UI |
| `app/src/App.css` | .limit-warning overlay, @keyframes shake |
| `plans/phase-3-session-operations.md` | Gate §8 / 回帰チェック §9 のショートカット記述 |
| `画面ワイヤー仕様.md` | §3.7 ショートカット記述 |
| `要件定義.md` | §7.4 横スロット値（10%/90% → 13%/87%） |

---

## 5. Gate 条件

- slot 0 (leftmost) のカード左端が 0px 以上であること（1280px 幅で確認）
- slot 4 (rightmost) のカード右端が viewport 幅以下であること
- セッション上限到達時に赤オーバーレイ + shake が 900ms 表示されること
- メモ上限到達時に同様の演出が出ること
- Phase 3-1 の既存 Gate（ショートカット生成、colorSlot、前詰め、上限拒否）を壊していないこと

---

## 6. 変更履歴

- 2026-04-08: 初版作成

