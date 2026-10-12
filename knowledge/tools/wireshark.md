---
name: Wireshark
category: プロキシ・通信解析
tags: [必修, パケット解析, ネットワーク]
url: https://www.wireshark.org/
license: GPL-2.0（無償）
phase: [recon, survey]
---

## 機能

ネットワークを流れるパケットをそのまま捕まえて読みます。HTTP より下の層で何が起きているかを確かめるときに使います。

## 使いどころ

- 平文通信の確認: ログインの資格情報が暗号化されずに流れていないか
- プロキシを通せない通信の確認: モバイルアプリの独自プロトコル、gRPC、WebSocket の中身
- TLS の実際のやり取り: 使われた版と暗号スイート、証明書チェーン
- 接続できない原因の切り分け: TCP のハンドシェイクが成立しているか、RST はどちらから来たか

## よく使う表示フィルタ

```
http.request                      # HTTP の要求だけ
http.request.method == "POST"
tcp.port == 80 && http            # 平文の HTTP
tls.handshake.type == 1           # Client Hello（提示された版と SNI が見える）
tls.handshake.version < 0x0303    # TLS 1.2 未満のハンドシェイク
ip.addr == 198.51.100.21
dns.qry.name contains "example"
frame contains "password"         # 平文に含まれる語の検索
tcp.flags.reset == 1              # RST を送ったのはどちらか
```

## 手順の例（平文通信の確認）

1. Capture → Options で対象のインターフェースを選び、キャプチャフィルタに `host 198.51.100.21` を入れる
2. ブラウザでログインを 1 回行う
3. 表示フィルタに `tcp.port == 80 && http.request.method == "POST"` を入れる
4. 該当パケットを右クリック → Follow → TCP Stream で本文を読む
5. 資格情報が読める場合は、その画面を証跡にする（**値はマスキングしてから保存**）

## 注意点

- キャプチャには診断対象以外の通信も入ります。**キャプチャフィルタで対象を絞ってから取る**のが原則です
- pcap ファイルには実際の資格情報が平文で残ります。診断対象フォルダに置く場合は暗号化し、報告後に廃棄してください
- 共有ネットワークでの無差別キャプチャは、RoE の範囲外であれば実施しないでください
