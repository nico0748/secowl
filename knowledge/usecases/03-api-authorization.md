---
name: API の認可を検証する
phase: survey
tools: [Burp Suite, ffuf, httpx, katana]
summary: エンドポイントを洗い出し、所有権の確認が行われているかを調べる
---

## 1. エンドポイントを集める

```bash
# OpenAPI があればそれが最良
curl -s https://api.example.com/openapi.json | jq -r '.paths | keys[]'

# 無ければ JS から拾う
katana -u https://example.com -jc -d 3 -silent | grep -E '/api/' | sort -u

# 過去の URL から
gau --subs example.com | grep '/api/' | sort -u

# モバイルアプリがあれば
apkurlgrep -a app.apk | grep example.com | sort -u
```

## 2. 認証なしで到達できるか

```bash
# Authorization ヘッダを外して全件叩く
while read p; do
  echo -n "$p "
  curl -s -o /dev/null -w "%{http_code}\n" "https://api.example.com$p"
done < paths.txt
```

200 が返るものは、認証が不要な設計か、認証漏れかを確認します。

## 3. 他人のリソースに到達できるか

これが本題です。確認の型は 3 つあります。

| 型 | 操作 | 成立すると |
|---|---|---|
| 水平越境 | A のトークンで B の ID を要求 | CWE-639 |
| 垂直越境 | 一般のトークンで管理 API を要求 | CWE-285 |
| メソッド改変 | `GET` が通る資源に `PUT` `DELETE` を送る | CWE-650 |

```bash
# ID を順に試す（RoE で許可された範囲・件数で）
ffuf -u 'https://api.example.com/v1/orders/FUZZ' \
  -H "Authorization: Bearer $TOKEN_A" \
  -w <(seq 10400 10450) -mc 200 -rate 5
```

**件数と範囲は事前に合意してください。** 無制限に回すと、他の利用者のデータに大量に触れることになります。

## 4. 見落としやすい箇所

- **一覧 API のフィルタ**: `GET /orders?user_id=883` のように、パラメータで他人を指定できないか
- **バルク操作**: `POST /orders/batch` に他人の ID を混ぜられないか
- **GraphQL**: イントロスペクションが有効なら全スキーマが取れる。ネストした解決で認可が抜けることがある
- **内部ヘッダ**: `X-User-Id` `X-Forwarded-User` をクライアントから送ると信用される実装

```bash
# GraphQL のイントロスペクション
curl -s -X POST https://api.example.com/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{__schema{types{name}}}"}' | jq '.data.__schema.types | length'
```

## 5. 発見事項の書き方

- 再現手順には**2 つのアカウントが必要**であることを明記する
- 証跡は、A のトークンで B のデータが返っている応答（個人情報はマスキング）
- 範囲の見積もりを書く: ID を順に試して何件取得できたか。影響の大きさがこれで決まる
- 対策は「リソース取得時に、トークンの主体と所有者の一致を確認する」。404 を返して存在も秘匿する
