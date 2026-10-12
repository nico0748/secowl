---
name: Shodan / Censys（インターネット全体のスキャンデータ）
category: ポートスキャン
tags: [必修, OSINT, パッシブ, 資産棚卸し]
url: https://www.shodan.io/
license: 商用（無償枠あり）
phase: [recon]
---

## 機能

インターネット全体を継続的にスキャンした結果を検索します。**対象へパケットを一切送らずに**、開いているポート・サービス・証明書・バナーを知ることができます。RoE 承認前の下調べに使える数少ない手段です。

## Shodan のクエリ例

```
ssl.cert.subject.CN:"example.com"      # 証明書の CN で引く
org:"Example Inc"                      # 組織名
net:198.51.100.0/24                    # IP レンジ
hostname:example.com port:8080
http.favicon.hash:-1234567890          # ファビコンのハッシュで同一基盤を探す
product:"Apache Tomcat" country:JP
```

```bash
shodan search --fields ip_str,port,org 'ssl.cert.subject.CN:"example.com"'
shodan host 198.51.100.21
```

## Censys のクエリ例

```
services.tls.certificates.leaf_data.subject.common_name: "example.com"
services.port: 8080 and services.service_name: HTTP
autonomous_system.organization: "Example Inc"
```

## 使いどころ

- 顧客が把握していない公開資産の発見（管理画面、開発環境、古い機器）
- CDN の背後にある実 IP の推定（証明書が同じホストを探す）
- 管理インターフェースが外部公開されていないかの確認

## 注意点

- データには観測時点があります。**現在も開いているとは限りません。** 発見事項にする前に、承認を得たうえで実機で確認してください
- 無償枠では結果が絞られます。件数が 0 でも「無い」とは言えません
- 検索結果に他組織の資産が混ざります。スコープ外のホストには接続しないでください
