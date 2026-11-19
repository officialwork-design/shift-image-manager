#!/usr/bin/env bash
# 本番フロント（GitHub Pages に公開する index.html / assets / config.js）を確認用に dist-prod/ に作る（Google・GitHub には接続しない）。
#   usage: tools/build-prod-site.sh                      → 本番 WebApp（既存デプロイ）に接続
#          PROD_GAS_WEB_APP_URL=<本番プロジェクトの確認用デプロイ URL> PROD_SITE_OUT=<dir> tools/build-prod-site.sh
#            → 公開前の確認用（同じ本番 GAS プロジェクトの別デプロイ。GitHub Pages の staging/ に置くと本番と同じオリジンで確認できる）
# - index.html の ?v=... をビルドごとの値に置き換える（ブラウザが古い JS を使わないように）
# - テスト用の WebApp・OAuth クライアント・localhost が含まれていたら中止
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${PROD_SITE_OUT:-$REPO_DIR/dist-prod}"
PROD_URL='https://script.google.com/macros/s/AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_/exec'
URL="${PROD_GAS_WEB_APP_URL:-$PROD_URL}"
if [[ ! "$URL" =~ ^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$ ]]; then echo "WebApp URL の形式が不正です。" >&2; exit 2; fi
COMMIT="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo nogit)"
STAMP="$(date +%Y%m%d%H%M%S)"
TAG="${COMMIT}-${STAMP}"
rm -rf "$OUT"; mkdir -p "$OUT"
sed -E "s/\?v=[A-Za-z0-9._-]+/?v=${TAG}/g" "$REPO_DIR/index.html" > "$OUT/index.html"
cp -R "$REPO_DIR/assets" "$OUT/"
sed -e "s#GAS_WEB_APP_URL: '[^']*'#GAS_WEB_APP_URL: '${URL}'#" -e "s#VERSION: '[^']*'#VERSION: '${TAG}'#" "$REPO_DIR/config.js" > "$OUT/config.js"
grep -q "APP_ENV: 'production'" "$OUT/config.js" || { echo "config.js の APP_ENV が production ではありません。中止しました。" >&2; rm -rf "$OUT"; exit 2; }
grep -q "${URL}" "$OUT/config.js" || { echo "config.js に接続先を設定できませんでした。" >&2; rm -rf "$OUT"; exit 2; }
if grep -rqE '[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com|localhost:[0-9]+|-test'"'" "$OUT"; then echo "テスト用の値が含まれています。中止しました。" >&2; rm -rf "$OUT"; exit 2; fi
{
  echo "commit: ${COMMIT}"
  echo "built:  ${STAMP}"
  echo "asset:  ?v=${TAG}"
  echo "gas:    ${URL}"
} > "$OUT/BUILD_INFO.txt"
cat "$OUT/BUILD_INFO.txt"
