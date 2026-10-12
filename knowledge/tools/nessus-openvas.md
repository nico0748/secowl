---
name: Nessus / OpenVAS（脆弱性スキャナ）
category: ポートスキャン
tags: [脆弱性スキャナ, プラットフォーム診断]
url: https://www.tenable.com/products/nessus
license: Nessus Essentials は無償（16 IP まで）/ OpenVAS は GPL
phase: [survey]
---

## 位置づけ

既知の脆弱性（CVE）をシグネチャで照合します。**プラットフォーム診断（OS・ミドルウェア）向け**であり、Web アプリ固有の論理的な欠陥は見つけられません。Web アプリ診断では Burp と手動検証が主役で、こちらは補助です。

| ツール | 特徴 |
|---|---|
| Nessus | 検出精度と更新頻度が高い。Essentials は 16 IP まで無償 |
| OpenVAS / Greenbone | OSS。Docker で立てられる。更新は Nessus より遅れる |

```bash
# OpenVAS を Docker で立てる例
docker run -d -p 9392:9392 -e PASSWORD=<pass> --name openvas immauss/openvas
# ブラウザで https://localhost:9392
```

## 使いどころ

- 公開サーバの OS とミドルウェアに既知の脆弱性が残っていないかの確認
- 設定不備（既定の資格情報、不要なサービス、弱い暗号）の洗い出し

## 注意点

- **スキャンプロファイルによっては対象のサービスを停止させます。** 本番環境では「Safe Checks」を有効にし、破壊的なプラグインを外してください
- 出力される件数は多く、大半は情報レベルです。そのまま報告書に貼らず、影響を評価して絞ってください
- 誤検出があります。CVE を発見事項として起票する前に、実際のバージョンと到達性を手で確認してください
