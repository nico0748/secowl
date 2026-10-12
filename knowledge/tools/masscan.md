---
name: masscan
category: ポートスキャン
tags: [ポートスキャン, 大規模, 高負荷]
url: https://github.com/robertdavidgraham/masscan
license: AGPL-3.0
phase: [recon]
---

## 機能

独自の TCP スタックでパケットを送り、大規模な IP レンジを短時間で走査します。/16 以上のレンジを扱うときに使います。

```bash
# レンジ全体の 443 だけを毎秒 1000 パケットで
sudo masscan 198.51.100.0/22 -p443 --rate 1000 -oL masscan.txt

# 見つかった IP を nmap に渡す
awk '/open/ {print $4}' masscan.txt | sort -u > alive.txt
nmap -sV -iL alive.txt
```

## 注意点

**`--rate` の既定は高く、設定を誤ると対象のネットワークを飽和させます。** 受託診断では 1000 pps 程度から始め、顧客側で影響がないか確認してから上げてください。

サービス特定の精度は nmap に劣ります。masscan で範囲を絞り、nmap で詳細を取る 2 段構えが前提です。
