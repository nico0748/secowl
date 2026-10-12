---
name: Chaos（ProjectDiscovery）
category: サブドメイン探索
tags: [サブドメイン, データセット, バグバウンティ]
url: https://chaos.projectdiscovery.io/
license: 無償（API キー登録制）
phase: [recon]
---

## 機能

ProjectDiscovery が継続的に収集している、**公開バグバウンティプログラム対象のサブドメイン一覧**です。対象がバウンティを公開している組織であれば、既知のサブドメインを即座に取得できます。

```bash
chaos -d example.com -silent -o chaos.txt
chaos -d example.com -silent | httpx -silent -title -status-code
```

API キーは `CHAOS_KEY` 環境変数に入れます。

## 使いどころ

- バグバウンティの対象を調べるとき
- 受託診断では、**対象がバウンティを公開していなければデータがありません**。その場合は他の情報源を使ってください

## 注意点

データセットには過去の記録が含まれます。現存するかは `dnsx` で確認してください。
