---
name: sqlmap
category: Webアプリケーションの調査
tags: [SQLインジェクション, 自動化, 高リスク, OSS]
url: https://sqlmap.org/
license: GPL-2.0
phase: [survey]
---

## 機能

SQL インジェクションの検出と、成立した場合のデータ取得を自動化します。**既定の設定でもデータベースへ多数の要求を送る**ため、本番環境では設定を絞ってください。

## 使い方

Burp で捕まえたリクエストをファイルに保存して渡すのが確実です。

```bash
# Burp の Repeater から「Copy to file」で保存したものを使う
sqlmap -r request.txt --batch --level 2 --risk 1

# 検証するパラメータを限定する
sqlmap -r request.txt -p q --batch --level 2 --risk 1

# 検出だけで止める（データは取らない）
sqlmap -r request.txt --batch --technique=B --level 1 --risk 1 --flush-session

# DBMS が分かっている場合は指定して要求数を減らす
sqlmap -r request.txt --dbms=mysql --batch
```

## 本番環境での設定

| オプション | 推奨 | 理由 |
|---|---|---|
| `--level` | 1〜2 | 3 以上はヘッダや Cookie まで試し、要求数が跳ね上がる |
| `--risk` | 1 | 2 以上は `OR` ベースの注入を試し、**UPDATE 文に当たるとデータを壊す** |
| `--delay` | 0.5 以上 | 要求間隔。WAF の遮断と負荷を抑える |
| `--threads` | 1 | 既定は 1。上げない |
| `--technique` | `B`（ブール）または `T`（時間） | スタック注入 `S` は実行を伴う |

**`--os-shell` `--os-pwn` `--file-write` は使わないでください。** 受託診断の範囲を超えます。検証は「注入が成立する」ことの確認までで十分です。

## 発見事項にするとき

- 証跡は、注入が成立したことを示す応答の差分（真と偽の 2 本）に留めます
- データを取得した場合は、取得した件数と種類を記録し、**取得したデータ自体は破棄**してその旨を証跡に書きます
- 対策はプレースホルダ（prepared statement）の使用です。エスケープ関数の追加は対策として不十分と書いてください

## 注意点

sqlmap は検証のために大量のリクエストを送ります。RoE で負荷の上限が決まっている場合、手動での確認（`' OR 1=1 --` ではなく、真偽で応答が変わる最小の入力）を先に行い、sqlmap は裏取りに使うのが安全です。
