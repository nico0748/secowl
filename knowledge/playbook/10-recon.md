---
phase: recon
order: 2
title: 偵察・列挙
label: E1
goal: 攻撃面（画面・API・認証境界）の一覧をそろえ、チェックリストに反映する
summary: 受動的偵察を先に尽くし、そのあと能動的偵察で裏を取ります。成果物はサーフェス一覧と入力点の棚卸しです。
steps:
  - title: 受動的偵察から始める
    detail: 対象へパケットを送らずに集めます。WHOIS で管理組織、証明書透明性ログで関連ホスト、検索エンジンで公開ページの構成を把握します。痕跡が残らないため、ここを尽くしてから能動に移ります。
    tools: [whois-jprs, viewdns-reverse-whois, crt-sh, asn-ip-range, subdomain-data-sources, shodan-censys, wayback-gau]
  - title: サブドメインを列挙する
    detail: パッシブな情報源から名前を集めます。集めた名前はスコープ内かどうかを必ず照合し、対象外は記録だけ残して触れません。
    tools: [subfinder, amass, chaos, sublist3r-findomain]
  - title: 生存しているホストを絞り込む
    detail: 名前解決と HTTP 応答で、実際に動いているものだけを残します。ステータス・タイトル・Server ヘッダ・技術スタックがここで分かります。
    tools: [naabu-dnsx, httpx, wappalyzer]
  - title: ポートとサービスを特定する
    detail: 対象ホストの開いているポートと、動いているサービス・バージョンを調べます。レートを抑え、破壊的な NSE スクリプトは使いません。
    tools: [nmap, masscan, naabu-dnsx]
  - title: catch-all かどうかを先に判定する
    detail: 存在しないパスに 200 を返すサーバでは、パス列挙が全部ヒットして無意味になります。トップページと存在しないパスの応答サイズを比べ、ほぼ同じなら catch-all として除外設定を入れます。
    tools: [ffuf]
  - title: 画面とパスを列挙する
    detail: robots.txt・sitemap.xml・HTML のリンクから既知の URL を先に集め、そのあとで辞書を回します。403 は「ない」ではなく「あるが見せない」の証拠です。
    tools: [ffuf, dirsearch-seclists, gobuster, aquatone, favfreak]
  - title: セキュリティヘッダと TLS を確認する
    detail: HSTS・CSP・X-Frame-Options・X-Content-Type-Options・Referrer-Policy・CORS の有無を記録します。TLS はプロトコル版・暗号スイート・証明書の期限と CN/SAN を見ます。
    tools: [httpx, testssl-sh]
  - title: 入力点を棚卸しする
    detail: フォーム・検索・クエリパラメータ・Cookie・ヘッダ・JSON の各入力点を一覧にします。この一覧が、次フェーズでインジェクションを網羅する単位になります。
    tools: [burp-suite, apkurlgrep, wayback-gau]
  - title: 認証境界を書き出す
    detail: 未認証で到達できる範囲・認証が要る範囲・管理者だけの範囲を分けます。境界が分かると、次フェーズの越境検証の設計ができます。
done:
  - サーフェスが 1 件につき 1 ファイルで登録されている
  - catch-all かどうかを判定した
  - 入力点（フォーム・パラメータ・ヘッダ）を列挙した
  - 技術スタックとバージョンを特定した。特定できない場合は「特定不能」と記録した
  - 認証境界を未認証・一般・管理の 3 区分で書き出した
pitfalls:
  - ツールを流すこと自体が目的になり、攻撃面の地図ができていない
  - catch-all を判定せずにパス列挙を回し、偽の結果を大量に拾う
  - スコープ外のホストが列挙結果に混ざったまま、能動的な検証へ進む
  - レートを上げすぎて業務に影響を与える
---

## 偵察の 2 軸

| 種別 | 内容 | 痕跡 |
|---|---|---|
| 受動的（Passive） | 対象へパケットを一切送らない。WHOIS・DNS・CT ログ・検索エンジン・Shodan・Censys | 小 |
| 能動的（Active） | 対象へリクエストを送る。nmap・httpx・ffuf・gobuster・nuclei | 大 |

受動を尽くしてから能動に移ると、送るリクエスト数が減り、見落としも減ります。

## 定番の連鎖

```
subfinder → dnsx → httpx → nuclei
```

列挙して、生存を確認して、既知の脆弱性を一次スキャンする流れです。nuclei の結果は候補であり、手動の裏取りを経て初めて発見事項になります。

## catch-all の判定

```bash
TARGET=example.test
SZ_TOP=$(curl -s "https://$TARGET/" | wc -c)
SZ_404=$(curl -s "https://$TARGET/zzz-does-not-exist-$(date +%s)" | wc -c)
echo "top=$SZ_TOP  404=$SZ_404"
```

サイズがほぼ同じなら catch-all です。`ffuf -ac` または `-fs <サイズ>` で除外します。

## 列挙のレート

| 設定 | 値の目安 | 理由 |
|---|---|---|
| ffuf のスレッド | `-t 5` | 業務影響を避ける |
| ffuf の遅延 | `-p 0.3` | 同上 |
| nmap のタイミング | `-T3` から `-T4` まで | それ以上は負荷が読めない |
| 表示するステータス | `-mc 200,201,204,301,302,307,401,403,405,500` | 403 と 405 に意味がある |

## 受動先行でリクエストを減らす

辞書総当りの前に、sitemap.xml と HTML のリンクから既知の URL を集めます。これだけで列挙対象が大きく減ります。

## 攻撃面一覧の作り方

1. 偵察で見つけたサブドメイン・ホスト・ポート・エンドポイント・サービスを、種別ごとにサーフェスとして登録する
2. それぞれに「どのツールで見つけたか」と「観測した応答」を残す
3. 「着眼点」に、その面で重点的に確認するカテゴリを書く
4. 優先順位を付ける。ファイル授受・検索・認証・アップロードを持つ面を上に置く

優先順位は、入力点の数と、成立したときの影響の大きさで決めます。静的なページだけの面は後回しにします。
