---
name: 新規ドメインの偵察を一から立ち上げる
phase: recon
tools: [crt.sh, subfinder, OWASP Amass, dnsx, httpx, aquatone, nmap, naabu]
summary: ドメイン名だけ渡された状態から、スコープ内の攻撃面を一覧にするまで
---

## 前提

RoE に署名があり、診断元 IP が許可リストに登録済みであること。署名前はパッシブな手段（crt.sh、Shodan、Censys、subfinder の passive）だけを使います。

## 手順

### 1. パッシブに集める（対象へパケットを送らない）

```bash
# 証明書透明性ログ
curl -s 'https://crt.sh/?q=%25.example.com&output=json' \
  | jq -r '.[].name_value' | sed 's/\*\.//' | sort -u > crt.txt

# パッシブ列挙
subfinder -d example.com -all -silent > subfinder.txt
amass enum -passive -d example.com -o amass.txt

cat crt.txt subfinder.txt amass.txt | sort -u > subs.txt
wc -l subs.txt
```

### 2. 生きているものを選別する

```bash
# ワイルドカード DNS を除外しつつ解決
dnsx -l subs.txt -wd example.com -a -resp -silent > resolved.txt

# HTTP が応答するものだけ
httpx -l resolved.txt -silent -json -status-code -title -tech-detect -web-server > httpx.jsonl
```

### 3. SecOwl に取り込む

「偵察 → ツール出力を取り込む」に `subs.txt` と `httpx.jsonl` を順に貼ります。
サブドメインとエンドポイントがサーフェスとして登録され、技術スタックが「テクノロジー」に集計されます。

### 4. 目で確認する

```bash
cut -d'"' -f4 httpx.jsonl | aquatone -out ./shots
open ./shots/aquatone_report.html
```

一覧を見て、次のものに印を付けます。

- 既定のインストール画面、管理画面、ステージング環境のラベル
- ログイン画面（認証・認可の検証対象）
- エラーページにスタックトレースが出ているもの

### 5. ポートを見る

```bash
# 速く絞る
naabu -list resolved.txt -top-ports 1000 -silent -o ports.txt

# 詳細は nmap で
nmap -sV -sC -iL alive.txt -oA detail
```

`detail.xml` を取り込むと、ホストとポートがサーフェスになります。

### 6. スコープを確定する

ここまでで出た一覧を顧客に提示し、次を確認します。

- 対象に含めるもの、除くもの（SecOwl では「対象外」の状態にすると集計から外れます）
- 他組織と共用しているホストの有無
- 検証を避けるべき時間帯と機能

確定したら、サーフェスの状態を「未調査」にして E2 へ進みます。

## このフェーズで記録すること

| 記録 | SecOwl での場所 |
|---|---|
| 使ったコマンド | ツール実行ログ（フェーズ: 偵察・列挙） |
| 見つけた攻撃面 | サーフェス |
| スコープの合意 | 00-診断対象/スコープとRoE.md |
