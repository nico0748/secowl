---
name: Nikto
category: Webアプリケーションの調査
tags: [Webサーバ, 設定確認, 古典, OSS]
url: https://github.com/sullo/nikto
license: GPL
phase: [survey]
---

## 位置づけ

Web サーバの既知の設定不備と危険なファイルを調べる古典的なスキャナです。検出は粗く誤検出も多いものの、**短時間で広く当たりをつける**用途では今も使えます。

```bash
nikto -h https://example.com -o nikto.txt
nikto -h https://example.com -Tuning 123b      # 検査種別を絞る
nikto -h https://example.com -useproxy http://127.0.0.1:8080   # Burp を通す
```

`-useproxy` で Burp を経由させると、Nikto が送った要求がすべて History に残ります。あとから手で追えるため、この使い方を勧めます。

## 注意点

- 要求が目立つため WAF に遮断されやすく、以降の診断に影響することがあります。診断の終盤に回すか、除外申請後に実行してください
- 出力の大半は情報レベルです。そのまま発見事項にせず、実際に到達できるかを確認してから起票してください
