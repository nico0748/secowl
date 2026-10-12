---
name: S3 バケットの調査（S3Scanner / GrayhatWarfare）
category: Webアプリケーションの調査
tags: [クラウド, ストレージ, 情報露出]
url: https://github.com/sa7mon/S3Scanner
license: MIT / 商用（GrayhatWarfare）
phase: [recon, survey]
---

## 機能

公開設定のまま放置されたオブジェクトストレージです。バックアップ、設定ファイル、顧客データが入っていることがあり、見つかれば影響の大きい発見事項になります。

## S3Scanner

バケット名の候補を当てて、公開状態を調べます。

```bash
# 名前の候補から
s3scanner scan -f bucket-names.txt

# ドメインから候補を作る
s3scanner scan -b example-backup
s3scanner scan -b example-assets -b example-dev -b example-staging

# 列挙できるものを一覧に
s3scanner scan -f names.txt --enumerate
```

候補名の作り方: `<組織名>`、`<組織名>-backup`、`<組織名>-dev`、`<組織名>-assets`、`<製品名>-prod` など。
JS バンドルやページ内の URL に実際のバケット名が書かれていることも多いので、先に `grep -oE 's3[.-][a-z0-9.-]*amazonaws\.com[^"]*'` で拾ってください。

## GrayhatWarfare

既に収集済みの公開バケットとファイルを検索できるサービスです。自分で当てずに探せます。

```
# ブラウザで
https://buckets.grayhatwarfare.com/
検索語: example.com / 組織名 / 製品名
```

## 他のクラウド

| 事業者 | 確認先 |
|---|---|
| Azure Blob | `https://<account>.blob.core.windows.net/<container>?restype=container&comp=list` |
| Google Cloud Storage | `https://storage.googleapis.com/<bucket>` |
| Alibaba OSS | `https://<bucket>.oss-<region>.aliyuncs.com/` |

## 注意点

- **中身をダウンロードする前に止まってください。** 公開状態の確認（一覧が取れること、1 件のヘッダが取れること）までを証跡とし、ファイルの取得は RoE で許可されている場合に限ります
- 他組織のバケットに当たることがあります。名前が似ているだけで無関係の可能性があるため、所有者を確認せずに操作しないでください
- 対策として発見事項に書くのは「バケットポリシーとブロックパブリックアクセスの設定」「オブジェクト単位の ACL ではなくバケット単位での制御」です
