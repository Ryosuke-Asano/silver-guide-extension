# Silver Guide 資料

**3.0.0 の採用済み Spec** は [3.0.0 資料](specs/3.0.0/README.md) にまとめています。フォーム補助＝上側 Tooltip、単語解説＝下線クリックでページ内ポップアップ、PDF＝専用タブです。文章の範囲選択によるサイドパネル解説は補助として残します。[実装作業順](specs/3.0.0/implementation-plan.md) に沿って進めた内容と確認範囲は [3.0.0 実装状況](specs/3.0.0/implementation-status.md) を参照してください。[使い方](user-guide.md)と[プライバシー](privacy-and-support.md)は3.0.0へ更新しています。

以下は主に2.0の設計と検証履歴です。[旧製品設計](product-design.md)の全機能を3.0.0へ持ち込まず、新版の仕様は3.0.0 Specを優先します。旧版の試験結果を新版の合格として扱いません。

| 資料 | 内容 |
| --- | --- |
| [実装状況と公開条件](implementation-status.md) | SG要件への対応、採用構成、未達の公開条件、未定の運用情報 |
| [検証記録](verification.md) | 自動試験、独立した実ブラウザー検証、修正した不具合、評価の限界 |
| [追加の製品品質検証](extended-validation.md) | 実書類、最大負荷、拡大・強制配色、文章整理、追加修正の進行 |
| [小さい記入枠・精度・性能の評価](quality-evaluation-20261013.md) | 全件操作、固定正解との比較、引用と条件の修正、反復性能測定 |
| [使い方](user-guide.md) | 現行3.0.0。上側Tooltip、下線語ポップアップと補助のサイドパネル、専用PDFタブと標準保存 |
| [赤羽台祭の検証キット](akabanedai-test-plan.md) | 架空資料、5課題、支援段階、記録票、未確定の同意・運用欄 |
| [プライバシーと問い合わせ](privacy-and-support.md) | 現行3.0.0。作業中の保持、本人によるPDF保存、サイト権限、旧版データ、確認済み環境と未実施の公開条件 |
| [資材とライセンス](runtime-assets.md) | 固定版、モデル、フォント、hash、ライセンス、再生成、署名資材 |
| [製品設計](product-design.md) | 対象、標準機能、画面、デザイン、構成、運用 |
| [PDF処理仕様](specs/pdf-pipeline.md) | 能力判定、混在解析、座標、意味、修正、日本語出力、検証 |
| [PDFの実行分担](decisions/pdf-execution.md) | Workerと作業タブの責務、描画方針、取消と品質基準の採用記録 |
| [データと状態の契約](specs/data-contracts.md) | 三値条件、revision、IPC、保管庫、鍵、復旧、移行 |
| [品質と配布仕様](specs/quality-and-release.md) | 精度資材、性能、アクセシビリティ、利用者試験、配布と保守 |
| [UI設計と画面比較](design-system.md) | 継承する色・文字、工程と操作入口、公式基準・製品独自寸法、変更前後の実画面 |

0.1の[要件](product-requirements.md)、[技術設計](architecture.md)、[実装順序](implementation-plan.md)、[QA](qa.md)は履歴です。入力値を扱わない制約など、2.0と異なる説明を現在の機能案内へ転用しません。
