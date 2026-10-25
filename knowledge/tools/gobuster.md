---
name: gobuster
category: Webアプリケーションの調査
tags: [ディレクトリ探索, DNS, 仮想ホスト, OSS]
url: https://github.com/OJ/gobuster
license: Apache-2.0
phase: [recon, survey]
commands:
  - id: gobuster-dir
    label: ディレクトリ探索（同時 10）
    program: gobuster
    args: ["dir", "-u", "{{target}}", "-w", "{{wordlist}}", "-t", "10", "-o", "{{out}}"]
    out: { format: gobuster, ext: txt }
    vars:
      - { name: target, kind: target, required: true, label: 対象の URL, hint: "例: https://example.com/", accept: [url] }
      - { name: wordlist, kind: text, required: true, label: ワードリストのパス, hint: "例: /usr/share/wordlists/dirb/common.txt（置き場所は /usr/share・Homebrew の share・/opt・自分のホームフォルダの直下にある wordlists / seclists / SecLists / dirb / dirbuster の下、拡張子は .txt か .lst だけ）", pattern: '(?!.*\.\.)(?:/usr/share|/usr/local/share|/opt/homebrew/share|/opt|/Users/[A-Za-z0-9_.-]+|/home/[A-Za-z0-9_.-]+)/(?:wordlists|seclists|SecLists|dirb|dirbuster)(?:/[A-Za-z0-9_.+~-]+)+\.(?:txt|lst)' }
    timeout_sec: 900
---

## 機能

モードを切り替えて、ディレクトリ・DNS サブドメイン・仮想ホストの総当たりを行います。

```bash
# ディレクトリ
gobuster dir -u https://example.com -w raft-medium-words.txt -t 20 -x php,bak

# DNS サブドメイン（対象の DNS に問い合わせが飛ぶ）
gobuster dns -d example.com -w subdomains-top1million-5000.txt -t 20

# 仮想ホスト（同じ IP の別サイト）
gobuster vhost -u https://198.51.100.21 -w subs.txt --append-domain
```

## モードの違い

| モード | 何を叩くか | 注意 |
|---|---|---|
| `dir` | HTTP のパス | 404 の扱いに注意。`-s`/`-b` で調整 |
| `dns` | DNS サーバ | ワイルドカード DNS があると全部当たる |
| `vhost` | Host ヘッダ | 応答長で判定するため `--exclude-length` が要る |

## よくある落とし穴

- `dir` モードで `-k`（証明書検証の無効化）を付け忘れると、自己署名証明書の環境で全件失敗します
- `dns` モードはワイルドカードがあると全件ヒットします。先に `dig a.b.c.example.com` で確認してください
- SecOwl の取り込みは `dir` モードの標準出力に対応しています。そのまま貼り付けられます
