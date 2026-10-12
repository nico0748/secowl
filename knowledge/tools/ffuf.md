---
name: ffuf
category: Webアプリケーションの調査
tags: [必修, ファジング, 高速, OSS]
url: https://github.com/ffuf/ffuf
license: MIT（無償）
phase: [survey]
---

## 機能

URL・ヘッダ・本文の任意の位置に `FUZZ` を置き、辞書の値を順に差し込みます。ディレクトリ探索だけでなく、パラメータ名の発見、仮想ホストの発見、値の総当たりに使えます。

## 用途別のコマンド

```bash
# ディレクトリ探索
ffuf -u https://example.com/FUZZ -w raft-medium-words.txt -mc 200,301,401,403

# 拡張子つき
ffuf -u https://example.com/FUZZ -w words.txt -e .php,.bak,.old

# パラメータ名の発見（GET）
ffuf -u 'https://example.com/page?FUZZ=test' -w burp-parameter-names.txt -fs 1234

# 仮想ホストの発見（同じ IP で別サイトが動いていないか）
ffuf -u https://198.51.100.21 -H 'Host: FUZZ.example.com' -w subs.txt -fs 1234

# POST の値を総当たり（RoE の確認が要る）
ffuf -u https://example.com/api/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"user":"admin","pass":"FUZZ"}' -w passwords.txt -fc 401

# 2 つの辞書を組み合わせる
ffuf -u https://example.com/W1/W2 -w dirs.txt:W1 -w files.txt:W2
```

## 絞り込みのオプション

| オプション | 内容 |
|---|---|
| `-mc` | 残す応答コード（match） |
| `-fc` | 除く応答コード（filter） |
| `-fs` | 除く応答サイズ。**ワイルドカード応答を消すのに必須** |
| `-fw` | 除く単語数 |
| `-fr` | 除く正規表現（本文に対して） |
| `-ac` | 自動キャリブレーション。存在しないパスの応答を学習して除外する |
| `-rate` | 毎秒の要求数 |

## 手順

1. 存在しないパスを 1 回手で叩き、応答コードと本文長を確認する
2. `-fs <その長さ>` か `-ac` で除外する
3. `-rate 20` 程度から始め、対象の応答が遅くならないか見ながら調整する

## 注意点

ffuf は既定で非常に速く動きます。**本番環境では `-rate` と `-t` を必ず指定してください。** 指定しないとサービスに影響が出ます。
