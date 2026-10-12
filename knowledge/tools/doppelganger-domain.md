---
name: ドッペルゲンガードメインの調査（dnstwist / urlcrazy）
category: フィッシング訓練
tags: [ドメイン, 監視, 訓練準備, OSS]
url: https://github.com/elceef/dnstwist
license: Apache-2.0（dnstwist）
phase: [recon]
---

## 機能

対象ドメインに似た綴りのドメインを機械的に作り出し、**実際に登録されているか**を調べます。使い道は 2 つあります。

1. **防御**: 自組織に似たドメインが第三者に取られていないかの監視。取られていれば、それ自体が報告対象です
2. **訓練準備**: 訓練で使うドメインの候補選び。合意のうえで自組織が先に押さえる

## 生成されるパターン

| 種別 | 例（example.com に対して） |
|---|---|
| 文字の入れ替え | exmaple.com |
| 隣接キーの打ち間違い | exsmple.com |
| 文字の欠落・重複 | exampl.com / exaample.com |
| 見た目が似た文字 | exarnple.com（rn → m）、examp1e.com |
| ハイフン挿入 | exa-mple.com |
| TLD 違い | example.co / example.net / example.co.jp |
| サブドメイン化 | example.com.login-page.net |

## 使い方

```bash
# 登録済みのものだけを出し、MX レコードの有無も見る
dnstwist --registered --mxcheck --format csv example.com > twist.csv

# スクリーンショットと類似度まで取る
dnstwist --registered --screenshots ./shots --phash example.com

# 別実装
urlcrazy -f csv example.com
```

`--mxcheck` で MX が立っているものは、メール受信の準備がある＝実害の可能性が高い候補です。優先して調べてください。

## 見つかったあとの調べ方

1. `whois` で登録日と登録者を見る。自組織の防衛的登録かを確かめる
2. 証明書透明性ログ（crt.sh）で証明書が発行されているかを見る
3. urlscan.io と VirusTotal で過去の挙動を見る
4. 実害がある場合は、レジストラへの申し立てと JPCERT/CC への連絡を検討する

## 訓練でドメインを選ぶときの条件

- 自組織が所有するか、新規に取得したものに限る。**他者が登録済みのドメインは使わない**
- 訓練後も保持し、第三者に渡らないようにする
- 対象者が後から検索したときに、訓練であったと分かる記録を残す
