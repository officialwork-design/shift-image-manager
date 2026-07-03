# API仕様書

## 1. 基本方針

GitHub Pages から Google Apps Script WebApp を呼び出します。

GitHub Pages では `google.script.run` は使用できないため、GAS WebApp を API として利用します。

初期実装では、Apps Script WebApp の CORS 制約を避けるため JSONP 方式を標準とします。

## 2. エンドポイント

GAS WebApp のデプロイURLを使用します。

```text
GAS_WEB_APP_URL
```

この値は以下で管理します。

- フロント: `config.js`
- 運用管理: Spreadsheet `ID管理` シート

## 3. リクエスト形式

### JSONP GET

```text
{GAS_WEB_APP_URL}?action=getDateList&payload={...}&callback=callbackName
```

### パラメータ

| パラメータ | 必須 | 内容 |
|---|---:|---|
| action | 必須 | 実行するAPI名 |
| payload | 任意 | JSON文字列化した引数 |
| callback | JSONP時必須 | コールバック関数名 |

## 4. レスポンス形式

すべてのAPIは共通形式で返します。

```json
{
  "success": true,
  "data": {},
  "error": null,
  "timestamp": "2026-07-03 12:00:00"
}
```

エラー時:

```json
{
  "success": false,
  "data": null,
  "message": "エラーメッセージ",
  "error": {
    "message": "エラーメッセージ",
    "action": "getDateList"
  },
  "timestamp": "2026-07-03 12:00:00"
}
```

## 5. Action一覧

| action | 用途 | 状態 |
|---|---|---|
| getConfig | ID管理シートの設定取得 | 必須 |
| getDateList | SIFT_DATAから日付一覧取得 | 必須 |
| getSiftPreview | 選択店舗・日付の投稿文取得 | 必須 |
| changeDateAndStore | 店舗・日付切替とシフト生成 | 必須 |
| getImageList | 画像一覧・出勤/休み一覧取得 | 必須 |
| setCastAbsent | 休み/出勤切替 | 必須 |
| refreshImageCache | Drive画像キャッシュ更新 | 任意 |
| checkImages | 画像未登録チェック | 任意 |

## 6. getConfig

### 用途

`ID管理` シートの設定を取得します。

### payload

```json
{}
```

### data

```json
{
  "appMode": "production",
  "pagesUrl": "https://officialwork-design.github.io/shift-image-manager/",
  "stores": ["KABUKI", "AKIBA"],
  "GITHUB_PAGES_URL": "https://officialwork-design.github.io/shift-image-manager/",
  "DRIVE_IMAGE_FOLDER_ID": "1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-",
  "SHEET_SIFT_DATA": "SIFT_DATA",
  "SHEET_IMAGE_GENERATION": "画像生成",
  "TIMEZONE": "Asia/Tokyo"
}
```

## 7. getDateList

### 用途

SIFT_DATA内の投稿文から日付一覧を抽出します。

### payload

```json
{}
```

### data

```json
["7月1日(水)", "7月2日(木)"]
```

## 8. getSiftPreview

### 用途

選択された店舗・日付に一致するSIFT_DATA投稿文を取得します。

### payload

```json
{
  "store": "KABUKI",
  "date": "7月1日(水)"
}
```

### data

```json
{
  "store": "KABUKI",
  "date": "7月1日(水)",
  "posts": [
    {
      "label": "KABUKI / 7月1日(水) / A",
      "cell": "A1",
      "text": "投稿文"
    }
  ],
  "postText": "投稿文",
  "cell": "A1"
}
```

## 9. changeDateAndStore

### 用途

店舗・日付を切り替え、SIFT_DATAからキャストを抽出して画像生成シートに反映します。

### payload

```json
{
  "store": "KABUKI",
  "date": "7月1日(水)"
}
```

### data

```json
{
  "store": "KABUKI",
  "date": "7月1日(水)",
  "castNames": ["ひめる", "りさ"],
  "count": 2
}
```

## 10. getImageList

### 用途

現在の画像生成シートから、画像一覧・出勤中・休み設定を取得します。

### payload

```json
{
  "store": "KABUKI",
  "date": "7月1日(水)"
}
```

`store` / `date` が未指定の場合は、画像生成シートの `C1` / `A1` を使用します。

### data

```json
{
  "selectedStore": "KABUKI",
  "selectedDate": "7月1日(水)",
  "activeCastList": [],
  "absentCastList": [],
  "missingImages": [],
  "updatedAt": "12:00:00"
}
```

## 11. setCastAbsent

### 用途

指定行のキャストを休み、または出勤に切り替えます。

### payload

```json
{
  "row": 3,
  "isAbsent": true
}
```

### data

```json
{
  "success": true
}
```

## 12. refreshImageCache

### 用途

Google Driveの画像ファイル一覧を再取得し、キャッシュします。

### payload

```json
{}
```

### data

```json
{
  "success": true,
  "imageCount": 30,
  "hasPreparingImage": true
}
```

## 13. checkImages

### 用途

現在の出勤キャストに対して画像未登録をチェックします。

### payload

```json
{}
```

### data

```json
{
  "missingCount": 2,
  "missingNames": ["体入アマ", "体入リア"]
}
```

## 14. エラー処理

GAS側で例外が発生した場合、エラー内容を `エラーログ` シートへ保存します。

フロント側では toast または alert で表示します。

## 15. 注意事項

- GitHub Pages側に秘密情報は置かない。
- GAS_WEB_APP_URLは公開前提で扱う。
- データ改ざん対策が必要になった場合は認証機能を追加する。
- 将来的にLINEログインを入れる場合は userId をpayloadに含め、GAS側で権限チェックする。
