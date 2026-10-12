---
name: FavFreak（ファビコンからの逆引き）
category: Webアプリケーションの調査
tags: [フィンガープリント, OSINT, 資産発見]
url: https://github.com/devanshbatham/FavFreak
license: MIT
phase: [recon]
---

## 考え方

ファビコン（`/favicon.ico`）のハッシュは、同じ製品・同じ組織のテンプレートを使っているサイトで一致します。これを Shodan の `http.favicon.hash` で引くと、**同じ基盤で動いている別の資産**が見つかります。

CDN の背後に隠れた実サーバを探すときにも効きます。実サーバは同じファビコンを返すためです。

## 使い方

```bash
cat urls.txt | python3 favfreak.py -o output

# ハッシュを自分で計算する
python3 -c "
import mmh3, requests, codecs
r = requests.get('https://example.com/favicon.ico')
print(mmh3.hash(codecs.encode(r.content, 'base64')))
"
```

得られたハッシュで検索します。

```
# Shodan
http.favicon.hash:-1234567890

# Censys
services.http.response.favicons.md5_hash: "..."
```

## 使いどころ

- 管理画面だけ別ドメインで公開されている構成の発見
- WAF や CDN の裏にある実 IP の推定
- 既知製品の特定（Jenkins、GitLab、Grafana などは既知のハッシュがある）

## 注意点

同じ製品を使う無関係の組織も一致します。**出てきたホストが対象組織のものかは、証明書や WHOIS で確認してから**スコープに含めてください。
