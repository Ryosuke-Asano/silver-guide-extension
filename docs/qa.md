# 検証記録

## 2026-10-06 — 汎用フォーム支援

対象リポジトリは `Ryosuke-Asano/silver-guide-extension`、作業ブランチは `codex/general-form-guidance`。取得時の基準コミットは `0f9c153` (`master`)。README、製品要件、技術・UI 設計を確認して実装した。リポジトリ内の `AGENTS.md` と `.agents/skills` は存在しなかった。保存済み Floorp 開発環境は計算環境としてのみ使い、他リポジトリは変更していない。

### 最終検証

以下は 18:58 UTC の初回検証。マージ前の追加検証結果は後述する。

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

初回記録の時点では、公開ストア配信、本番デプロイ、デフォルトブランチへのマージは行っていない。

## 2026-10-06 — マージ前の追加確認

### Firefox 実行環境の確認

Mozilla 配布版 Firefox 157.0.1、Firefox ESR 140.17.0 と geckodriver 0.37.1 を `/tmp` に取得した。保存済み Floorp のスクリプト・プロファイルは使用せず、一時プロファイルと専用の描画環境で試した。Xvfb の実行ファイルだけは既存環境から読み取りで利用し、表示・ログは今回専用に分離した。製品 manifest の権限、システムのインストール、ブラウザ保護は変更していない。

初回は Firefox のアプリデータ用ディレクトリが読み取り専用のホームを向き、プロファイルの初期化に失敗した。一時ディレクトリに XDG 設定・キャッシュの置き場を作ると Firefox 157 は Marionette の接続待ちまで起動したが、content process が繰り返し signal 11 で終了した。ログには `Sandbox: writing /proc/self/uid_map: EROFS`、`A content process crashed` が記録され、WebDriver は `Failed to decode response from marionette` を返した。ESR 版もセッション初期化が時間内に完了しなかった。headless と専用 Xvfb の両方を試した。

これは**拡張を読み込む前の環境上の失敗**だった。次に、承認された一時的なテスト実行で Codex のファイルシステム隔離の外に専用ドライバーを起動したところ、Firefox 自身のサンドボックスを有効のまま接続に成功した。署名検証・証明書検証も無効にしていない。製品権限は同じ `activeTab` / `scripting` / `storage` だけ。保存済み Floorp のプロファイルは使用していない。

Firefox 157.0.1 の実際のツールバー操作で `activeTab` を付与し、実際の popup の開始ボタンから background と content を起動する **6 / 6 件の smoke が成功**した。開始、フォームの前後移動、停止・再開、ARIA と native invalid のエラー復帰、動的画面と現在入力欄の可視性を確認した。架空 fixture の送信回数は 0。スクリーンショットも目視確認した。最終実行は 19:58 UTC、6.3 秒。Firefox の実 viewport は 500×758 であり、390px 幅を確認したと主張しない。Floorp 本体、スクリーンリーダーの発声は引き続き未検証。

実行ログと結果は `/tmp/silver-guide-qa/firefox/` の `smoke-results.json`、`smoke-geckodriver.log`、`native-form-navigation.png`、`declared-error-recovery.png`、`dynamic-mobile-stage.png` に残した。再現 runner は [tests/firefox/README.md](../tests/firefox/README.md)、通常の Firefox / Floorp での最小手動手順は [E2E README](../tests/e2e/README.md#firefox--floorp-の手動確認) に記録した。認証・実申請・追加ホスト権限は不要。

### 通常の Tab と狭い画面の追加修正

独立した実操作レビューで、390×844 の通常の Tab 移動では select がパネルに隠れること、幅の変更で desktop の配置が残ってパネルがはみ出すこと、短い次画面ではスクロールできず date 欄が隠れることを再現した。フォーカス後と resize 時の配置を更新し、隠れた欄だけをスクロールする。短いページでは入力欄の上下の空きへパネルを移す。

回帰 E2E 3 件を追加し、型チェック・lint（警告 0）・単体 **88 / 88**・Firefox / Chromium ビルドと、実 Chromium 拡張 E2E **13 / 13** が成功した。追加テスト 2 件は旧ビルドで失敗することも確認した。最終 E2E は 19:48:59 UTC 開始、15.4 秒。失敗・skip・flaky は 0。`/tmp/silver-guide-qa/premerge-after-fix/` に結果・画面を残した。空き領域が 180px 未満の画面では利用者によるパネルの縮小が必要。

### GitHub のチェック状態

PR #1 の初回 head `49dae95` に対する GitHub check run と commit status は各 0 件、Actions workflow も 0 件だった。集計 status の `pending` は実行中の CI ではなく、登録された status がない状態。型チェック・lint・単体・ビルド・Chromium E2E の実行結果を使ってレビューする。

## 2026-10-06 — 公開構造に基づく実用性の改善

作業ブランチは `codex/practical-form-usability`、基準は PR #1 の追加検証を含む `c93ba8c`。PR #1 の汎用フォーム基盤と分けてレビューする後続変更である。

### 観察と変更

[実用性レビュー](usability-review.md) に、横浜市・e-kanagawa・デジタル庁の公開 GET と静的 DOM の観察を記録した。公開ページに拡張を注入した操作検証や、認証後の申請画面の確認ではない。操作は構造だけを反映した架空 localhost fixture で検証した。

- 本文に入力欄がない案内ページで検索へ誘導しないよう、公開 HTML の検索・共通ランドマークを初期候補と区別した。検索欄の明示的なフォーカスでは支援し、同じフォーム内の移動は維持する。
- 画像の `alt` と可視 native label を補足し、電話番号などの可視項目名と ARIA の入力例を区別した。構造上関連する見出しの可視「必須」も補足するが、`required` の判定を拡大しない。
- 対象外欄へのフォーカスで前のヒントを解除し、配置だけはその欄の矩形を使う。開いた用語説明にも設定変更を反映し、操作中のフォーカスを保つ。
- 横浜市本文の公式リンクと現行 FAQ のタイトルを確認し、ガイドの FAQ URL を訂正した。

### 最終検証

| 確認 | 結果 | 範囲 |
| --- | --- | --- |
| `pnpm run check` | 成功 | TypeScript と設定 |
| `pnpm run lint` | 成功、警告 0 | 本体・単体テスト・設定 |
| `pnpm test` | **137 / 137 成功、3 ファイル** | 公開ラベル・画像 alt、可視ラベル、構造上の必須表示、検索識別の追加回帰と既存テスト |
| Firefox / Chromium ビルド | 成功 | `pnpm run build`、`pnpm run build:chromium` |
| Chromium 実拡張 E2E | **16 / 16 成功** | 初期候補・検索のみのページ、ラベル・必須、対象外8種類、設定反映、既存フォーム・動的更新・エラー復帰 |
| Firefox 実拡張 smoke | **7 / 7 成功** | 実ツールバーと popup による開始、既存6フロー、新しい公開構造 fixture と対象外欄の非重なり |
| 独立ロジック確認 | **6 / 6 成功** | private getter / setter / Text.data、フォーム・検証・外部要求の throw guard。配置は stub と区別 |
| `git diff --check`、Firefox runner 構文確認 | 成功 | 差分と `node --check tests/firefox/smoke.mjs` |

Chromium は Chrome for Testing 145.0.7632.6 / Playwright 1.58.2。最終実行は 20:24:25.864 UTC 開始、21.3 秒、失敗・skip・flaky 0。新しい対象外欄のテストは readonly input / textarea、ARIA readonly select、password、contenteditable、custom textbox / combobox / listbox を 1280×900 と 390×844 で確認する。ヒント解除後も欄とパネルが重ならず、欄の中心が操作可能なことを確認した。既存の privacy guard も成功し、入力・選択・添付・私的文字列のアクセス、変更、検証・送信操作は 0。

Firefox は Mozilla 配布版 157.0.1 / geckodriver 0.37.1。最終実行は 20:25:16.381–20:25:23.573 UTC、7.2 秒。製品と同じ manifest と実際の toolbar / popup を使い、前後移動・停止再開・エラー復帰・動的画面に加え、検索と本文の区別、電話番号の可視ラベルと必須補足、readonly / password / custom editor のヒント解除と非重なりを確認した。架空 fixture の送信回数は常に 0。狭い画面の実 viewport は 500×758。

両ビルドの `content.js` の SHA256 は `6c9904a1e58a84e5e6279c2a24ad5e3c56b6175c2e15fa076ca312f6587ff755`。この同じバンドルを最終ブラウザ検証に使用した。電話番号、検索のみのページ、desktop / mobile の対象外欄、用語説明、Firefox の画面を目視確認した。

### 失敗を検出して修正した点

- 新しい E2E 3 件は旧バンドルで失敗した。初期候補に検索が混ざる、対象外欄へ移ってもお名前のヒントが残る、開いた用語説明の文字サイズが更新されない、という変更前の問題を検出した。
- 中間版の16件成功後、スクリーンショットと追加の実測で、ヒントを消すとパネルが既定位置へ戻って対象外欄を覆う回帰を検出した。readonly / password の中心がパネルに当たり、390px 幅でも password と重なった。配置専用の矩形とヒント用の対象欄を分け、desktop / mobile の非重なりと中心の操作可能性を回帰 E2E に加えた。この assertion は中間の旧バンドルで失敗し、最終版で成功した。
- 最初の Firefox smoke は、検索除外後の8項目に対し旧期待9項目が残って失敗した。意図した候補数へ期待を更新し、公開構造 fixture のフローも追加したうえで最終7件が成功した。

これらは最終版では解消している。途中の成功を最終結果として扱わず、変更後の同じバンドルで再確認した。

### 証拠・未実施

- Chromium 最終結果・版の記録: `/tmp/silver-guide-qa/followon-final/results.json`、`verification.json` と `screenshots/`
- Firefox 最終結果・画面: `/tmp/silver-guide-qa/followon-final-firefox/smoke-results.json` と PNG、driver ログ
- 旧版の失敗: `followon-before-fix/`、`followon-placement-before-fix/`、`followon-firefox-before-expectation-fix/`
- 独立確認: `/tmp/silver-guide-qa/followon-independent-review.md` と `followon-independent-results.json`

再現用の fixture・unit・E2E・Firefox runner はリポジトリに含む。スクリーンショット、ログ、プロファイルはソースへ含めていない。

Floorp 本体、実利用者による評価、スクリーンリーダー・音声エンジンの発声、公開サイトへの拡張注入、認証後の画面は未検証。iframe、サイトの Shadow DOM、独自入力部品の項目解析、PDF、極端な表示域には既存の制約がある。制度の適否や記入内容・送信可否は判断しない。任意サイトでの完全動作の保証ではない。

製品の権限と runtime 依存は変更していない。実申請・同意・購入・本人確認、外部 AI、公開ストア配信、本番デプロイは行っていない。

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
