---
type: vs-scope
title: "{{title}}"
engagement: "{{engagement}}"
client: "{{client}}"
target_system: "{{target_system}}"
period_from: "{{period_from}}"
period_to: "{{period_to}}"
agreed: false
agreed_at: ""
agreed_by: ""
scope_targets: []
scope_allow: []
scope_deny: []
scope_ports: []
created: {{today}}
updated: {{today}}
tags:
  - 521-web
  - pentest-scope
  - roe
status: draft
confidential: true
---

# スコープ / Rules of Engagement (RoE) — {{title}}

> クライアントの書面承認を得るまで診断を開始しないでください。許可のない検証は法令と契約に違反します。
> 対応フェーズ: E0 事前準備

## 1. 当事者・体制

| 役割 | 氏名 / 連絡先 |
|---|---|
| クライアント窓口 |  |
| 診断責任者（自社） |  |
| 診断実施者 |  |
| 緊急連絡先（両者） |  |

## 2. 診断対象（イン・スコープ）

| 種別 | 値 |
|---|---|
| URL / FQDN |  |
| IP レンジ |  |
| API（OpenAPI/Swagger） |  |
| 画面・機能 |  |

### 認証境界・アカウント

- 認証境界（未認証 / 一般 / 管理 / テナント別）:
- 提供アカウント（ロール別に最低2セット）:

## 3. 対象外（アウト・オブ・スコープ）

- [ ] 決済本番系
- [ ] 外部連携先・サードパーティ
- [ ] 記載外サブドメイン
- [ ] その他:

## 4. 禁止行為

- [ ] DoS / 大量負荷試験
- [ ] ソーシャルエンジニアリング
- [ ] 物理侵入
- [ ] 本番データの破壊・改ざんを伴う検証
- [ ] その他:

## 5. 実施条件

- 検証時間帯:
- 診断元 IP（許可リストへ登録する値）:
- WAF / IPS の有無と除外申請:
- 緊急停止条件（誰が、どの条件で停止を宣言するか）:
- データ取扱い: 証跡の機微情報はマスキングします。NDA: [有 / 無]

## 6. 成果物・スケジュール

- 納品物: 診断報告書 / リテスト結果
- 診断期間: {{period_from}} 〜 {{period_to}}
- 報告会: 

## 7. 承認

| 役割 | 氏名 | 日付 | 承認 |
|---|---|---|---|
| クライアント |  |  | ☐ |
| 自社責任者 |  |  | ☐ |
