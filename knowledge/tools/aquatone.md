---
name: aquatone（スクリーンショットの一括取得）
category: Webアプリケーションの調査
tags: [スクリーンショット, 一覧化, 偵察]
url: https://github.com/michenriksen/aquatone
license: MIT
phase: [recon]
---

## 機能

多数の URL を開いてスクリーンショットを撮り、HTML のレポートにまとめます。**数百のサブドメインを目で確認する**作業を現実的な時間に収めます。

```bash
cat resolved.txt | aquatone -out ./aquatone -ports large -threads 10
open ./aquatone/aquatone_report.html
```

後継として `gowitness` も使えます。

```bash
gowitness scan file -f urls.txt --screenshot-path ./shots
gowitness report serve        # ブラウザで一覧を見る
```

## 見どころ

一覧にしたときに目に付くのは次の種類です。

- 既定のインストール画面（WordPress、phpMyAdmin、Tomcat の管理画面）
- 開発・ステージング環境のラベルが入った画面
- ログイン画面だけが並ぶ中で、1 つだけ中身が見えているもの
- エラーページにスタックトレースが出ているもの

## 注意点

スクリーンショットには実際の画面が写ります。顧客の業務データが写り込む可能性があるため、保存先と廃棄の扱いを RoE に合わせてください。
