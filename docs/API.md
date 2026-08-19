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

### iframe postMessage POST

画像アップロードなどURL長制限に当たる処理は、GitHub Pages から hidden iframe の `multipart/form-data` フォームPOSTで送信します。Apps Script WebApp のCORS制約を避けるため、GASはHTMLレスポンス内の `postMessage` で親画面へ処理結果を返します。

```text
action=uploadImageFile
name=あいな
folderKey=osaka
fileName=source.jpg
mimeType=image/jpeg
imageFile=(binary)
responseMode=postMessage
messageId=...
parentOrigin=https://officialwork-design.github.io
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
| updateShiftRows | 編集テーブルの一括保存 | 必須 |
| setCastAbsent | 休み/出勤切替 | 必須 |
| registerImage | 画像登録シートへのDrive画像登録 | 任意 |
| uploadImage | Drive画像フォルダへの画像追加（dataURL互換） | 任意 |
| uploadImageFile | Drive画像フォルダへの画像追加（ファイルフォーム） | 任意 |
| verifyImageUpload | 画像追加後のDrive反映確認 | 任意 |
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
  "DRIVE_IMAGE_FOLDER_IDS": "17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ",
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
JSONPレスポンス軽量化のため、画像はbase64 dataURLではなくGoogle DriveサムネイルURLで返します。

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
  "editRows": [
    {
      "sortOrder": 1,
      "castName": "ひめる",
      "workTime": "18:00",
      "status": "出勤",
      "imageStatus": "登録済み",
      "imageFileId": "",
      "imageSource": "auto"
    }
  ],
  "imageOptions": [
    {
      "fileId": "drive-file-id",
      "name": "ひめる",
      "imageUrl": "https://drive.google.com/thumbnail?id=drive-file-id&sz=w120"
    }
  ],
  "missingImages": [],
  "updatedAt": "12:00:00"
}
```

`activeCastList[].imageUrl` は以下の形式です。

```text
https://drive.google.com/thumbnail?id={fileId}&sz=w600
```

## 11. updateShiftRows

### 用途

編集テーブルの行データを画像生成シートへ保存します。

`imageFileId` を指定すると、キャスト名による自動照合より優先して、そのDrive画像を出力画像に差し込みます。

### payload

```json
{
  "rows": [
    {
      "sortOrder": 1,
      "castName": "手入力キャスト",
      "workTime": "18:00",
      "status": "出勤",
      "imageFileId": "drive-file-id"
    }
  ]
}
```

### data

```json
{
  "success": true,
  "count": 1,
  "editRows": []
}
```

## 12. setCastAbsent

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

## 13. registerImage

### 用途

既にDriveへ保存済みの画像を `画像登録` シートへ登録します。通常UIではローカルファイル選択による `uploadImageFile` を使用し、このAPIは既存Drive画像を後から登録する補助用です。

登録シートの列は `名前 / ファイルID / ファイルURL / サムネイルURL / フォルダ名 / 更新日` です。

### payload

```json
{
  "name": "めう.jpeg",
  "fileIdOrUrl": "https://drive.google.com/file/d/1x8GjrSXNH-XOYmWnbEZoeO9E_7DhxdVs/view?usp=drivesdk",
  "folderKey": "tokyo"
}
```

### data

```json
{
  "success": true,
  "name": "めう.jpeg",
  "fileId": "1x8GjrSXNH-XOYmWnbEZoeO9E_7DhxdVs",
  "fileUrl": "https://drive.google.com/file/d/1x8GjrSXNH-XOYmWnbEZoeO9E_7DhxdVs/view?usp=drivesdk",
  "thumbnailUrl": "https://drive.google.com/thumbnail?id=1x8GjrSXNH-XOYmWnbEZoeO9E_7DhxdVs&sz=w1000",
  "folderName": "東京",
  "updatedAt": "2026/08/19",
  "row": 2
}
```

同じ `ファイルID` が既に登録されている場合は既存行を更新します。登録後は画像キャッシュを破棄し、`getImageList` の画像候補・自動照合に反映します。

## 14. uploadImage / uploadImageFile

### 用途

GitHub Pages からローカル画像ファイルを追加し、選択したDrive画像フォルダへ保存します。

通常UIでは `uploadImageFile` を使用します。保存後はDriveフォルダにファイルを作成し、同じ内容を `画像登録` シートへ追記または更新します。`registerImage` は既存Drive画像のファイルID/URLを登録する補助用です。

`uploadImageFile` はファイル入力を `multipart/form-data` で送信します。`uploadImage` はdataURL互換用として残します。保存ファイル名は `name + 元画像の拡張子` です。

GitHub Pages から通常の `fetch POST` はCORSで失敗しやすいため使用しません。送信前にJSONPで `uploadImageFile` action の存在だけ確認し、`Unknown action: uploadImageFile` の場合は Apps Script の再デプロイが必要です。

### payload（uploadImageFile）

```text
name=あいな
folderKey=osaka
fileName=source.jpg
mimeType=image/jpeg
imageFile=(binary)
```

### payload（uploadImage）

```json
{
  "name": "あいな",
  "folderKey": "osaka",
  "fileName": "source.jpg",
  "mimeType": "image/jpeg",
  "dataUrl": "data:image/jpeg;base64,..."
}
```

`folderKey`:

| 値 | 保存先 |
|---|---|
| osaka | 大阪フォルダ |
| tokyo | 東京フォルダ |

### data

```json
{
  "success": true,
  "name": "あいな",
  "fileName": "あいな.jpg",
  "fileId": "drive-file-id",
  "folderKey": "osaka",
  "folderLabel": "大阪",
  "imageUrl": "https://drive.google.com/thumbnail?id=drive-file-id&sz=w600",
  "uploadLogSpreadsheetId": "1QivIBngvbskj7oNbToliE9_aq3Gke74VyrL37zU7qac",
  "uploadLogSheetName": "画像保存記録"
}
```

`uploadImageFile` はGASのHTMLレスポンスから `postMessage` で成否を受け取ります。送信後は `refreshImageCache` を呼ばず、`getImageList` をJSONPで再取得します。画像照合元は通常 `画像登録` シートのため、全Drive走査によるAPI timeoutを避けます。

保存記録は `IMAGE_UPLOAD_LOG_SPREADSHEET_ID` のSpreadsheetに追記します。記録のみ失敗した場合はアップロードを成功扱いにし、`エラーログ` に記録します。

## 15. verifyImageUpload

### 用途

選択フォルダに `name + 元画像の拡張子` の画像が存在するか確認します。

アップロード前に既存の同名ファイルIDを取得し、アップロード後は `excludeFileIds` に渡すことで、新規追加されたファイルだけを成功判定に使います。

### payload

```json
{
  "name": "あいな",
  "folderKey": "osaka",
  "fileName": "source.jpg",
  "mimeType": "image/jpeg",
  "excludeFileIds": ["existing-drive-file-id"]
}
```

### data

```json
{
  "found": true,
  "name": "あいな",
  "fileName": "あいな.jpg",
  "folderKey": "osaka",
  "folderLabel": "大阪",
  "folderId": "17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ",
  "fileId": "new-drive-file-id",
  "imageUrl": "https://drive.google.com/thumbnail?id=new-drive-file-id&sz=w600",
  "matches": [],
  "newMatches": []
}
```

## 16. refreshImageCache

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
  "hasPreparingImage": true,
  "folderCount": 2,
  "fileCount": 31,
  "folderIds": ["1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-"],
  "folderErrors": []
}
```

## 17. checkImages

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

## 18. エラー処理

GAS側で例外が発生した場合、エラー内容を `エラーログ` シートへ保存します。

フロント側では toast または alert で表示します。

## 19. 注意事項

- GitHub Pages側に秘密情報は置かない。
- GAS_WEB_APP_URLは公開前提で扱う。
- データ改ざん対策が必要になった場合は認証機能を追加する。
- 将来的にLINEログインを入れる場合は userId をpayloadに含め、GAS側で権限チェックする。
