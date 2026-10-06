# 検証記録

## 2026-10-06 — 汎用フォーム支援

対象リポジトリは `Ryosuke-Asano/silver-guide-extension`、作業ブランチは `codex/general-form-guidance`。取得時の基準コミットは `0f9c153` (`master`)。README、製品要件、技術・UI 設計を確認して実装した。リポジトリ内の `AGENTS.md` と `.agents/skills` は存在しなかった。保存済み Floorp 開発環境は計算環境としてのみ使い、他リポジトリは変更していない。

### 最終検証

| 確認 | 結果 | 範囲 |
| --- | --- | --- |
| `pnpm run check` | 成功 | 本体、単体テスト、Vite / Vitest / Playwright 設定の型チェック |
| `pnpm run lint` | 成功、警告 0 | TypeScript / TSX と設定の ESLint |
| `pnpm test` | 88 / 88 成功、3 ファイル | フォーム解析 84 件と既存の辞書・ガイド 4 件 |
| `pnpm run build` | 成功 | Firefox / Floorp 向け出力 `dist/` |
| `pnpm run build:chromium` | 成功 | Chromium 向け出力 `dist-chromium/` |
| Playwright E2E | 10 / 10 成功 | 実際の拡張の popup、background service worker、注入した content script |
| `git diff --check` | 成功 | 差分の空白・競合マーカー確認 |

最終 E2E は 2026-10-06 18:58 UTC、12.2 秒。失敗・スキップ・flaky は各 0。Node.js 24.19.0、リポジトリ指定の pnpm 10.13.1、Playwright 1.58.2、同梱 Chrome for Testing 145.0.7632.6 を使用した。Browser plugin は不在のため通常の Playwright を使用した。

E2E の流れは、架空のローカルフォームを開く → 利用者が支援を開始する → 項目・用語・ページの説明を読む → 利用者の操作で項目へ移動する、である。単体・ブラウザテストは、ARIA、表・定義リスト、fieldset と radio、別フォーム、非表示・無効・読み取り専用の欄、動的な複数段階、エラー復帰、停止・再開を検証した。表示は 1280×900、1280×680 と中央寄せフォーム、390×844 と大きい文字で確認した。

| 画面・操作の確認 | 結果 |
| --- | --- |
| ページの URL・タイトル、意味のある本文と支援 UI | 成功 |
| framework エラー表示、関連 console error / warning | なし |
| 最初・前・次の項目へのフォーカスとフォーム境界 | 成功 |
| ページのエラー通知からの復帰 | 成功、入力値を含むエラー文の転載なし |
| 手順差し替え、隠れた旧用語、編集領域への変化 | 成功 |
| 停止・再開、同一ページへの二重注入 | 成功、宣言衝突・重複 UI なし |
| パネル先頭・現在項目・閉じる操作、入力欄との配置 | 成功、対象スクリーンショットを目視確認 |

### プライバシーと隔離

テスト用の入力・選択・添付はすべて架空データ。実際の行政申請・送信・同意・購入・本人確認は行っていない。実サイトや認証画面にアクセスしておらず、外部 AI も利用していない。

入力値・初期値・選択状態・添付・検証結果・検証メソッドに guard を付けた単体テストを実行した。実ブラウザでは、content script と同じ隔離ワールドに getter / setter とメソッドのカウンターを付け、値・選択・添付・保護領域の文字の読取と変更が 0 であることを確認した。検証・送信の呼び出しは 0、支援開始後の通信も 0。テスト前後の値・選択・添付の一致、メッセージ・ログ・ネットワーク・ストレージへの流出がないことも確認した。設定の保存先には文字サイズ・原文表示の二つだけが残る。

本体の manifest は変更していない。headless テストではツールバーからの `activeTab` 付与を再現できないため、一時ディレクトリの拡張コピーだけに localhost のホスト権限を付けている。ブラウザプロファイルも隔離し、fixture のサーバーは localhost だけで GET を受け付ける。

### 失敗を検出して修正した点

- **再注入時のエラー**: 停止後に再開すると、classic script のトップレベル宣言が衝突した。注入用バンドルを IIFE にし、実拡張の再開テストと console の確認が成功した。
- **保護領域の文字取得**: 元の用語判定は除外する前に `Text.data` を取得していた。旧ビルドを強化した guard で実行すると、架空の保護領域に 11 回の取得を検出した。除外を先に行い、修正後は 0 を確認した。
- **古い画面と操作部品**: 隠れた用語・見出し、カスタム選択欄、通知領域、後から編集領域になった本文への用語支援を独立レビューで検出した。表示中の所有用語・見出しに限定し、属性変更にも追従するよう修正した。
- **支援内のフォーカス・表示位置**: 背景更新による公式リンクとチェックリストのフォーカス喪失、項目移動後のスクロール残存、パネルと入力欄の重なり、狭い画面の上辺での入力欄の切れを修正し、再検証した。

環境付属 Chromium 151 は拡張 service worker を読み込めなかった。Playwright が対応する同梱ブラウザを `/tmp` に取得して解消した。環境の既定 pnpm 11 のキャッシュ先への書き込みも失敗したため、リポジトリ指定の pnpm 10 を `/tmp` に置いて実行した。いずれも最終検証のブロッカーではない。

### 証拠と再現

- 最終結果: `/tmp/silver-guide-qa/results.json`
- 画面: `/tmp/silver-guide-qa/screenshots/` の `desktop-error-recovery.png`、`desktop-centered-field-visible.png`、`mobile-large-field.png`、`mobile-large-glossary.png` など
- 修正前の保護領域取得を検出した結果・trace: `/tmp/silver-guide-qa/regressions-before-fix/protected-text-read.results.json` と `.trace.zip`
- 独立レビューの再現ハーネス・記録: `/tmp/silver-guide-content-review.mjs` と `.md`

再現可能な fixture と E2E はリポジトリに含め、スクリーンショット・trace・ブラウザプロファイルはソースに含めていない。通常の実行方法と環境変数は [tests/e2e/README.md](../tests/e2e/README.md) を参照する。

```sh
pnpm run check
pnpm run lint
pnpm test
pnpm run build
PLAYWRIGHT_BROWSERS_PATH=/tmp/silver-guide-playwright-browsers pnpm run test:e2e
```

### 未実施・残る制約

- Firefox / Floorp の実行、実際のツールバーによる権限付与、スクリーンリーダーの発声、音声エンジンは未検証。Firefox 向けは型・ビルドの確認まで。
- 実際の行政サイトの改版や認証後の画面は未検証。確認済みガイドの説明・公式 URL は今回変更していない。
- iframe、サイト内 Shadow DOM、独自ウィジェット、PDF、独自クラスだけのエラー、極端な表示域・大量 DOM は追加検証が必要。
- 通常のページ遷移では支援を開始し直す。DOM / フォーカス変化を伴わない `history.pushState` / `replaceState` だけの変更は、次の状態照会・更新で再判定する。
- fixture の成功は任意サイトでの完全動作を保証しない。詳しい対応範囲は [form-support.md](form-support.md) を参照する。

公開ストア配信、本番デプロイ、デフォルトブランチへのマージは行っていない。

## 以前の初期実装の確認記録

### 実行結果

- `corepack pnpm@10.13.1 run check`: 成功
- `corepack pnpm@10.13.1 run test`: 1 件成功
- `corepack pnpm@10.13.1 run build`: 成功

### 視覚確認

基準コンセプトは `../../yasashiku-yomu-extension/docs/assets/ui-concept-v1.png`。ローカルのポップアップを 430 × 640px で表示し、次を確認した。

| 比較項目 | 基準 | 実装結果 |
| --- | --- | --- |
| 背景 | 純白 | `#ffffff` |
| 主操作 | 青緑、太字、大きな操作面 | `#076c78`、21px、58px 以上 |
| 文字サイズ選択 | 3 分割の枠、選択時に主操作色 | 同じ構造と色 |
| 原文表示 | 右側スイッチ、太字ラベル | 同じ構造と寸法 |
| フォーカス | 青い 3px 輪郭 | `#0c75a6` の 3px 輪郭 |
| パネル | 白背景、既存の罫線・角丸 | 支援ドックとツールチップにも適用 |

### 意図した差分

- Silver Guide 固有の「支援を停止する」と「入力内容は送信しません」を追加した。
- 行政ページの詳細な入力説明・公式導線は、公開 URL を確認してガイドパックへ登録するまで表示しない。未確認の制度案内を推測して表示しないためである。
