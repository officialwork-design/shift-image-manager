#!/usr/bin/env bash
# GAS WebApp の HTTP 挙動を確認する（テスト環境の URL にのみ使用すること）
#   usage: tools/cors-probe/curl-check.sh <TEST_GAS_WEB_APP_URL> [https://<テスト用ページのオリジン>]
# 確認項目:
#   1) POST(text/plain) の応答が 302 で、302 応答自体に Access-Control-Allow-Origin があるか
#   2) 転送先（GET）が JSON と Access-Control-Allow-Origin を返すか
#   3) OPTIONS（プリフライト）への応答（GAS は処理できない想定）
#   4) 認証なしの保護 API が JSON の AUTH_REQUIRED を返すか
set -euo pipefail
URL="${1:?テスト用 GAS WebApp URL を指定してください}"
ORIGIN="${2:-https://example.test}"
PROD_DEPLOYMENT='AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_'
if [[ "$URL" == *"$PROD_DEPLOYMENT"* ]]; then
  echo "本番の WebApp URL です。このスクリプトは本番に使用できません。" >&2
  exit 2
fi

echo "== 1) POST text/plain（リダイレクトを追わない）"
curl -sS -o /dev/null -D - -X POST "$URL" -H "Origin: $ORIGIN" -H 'Content-Type: text/plain;charset=utf-8' \
  --data '{"action":"getPublicConfig","payload":{}}' | grep -iE '^(HTTP/|location:|access-control-allow-origin:)' || true

echo; echo "== 2) リダイレクトを追って最終応答（GET）を確認"
curl -sS -L -D - -X POST "$URL" -H "Origin: $ORIGIN" -H 'Content-Type: text/plain;charset=utf-8' \
  --data '{"action":"getPublicConfig","payload":{}}' --post302 -o /tmp/cors-probe-body.txt | grep -iE '^(HTTP/|location:|access-control-allow-origin:|content-type:)' || true
echo "--- body"; head -c 400 /tmp/cors-probe-body.txt; echo
echo "（注）ブラウザは 302 の後を GET で取得する。--post302 なしの結果も確認すること:"
curl -sS -L -o - -X POST "$URL" -H "Origin: $ORIGIN" -H 'Content-Type: text/plain;charset=utf-8' --data '{"action":"getPublicConfig","payload":{}}' | head -c 400; echo

echo; echo "== 3) OPTIONS（プリフライト）"
curl -sS -o /dev/null -D - -X OPTIONS "$URL" -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' | grep -iE '^(HTTP/|access-control-)' || true

echo; echo "== 4) 認証なしの保護 API（AUTH_REQUIRED を期待）"
curl -sS -L -X POST "$URL" -H "Origin: $ORIGIN" -H 'Content-Type: text/plain;charset=utf-8' \
  --data '{"action":"whoAmI","payload":{}}' | head -c 400; echo
