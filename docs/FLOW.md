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
getConfig 実行
↓
getDateList 実行
↓
店舗・日付セレクトを初期化
↓
画面を操作可能にする
```

## 3. 店舗・日付選択フロー

```text
ユーザーが店舗を選択
↓
ユーザーが日付を選択
↓
両方が選択済みか確認
↓
ローディング表示
↓
changeDateAndStore 実行
↓
SIFT_DATAから対象投稿を検索
↓
投稿文からキャスト名を抽出
↓
画像生成シート H3:H38 に反映
↓
休み設定を初期化
↓
getImageList 実行
↓
画像一覧・出勤一覧・休み一覧を再描画
↓
ローディング非表示
```

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
@以降を削除
↓
絵文字・記号を削除
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
ID管理シートから DRIVE_IMAGE_FOLDER_ID を取得
↓
Google Drive フォルダ内のファイルを取得
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

## 8. 休み設定フロー

```text
ユーザーが休みボタンを押す
↓
確認ダイアログ表示
↓
setCastAbsent 実行
↓
対象行の I列 に "休み" をセット
↓
画像一覧を再取得
↓
出勤一覧から除外
↓
休み一覧に表示
↓
操作ログを保存
```

出勤に戻す場合は、対象行の I列 を空欄に戻します。

## 9. 画像未登録チェックフロー

```text
現在のキャスト一覧を取得
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
Driveフォルダを再スキャン
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

## 14. デプロイ確認フロー

```text
GitHub Pagesを開く
↓
画面が表示されるか確認
↓
店舗セレクトが表示されるか確認
↓
日付セレクトが表示されるか確認
↓
KABUKI / 7月1日(水) を選択
↓
SIFT_DATA投稿文が表示されるか確認
↓
画像一覧が表示されるか確認
↓
休み設定が動作するか確認
↓
ログが記録されるか確認
```

## 15. 開発優先順位

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
