---
name: 通信を捕まえて解析する
phase: survey
tools: [Burp Suite, Wireshark, tcpdump, mitmproxy]
summary: HTTP で見えない層の確認と、プロキシを通せない通信の扱い
---

## どのツールを使うか

| 対象 | 使うもの |
|---|---|
| ブラウザの HTTP(S) | Burp Suite |
| モバイルアプリの HTTP(S) | mitmproxy（または Burp + 端末のプロキシ設定） |
| 証明書ピンニングがある通信 | パケットキャプチャで存在の確認まで。中身は読めない |
| HTTP 以外（独自プロトコル、DB 接続） | Wireshark / tcpdump |
| サーバ上で取る | tcpdump → 手元の Wireshark で読む |

## 1. 平文通信の確認

```bash
# サーバ側で取る
sudo tcpdump -i any -s0 'host 198.51.100.21 and tcp port 80' -w plain.pcap

# 手元で読む（Wireshark の表示フィルタ）
tcp.port == 80 && http.request.method == "POST"
```

該当パケットを Follow → TCP Stream で開き、資格情報が読めることを確認します。
**証跡を取るときは値をマスキングしてください。**

## 2. TLS 設定の実態を見る

```
tls.handshake.type == 1          # Client Hello。提示された版と SNI
tls.handshake.type == 2          # Server Hello。実際に選ばれた版と暗号スイート
tls.handshake.version < 0x0303   # TLS 1.2 未満
```

`testssl.sh` の結果と突き合わせると、設定値と実際の挙動のずれが分かります。

## 3. モバイルアプリの通信

```bash
mitmproxy --mode regular --listen-port 8080
# 端末のプロキシを手元の IP:8080 に向け、mitm.it から CA 証明書を入れる
```

証明書ピンニングがある場合、通信は失敗します。その事実自体は**実装として正しい**ので、発見事項にはなりません。
迂回（Frida によるピンニング無効化など）は RoE で許可されている場合に限ります。

## 4. 接続できない原因の切り分け

| 症状 | 見るところ |
|---|---|
| 接続が張れない | `tcp.flags.syn == 1 && tcp.flags.ack == 0` に対する応答の有無 |
| すぐ切れる | `tcp.flags.reset == 1`。どちらが送ったか |
| TLS で失敗 | `tls.alert_message`。アラートの内容 |
| 名前が引けない | `dns` フィルタで応答コードを確認 |

## 記録の仕方

pcap には実際の資格情報が平文で残ります。診断対象フォルダに置く場合は暗号化し、報告後の廃棄まで RoE に沿って扱ってください。
SecOwl では、実行したコマンドと読み取った内容を「ツール実行ログ」に記録し、pcap 自体は保存先に置かない運用を勧めます。
