#!/usr/bin/env bash
# テスト用 Apps Script プロジェクトにだけ gas/ を反映する（本番の .clasp.json は使わない）
#
#   usage: TEST_SCRIPT_ID=<テスト用スクリプトID> \
#          TEST_SPREADSHEET_ID=<テスト用スプレッドシートID> \
#          TEST_DRIVE_FOLDER_ID=<テスト用 Drive フォルダID> \
#          tools/clasp-test-push.sh [--dry-run] [--yes]
#
# - 3つの ID はすべて必須。どれかが本番の ID、または ID どうしが同じなら中止する。
# - 反映先と、Script Properties / ID管理シートに設定すべき値を表示してから確認を求める（--yes で省略）。
# - リポジトリ直下で `clasp push` を実行すると本番（.clasp.json）に反映されるため、テストでは必ずこのスクリプトを使う。
set -euo pipefail

PROD_SCRIPT_ID='1m0G9Y3ATR885RDD1LBEjp5Zsc5Ts4qv_hq1q9kFw3Xe0WmKy5DQVnATS'
PROD_SPREADSHEET_ID='1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0'
PROD_FOLDER_IDS=('1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-' '17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ')
PROD_DEPLOYMENT='AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_'
ALL_PROD=("$PROD_SCRIPT_ID" "$PROD_SPREADSHEET_ID" "${PROD_FOLDER_IDS[@]}" "$PROD_DEPLOYMENT")

die() { echo "中止: $*" >&2; exit 2; }

DRY_RUN=0; YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes) YES=1 ;;
    *) die "不明な引数: $arg" ;;
  esac
done

TEST_SCRIPT_ID="${TEST_SCRIPT_ID:-}"
TEST_SPREADSHEET_ID="${TEST_SPREADSHEET_ID:-}"
TEST_DRIVE_FOLDER_ID="${TEST_DRIVE_FOLDER_ID:-}"
[[ -n "$TEST_SCRIPT_ID" ]] || die "TEST_SCRIPT_ID が未指定です"
[[ -n "$TEST_SPREADSHEET_ID" ]] || die "TEST_SPREADSHEET_ID が未指定です"
[[ -n "$TEST_DRIVE_FOLDER_ID" ]] || die "TEST_DRIVE_FOLDER_ID が未指定です"
for v in "$TEST_SCRIPT_ID" "$TEST_SPREADSHEET_ID" "$TEST_DRIVE_FOLDER_ID"; do
  [[ "$v" =~ ^[A-Za-z0-9_-]{10,}$ ]] || die "ID の形式が不正です: $v"
  for p in "${ALL_PROD[@]}"; do [[ "$v" != "$p" ]] || die "本番の ID が指定されています: $v"; done
done
[[ "$TEST_SCRIPT_ID" != "$TEST_SPREADSHEET_ID" && "$TEST_SPREADSHEET_ID" != "$TEST_DRIVE_FOLDER_ID" && "$TEST_SCRIPT_ID" != "$TEST_DRIVE_FOLDER_ID" ]] \
  || die "3つの ID に同じ値があります"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$REPO_DIR"/gas/*.gs "$REPO_DIR"/gas/appsscript.json "$WORK"/
printf '{"scriptId":"%s","rootDir":"."}\n' "$TEST_SCRIPT_ID" > "$WORK/.clasp.json"
for p in "${ALL_PROD[@]}"; do ! grep -q "$p" "$WORK/.clasp.json" || die ".clasp.json に本番の ID が含まれています"; done

cat <<MSG
================ 反映内容の確認 ================
反映先（テスト用 Apps Script）: $TEST_SCRIPT_ID
  https://script.google.com/home/projects/$TEST_SCRIPT_ID/edit
反映するファイル: $(ls "$WORK" | grep -v '^\.clasp' | tr '\n' ' ')

反映後に設定する値（Script Properties）:
  APP_ENV         = test
  SPREADSHEET_ID  = $TEST_SPREADSHEET_ID
  AUTH_MODE       = google_id_token
  GOOGLE_OAUTH_CLIENT_ID = <テスト用 OAuth クライアントID>
テスト用スプレッドシートの ID管理シート:
  DRIVE_IMAGE_FOLDER_ID = $TEST_DRIVE_FOLDER_ID
================================================
MSG

if [[ $DRY_RUN -eq 1 ]]; then echo "(dry-run: push しません)"; exit 0; fi
if [[ $YES -ne 1 ]]; then
  read -r -p "上記のテスト用プロジェクトに反映します。よろしいですか？ [yes/no] " ans
  [[ "$ans" == "yes" ]] || die "キャンセルしました"
fi
command -v clasp >/dev/null || die "clasp がインストールされていません（npm i -g @google/clasp）"
(cd "$WORK" && clasp push --force)
echo "完了。Script Properties に APP_ENV=test と SPREADSHEET_ID（テスト用）を設定してから実行してください。"
