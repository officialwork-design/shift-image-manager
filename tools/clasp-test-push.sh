#!/usr/bin/env bash
# テスト用 Apps Script プロジェクトにだけ gas/ を反映する（本番の .clasp.json は使わない）
#   usage: TEST_SCRIPT_ID=<テスト用スクリプトID> tools/clasp-test-push.sh [--dry-run]
# 注意: リポジトリ直下で `clasp push` を実行すると本番（.clasp.json）に反映される。テストでは必ずこのスクリプトを使う。
set -euo pipefail
PROD_SCRIPT_ID='1m0G9Y3ATR885RDD1LBEjp5Zsc5Ts4qv_hq1q9kFw3Xe0WmKy5DQVnATS'
TEST_SCRIPT_ID="${TEST_SCRIPT_ID:?TEST_SCRIPT_ID を指定してください（テスト用 Apps Script のスクリプトID）}"
if [[ "$TEST_SCRIPT_ID" == "$PROD_SCRIPT_ID" ]]; then
  echo "本番のスクリプトIDです。中止しました。" >&2
  exit 2
fi
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$REPO_DIR"/gas/*.gs "$REPO_DIR"/gas/appsscript.json "$WORK"/
printf '{"scriptId":"%s","rootDir":"."}\n' "$TEST_SCRIPT_ID" > "$WORK/.clasp.json"
if grep -q "$PROD_SCRIPT_ID" "$WORK/.clasp.json"; then echo "本番IDが含まれています。中止しました。" >&2; exit 2; fi
echo "反映先: テスト用スクリプト $TEST_SCRIPT_ID"
ls -1 "$WORK"
if [[ "${1:-}" == "--dry-run" ]]; then echo "(dry-run: push しません)"; exit 0; fi
(cd "$WORK" && clasp push)
echo "完了。Script Properties に APP_ENV=test と SPREADSHEET_ID（テスト用）が設定されていることを確認してください。"
