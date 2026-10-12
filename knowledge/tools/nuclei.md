---
name: nuclei
category: Webアプリケーションの調査
tags: [必修, 脆弱性スキャン, テンプレート, OSS]
url: https://github.com/projectdiscovery/nuclei
license: MIT（無償）
phase: [survey]
---

## 機能

YAML で書かれたテンプレートに従って要求を送り、応答が条件に合うかを判定します。既知の脆弱性・設定不備・情報露出を広く拾えます。

```bash
# テンプレートを更新してから回す
nuclei -update-templates

# 深刻度を絞って回す
nuclei -u https://example.com -severity medium,high,critical

# 大量の対象に
nuclei -l resolved.txt -severity high,critical -rate-limit 50 -jsonl -o nuclei.jsonl

# 種類を絞る
nuclei -l urls.txt -tags cve,exposure,misconfiguration
nuclei -l urls.txt -t http/exposures/        # 情報露出のみ

# 外部との通信を伴う検知（OOB）を使う
nuclei -l urls.txt -tags ssrf -iserver https://<自前の interactsh>
```

## SecOwl への取り込み

`-jsonl` の出力を「偵察 → ツール出力を取り込む」に貼ると、**サーフェスと発見事項（draft）が同時に作られます。** 発見事項の本文には「手動で裏取りしてください」という注記が入ります。

```bash
nuclei -l resolved.txt -severity medium,high,critical -jsonl -o nuclei.jsonl
```

## テンプレートの種類

| ディレクトリ | 内容 |
|---|---|
| `http/cves/` | 既知の CVE |
| `http/exposures/` | 設定ファイル・バックアップ・鍵の露出 |
| `http/misconfiguration/` | 設定不備 |
| `http/technologies/` | 技術スタックの特定 |
| `http/takeovers/` | Subdomain Takeover |
| `dns/` `ssl/` `network/` | HTTP 以外 |

## 注意点

- **検出をそのまま発見事項にしないでください。** テンプレートは応答の一致を見ているだけで、実際に悪用できるかは別です。SecOwl が draft で起票するのはこのためです
- `-rate-limit` を指定しないと要求が集中します。本番では 50 程度から
- 一部のテンプレートはデータを書き換える要求を送ります。`-severity` と `-tags` で範囲を限定し、本番では内容を確認してから実行してください
- 自作テンプレートを書けば、その診断対象固有の検査を繰り返せます。再テスト（E5）で有用です
