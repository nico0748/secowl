---
name: 送信元偽装対策（SPF / DKIM / DMARC）
category: フィッシング訓練
tags: [メール, 防御, DNS, 設定確認]
url: https://dmarc.org/
license: 仕様
phase: [recon, survey]
---

## 機能

対象組織のドメインが、第三者に差出人を騙られる状態かどうかを DNS から確認します。訓練の準備としても、診断の発見事項としても使います。

| 仕組み | 役割 | 見る場所 |
|---|---|---|
| SPF | そのドメインから送ってよい IP を宣言する | `TXT` の `v=spf1 ...` |
| DKIM | 本文とヘッダに署名する | `<selector>._domainkey.<domain>` の `TXT` |
| DMARC | SPF と DKIM の結果をどう扱うかを宣言する | `_dmarc.<domain>` の `TXT` |

## 確認コマンド

```bash
dig +short TXT example.com | grep spf1
dig +short TXT _dmarc.example.com
dig +short TXT selector1._domainkey.example.com

# 一括で見るなら
curl -s "https://dns.google/resolve?name=_dmarc.example.com&type=TXT" | jq .
```

## 発見事項になる状態

| 状態 | 影響 |
|---|---|
| SPF レコードが無い | 任意の送信元から差出人を騙れる |
| SPF が `?all` または `~all` 止まり | 受信側が拒否しないため、迷惑メールフォルダに届く程度で済む |
| SPF の DNS 参照が 10 回を超える | 評価が `permerror` になり、SPF が機能しない |
| DMARC が無い、または `p=none` のまま | 偽装メールが届いても拒否されない |
| DMARC に `rua=` が無い | 偽装の発生を検知できない |

## 推奨する設定の順序

1. `p=none` と `rua=` でレポートを集め、正規の送信元を洗い出す（1〜2 か月）
2. SPF と DKIM を正規の送信元すべてに通す
3. `p=quarantine` に上げ、影響を見る
4. `p=reject` にする

> 実例: 本 vault の `mail-auth-incident` では、ホスティング移行で A レコードを変えた際に SPF の include 先が外れ、Gmail 宛が不達になりました。送信経路を変更したら SPF を見直してください。
