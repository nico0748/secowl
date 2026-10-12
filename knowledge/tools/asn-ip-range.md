---
name: ASN と IP レンジの特定（bgp.he.net / whois）
category: 管理アセットの調査
tags: [ネットワーク, IPレンジ, 資産棚卸し]
url: https://bgp.he.net/
license: 無償
phase: [recon]
---

## 機能

対象組織が自前で IP アドレスを保有している場合、その AS 番号と割り当てられた IP レンジを特定します。レンジが分かれば、ドメイン名を知らないホストも調査対象に入れられます。

## 手順

```bash
# 1. IP から AS 番号を引く
whois -h whois.cymru.com " -v 198.51.100.21"

# 2. AS 番号から広告しているプレフィックスを引く
whois -h whois.radb.net '!gAS64500'

# 3. 組織名から AS を探す（ブラウザ）
#    https://bgp.he.net/search?search[search]=Example+Inc
```

## 使いどころ

- CDN の裏側を探す: ドメインが Cloudflare を指していても、組織自身の AS に実サーバの IP が残っていることがあります
- クラウド利用の確認: IP が AWS や GCP のレンジなら、自前のレンジは持っていません。その場合はこの手法の出番はありません

## 注意点

- **AS に属する IP すべてが診断対象とは限りません。** レンジ全体をスキャンする前に、RoE で対象 IP が明記されているかを確認してください
- 共用クラウドの IP レンジを無差別にスキャンすると、他の利用者の資産に触れます。クラウド事業者の試験ポリシーにも違反します
