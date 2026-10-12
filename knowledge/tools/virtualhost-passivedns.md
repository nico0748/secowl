---
name: バーチャルホストとパッシブ DNS（SecurityTrails / Mnemonic / ipinfo.io）
category: Webアプリケーションの調査
tags: [DNS履歴, 同居サイト, CDN]
url: https://securitytrails.com/
license: 商用（無償枠あり）
phase: [recon]
---

## 機能

1 つの IP アドレスで複数のサイトが動いている構成（バーチャルホスト）と、ドメインが過去に指していた IP の履歴です。

| 調べること | 何に効くか |
|---|---|
| 同じ IP に同居するドメイン | 共用環境の把握。**負荷をかける検証が他者に影響しないかの確認** |
| 過去の A レコード | CDN 導入前の実 IP。WAF の迂回経路の発見 |
| 過去の NS / MX | 使われなくなった外部サービスの特定 |

## 使い方

```bash
# SecurityTrails: ドメインの DNS 履歴
curl -s -H "APIKEY: $ST_KEY" \
  "https://api.securitytrails.com/v1/history/example.com/dns/a" | jq .

# SecurityTrails: 同一 IP のドメイン
curl -s -H "APIKEY: $ST_KEY" \
  "https://api.securitytrails.com/v1/ips/nearby/198.51.100.21" | jq .

# Mnemonic Passive DNS（無償・キー不要）
curl -s "https://api.mnemonic.no/pdns/v3/example.com" | jq -r '.data[].answer' | sort -u

# ipinfo.io: IP の所有者と ASN
curl -s "https://ipinfo.io/198.51.100.21/json" | jq .

# 実 IP の候補に Host ヘッダを付けて直接確認する
curl -s -H 'Host: example.com' --insecure https://198.51.100.21/ | head -20
```

## 判定の仕方

候補 IP に Host ヘッダ付きで要求し、**CDN 経由と同じコンテンツが返れば実 IP が露出しています**。これは発見事項になります。

- 影響: WAF・DDoS 対策・レート制限をすべて迂回できる
- 対策: オリジンのファイアウォールで、CDN の送信元 IP レンジからのみ受け付ける設定にする

## 注意点

同居するドメインが他組織のものである場合、そのホストへの検証は行わないでください。IP 単位でスキャンする RoE になっている診断対象では、同居の有無を先に確認して顧客と共有してください。
