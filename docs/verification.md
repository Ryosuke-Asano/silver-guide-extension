#元ページ内の支援を復元したc6bfe04e版の[実ブラウザー確認](assets/validation-c6bfe04e-inline.json)、[デモ用ページ・PDF/OCRの公開操作](assets/validation-c6bfe04e-demo.json)、[未署名開発版の台帳](assets/validation-c6bfe04e-development-packages.json)を保存しました。ZIPの全646ファイルは凍結ビルドと照合済みです。実演セットは E:/others/silverguide-demo-kit-20261014.zip、台本は E:/others/silverguide-demo-20261014/presenter-notes.txt、実演ページは http://127.0.0.1:4187/ です。

 Silver Guide 2.0 検証記録

2026-10-14の元ページ支援復元では固定候補`c6bfe04e…`の型検査・51ファイル631テスト・Gecko/Chromiumビルド・全646ファイルの凍結照合を確認しました。以前のページ内機能が専用タブ中心の実装へ十分に継承されていなかったため、通常ページ上での説明と入力欄案内を戻しています。以下のb96正式120profile・精度21資料・小枠625位置の結果は、その固定版の履歴です。新しいページ内支援の正式120profile性能測定、全面WCAG・実利用者試験は未実施です。

2026-10-13。架空の氏名・住所、生成PDF、ローカル試験サイトを使用しました。利用者の実書類、通常ブラウザープロファイル、本番の申請・送信は使用していません。正式公開の判定は[実装状況](implementation-status.md)に残る条件を含めて行います。

**最終UIの正式性能測定は完了しました。** 最終候補`b96c4733…`は48ファイル574テスト、型検査、両ビルド・全646ファイルの凍結照合、小さい枠625位置の6条件と独立10資料の保存比較、Chromium17画面・34条件、Floorp HTTP反映・取消と読書200%時の幅確認を終えました。21資料の精度回帰も全件実行し、失敗・未完了・外部通信0を確認しています。

[最終UIの正式性能結果](assets/validation-b96c4733-performance-final.json)はChromium・Floorp各60新規profile、合計120profile・1320一次記録です。11指標×2ブラウザーの全22集計でp95とその片側95%上限が既定予算内、失敗・打切り0件でした。物理8コア・16論理CPU・61.66GiBのWindows開発機と固定資料での観測で、4コア・8GiB基準機や最大負荷での公開判定ではありません。メモリー値は各processを順番に読んだprivate commit合計の標本peakで、真の同時peakの上下界や物理RAM使用量を保証せず、標本間の短い増加を捉えない場合があります。公開UIの測定と、同一モデルの再解析・出力検証を行う補足API測定を区別し、UI変更前との因果的な改善は主張しません。実行終了と所有processの終了を確認し、製品source103ファイル・両ビルド646ファイル・固定資料4件の不変を照合しました。各測定の範囲は[品質評価](quality-evaluation-20261013.md)へ記録します。未署名の開発用ZIPの作成と、固定ビルドへの全646ファイルの照合も完了しました。

UI変更前の`d5ce15ec…`は小さい枠の代替操作・一覧スクロール・PDFの単位と画像方向・印字済み単位セル・引用と条件の整理を修正し、47ファイル541テスト、型検査、両ビルド、298実行資材の検査が成功しました。[今回の評価記録](quality-evaluation-20261013.md)で全件操作と精度・性能の評価を区別します。初期の`ec94820e…`と、その後の`3b67ad1d…`等の実操作・出力・パッケージの証跡は[追加の製品品質検証](extended-validation.md)に版を付けて保持します。

## 再現できる自動試験

`corepack pnpm@10.13.1 run check`と`corepack pnpm@10.13.1 run test`を使用します。UI変更前の47ファイル541テストは全件成功、失敗0件、86.73秒でした。集計は`E:/others/silverguide-qa/all-tests-underline-outline-fixed-20261013.json`です。以前のd4全536件は`E:/others/silverguide-qa/all-tests-fine-skew-20261013.json`へ保存しています。以前のf53全530件は`E:/others/silverguide-qa/all-tests-pdf-accuracy-fixed-recheck-20261013.json`へ保存しています。実ブラウザーの同時起動による競合を避け、testコマンドはファイルごとの逐次実行にしています。型検査と両ビルド、各298実行資材の検査も成功しました。以前の45ファイル511件は`E:/others/silverguide-qa/all-tests-small-target-interim-20261013.json`、42ファイル487件は`E:/others/silverguide-qa/extended-tests-page-answer-final-20261013.json`、`b6c3b340…`の36ファイル389件は`E:/others/silverguide-qa/extended-tests-template-cancel-20261013.json`、初期版の21ファイル200件は`E:/others/silverguide-qa/final-tests.json`、25ファイル252件は`E:/others/silverguide-qa/extended-tests-final-20261013.json`、28ファイル280件は`E:/others/silverguide-qa/extended-tests-cpu-offline-20261013.json`、31ファイル325件は`E:/others/silverguide-qa/extended-tests-browser-policy-20261013.json`として保持しています。

| 分類 | 検証内容 |
| --- | --- |
| PDF engine・実Worker | native欄、画像OCR、低解像度・混在・縦書き、条件、required、回転・CropBox・UserUnit、widget、出力値、字形、ラスタ比較、機能制限、Worker失敗・取消 |
| PDF controller・実ブラウザー | StrictMode、パスワード、途中結果、再解析差分、手動修正保護、作成と変更の競合、保存中断、出力bytesの保持 |
| 保管庫 | 実WebCrypto、600,000回KDF、IDB中断、改ざん、nonceとチャンク、所有権fence、生存確認、backup取込の原子性、別パスフレーズ、移行、取消 |
| 案内 | ECDSA実署名、canonical JSON、hash、schema、期限・対象版、撤回、replay、巻戻し、公開鍵削除、複数タブ設定競合、builtin署名・private RAM |
| 説明・読書・手続き | 数字・条件・否定・期限の保持、原文範囲、文脈と曖昧さ、リスト・表・注記、音声状態、期限停止、履歴 |
| ウェブ反映 | 複数フォーム、グループと選択、除外、構造変更、現在値の明示確認、反映とサイトイベント、後の編集を保護する取消 |
| IPC・ワークスペース | 正規送信元、対象URL、tabID0、popupのfocus競合、解析epoch、旧tokenのcleanup、遅れた応答の失効、説明入力と辞書更新、保護状態不明時の保存停止 |

ブラウザーテストは実際のPDF/OCR Workerと同梱モデル・フォントを読み、出力PDFのbytesを再読込します。単に結果をmockした解析を実OCR成功として数えません。

## 独立した実ブラウザー検証

実装担当と異なるサブエージェントが、Windows上の隔離プロファイルで次を確認しました。Chromium149はPlaywright/CDP、Floorp12.20.1（Gecko157.0.1）とFirefox158 betaは公式Geckodriver0.37.1、一時アドオン、実ツールバー・popupを使用しています。元タブの関連付けはmockへ置き換えていません。

| 操作 | 確認結果・範囲 |
| --- | --- |
| 起動・対象タブ | 実ツールバーからpopup、専用タブ、元URLの検証。Floorpのpopupを閉じるfocus競合を発見し修正 |
| ウェブ取得・反映・取消 | 既存値・パスワードの初期取得を避け、候補だけでは元サイトを変更しない。実反映でinput/change、送信・同意なし。後の利用者編集を取消で保持 |
| 下書き | 保存・reload・即時解除・再開。残留leaseによる20秒待ちを発見し生存確認で修正 |
| 日本語PDF | 4native欄の確認・入力・出力再表示。Chromiumではdownloads APIの完了を確認。日本語・かな・全角・異体字43glyphの別試験も実施 |
| OCR | 同梱WASM/モデルを拡張CSP下で実行し、画像のみの4欄を解析。初期の候補欠落と注意文の誤ラベルを修正 |
| ロックと復旧 | Floorp/Firefoxで元PDFと4回答を同じタブに復旧 |
| 登録情報・履歴 | 名前付きprofileを暗号化して選択、各欄で明示候補選択。チェックリストautosave、3履歴、旧地点復元と再開 |
| バックアップ | 実ダウンロード、SGVB0001と暗号化、パスフレーズ変更、旧backupの別鍵取込、コピー追加、旧current鍵拒否、新鍵で再開 |
| プライベート | Chromiumの実split privateとFloorp/Firefoxの実privateウィンドウで通常profile非表示・保存禁止・PDF処理、通常保管庫が維持されること |
| 説明・案内 | 構造保持、手入力、説明、署名案内の取込・明示適用・巻戻し・別画面反映・鍵競合を確認 |
| 狭い画面 | 320/390pxと24px本文で読書・チェックリスト・更新画面を検証。select、長い鍵ID、下書き名のoverflowを修正 |

初期版`ec94820e…`の独立検証は完了しました。下表の7実行ログはすべてこのソース識別子を記録し、実行時エラー0件です。その後の修正版や別のOS・ブラウザー版を確認した扱いにはしません。

| 初期版の実行 | 証跡ディレクトリ（`E:/others/silverguide-qa/`以下） |
| --- | --- |
| Chromium：ウェブ・PDF・OCR・保存・登録情報・履歴・バックアップ | `product-extension-1791824811728` |
| Floorp：ウェブ・PDF・OCR・ロックと復旧 | `floorp-product-1791825021404` |
| Firefox：ウェブ・PDF・OCR・ロックと復旧 | `firefox-product-1791824956211` |
| 読書：説明・実音声イベント・狭い画面・保存 | `reader-product-1791824883043` |
| Chromium private：通常保管庫の分離・RAM案内・PDF | `chromium-private-1791824811620` |
| Floorp private：通常保管庫の分離・RAM案内・PDF | `floorp-product-1791824829599` |
| Firefox private：通常保管庫の分離・RAM案内・PDF | `firefox-product-1791824829592` |

各ディレクトリに`qa-log.json`と画面・表示内容を保存しています。集約報告は`E:/others/silverguide-qa/independent-acceptance.md`です。保存したPDFを編集して38.4ms後に別画面へ移り、reload・解除・再開して直前の回答を復元しました。未解析の貼り付け文と手入力語句の切替後の保持、読書画面を離れたときの音声停止と復帰後の再開も確認しました。

## 出力PDFの別エンジンによる確認

初期版のChromium拡張から実際にダウンロードした`product-extension-1791824811728/native-filled.pdf`を、pypdf 6.10.0の厳密読込とPopplerで別に確認しました。1ページ・4欄のcanonical値と各widgetの値が一致し、通常appearanceが存在しました。MediaBoxとCropBox、回転も確認し、PopplerのA4全体描画で架空の日本語氏名・かな・住所・電話が枠内に表示され、欠落・重なり・切れがないことを目視しました。

構造の検査結果は`E:/others/silverguide-qa/independent-pdf-inspection.json`、描画は[別エンジンの出力確認](assets/acceptance-pdf-poppler.png)です。この確認は合成した1書類の証跡であり、独立した実帳票corpusの判定に置き換えません。

元の合成PDFはCFFフォントをFontFile2として保持しており、元PDFと出力PDFの両方でPopplerのフォント種別警告が発生しました。原本に存在した同じフォントを保持した結果です。新しく埋め込んだ回答用フォントはTrueTypeであることを別に検査しました。Chromiumにも元の合成PDFのfont-sanitizer警告がありましたが、表示を目視し、実行時エラーとして数えていません。一般のフォント互換性まで保証する結果ではありません。

## 検証したビルドと開発用パッケージ

### 最終UI候補 b96c4733

ソースSHA-256は`b96c473355a5a9a81bba5874c0b463a8e7aabec4131d98630b87bfbea807a11f`です。未署名の開発用ZIPは`E:/others/silverguide-build-20261013-b96c4733/`に作成しました。[パッケージ記録](assets/validation-b96c4733-development-packages.json)と[アーカイブ照合](assets/validation-b96c4733-development-archives.json)に、各ZIPの323ファイル・合計646ファイルのサイズとSHA-256が元の固定ビルドと現在のビルドへ一致した結果を記録しています。[Python標準zipfile/hashlibによる別実装の独立照合](assets/validation-b96c4733-development-independent.json)も実終了0で完了し、全646ファイルのCRC・サイズ・SHA、一意な期待集合、安全な展開パス、余分・重複・directory entryがないこと、ZIP自体のSHA、台帳とREADMEの一致を確認しました。正式なアドオン署名や公開配布の完了を意味しません。

| 最終UI候補の開発用ZIP | バイト数 | SHA-256 |
| --- | --- | --- |
| `silverguide-2.0.0-gecko-development.zip` | 30,069,827 | `2b609358062d849b9966f3e12e0cecdd98719708f012048d0e93c0ef97745549` |
| `silverguide-2.0.0-chromium-development.zip` | 30,069,755 | `89c2130b9c334d80502656fd83c10a8557c356bed57d5aab84315f680e3864fb` |

### 以前の版の記録

初期の独立実操作と出力PDFに対応する両ビルドのソースSHA-256は`ec94820ea85be647c4ff05c89de364e0269e410e15decd3b6da410099f596385`です。Geckoは2026-10-12T17:02:15.044Z、Chromiumは2026-10-12T17:02:25.590Zにビルドしました。この版の後に追加修正があります。

開発用ZIPは`E:/others/silverguide-build-20261013-ec94820e/`にあります。各ZIPの323ファイルを展開読込し、検証済みのビルドと全ファイルのSHA-256が一致しました。298同梱実行資材とローカルentry、manifestもビルド時の検証対象です。これらは署名のない開発用配布物です。

| 開発用ZIP | SHA-256 |
| --- | --- |
| `silverguide-2.0.0-gecko-development.zip` | `7e03b11f2564ec14bd0b73d6f6556c70cac0d4a277255bcb314d2071c464a98a` |
| `silverguide-2.0.0-chromium-development.zip` | `279e358fe8e1ca47e3a80fd1420c006796d987290784060ff2aa1eba99cda918` |

バイト数・SHA-256は`package-manifest.json`、展開内容の照合結果は`archive-verification.json`に記録しています。一時読み込みの手順は[README](../README.md)を参照してください。

追加修正版のソースSHA-256は`73aa364117bbacf72a109b618d7105439466990dac67caf7a16cef18063cf62c`です。Geckoは2026-10-12T18:46:09.182Z、Chromiumは2026-10-12T18:47:22.077Zにビルドしました。開発用ZIPは`E:/others/silverguide-build-20261013-73aa3641/`にあり、323ファイルずつのサイズとSHA-256が対応するビルドに一致しました。正式なアドオン署名はありません。

| 追加修正版の開発用ZIP | SHA-256 |
| --- | --- |
| `silverguide-2.0.0-gecko-development.zip` | `f07c3ac7964a80dad00ad6277d4fede515d01f6575c259e87aa0b8c133373729` |
| `silverguide-2.0.0-chromium-development.zip` | `535ffae394532c33cbfe692a4f39fa2be61798f9844462c250c8cc24f13b94d4` |

前の修正版`25db729d11fe851d4c6ee0069f800b80bcceb0690123612b23f3c2bfcbd7ba75`は、Geckoを2026-10-12T19:54:05.562Z、Chromiumを2026-10-12T19:54:33.177Zにビルドしました。同版の測定と発見した問題を追加検証へ保持しています。

前の修正版`cb52865c0f4056276d404e8412b5f196c59b07ee0308fb91fdecd614498a0feb`は、Geckoを2026-10-12T20:36:50.448Z、Chromiumを2026-10-12T20:38:08.657Zにビルドし、独立した38画面・状態と27 engine case・4実拡張フローを確認しました。同版の結果と、その後の追加修正は追加検証へ分けて保持しています。

前の修正版のソースSHA-256は`b6c3b3406ca4b34f1d4b25f4264e54eee77e5d40e59c6b0457b51073dc79080b`です。Geckoは2026-10-12T21:41:23.112Z、Chromiumは2026-10-12T21:43:11.354Zにビルドし、298実行資材・ローカルentry・秘密鍵除外とブラウザー対象の整合性検証が成功しました。同版の独立実操作は38状態・ドック・進行情報に加え、署名様式の採用・暗号化保存と実再開・更新・撤回・期限切れ・実ファイル保存を確認しました。追加10状態のaxe違反・判定不能とpage errorは0です。従来のoverlayや支援技術未実施の限界、負荷・開発用ZIPの結果は[追加検証](extended-validation.md)で識別子と対応させて記録します。

以前の修正版のソースSHA-256は`3b67ad1d8f2af335c4dcc433dd2797b9df7bb50008f23acb1419b5dbb93b76b1`です。Geckoは2026-10-13T05:29:05.458Z、Chromiumは2026-10-13T05:29:29.769Zにビルドしました。42ファイル・487テストと型検査、両対象の298実行資材・ローカルentry・秘密鍵除外・対象manifestの一致を検証しました。同じ版でChromiumの変更経路35実UI記録、両ブラウザーのPDF作成経路6profile、9系列の公開帳票と別の1PDF・2ROI訂正の限定再試験を独立して確認しました。小さいoverlayのraw axe78件、全件・支援技術未実施、手動選定欄と自動精度の違いは[追加検証](extended-validation.md)へ保持しています。

以前の未署名開発用ZIPは`E:/others/silverguide-build-20261013-3b67ad1d/`です。各323ファイルのサイズ・SHAが対応するビルドへ一致し、ZIP作成後の両bundle全646ファイルも実UI前のbaselineへ一致しました。説明は同folderの`README.txt`、hash・日時・サイズは`package-manifest.json`、照合は`archive-verification.json`です。

| 以前の修正版の開発用ZIP | バイト数 | SHA-256 |
| --- | --- | --- |
| `silverguide-2.0.0-gecko-development.zip` | 30,059,520 | `3eac8092e8959aec9e24341eb8f51700122a595334f74f417ad4dd1449aa818e` |
| `silverguide-2.0.0-chromium-development.zip` | 30,059,442 | `86329ebc07fa2688d346cbaedbc6babf8942d645382fa76c3a292aa1af2101cd` |

## 発見して修正した主な問題

- PDF注釈のappearanceを入力枠と二重検出していたため、annotationを除いた原ページ解析へ修正。
- CFFのsubsetで日本語outlinesが欠けるため、固定TrueTypeを静的化して必要glyphだけ埋め込み、出力の大きさと字形を確認。
- React開発環境の巨大バイト列ログで画面が停止するため、表示stateに出力metadataのみを置き、bytesをprivate参照に保持。
- 低解像度の罫線・OCR誤検出で欄が欠け、注意文がラベルになるため、細い境界と近接ラベルの評価を修正。
- Floorpのpopup終了時に別タブを元ページとして扱うため、popupで選んだtabID/URLを保持し、backgroundで実タブと再照合。
- 手入力語句を本文の残留選択で上書きするため、入力部品のkeyup/mouseupを選択取得から除外。
- 更新・期限切れ後に古い用語説明が残るため、変更されたcatalogで説明とその音声を閉じる。同じ内容の再取得では閉じない。
- 古いウェブ解析・previewの応答が新しい下書きへ反映されるため、要求世代・作業ID・mounted状態で結果を失効させる。
- 欄変更時の以前の回答と選択肢の意味を失うため、回答と元の表示ラベルを保管し、自動再割当を避ける。
- 保護状態の通信失敗をprivateと誤表示するため、未確認状態として永続保存を停止し、再試行を提供。
- 通常のPDF入力と欄の編集で省略可能な属性にundefinedを含めて保存を拒否されるため、属性を省略するJSON契約へ修正。実際の画面操作と実PDFから厳密な保管庫保存・復元を試験。
- 設定の入力を保持したまま画面を隠す際、CSSがhidden属性を上書きするため、非表示の画面を視覚・アクセシビリティ双方から隠す規則を追加。
- 保存対象の変更から1秒以内に画面を移るとautosaveの待機が取り消されるため、移動時に保存し、コミット中の終了を知らせる。別画面の作業を保存済みと誤表示しない。
- 読書画面の未処理の貼り付け文・手入力語句が画面切替で消えるため、非表示でも入力を保持し、音声は一時停止。貼り付け途中の文章を閉じる際も知らせる。

## デザインの照合

構想画像`assets/workspace-concept-v2.png`から、白い面と青緑の主操作、濃い大きな文字、本のアイコン、作業一覧・設定、淡い緑の説明、戻る・次へと保存状態を継承しています。最終UIは質問をDOMの先頭とデスクトップの左へ、原本を右へ置き、狭い画面では質問・原本の順に縦配置します。必須性・条件は基本確認として画面内に残し、手動修正や表記変換などの補助工具を開閉入口へまとめました。[UI設計と変更前後の実画面](design-system.md)で、記録した34条件のボタン数・寸法・コントラストと確認範囲を示します。

## 評価の限界と未達条件

実書類corpusの精度校正、独立した公的文章等200件による公開判定、最大負荷・基準機のp95、NVDA・日本語IME・音声の人による聴取、対象利用者の試験、署名配布物の検証は未完了です。架空の固定200段落による根拠範囲の評価は完了し、実文章の公開判定と区別して[品質評価](quality-evaluation-20261013.md)へ記録しています。GeckoのOS標準「名前を付けて保存」の操作・保存完了は自動化できておらず、実出力と表示は別に確認しました。合成資料の成功を全ての日本の様式の成功率やWCAG完全適合として宣言しません。

実利用者検証は赤羽台祭の企画で実施予定ですが、現時点では実施できないとの利用者回答を記録しています。参加者、日時、試験同意、支援技術の構成、結果は実施時に記録します。

公開ID、配布先、問い合わせ先、更新origin、鍵運用は未定との回答を受けています。開発用署名・一時アドオンを正式配布の成功として数えません。完全な製品完成を宣言するには[品質と配布仕様](specs/quality-and-release.md)の公開条件を閉じる必要があります。
