---
name: subfinder
category: サブドメイン探索
tags: [必修, サブドメイン, パッシブ, OSS]
url: https://github.com/projectdiscovery/subfinder
license: MIT（無償）
phase: [recon]
---

## 機能

パッシブな情報源だけを使ってサブドメインを集めます。Amass より軽く速いため、まずこれを回してから Amass で補うのが実務的な順序です。

```bash
# 基本
subfinder -d example.com -silent -o subs.txt

# すべての情報源を使う（API キーを設定している前提）
subfinder -d example.com -all -silent

# 複数ドメインをまとめて
subfinder -dL domains.txt -all -silent -o subs.txt

# そのまま生存確認へつなぐ
subfinder -d example.com -silent | dnsx -silent -a -resp | tee resolved.txt
```

API キーは `~/.config/subfinder/provider-config.yaml` に書きます。

## SecOwl への取り込み

出力をそのまま「偵察 → ツール出力を取り込む」に貼れば、サブドメインがサーフェスとして登録されます。

```bash
subfinder -d example.com -silent > subs.txt   # 1 行 1 ドメインの形式
```

## 注意点

パッシブでも、情報源の API 提供者には照会の記録が残ります。秘匿性の高い診断対象では、使う情報源を絞ってください。
