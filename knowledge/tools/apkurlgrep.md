---
name: ApkUrlGrep（APK からのエンドポイント抽出）
category: Webアプリケーションの調査
tags: [モバイル, エンドポイント抽出, 偵察]
url: https://github.com/ndelphit/apkurlgrep
license: MIT
phase: [recon]
---

## 機能

Android の APK を展開し、含まれている URL とエンドポイントを抜き出します。**公開アプリから、Web 側では公開されていない API の一覧が取れる**ことがあります。

```bash
apkurlgrep -a app.apk
apkurlgrep -a app.apk | grep example.com | sort -u > endpoints.txt
```

## 併せて使うもの

```bash
# APK を展開して中身を読む
apktool d app.apk -o app_decoded
jadx-gui app.apk          # Java に逆コンパイルして読む

# 設定ファイルや鍵の混入を探す
grep -rniE 'api[_-]?key|secret|password|token|bearer' app_decoded/ | head -50

# 通信先のドメイン
grep -rhoE 'https?://[a-zA-Z0-9./_-]+' app_decoded/ | sort -u
```

## 使いどころ

- Web の診断で、アプリ専用 API がスコープに入っているかの確認材料
- 認証なしで叩ける内部向けエンドポイントの発見
- ハードコードされた資格情報の検出（発見事項になります）

## 注意点

- **APK の取得と逆コンパイルが RoE の範囲内かを確認してください。** 対象組織のアプリであっても、利用規約で逆コンパイルを禁じている場合があります
- 抽出したエンドポイントへ要求を送る前に、それがスコープ内かを確かめてください
- ハードコードされた鍵を見つけた場合、値を報告書に書かず、位置（ファイルと行）と種類だけを示してください
