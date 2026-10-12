---
name: httpx
category: Webアプリケーションの調査
tags: [必修, 生存確認, 技術スタック, パイプライン]
url: https://github.com/projectdiscovery/httpx
license: MIT（無償）
phase: [recon]
---

## 機能

大量のホスト名や URL に対して HTTP 要求を投げ、生きているものと、その状態・題名・技術スタックを一覧にします。サブドメイン列挙と本格的な診断の間をつなぐツールです。

```bash
# 生存確認と基本情報
httpx -l subs.txt -silent -status-code -title -tech-detect -content-length

# JSON で出す（SecOwl の取り込みに使える形式）
httpx -l subs.txt -silent -json -tech-detect -title > httpx.jsonl

# リダイレクト先まで追う
httpx -l subs.txt -silent -follow-redirects -location

# 特定の応答だけ残す
httpx -l subs.txt -silent -mc 200,401,403 -title

# 管理画面を探す
httpx -l subs.txt -path /admin,/login,/actuator/health -mc 200,401 -silent
```

## SecOwl への取り込み

`-json` の出力をそのまま「偵察 → ツール出力を取り込む」に貼ると、エンドポイントのサーフェスとして登録され、`tech` と `product` も埋まります。

```bash
httpx -l subs.txt -silent -json -tech-detect -title -web-server > httpx.jsonl
```

## 見どころ

| 応答 | 意味 |
|---|---|
| 401 / 403 | 認証がかかっている。**存在することは分かる**ので、認可の検証対象になる |
| 200 だが題名が既定のまま | 構築途中の環境の可能性 |
| 5xx | エラー処理の不備が露出していることがある |
| 同じ content-length が大量 | ワイルドカードまたは共通のエラーページ。除外して絞る |

## 注意点

既定の並列数は高めです。対象が小規模なら `-rate-limit` で絞ってください。
