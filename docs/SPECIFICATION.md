# shift-image-manager 仕様書

## 1. システム概要

shift-image-manager は、SIFT_DATA シートに保存された店舗別・日付別の投稿文から出勤キャストを抽出し、Google Drive 内の画像と紐付けて画像シフトを管理する Web システムです。

## 2. 基本構成

```text
GitHub
↓
GitHub Pages
↓
HTML / CSS / JavaScript / Bootstrap 5.3
↓
Google Apps Script WebApp
↓
Google Spreadsheet
↓
Google Drive
```

## 3. 今回の方針

- LIFF URL は現時点では使用しない。
- フロントエンドは GitHub Pages で公開する。
- バックエンドは独立 Google Apps Script プロジェクトで作成する。
- データは Google Spreadsheet に保存する。
- 画像は Google Drive の指定フォルダから取得する。
- UI は Bootstrap 5.3 以上を標準とする。
- `google.script.run` は使用しない。

## 4. 使用サービス

| 区分 | サービス | 用途 |
|---|---|---|
| ソース管理 | GitHub | HTML / CSS / JS / GAS の管理 |
| 公開 | GitHub Pages | フロントエンド公開 |
| API | Google Apps Script WebApp | Spreadsheet / Drive 操作 |
| DB | Google Spreadsheet | 設定・SIFT_DATA・ログ保存 |
| 画像 | Google Drive | キャスト画像保存 |

## 5. URL / ID

| 項目 | 値 |
|---|---|
| GitHub Repository | https://github.com/officialwork-design/shift-image-manager.git |
| GitHub Pages | https://officialwork-design.github.io/shift-image-manager/ |
| GAS Script ID | 1m0G9Y3ATR885RDD1LBEjp5Zsc5Ts4qv_hq1q9kFw3Xe0WmKy5DQVnATS |
| Spreadsheet ID | 1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0 |
| Drive Image Folder ID | 1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR- |

## 6. ID管理方針

ID類は Spreadsheet の `ID管理` シートで管理します。

通常運用で変更する可能性がある値は、Script Properties ではなく `ID管理` シートから読み取ります。

外部公開したくない秘密情報が必要になった場合のみ Script Properties を使用します。

## 7. 主要機能

- 店舗選択
- 日付選択
- SIFT_DATA 投稿文確認
- 出勤キャスト抽出
- Drive画像取得
- 出勤中一覧表示
- 休み設定
- 画像未登録チェック
- 画像キャッシュ更新
- 操作ログ記録
- エラーログ記録

## 8. 店舗仕様

初期対象店舗は以下です。

- KABUKI
- AKIBA

## 9. SIFT_DATA仕様

`SIFT_DATA` シートは以下の構成とします。

```text
1行目: KABUKI
2行目: AKIBA
列方向: 日付別投稿
```

例:

```text
A1: KABUKI 7月1日投稿
B1: KABUKI 7月2日投稿
A2: AKIBA 7月1日投稿
B2: AKIBA 7月2日投稿
```

## 10. 画像取得仕様

Google Drive の `DRIVE_IMAGE_FOLDER_ID` に設定されたフォルダから画像を取得します。

画像ファイル名から拡張子を除いた文字列をキャスト名として扱います。

例:

```text
ひめる.png → ひめる
りさ.jpg → りさ
準備中.png → 準備中
```

キャスト画像が見つからない場合、`準備中` 画像が存在すれば代替表示します。

## 11. UI方針

- Bootstrap 5.3 以上を使用する。
- モバイルファーストで設計する。
- 横スクロールを発生させない。
- card / row / col / modal / toast / alert / spinner / table を優先使用する。
- 独自CSSは最小限にする。

## 12. GitHub運用

```text
GitHub
↓
社内PCに clone / pull
↓
VS Codeで編集
↓
commit / push
↓
GitHub Pages反映
```

## 13. GAS運用

```text
GitHub の gas/*.gs
↓
社内PCで確認
↓
Apps Scriptへコピー
↓
貼り付け
↓
保存
↓
デプロイ
```

## 14. 将来拡張

- LINEログイン
- LIFF
- ユーザー権限管理
- LINE通知
- 画像アップロード
- CSV出力
- PDF出力
- PWA対応
- バックアップ処理
