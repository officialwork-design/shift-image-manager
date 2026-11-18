#!/usr/bin/env bash
# テスト用 GAS に「エディタへ貼り付けて」反映するための 1 ファイル版を dist-gas-test/ に作る（clasp を使わない場合）。
#   usage: tools/build-test-gas-bundle.sh
#   出力: dist-gas-test/TestBundle.gs（gas/*.gs を名前順に連結）・appsscript.json・BUNDLE_INFO.txt（sha256）
# - このスクリプトは Google に接続しない（ファイルを作るだけ）。本番 GAS への貼り付けは禁止。
# - clasp を使う場合は tools/clasp-test-push.sh（テスト用 ID 必須・本番 ID 拒否）を使うこと。
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TEST_GAS_OUT:-$REPO_DIR/dist-gas-test}"
rm -rf "$OUT"; mkdir -p "$OUT"
{
  echo "// Shift Image Manager — テスト用 GAS 一括ファイル（$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo nogit)）"
  echo "// 本番の Apps Script プロジェクトには貼り付けないこと。APP_ENV=test の Script Properties が必要。"
  for f in $(cd "$REPO_DIR/gas" && ls *.gs | LC_ALL=C sort); do
    echo; echo "// ===== gas/$f ====="; cat "$REPO_DIR/gas/$f"
  done
} > "$OUT/TestBundle.gs"
cp "$REPO_DIR/gas/appsscript.json" "$OUT/appsscript.json"
node -e "new Function(require('fs').readFileSync(process.argv[1],'utf8'))" "$OUT/TestBundle.gs"
{
  echo "commit: $(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo nogit)"
  echo "files:  $(cd "$REPO_DIR/gas" && ls *.gs | wc -l | tr -d ' ')"
  echo "sha256: $( (command -v sha256sum >/dev/null && sha256sum "$OUT/TestBundle.gs" || shasum -a 256 "$OUT/TestBundle.gs") | cut -d' ' -f1)"
  echo "chars:  $(wc -m < "$OUT/TestBundle.gs" | tr -d ' ')"
} > "$OUT/BUNDLE_INFO.txt"
cat "$OUT/BUNDLE_INFO.txt"
