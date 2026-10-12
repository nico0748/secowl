---
name: Axiom / passthecdn
category: ポートスキャン
tags: [分散実行, CDN, 補助]
url: https://github.com/pry0cc/axiom
license: MIT
phase: [recon]
---

## Axiom

クラウド上に使い捨ての VM を複数立て、スキャンを分散して実行する仕組みです。1 台では時間がかかる大規模な列挙を短縮します。

```bash
axiom-fleet reconFleet -i 5                      # 5 台立てる
axiom-scan targets.txt -m nmapx -o results       # 分散実行
axiom-rm reconFleet -f                           # 片付ける
```

使いどころは、対象の資産が数千規模にのぼる ASM 的な棚卸しです。**VM が立ったままだと課金が続きます。** 実行後の `axiom-rm` を手順に組み込んでください。

また、スキャン元 IP が複数に分散するため、**RoE で診断元 IP を限定している診断対象では使えません。** 事前に合意が要ります。

## passthecdn

CDN の背後にある実サーバの IP を特定する試みをまとめたツール群です。考え方は次のとおりです。

1. 歴史的 DNS（SecurityTrails など）で、CDN 導入前の A レコードを探す
2. 証明書透明性ログから同じ証明書を使うホストを探し、Shodan や Censys で実 IP を引く
3. メールヘッダ、エラーページ、`X-Forwarded-For` の扱いなどから情報を拾う
4. 候補 IP に対し Host ヘッダを付けて直接要求し、同じコンテンツが返るか確かめる

```bash
curl -s -H 'Host: example.com' https://198.51.100.21/ --insecure | head
```

実 IP が露出している場合、WAF と DDoS 対策を迂回できるため**それ自体が発見事項**になります。対策は「CDN の送信元 IP からのみ受け付けるようオリジンのファイアウォールを設定する」です。
