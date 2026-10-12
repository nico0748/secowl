---
name: ログイン機能を診断する
phase: survey
tools: [Burp Suite, ffuf, jwt_tool, Wireshark, testssl.sh]
summary: 認証・セッション・認可の 3 層を順に確かめる
---

## 準備

- ロール別に 2 セット以上のアカウント（一般 A、一般 B、管理）を受け取る
- Burp の Scope に対象ホストだけを登録する
- ログイン前・一般 A・管理 の 3 回、画面を一通り操作して Site map を 3 つ作る

## 1. 認証（WSTG-ATHN）

| 確認 | 手順 | 成立したときの発見事項 |
|---|---|---|
| ユーザ列挙 | 登録済み／未登録のアドレスで失敗したときの文言と応答時間を比べる | CWE-204 |
| ブルートフォース耐性 | 同一アカウントに 20 回失敗する。ロックされるか | CWE-307 |
| パスワードポリシー | `a` 1 文字で登録できるか | CWE-521 |
| リセットの不備 | リセットトークンの推測可能性、有効期限、再利用 | CWE-640 |
| 多要素認証の回避 | OTP 検証をスキップして次の画面へ直接要求を送る | CWE-287 |

```bash
# 応答時間の差を測る
for u in registered@example.com notexist@example.com; do
  curl -s -o /dev/null -w "$u %{time_total}\n" \
    -X POST https://example.com/login -d "email=$u&password=wrong"
done
```

## 2. セッション（WSTG-SESS）

- Cookie 属性: `Secure` `HttpOnly` `SameSite` が付いているか
- ログイン後にセッション ID が**再発行されるか**（固定化の防止）
- ログアウト後に古いセッション ID が無効になるか
- トークンが JWT なら `jwt_tool` で署名検証を確かめる

```bash
curl -sI https://example.com/login | grep -i set-cookie
jwt_tool <token> -M at -t https://example.com/api/me -rh "Authorization: Bearer "
```

## 3. 認可（WSTG-ATHZ）

ここが最も発見事項につながります。**一般 A のトークンで、一般 B と管理のリソースを要求します。**

1. 一般 B でログインし、リソース ID（注文番号、ユーザ ID）を控える
2. 一般 A に切り替え、Burp の Repeater で ID だけを B のものに差し替える
3. 200 が返れば水平権限昇格（IDOR、CWE-639）
4. 管理専用の API を一般 A のトークンで叩く。通れば垂直権限昇格（CWE-285）

Burp 拡張の **Autorize** を入れると、一般 A のセッションで同じ要求を自動再送し、結果を一覧にしてくれます。手作業の漏れを防げます。

## 4. 通信路

```bash
# 平文で届く経路が残っていないか
curl -sI http://example.com/login
nmap --script ssl-enum-ciphers -p 443 example.com
./testssl.sh --fast https://example.com
```

平文の POST が成立するなら、Wireshark で実際に資格情報が読めることを証跡にします（値はマスキング）。

## 記録の仕方

検証した項目は、その都度「調査 → 診断チェックリスト」を切り替えます。
検出があったものは「トリアージ → 発見事項を起票」へ送り、CVSS 計算機でベクタを決めます。
