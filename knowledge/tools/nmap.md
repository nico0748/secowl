---
name: nmap
category: ポートスキャン
tags: [必修, ポートスキャン, サービス特定, OSS]
url: https://nmap.org/
license: NPSL（無償）
phase: [recon, survey]
commands:
  - id: nmap-detail
    label: ポートを指定して、サービスとバージョンを調べる（-sV -sC）
    program: nmap
    args: ["-sV", "-sC", "-p", "{{ports}}", "-oX", "{{out}}", "{{target}}"]
    out: { format: nmap, ext: xml }
    vars:
      - { name: target, kind: target, required: true, label: 対象のホスト, hint: "ホスト名か IP アドレスを 1 つ", accept: [host, ip] }
      - { name: ports, kind: ports, required: true, default: "80,443", label: ポート, hint: "例: 80,443,8000-8100" }
    timeout_sec: 600
  - id: nmap-top100
    label: よく使われる上位 100 ポートを調べる（-T3 --top-ports 100）
    program: nmap
    args: ["-T3", "--top-ports", "100", "-oX", "{{out}}", "{{target}}"]
    out: { format: nmap, ext: xml }
    vars:
      - { name: target, kind: target, required: true, label: 対象のホスト, hint: "ホスト名か IP アドレスを 1 つ", accept: [host, ip] }
    timeout_sec: 600
---

## 機能

対象ホストの開いているポートと、そこで動いているサービス・バージョンを調べます。NSE（スクリプトエンジン）で個別の検査まで行えます。

## よく使うコマンド

```bash
# 疎通確認だけ（ポートは見ない）
nmap -sn 198.51.100.0/24

# 全 TCP ポートを速く。まず当たりをつける
nmap -p- --min-rate 1000 -T4 -oA allports 198.51.100.21

# 見つかったポートだけ深く見る
nmap -sV -sC -p 22,80,443,8080 -oA detail 198.51.100.21

# UDP は時間がかかるので上位だけ
nmap -sU --top-ports 50 198.51.100.21

# TLS の暗号スイートを一覧にする
nmap --script ssl-enum-ciphers -p 443 example.com

# HTTP のよくあるパスを引く
nmap --script http-enum -p 80,443 example.com
```

`-oA` で `.nmap` `.gnmap` `.xml` の 3 形式が出ます。**`.xml` を SecOwl の「ツール出力を取り込む」に貼ると、ホストとポートがサーフェスとして登録されます。**

## 主なオプションの意味

| オプション | 内容 |
|---|---|
| `-sS` | SYN スキャン。既定（要管理権限）。接続を完了しない |
| `-sT` | TCP コネクトスキャン。権限がないときはこちらになる |
| `-sU` | UDP スキャン。応答がないポートは `open\|filtered` と表示される |
| `-sV` | サービスとバージョンの特定 |
| `-sC` | 既定の NSE スクリプト。`--script=default` と同じ |
| `-O` | OS 推定 |
| `-A` | `-sV -sC -O --traceroute` をまとめたもの |
| `-Pn` | ping を省いて全ホストを生存扱いにする。ICMP が落とされる環境で使う |
| `-T0`〜`-T5` | 速度。`-T4` が実務の既定。`-T5` は取りこぼしが増える |
| `--min-rate` | 1 秒あたりのパケット下限。全ポートスキャンの時間短縮に効く |

## 結果の読み方

| 表示 | 意味 |
|---|---|
| `open` | 応答があった |
| `closed` | RST が返った。ホストは生きている |
| `filtered` | 応答がない。ファイアウォールで落とされている可能性 |
| `open\|filtered` | UDP で区別がつかない状態 |

## 注意点

- **スキャン自体が対象に負荷をかけます。** `--min-rate` を上げすぎると、機器によっては通信が詰まります。RoE で時間帯と速度の上限が決まっていればそれに従ってください
- 診断元 IP を許可リストに登録してもらってから実行します。登録前に走らせると WAF に遮断され、結果が歪みます
- クラウド事業者のレンジをスキャンする場合、事業者の試験ポリシーの確認が要ります
