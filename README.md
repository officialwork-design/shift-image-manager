# shift-image-manager

SIFT_DATA の投稿文から店舗・日付別の出勤キャストを抽出し、Google Drive の画像と紐付けて画像シフトを管理する Web システムです。

## 構成

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

## 公開URL

```text
https://officialwork-design.github.io/shift-image-manager/
```

## 関連URL

| 種別 | URL / ID |
|---|---|
| GitHub | https://github.com/officialwork-design/shift-image-manager.git |
| GitHub Pages | https://officialwork-design.github.io/shift-image-manager/ |
| GAS Script ID | 1m0G9Y3ATR885RDD1LBEjp5Zsc5Ts4qv_hq1q9kFw3Xe0WmKy5DQVnATS |
| Spreadsheet ID | 1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0 |
| Drive Image Folder ID | 1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR- |
| Drive Additional Image Folder ID | 17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ |

## 方針

- LIFF URL は現時点では使用しない。
- フロントエンドは GitHub Pages で公開する。
- バックエンドは Google Apps Script WebApp とする。
- データは Google Spreadsheet で管理する。
- 画像は Google Drive の指定フォルダから取得する。追加取得フォルダは `DRIVE_IMAGE_FOLDER_IDS` で複数指定できる。
- UI は Bootstrap 5.3 以上を標準とする。
- GitHub Pages では `google.script.run` を使用しない。

## ディレクトリ構成

```text
shift-image-manager/
├── index.html
├── config.js
├── .clasp.json
├── README.md
├── assets/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── api.js
│       └── app.js
├── docs/
│   ├── SPECIFICATION.md
│   ├── API.md
│   ├── SHEET.md
│   └── FLOW.md
└── gas/
    ├── Code.gs
    ├── ApiRouter.gs
    ├── ConfigService.gs
    ├── SpreadsheetService.gs
    ├── SiftService.gs
    ├── ImageService.gs
    ├── ShiftService.gs
    ├── LogService.gs
    ├── Utils.gs
    └── appsscript.json
```

## ドキュメント

| ファイル | 内容 |
|---|---|
| docs/SPECIFICATION.md | システム仕様 |
| docs/API.md | API仕様 |
| docs/SHEET.md | Spreadsheet設計 |
| docs/FLOW.md | 処理フロー |

## 開発フロー

```text
GitHub
↓
社内PCに clone / pull
↓
VS Codeで編集
↓
git add .
↓
git commit
↓
git push
↓
GitHub Pages反映
```

## GAS反映フロー

```text
社内PCで gas/*.gs / gas/appsscript.json を編集
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

手動コピーが必要な場合のみ、以下の流れを使います。

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

## 初回セットアップ

```bash
git clone https://github.com/officialwork-design/shift-image-manager.git
cd shift-image-manager
```

GitHub Pages は `main` ブランチのルートを公開対象にします。

## clasp 運用

このリポジトリは `.clasp.json` で `rootDir` を `gas` に設定しています。

```bash
clasp login
clasp status
clasp push
clasp deploy
```

- GAS側へ反映するファイルは `gas/` 配下のみです。
- `appsscript.json` は `gas/appsscript.json` を正とします。
- WebアプリURLは公開前提の値として `ID管理` シートと `config.js` に設定します。
- 秘密情報が必要になった場合のみ、Apps Script の Script Properties を使用します。
- GitHub Pages からは JSONP / WebApp API を呼び、`google.script.run` は使用しません。

## Spreadsheet

使用する主なシートは以下です。

- ID管理
- 仕様書
- 画像生成
- SIFT_DATA
- 画像操作ログ
- 画像チェック
- エラーログ

## SIFT_DATA 形式

```text
1行目: KABUKI
2行目: AKIBA
列方向: 日付別投稿
```

## 画像取得フォルダー

通常運用では `画像登録` シートの内容を画像照合元として使用します。列は `名前 / ファイルID / ファイルURL / サムネイルURL / フォルダ名 / 更新日` です。

`画像登録` にない画像は、従来通りDriveフォルダーからも取得します。

Driveフォルダーの全走査は `ID管理` の `ENABLE_DRIVE_IMAGE_SCAN` が `true` の場合のみ実行します。通常はタイムアウト回避のため `false` で運用します。

画像取得元は `ID管理` シートの `DRIVE_IMAGE_FOLDER_ID` を主フォルダーとして使用します。

追加フォルダーは `DRIVE_IMAGE_FOLDER_IDS` にカンマ区切りまたは改行区切りで指定できます。フォルダーIDだけでなく、Google Drive のフォルダーURLも指定できます。指定フォルダー配下のサブフォルダーも画像取得対象です。

```text
17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ
```

画像登録UIでは、ローカルファイルを選択して大阪/東京フォルダーへ保存し、同時に `画像登録` シートへ追記します。既にDriveへ保存済みの画像だけを登録したい場合は、補助欄のDriveファイルIDまたはURLを使用します。

```text
名前 / ファイルID / ファイルURL / サムネイルURL / フォルダ名 / 更新日
```

## 実装順

1. README / docs 整備
2. GAS API基盤
3. getConfig
4. getDateList
5. getSiftPreview
6. changeDateAndStore
7. getImageList
8. 休み設定
9. 画像登録
10. 画像未登録チェック
11. 画像キャッシュ更新
12. UI改善

## 注意事項

- GitHub Pages側に秘密情報を置かない。
- GAS WebApp URL は公開前提で扱う。
- 秘密情報が必要な場合は Script Properties を使う。
- 運用で変更するIDやシート名は Spreadsheet の ID管理シートを優先する。
