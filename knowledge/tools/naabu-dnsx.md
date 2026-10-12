---
name: naabu / dnsx（ProjectDiscovery）
category: ポートスキャン
tags: [ポートスキャン, DNS, パイプライン, OSS]
url: https://github.com/projectdiscovery/naabu
license: MIT（無償）
phase: [recon]
---

## 位置づけ

どちらも「大量の対象に対して速く回す」ことに特化しています。nmap の代わりではなく、**nmap に渡す前の絞り込み**に使います。

| ツール | 役割 |
|---|---|
| naabu | SYN ベースの高速ポートスキャン。開いているポートの一覧まで |
| dnsx | DNS の一括解決。生存確認、CNAME・A・MX の取得、ワイルドカード判定 |

## 使い方

```bash
# サブドメインを解決し、生きているものだけ残す
subfinder -d example.com -silent | dnsx -silent -a -resp > resolved.txt

# CNAME を見る（Subdomain Takeover の下調べ）
dnsx -l subs.txt -cname -resp -silent

# ワイルドカード DNS を除外する（*.example.com が全部解決する環境向け）
dnsx -l subs.txt -wd example.com -silent

# 高速にポートを絞り、詳細は nmap に渡す
naabu -list resolved.txt -top-ports 1000 -silent -o ports.txt
naabu -host 198.51.100.21 -p - -nmap-cli 'nmap -sV -sC'
```

`-nmap-cli` を使うと、naabu が見つけたポートだけを nmap に渡して実行します。全ポートスキャンの時間を大幅に縮められます。

## 注意点

- naabu は既定で SYN スキャンのため管理権限が要ります。権限がなければ `-s c`（コネクトスキャン）にします
- ワイルドカード DNS を持つドメインでは、存在しないサブドメインもすべて解決します。`-wd` での除外を忘れると偽の資産が大量に登録されます
