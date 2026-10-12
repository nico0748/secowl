---
name: dirsearch / SecLists（ディレクトリ探索と辞書）
category: Webアプリケーションの調査
tags: [必修, ディレクトリ探索, 辞書]
url: https://github.com/maurosoria/dirsearch
license: GPL-2.0 / MIT（SecLists）
phase: [survey]
---

## dirsearch

リンクからたどれないパスを辞書で探します。

```bash
dirsearch -u https://example.com -e php,bak,old,zip,log -x 404,403 -t 20

# 認証つき
dirsearch -u https://example.com --cookie "SESSID=..." -t 10

# 複数対象
dirsearch -l urls.txt -w /usr/share/seclists/Discovery/Web-Content/raft-medium-words.txt
```

## SecLists

辞書の標準的な配布物です。用途ごとにファイルが分かれています。

| パス | 用途 |
|---|---|
| `Discovery/Web-Content/raft-*-words.txt` | 一般的なディレクトリとファイル名。まずこれ |
| `Discovery/Web-Content/common.txt` | 短時間で回したいとき |
| `Discovery/DNS/subdomains-top1million-*.txt` | サブドメインの総当たり |
| `Discovery/Web-Content/api/` | API のパス |
| `Fuzzing/` | パラメータ値のファジング用 |
| `Passwords/` | パスワードスプレー（**RoE で許可された場合のみ**） |

```bash
git clone --depth 1 https://github.com/danielmiessler/SecLists.git /usr/share/seclists
```

## 探索の進め方

1. まず `common.txt` で短く回し、応答の傾向をつかむ
2. 存在しないパスの応答（404 の本文長、リダイレクト先）を確かめ、除外条件を決める
3. `raft-medium-words.txt` で本番の探索を回す
4. 見つかったディレクトリの配下を再帰的に探す
5. 拡張子を変えて再試行する（`.bak` `.old` `.zip` `.swp` `~`）

## 注意点

- **応答コードだけで判断しないでください。** 常に 200 を返して本文で「見つかりません」と書く実装があります。本文長での除外（`--exclude-sizes`）を併用します
- 並列数を上げると WAF に遮断され、以降の診断ができなくなります。`-t 10` 程度から始めてください
- 見つかったバックアップファイルをダウンロードする行為は、内容によっては情報の持ち出しになります。存在の確認までに留め、中身の取得は RoE を確認してください
