---
name: tcpdump
category: プロキシ・通信解析
tags: [パケット解析, CLI, ネットワーク]
url: https://www.tcpdump.org/
license: BSD（無償）
phase: [recon, survey]
---

## 機能

コマンドラインでパケットを捕まえます。GUI を置けないサーバ上で取り、手元の Wireshark で読む組み合わせがよく使われます。

## よく使うコマンド

```bash
# 対象ホストとの通信だけをファイルに保存する
sudo tcpdump -i any host 198.51.100.21 -w capture.pcap

# 平文 HTTP の中身を画面で見る
sudo tcpdump -i any -A 'tcp port 80 and host 198.51.100.21'

# DNS の問い合わせだけ
sudo tcpdump -i any -n 'udp port 53'

# TLS の Client Hello だけ（SNI を確認する）
sudo tcpdump -i any -s0 'tcp[((tcp[12:1] & 0xf0) >> 2)] = 0x16'
```

- `-s0` を付けないとパケットが途中で切れます
- `-n` で名前解決を止めると、調査中に余計な DNS 問い合わせを出さずに済みます

## 注意点

管理権限が要ります。本番サーバで取る場合はディスクを使い切らないよう `-C`（ファイル分割）と `-W`（世代数）を付けてください。
