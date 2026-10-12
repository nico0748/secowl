---
name: Subdomain Takeover を探す
phase: survey
tools: [subfinder, dnsx, subjack, nuclei]
summary: 解放済みの外部サービスを指したままの CNAME を見つける
---

## 1. 候補を絞る

```bash
# サブドメインを集める
subfinder -d example.com -all -silent > subs.txt

# CNAME が外部サービスを指しているものだけ残す
dnsx -l subs.txt -cname -resp -silent \
  | grep -Ei 's3|github\.io|herokuapp|azurewebsites|cloudapp|netlify|cloudfront|fastly|surge\.sh|readthedocs|shopify|zendesk|statuspage|bitbucket' \
  > cname-candidates.txt
```

**解決しない CNAME** も候補です。参照先が消えている状態です。

```bash
dnsx -l subs.txt -cname -resp -silent -rcode nxdomain
```

## 2. 指紋で判定する

```bash
subjack -w subs.txt -t 50 -timeout 30 -ssl -c fingerprints.json -v -o takeover.txt
nuclei -l subs.txt -t http/takeovers/ -silent
```

## 3. 手で確かめる

自動ツールの出力は候補です。応答を見て判断します。

```bash
curl -sI https://old.example.com | head -5
curl -s  https://old.example.com | head -30
dig +short CNAME old.example.com
```

| 応答 | 判定 |
|---|---|
| サービス側の「このリソースは存在しません」画面 | 乗っ取り可能の疑い。**要検証** |
| 正常なコンテンツ | 問題なし |
| 404 だがサービス固有の文言が無い | 別の原因の可能性。CNAME 先を確認 |

## 4. 確定のさせ方

確定は「そのリソース名を自分で取得できるか」で決まりますが、**取得は RoE で明示的に許可されている場合のみ**行ってください。

許可がある場合:

1. 該当サービスでリソースを作成し、識別できる文言を置く
2. 対象のサブドメインでその文言が返ることを確認し、証跡にする
3. **ただちに解放する。** 解放した時刻を証跡に記録する

許可がない場合は、CNAME の記録とサービス側の応答までを証跡とし、「乗っ取り可能な状態にある」と報告します。

## 5. 発見事項の書き方

- 深刻度は、親ドメインの Cookie が渡るか、OAuth のリダイレクト先に使われているかで変わります
- 対策は「外部サービスを解約する前に DNS レコードを削除する」「解決しない CNAME を定期的に検出する」
- 継続監視として、`dnsx` の実行を cron に入れる運用を提案できます
