---
name: interactsh（帯域外の検知）
category: Webアプリケーションの調査
tags: [SSRF, ブラインド, OOB, OSS]
url: https://github.com/projectdiscovery/interactsh
license: MIT
phase: [survey]
---

## 機能

応答に結果が返らない脆弱性（ブラインド SSRF、ブラインド XXE、ブラインド SQL インジェクション、ブラインド RCE）を確かめるには、**対象サーバから自分宛に通信させる**必要があります。その受け口になるのが interactsh です。

DNS・HTTP・SMTP の着信を記録し、どの検証からの通信かを一意の識別子で区別します。

## 使い方

```bash
# クライアントを起動すると固有のドメインが払い出される
interactsh-client -v
# → c7xk2j....oast.fun

# そのドメインを検証対象に埋め込む
curl 'https://example.com/fetch?url=http://c7xk2j....oast.fun/probe1'

# nuclei と組み合わせる
nuclei -l urls.txt -tags ssrf,oob
```

着信があれば、対象サーバがその URL へ接続したことの証拠になります。

## 自前で立てる

公開サーバを使うと、検証内容が第三者のサーバに記録されます。秘匿性の高い診断対象では自前で立ててください。

```bash
interactsh-server -domain oob.example-test.jp -ldip <サーバの IP>
interactsh-client -server https://oob.example-test.jp
```

必要な DNS 設定は、`oob.example-test.jp` の NS をそのサーバに向けることです。

## 証跡の取り方

- 送った要求（埋め込んだ識別子が分かるもの）
- 着信の記録（時刻、送信元 IP、プロトコル）

この 2 つが揃うと、第三者が再現できる根拠になります。

## 注意点

公開の `oast.fun` を使うと、**対象サーバの IP アドレスと内部の挙動が外部サービスに記録されます。** 顧客の情報が外部に出ることになるため、RoE で許容されているかを確認してください。
