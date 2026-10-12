---
name: mitmproxy
category: プロキシ・通信解析
tags: [プロキシ, スクリプト, モバイル]
url: https://mitmproxy.org/
license: MIT（無償）
phase: [survey]
---

## 機能

スクリプトで通信を書き換えられるプロキシです。Burp の GUI では手が届かない「毎回この値を置き換える」「レスポンスを条件つきで差し替える」といった処理を Python で書けます。

## 使いどころ

- モバイルアプリの通信を捕まえる（証明書ピンニングがない場合）
- 署名つきリクエストの再送: 書き換えたあとに署名を計算し直すアドオンを書く
- 大量の通信から特定の条件に合うものだけ抜き出す

```bash
mitmproxy --mode regular --listen-port 8080          # 対話的に見る
mitmdump -s rewrite.py -w flows.mitm                 # スクリプトを当てて保存
mitmweb                                              # ブラウザ UI
```

```python
# rewrite.py — 応答の特定ヘッダを落として挙動を見る例
def response(flow):
    flow.response.headers.pop("content-security-policy", None)
```

## 注意点

書き換えた通信を本番に送ると、対象のデータを変更する恐れがあります。書き換えの対象を URL で限定してから使ってください。
