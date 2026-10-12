---
name: OWASP Amass
category: サブドメイン探索
tags: [必修, サブドメイン, OSINT, OSS]
url: https://github.com/owasp-amass/amass
license: Apache-2.0（無償）
phase: [recon]
---

## 機能

多数の情報源を束ねてサブドメインを集め、結果をグラフとして保持します。単発の列挙ツールより網羅性が高く、資産の関係（どの IP に載っているか、どの ASN か）まで追えます。

## 使い方

```bash
# パッシブのみ（対象へパケットを送らない）
amass enum -passive -d example.com -o subs.txt

# 設定ファイルで API キーを渡す
amass enum -passive -d example.com -config ~/.config/amass/config.ini

# アクティブ（DNS 解決と証明書の取得を行う。RoE の確認が要る）
amass enum -active -d example.com -brute -w wordlist.txt

# 収集済みのグラフから関連資産を引く
amass intel -d example.com -whois
amass db -names -d example.com
```

## パッシブとアクティブの違い

| モード | 対象への通信 | 使いどころ |
|---|---|---|
| `-passive` | **なし**（第三者のデータベースだけを引く） | RoE 承認前の下調べ、スコープの相談 |
| `-active` | あり（DNS 解決、443 への接続、総当たり） | 承認後の列挙 |

RoE に署名がない段階では `-passive` だけを使ってください。

## 注意点

- 実行時間が長くなりがちです。`-timeout` で上限を決めてください
- API キーを入れると結果が大きく変わります。`subdomain-data-sources` のページを参照してください
- 出てきたホスト名には、他組織のものが混ざることがあります。スコープに含める前に所有者を確認してください
