---
name: Subdomain Takeover の調査（subjack / dnsx）
category: サブドメイン探索
tags: [必修, 乗っ取り, CNAME, 高影響]
url: https://github.com/haccer/subjack
license: MIT
phase: [survey]
---

## 機能

サブドメインの CNAME が外部サービス（S3、GitHub Pages、Heroku、Azure、Netlify など）を指したまま、**その先のリソースが解放されている**状態です。第三者が同じ名前でリソースを作ると、そのサブドメインを自分のものにできます。

成立すると次の被害につながります。

- 正規ドメイン上での偽ページ設置（フィッシングの信頼性が上がる）
- 親ドメインに発行された Cookie の取得（`Domain=.example.com` の場合）
- 正規ドメインのメール・OAuth リダイレクト先としての悪用

## 探し方

```bash
# 1. CNAME が外部サービスを指しているものを抜き出す
dnsx -l subs.txt -cname -resp -silent | grep -Ei 's3|github\.io|herokuapp|azurewebsites|netlify|cloudfront|fastly|surge\.sh'

# 2. subjack で指紋照合する
subjack -w subs.txt -t 50 -timeout 30 -ssl -c fingerprints.json -v -o takeover.txt

# 3. 候補が出たら、HTTP 応答を手で確認する
curl -sI https://old.example.com | head -5
curl -s https://old.example.com | head -20
```

`fingerprints.json` は subjack のリポジトリに同梱されています。サービスの文言は変わるため、最新版を取得してください。

## 判定の注意

**自動ツールの出力をそのまま発見事項にしないでください。** 次の 2 つは別物です。

| 状態 | 判定 |
|---|---|
| CNAME が外部サービスを指し、サービス側が「未登録」の応答を返す | 乗っ取り可能の疑い。**要検証** |
| CNAME が外部サービスを指しているが、正常にコンテンツを返す | 問題なし |

検証は「そのリソース名を自分で取得できるか」で確定しますが、**取得する行為は RoE で明示的に許可されている場合のみ**行ってください。許可がない場合は、応答内容と CNAME の記録までを証跡とし、「乗っ取り可能な状態にある」と報告します。

取得して確認した場合は、**確認後ただちに解放し、その時刻を証跡に残してください**。

## 対策（発見事項に書く内容）

- 使わなくなった外部サービスを解約する前に、先に DNS レコードを削除する
- DNS レコードの棚卸しを定期的に行い、解決できない CNAME を検出する
- 親ドメインに Cookie を発行しない。発行する場合は `Domain` 属性を限定する
