# 処理フロー設計書

## 1. 全体フロー

```text
ユーザー
↓
GitHub Pages
↓
Bootstrap UI
↓
JavaScript
↓
GAS WebApp API
↓
Google Spreadsheet
↓
Google Drive
```

## 2. 初期表示フロー

```text
index.html 読み込み
↓
Bootstrap / CSS / JS 読み込み
↓
config.js 読み込み
↓
app.js 起動
↓
getDateOptions 実行（年付き日付。年を確定できない日付は選択不可）
↓
店舗・日付セレクトを初期化
↓
画面を操作可能にする
```

## 3. 店舗・日付選択フロー（Phase 1.5）

```text
ユーザーが店舗・日付を選択（日付の値は YYYY-MM-DD）
↓
処理中なら選択を元に戻して終了
↓
未保存の変更あり？
  あり → 確認モーダル［保存して移動 / 保存せず移動 / キャンセル］
          保存して移動 → 現在の店舗・日付に saveShift → 失敗なら移動しない
          キャンセル  → セレクトを元に戻す（入力は保持）
↓
getSavedShift（読み取りのみ）
↓
initialized = true  → 保存データを表示（SIFT_DATA から作り直さない）
initialized = false → initializeShift（POST・認証必須）
                       ロック内で再確認し、無い場合のみ SIFT_DATA から作成
                       認証不可・SIFT_DATA なし → 警告を表示（データは作らない）
↓
応答の store / date が選択と一致することを確認して表示
↓
保存状態バッジ「保存済み rev N」
```

「再読み込み」ボタンは保存済みデータを読み直すだけです（未保存の変更がある場合は確認）。

## 4. SIFT_DATA読み取りフロー

```text
store / date を受け取る
↓
store から対象行を決定
  KABUKI → 1行目
  AKIBA → 2行目
↓
対象行の投稿文を左から右に検索
↓
投稿文内に date が含まれるセルを対象にする
↓
対象投稿文を返す
```

## 5. キャスト抽出フロー

```text
投稿文を行ごとに分割
↓
空行を除外
↓
日付行を除外
↓
時間行を除外
↓
店舗名・営業時間・URL・SNS IDなどを除外
↓
イベント名を除外
↓
前後を絵文字で囲んだ見出し行（✨マカロン✨ など）を除外
↓
@ / ＠ 以降を削除（Xアカウント）
↓
不可視文字・絵文字（Unicode プロパティ判定・サロゲートペアを壊さない）・♡☆★ などの装飾を削除
↓
空白を削除
↓
名前を正規化
↓
キャスト名として採用
```

## 6. 表記ゆれ対応

以下の表記ゆれはGAS側で吸収します。

| 入力例 | 正規化例 |
|---|---|
| 体入 らんこ🔰 | 体入らんこ |
| 体入リア🔰 | 体入リア |
| 体入アマ🔰 | 体入アマ |
| 恋富子🔰 | 恋富子 または 体入恋富子 |
| みあは🔰 | みあは または 体入みあは |

最終的な採用名は、画像ファイル名・運用ルールに合わせて調整します。

## 7. 画像取得フロー

```text
ID管理シートから DRIVE_IMAGE_FOLDER_ID / DRIVE_IMAGE_FOLDER_IDS を取得
↓
Google Drive フォルダ内のファイルを複数フォルダから取得
  指定フォルダ配下のサブフォルダも走査
↓
ファイル名から拡張子を除外
↓
キャスト名 → fileId のマップを作成
↓
画像生成シートのキャスト名と照合
↓
一致すれば画像URLを返す
↓
一致しなければ準備中画像を返す
↓
準備中画像もなければ画像なし扱い
```

## 8. 休み設定フロー（Phase 1.5）

```text
出勤中 / 休み設定一覧の「休み」「戻す」ボタン（recordId で対象を特定）
↓
未保存の変更あり？
  あり → サーバーに送らず画面上の状態だけ変更（他の未保存入力を失わない）→「編集保存」で確定
  なし → setCastAbsent(store, date, recordId, isAbsent, expectedRevision)
          ロック → revision 検証 → 新しい世代として保存 → 操作ログ
↓
画面を更新
```

## 9. 画像未登録チェックフロー

```text
選択中の店舗×日付の保存データ（シフト編集）を取得
↓
Drive画像マップを取得
↓
各キャスト名と画像ファイル名を照合
↓
未登録キャストを抽出
↓
画像チェックシートへ記録
↓
画面に件数と名前を表示
```

## 10. 画像キャッシュ更新フロー

```text
ユーザーが画像キャッシュ更新を押す
↓
refreshImageCache 実行
↓
Driveフォルダ群を再スキャン
↓
キャスト名 → fileId マップを再作成
↓
CacheServiceへ保存
↓
画像一覧を再描画
```

## 11. エラー処理フロー

```text
API処理開始
↓
try / catch で処理
↓
エラー発生
↓
エラーログシートへ保存
↓
共通レスポンス形式で success:false を返す
↓
フロントで toast / alert 表示
```

## 12. GitHub運用フロー

```text
GitHub Repository
↓
社内PCへ clone
↓
VS Codeで編集
↓
git add .
↓
git commit
↓
git push
↓
GitHub Pagesへ反映
```

## 13. GAS運用フロー

```text
社内PCで gas/*.gs / gas/appsscript.json を編集
↓
clasp status
↓
clasp push
↓
Apps Script エディタで反映内容を確認
↓
新しいバージョンを作成
↓
Webアプリをデプロイ
↓
GAS_WEB_APP_URL を ID管理 / config.js に反映
```

手動コピー運用が必要な場合のみ、以下の流れを使います。

```text
GitHub の gas/*.gs を確認
↓
Apps Script エディタを開く
↓
対象ファイルへコピー&ペースト
↓
保存
↓
新しいバージョンを作成
↓
Webアプリをデプロイ
↓
GAS_WEB_APP_URL を ID管理 / config.js に反映
```

## 14. GAS責務分離

```text
ApiRouter.gs  →  AuthService.gs（更新系の認証・認可）
↓
ConfigService.gs / SpreadsheetService.gs
↓
SiftService.gs / ImageService.gs / ShiftService.gs → ShiftRepository.gs（保存層）
↓
MigrationService.gs（旧データ移行。API からは呼べない）
↓
LogService.gs
↓
Utils.gs
```

- `doGet` / `doPost` は `ApiRouter.gs` に集約する。
- `Code.gs` は定数、初期メニュー、セットアップ入口だけを持つ。
- `ID管理` シートの設定を優先し、秘密情報が必要な場合のみ Script Properties を使う。
- GitHub Pages からは JSONP / WebApp API を呼び、`google.script.run` は使用しない。

## 15. デプロイ確認フロー

```text
GitHub Pagesを開く
↓
画面が表示されるか確認
↓
店舗セレクトが表示されるか確認
↓
日付セレクトが表示されるか確認
↓
KABUKI / 任意の日付を選択（保存データが無ければ初回作成）
↓
SIFT_DATA投稿文が表示されるか確認
↓
画像一覧が表示されるか確認
↓
休み設定が動作するか確認
↓
ログが記録されるか確認
```

## 15-2. 編集SIFT_DATA確認フロー

- 「SIFT_DATA原本確認」は原本をそのまま表示（読み取りのみ）。
- 「編集SIFT_DATA確認」「投稿風プレビュー」は画面上の編集テーブル（未保存含む）から生成。
- 差込画像・名前・時間・状態・並び順の変更は「編集保存」で `saveShift` により保存。

## 15-3. 元データから初期化フロー（Phase 1.5）

```text
「元データから初期化」
↓
確認モーダル: 対象店舗・対象日付・失われる内容を表示
  確認欄に「店舗:日付」（例 KABUKI:2026-11-16）を入力するまで実行ボタン無効
  キャンセル → 何も送信しない
↓
resetShiftFromSource(store, date, expectedRevision, confirmation)
  ロック → revision 検証 → SIFT_DATA を再解析 → 新しい世代として保存（直前の世代も KEEP_GENERATIONS の範囲で残る）
↓
結果を画面に表示（人数・rev）
```

対象の店舗×日付以外、SIFT_DATA 原本、旧「画像生成」シートは変更しません。

## 15-4. 保存フロー（Phase 1.5・世代追記 + コミットマーカー）

```text
saveShift(store, date, expectedRevision, rows, requestId)
↓ 認証・認可（POST のみ）
↓ 入力検証（時間・状態・画像ID・人数）
↓ LockService.tryLock(10秒)  失敗 → LOCK_TIMEOUT（書き込みなし）
↓ 管理行を再取得
↓ 同じ requestId が最後の成功更新 → 前回結果を返す（二重更新しない）
↓ expectedRevision ≠ 現在 revision → REVISION_CONFLICT（書き込みなし）
↓ recordId が対象店舗×日付に属するか検証
↓ 未コミット行（revision > 現在）を削除
↓ 新世代 (revision+1) の行を「シフト編集」に追記 → flush
↓ 読み戻して件数・recordId を検証  不一致 → WRITE_VERIFY_FAILED（管理行は旧のまま＝旧データが有効）
↓ 「シフト編集管理」の revision / rowCount / lastRequestId を更新（コミット）→ flush
↓ 古い世代を整理（失敗しても保存は成功）
↓ ロック解放 → 監査ログ
```

読み取り（getSavedShift）はロックを取らず、管理行の revision と一致する行だけを返します。行数が rowCount と異なる場合は `DATA_INCONSISTENT` とし、正常データとして返しません。

## 16. 開発優先順位

1. ドキュメント整備
2. GAS API基盤
3. getConfig
4. getDateList
5. getSiftPreview
6. changeDateAndStore
7. getImageList
8. 休み設定
9. 画像未登録チェック
10. 画像キャッシュ更新
11. UI改善
12. 将来のLINEログイン対応
