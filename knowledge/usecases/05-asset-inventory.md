---
name: 外部公開資産を棚卸しする（ASM）
phase: recon
tools: [JPRS WHOIS, ViewDNS.info, crt.sh, Shodan, Censys, bgp.he.net, dnstwist]
summary: 顧客が把握していない公開資産を洗い出し、管理台帳と突き合わせる
---

## 目的

診断のスコープを決める前に、「そもそも何が外部に出ているか」を把握します。顧客の台帳にない資産が見つかることが珍しくありません。

## 1. ドメインを広げる

```bash
# .jp は登録者名が公開されている
whois -h whois.jprs.jp example.co.jp

# 登録者から逆引きして他のドメインを探す（ViewDNS の Reverse Whois）
# https://viewdns.info/reversewhois/?q=Example+Inc

# 証明書から
curl -s 'https://crt.sh/?O=Example+Inc&output=json' | jq -r '.[].common_name' | sort -u
```

## 2. IP レンジを特定する

```bash
# 自前の AS を持っているか
whois -h whois.cymru.com " -v 198.51.100.21"
# https://bgp.he.net/search?search[search]=Example+Inc

# クラウドなら事業者のレンジ。自前レンジの調査は不要
curl -s https://ipinfo.io/198.51.100.21/json | jq '.org'
```

## 3. パッシブに資産を引く

```
# Shodan
org:"Example Inc"
ssl.cert.subject.CN:"example.com"
net:198.51.100.0/24

# Censys
autonomous_system.organization: "Example Inc"
services.tls.certificates.leaf_data.subject.common_name: "example.com"
```

## 4. 似たドメインを確認する

```bash
dnstwist --registered --mxcheck example.com
```

第三者に取られているものがあれば、台帳とは別の報告項目になります。

## 5. 台帳と突き合わせる

SecOwl にサーフェスとして登録し、顧客の台帳と照合します。差分は 3 種類に分かれます。

| 差分 | 対応 |
|---|---|
| 台帳にあり、外部からも見える | 想定どおり。スコープに含める |
| **台帳に無く、外部から見える** | 要確認。放置資産・シャドー IT の疑い |
| 台帳にあるが、外部から見えない | 内部向け。スコープ外か確認 |

2 番目が本来の成果です。SecOwl では状態を「未調査」にして、顧客確認後に「対象外」か「調査中」へ移します。

## 注意点

- パッシブ手段のみで進められるため、**RoE 署名前の相談材料**として使えます
- 逆引きで出たドメインが対象組織のものとは限りません。所有者を確認するまでアクセスしないでください
- 見つけた資産を一覧で渡すときは、「外部から観測できる状態である」という事実と観測日時を添えてください
