---
name: testssl.sh
category: Webアプリケーションの調査
tags: [TLS, 暗号, 設定確認, OSS]
url: https://testssl.sh/
license: GPL-2.0
phase: [survey]
---

## 機能

TLS の設定を網羅的に調べます。対応する版、暗号スイート、証明書、既知の脆弱性（Heartbleed、ROBOT、BEAST など）を 1 回で確認できます。

```bash
# 全項目
./testssl.sh https://example.com

# 要点だけ速く
./testssl.sh --fast --parallel https://example.com

# 機械可読で出す
./testssl.sh --jsonfile tls.json --severity MEDIUM https://example.com

# 特定の観点だけ
./testssl.sh -p https://example.com     # 対応プロトコル
./testssl.sh -U https://example.com     # 既知の脆弱性のみ
```

Docker でも動きます。

```bash
docker run --rm -t drwetter/testssl.sh https://example.com
```

## 発見事項になる状態

| 状態 | 深刻度の目安 |
|---|---|
| TLS 1.0 / 1.1 が有効 | 注意〜警告。PCI DSS では不適合 |
| SSLv3 が有効 | 警告（POODLE） |
| 証明書の期限切れ・ホスト名不一致 | 警告〜重要 |
| HSTS が無い | 注意。ほかの発見事項と合わせて影響が上がる |
| 弱い暗号スイート（RC4、3DES、NULL、EXPORT） | 注意〜警告 |
| 鍵長 1024 ビット以下 | 警告 |

## 注意点

nmap の `ssl-enum-ciphers` でも同等の情報が得られます。testssl.sh のほうが既知脆弱性の判定まで含む分だけ詳しく、要求数も多くなります。
