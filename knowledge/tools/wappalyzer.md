---
name: Wappalyzer（技術スタックの特定）
category: Webアプリケーションの調査
tags: [技術スタック, フィンガープリント]
url: https://www.wappalyzer.com/
license: 拡張は無償 / API は有償
phase: [recon]
---

## 機能

ページの HTML・ヘッダ・読み込むスクリプトから、使われている CMS・フレームワーク・ライブラリ・解析ツールを推定します。

| 使い方 | 手段 |
|---|---|
| 1 サイトずつ見る | ブラウザ拡張 |
| 大量に調べる | `httpx -tech-detect`（内部で同等の指紋を使う） |
| CLI | `webanalyze -host example.com` |

```bash
httpx -l urls.txt -silent -tech-detect -json | jq -r '[.url, (.tech//[]|join(","))] | @tsv'
webanalyze -host https://example.com -crawl 2
```

## 使いどころ

特定した技術は、そのまま**調べる脆弱性の優先順位**になります。

| 判明した技術 | 次に見ること |
|---|---|
| WordPress | プラグインの版、`/wp-json/wp/v2/users` によるユーザ列挙 |
| Spring Boot | `/actuator/*` の露出 |
| Laravel | `.env` の露出、`APP_DEBUG` によるスタックトレース |
| jQuery の古い版 | 既知の XSS（`$()` の扱い） |
| GraphQL | イントロスペクションの有効化、クエリの深さ制限 |

SecOwl ではサーフェスの `product` と `tech` に入れておくと、ホーム画面の「テクノロジー」に集計されます。

## 注意点

推定であり、確定ではありません。版まで出た場合でも、発見事項に書く前にほかの根拠（応答ヘッダ、既知のパスの挙動）で裏を取ってください。
