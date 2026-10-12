---
name: 過去の URL の収集（Wayback Machine / gau / katana / Google Web Cache）
category: Webアプリケーションの調査
tags: [必修, URL収集, アーカイブ, 偵察]
url: https://github.com/lc/gau
license: MIT
phase: [recon]
---

## 考え方

現在のサイトからリンクをたどるだけでは、**消されたページ・古い API・パラメータつきの URL**は見つかりません。アーカイブと各種データベースに残った過去の URL を集めると、探索の起点が大幅に増えます。

## gau（Get All URLs）

Wayback Machine、Common Crawl、AlienVault OTX、urlscan.io をまとめて引きます。

```bash
gau example.com | sort -u > urls.txt

# サブドメインも含める
gau --subs example.com | sort -u > urls.txt

# パラメータを持つ URL だけ
gau --subs example.com | grep '=' | sort -u > params.txt

# 拡張子で絞る
gau --subs example.com | grep -E '\.(js|json|xml|bak|old|zip|sql)(\?|$)'
```

同種のツールに `waybackurls`（Wayback のみ）があります。

## katana（能動クロール）

現在のサイトを実際に巡回し、JS の中まで読んでエンドポイントを抽出します。

```bash
katana -u https://example.com -jc -d 3 -silent -o katana.txt
katana -u https://example.com -jc -kf all -silent      # robots.txt や sitemap も使う
```

`-jc` が JavaScript のクロールです。SPA では必須です。

## Wayback Machine を直接引く

```bash
curl -s 'http://web.archive.org/cdx/search/cdx?url=*.example.com&output=text&fl=original&collapse=urlkey' > wayback.txt
```

ブラウザからは <https://web.archive.org/web/*/example.com*> で一覧できます。

## Google Web Cache

Google のキャッシュは現在縮小傾向にあるため、補助として扱ってください。代替として `urlscan.io` の過去スキャン、Bing のキャッシュ、archive.today があります。

```
site:example.com -inurl:www           # 検索演算子でサブドメインを探す
site:example.com filetype:pdf
site:example.com inurl:admin
```

## 集めた URL の使い方

```bash
# 生きているものだけ残す
cat urls.txt | httpx -silent -mc 200,401,403 > alive.txt

# パラメータ名を抽出して、ファジングの辞書にする
grep -oP '(?<=[?&])[a-zA-Z0-9_\-]+(?==)' urls.txt | sort -u > params-wordlist.txt

# JS ファイルから API のパスを拾う
grep -E '\.js(\?|$)' urls.txt | httpx -silent | while read u; do
  curl -s "$u" | grep -oE '"/[a-zA-Z0-9_/.-]{4,}"'
done | sort -u
```

## 注意点

アーカイブには当時の資格情報やトークンが残っていることがあります。見つけた場合は、**値そのものを報告書に書かず**、該当 URL と「有効なトークンが露出している」事実を示してください。
