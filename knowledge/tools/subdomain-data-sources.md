---
name: サブドメイン探索のデータソース一覧
category: サブドメイン探索
tags: [必修, OSINT, APIキー, 一覧]
url: https://github.com/projectdiscovery/subfinder#post-installation-instructions
license: 提供元ごとに異なる
phase: [recon]
---

## 考え方

Amass と subfinder は、それ自体がスキャンするのではなく**外部のデータベースへ照会するだけ**です。したがって結果の量は、設定した API キーの数でほぼ決まります。キーなしの状態と全部入れた状態では、取れるホスト数が数倍変わります。

無償枠のあるものから順に登録してください。

## データソース

| 提供元 | 何が引けるか | キー | 無償枠 |
|---|---|---|---|
| **Censys** | 証明書とホストのスキャン結果。SAN からサブドメインを取れる | 要 | あり（月あたり回数制限） |
| **Shodan** | インターネット全体のバナースキャン。IP とポート、`ssl.cert.subject.CN` 検索 | 要 | 限定的（有償推奨） |
| **SecurityTrails** | 歴史的 DNS。過去の A レコードから CDN の裏を割り出せる | 要 | あり（月 50 件程度） |
| **VirusTotal**（Google） | 観測されたサブドメインと関連 URL | 要 | あり（毎分 4 回） |
| **urlscan.io** | 実際にスキャンされたページの記録。URL とリソース読み込み先 | 任意 | あり |
| **AlienVault OTX** | 脅威情報のパッシブ DNS | 要（無償） | あり |
| **BinaryEdge** | スキャンデータとサブドメイン | 要 | あり（月 250 件） |
| **PassiveTotal**（RiskIQ / Microsoft） | パッシブ DNS と WHOIS の履歴 | 要 | あり（制限大） |
| **DNSDB**（Farsight / DomainTools） | パッシブ DNS の老舗。履歴の深さが特徴 | 要 | 商用 |
| **Spyse** | 資産情報の統合データベース | 要 | 現在はサービス形態が変わっているため要確認 |
| **ZoomEye** | 中国系のインターネットスキャン。Shodan と結果が異なる | 要 | あり |
| **ThreatBook** | 中国系の脅威情報 | 要 | 限定的 |
| **Cisco Umbrella** | DNS 解決の統計。人気ドメインの一覧も配布 | 要 | 一部無償 |
| **WhoisXML API** | WHOIS と逆引き WHOIS、DNS 履歴 | 要 | あり（登録時のみ） |
| **ZETAlytics** | パッシブ DNS | 要 | 限定的 |
| **C99.nl** | サブドメイン検索ほか多数の API | 要 | 有償 |
| **CIRCL**（ルクセンブルク CERT） | パッシブ DNS / パッシブ SSL。研究・CSIRT 向け | 要（申請制） | 審査あり |
| **Recon.dev** | 収集済みサブドメインの検索 | 要 | あり |
| **Chaos**（ProjectDiscovery） | バグバウンティ対象のサブドメイン | 要（無償） | あり |
| **networksdb.io** | 組織名から IP レンジと ASN | 任意 | あり |
| **crt.sh** | 証明書透明性ログ | 不要 | 無制限（礼儀の範囲で） |

## 設定の場所

```bash
# subfinder
~/.config/subfinder/provider-config.yaml

# amass
~/.config/amass/config.ini
```

```yaml
# provider-config.yaml の例
securitytrails: [KEY]
shodan: [KEY]
virustotal: [KEY]
censys: [API_ID:SECRET]
```

## 選び方

**まず無償で登録できるものだけ入れる**: crt.sh（不要）、AlienVault OTX、Chaos、VirusTotal、urlscan.io、BinaryEdge、SecurityTrails。
これだけで実務上の取りこぼしはかなり減ります。

有償を検討するなら、**歴史的 DNS**（SecurityTrails / DNSDB）が最も投資効果が高い領域です。CDN の背後にある実 IP を過去のレコードから割り出せることがあるためです。

## 注意点

- 照会の記録は提供元に残ります。秘匿性の高い診断対象では、使う情報源を顧客と合意してください
- 無償枠を超えると**静かに結果が減る**提供元があります。「出なかった」を「無い」と解釈しないでください
- 利用規約で商用利用を禁じている提供元があります。受託診断で使う前に確認してください
