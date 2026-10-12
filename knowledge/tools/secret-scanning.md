---
name: 秘密情報の探索（trufflehog / gitleaks）
category: Webアプリケーションの調査
tags: [秘密情報, ソースコード, 高影響, OSS]
url: https://github.com/trufflesecurity/trufflehog
license: AGPL-3.0 / MIT
phase: [recon, survey]
---

## 機能

公開されているリポジトリ、JS バンドル、設定ファイルに残った API キー・トークン・資格情報です。見つかれば影響の大きい発見事項になります。

## trufflehog

検出した鍵が**実際に有効か検証する**機能（`--only-verified`）があるのが特徴です。

```bash
# 公開リポジトリ
trufflehog github --org=example-inc --only-verified

# ローカルのディレクトリ
trufflehog filesystem ./app_decoded --only-verified

# 1 つのリポジトリの全履歴
trufflehog git https://github.com/example/app --only-verified
```

## gitleaks

```bash
gitleaks detect --source . --report-path leaks.json
gitleaks detect --source . --log-opts="--all"    # 全ブランチの履歴
```

## JS バンドルから探す

```bash
# 読み込まれている JS を集める
katana -u https://example.com -jc -silent | grep '\.js' | httpx -silent > js.txt

# 中身から鍵らしき文字列を探す
while read u; do curl -s "$u"; done < js.txt \
  | grep -oE '(AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ghp_[0-9A-Za-z]{36}|sk_live_[0-9a-zA-Z]{24})' \
  | sort -u
```

## 発見事項にするとき

- **値そのものを報告書に書かないでください。** 「どのファイルの何行目に、どの種類の鍵があるか」と、有効性の確認結果だけを書きます
- 対策は 2 段構えです。(1) 鍵をただちに失効・再発行する (2) 履歴から削除する（削除だけでは不十分で、失効が先）
- 影響は鍵の権限によります。鍵が何にアクセスできるかを確認したうえで深刻度を決めてください

## 注意点

有効性の検証（`--only-verified`）は、その API に実際に接続します。**顧客の本番サービスに対する認証試行**にあたるため、RoE の範囲内かを確認してください。
