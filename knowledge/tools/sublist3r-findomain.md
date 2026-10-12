---
name: Sublist3r / Findomain / Subdomain Finder
category: サブドメイン探索
tags: [サブドメイン, 補助, OSS]
url: https://github.com/aboul3la/Sublist3r
license: GPL-2.0 / MIT
phase: [recon]
---

## 位置づけ

いずれもサブドメイン列挙ツールです。subfinder と Amass で大半は取れるため、**取りこぼしの確認**として併用します。ツールごとに参照する情報源が違うため、結果の差分に意味があります。

| ツール | 特徴 |
|---|---|
| Sublist3r | 検索エンジン（Google, Bing, Baidu）と Netcraft, DNSdumpster を使う。Python 製 |
| Findomain | Rust 製で速い。監視モード（新しいサブドメインの発生を検知）がある |
| Subdomain Finder（c99.nl） | ブラウザから使える。API キー不要で手軽 |

```bash
# Sublist3r
python3 sublist3r.py -d example.com -o sublist3r.txt

# Findomain
findomain -t example.com -u findomain.txt
findomain -t example.com --monitoring-flag   # 継続監視

# 3 つの結果を突き合わせる
sort -u subfinder.txt amass.txt findomain.txt > all.txt
comm -13 <(sort -u subfinder.txt) <(sort -u findomain.txt)   # subfinder で取れなかったもの
```

## 注意点

Sublist3r は更新が止まっている時期があり、検索エンジン側の仕様変更で結果が出ないことがあります。空の結果を「サブドメインが無い」と解釈しないでください。
