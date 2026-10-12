---
name: CyberChef
category: Webアプリケーションの調査
tags: [エンコード, 補助, ブラウザ]
url: https://gchq.github.io/CyberChef/
license: Apache-2.0
phase: [survey, triage]
---

## 機能

エンコード・復号・ハッシュ・整形などの処理を並べて実行します。診断中に出てくる「この文字列は何か」を調べるときに使います。

## よく使う操作

| 場面 | レシピ |
|---|---|
| JWT の中身を見る | `Split('.')` → `From Base64` |
| URL の多重エンコード | `URL Decode` を繰り返し適用 |
| 難読化された JS | `JavaScript Beautify` → `From Charcode` |
| Cookie の中身 | `From Base64` → `Gunzip` |
| ハッシュの種類を当てる | `Analyse hashes` |
| バイト列から画像を復元 | `From Hex` → `Render Image` |
| XSS の検証文字列を作る | `To HTML Entity` / `To Unicode Escape` |

## オフラインで使う

診断中のデータを外部サイトに貼るのは避けるべきです。**手元で動かしてください。**

```bash
# ダウンロード版を使う
curl -LO https://github.com/gchq/CyberChef/releases/latest/download/CyberChef_v10.19.4.zip
unzip CyberChef_*.zip && open CyberChef_*.html

# Docker
docker run -d -p 8000:8000 mpepping/cyberchef
```

## 注意点

公開版（gchq.github.io）は処理をブラウザ内で行いますが、**顧客のトークンや個人情報を貼る行為自体が持ち出しにあたる**と判断される場合があります。診断対象のデータはオフライン版で扱ってください。
