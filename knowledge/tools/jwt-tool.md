---
name: jwt_tool / JWT Editor
category: Webアプリケーションの調査
tags: [認証, JWT, トークン]
url: https://github.com/ticarpi/jwt_tool
license: GPL-3.0
phase: [survey]
---

## 機能

JWT を使う実装では、署名の検証漏れが繰り返し見つかります。確認する点は決まっています。

| 検証項目 | 具体的な確認 |
|---|---|
| `alg: none` | ヘッダを `{"alg":"none"}` にし、署名を空にして通るか |
| アルゴリズムの混同 | `RS256` を `HS256` に変え、公開鍵を秘密鍵として署名して通るか |
| 弱い秘密鍵 | `HS256` の鍵を辞書で当てられるか |
| `kid` の注入 | `kid` にパストラバーサルや SQL を入れて鍵を差し替えられるか |
| 期限の検証 | `exp` を過ぎたトークンが通るか |
| 署名の検証そのもの | ペイロードを 1 文字変えて通るか |

## 使い方

```bash
# 中身を見る
jwt_tool <token>

# 代表的な攻撃を一通り試す
jwt_tool <token> -M at -t https://example.com/api/me -rh "Authorization: Bearer "

# alg:none
jwt_tool <token> -X a

# 鍵の総当たり
jwt_tool <token> -C -d /usr/share/seclists/Passwords/Common-Credentials/10k-most-common.txt

# ペイロードを書き換えて再署名
jwt_tool <token> -T -S hs256 -p "secret"
```

Burp 上で行う場合は拡張の **JWT Editor** が使えます。Repeater のタブで直接編集・再署名できます。

## 発見事項にするとき

- 「署名検証の不備」は CWE-347。影響は認証バイパスまたは権限昇格です
- 対策は「サーバ側で許可するアルゴリズムを 1 つに固定し、ヘッダの `alg` を信用しない」ことです。ライブラリの `verify` にアルゴリズムを明示的に渡す実装を示してください

## 注意点

**取得したトークンは実在の利用者のものです。** 検証に使ったトークンは記録に残さず、証跡では署名部分をマスキングしてください。
