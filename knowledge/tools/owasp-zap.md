---
name: OWASP ZAP
category: プロキシ・通信解析
tags: [プロキシ, 自動スキャン, OSS, Web]
url: https://www.zaproxy.org/
license: Apache-2.0（無償）
phase: [survey]
---

## 機能

Burp Suite と同じくプロキシ型の診断ツールです。無償で自動スキャンまで使えるため、Burp の Community 版では足りない自動化を補う位置づけになります。

## 使いどころ

- 予算の都合で Burp Professional を使えない診断対象
- CI に組み込んで、リリースのたびに基本的な検査を回す（`zap-baseline.py`）
- Burp で見た結果の裏取り。別エンジンで同じ所見が出るかを確かめる

## 基本の手順

```bash
# Docker で起動し、受動スキャンだけ回す（非破壊）
docker run --rm -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t https://example.com -r report.html

# 認証つきで回す場合はコンテキストとスクリプトを先に用意する
docker run --rm -v $(pwd):/zap/wrk:rw -t ghcr.io/zaproxy/zaproxy:stable \
  zap-full-scan.py -t https://example.com -n context.context -r report.html
```

## 注意点

- `zap-full-scan.py` は能動スキャンを含みます。データを書き換える要求を送るため、本番環境では RoE の確認が要ります
- 自動スキャンの結果は裏取り前の候補です。そのまま発見事項にせず、手で再現してから起票してください
