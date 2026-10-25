/**
 * モックデータを作ります。
 *   node scripts/seed-mock.js            既定の保存先（secowl.config.json か data/）
 *   SECOWL_DATA=/path node scripts/seed-mock.js
 *   node scripts/seed-mock.js --reset    同名の診断対象フォルダを消してから作り直す
 *
 * 値はすべて架空です。example.com / example.jp と TEST-NET のアドレスだけを使います。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataRoot } from '../server/lib/config.js'
import {
  createEngagement, createSurface, createToolLog, createFinding,
  listSurfaces, listFindings, readDoc, writeDoc, toggleChecklist, docPaths,
} from '../server/lib/store.js'
import { buildReport } from '../server/lib/report.js'
import { saveEvidence } from '../server/lib/evidence.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RESET = process.argv.includes('--reset')

function section(eid, file, heading, content) {
  const doc = readDoc(file)
  writeDoc(file, { sections: [{ heading, content }] })
  return doc
}

/** engagement.json の created を上書きします。診断対象一覧はこの日付の降順に並びます。 */
function setCreated(eid, date) {
  const file = path.join(dataRoot(), eid, 'engagement.json')
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'))
  meta.created = date
  fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n', 'utf8')
}

function nukeIfNeeded(id) {
  const dir = path.join(dataRoot(), id)
  if (fs.existsSync(dir)) {
    if (!RESET) {
      console.log(`既にある診断対象を飛ばします: ${id}（作り直すなら --reset を付けてください）`)
      return false
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
  return true
}

/* ============================ 診断対象1: EC サイト ============================ */

function seedShop() {
  const eid = '2026-10-example-shop'
  if (!nukeIfNeeded(eid)) return
  createEngagement({
    name: eid,
    client: '株式会社エグザンプル商会',
    target_system: 'Example Shop（会員制 EC サイト）',
    period_from: '2026-10-05',
    period_to: '2026-10-16',
  })
  setCreated(eid, '2026-10-05')

  const S = {}
  const add = (key, input) => { S[key] = createSurface(eid, input).id }

  // --- 偵察・列挙 ---
  add('www', { kind: 'subdomain', value: 'www.example.com', host: '198.51.100.21', product: 'nginx 1.24.0', tech: ['Cloudflare', 'PHP 8.1'], discovered_by: ['crt.sh', 'subfinder'], status: '調査済' })
  add('admin', { kind: 'subdomain', value: 'admin.example.com', host: '198.51.100.22', product: 'nginx 1.24.0', tech: ['Cloudflare'], discovered_by: ['subfinder'], status: '調査済' })
  add('api', { kind: 'subdomain', value: 'api.example.com', host: '198.51.100.23', product: 'nginx 1.24.0', tech: ['PHP 8.1'], discovered_by: ['subfinder', 'amass'], status: '調査済' })
  add('stg', { kind: 'subdomain', value: 'stg.example.com', host: '198.51.100.40', product: 'Apache Tomcat 9.0.71', tech: ['Java 17'], discovered_by: ['amass'], status: '調査中' })
  add('img', { kind: 'subdomain', value: 'img.example.com', host: '198.51.100.24', product: 'Cloudflare', tech: ['Cloudflare'], discovered_by: ['crt.sh'], status: '対象外' })
  add('mail', { kind: 'subdomain', value: 'mail.example.com', host: '198.51.100.30', product: 'Postfix 3.8', discovered_by: ['dig'], status: '対象外' })

  add('p443w', { kind: 'port', value: 'www.example.com:443', host: '198.51.100.21', port: 443, protocol: 'tcp', service: 'https', product: 'nginx 1.24.0', discovered_by: ['nmap'], status: '調査済' })
  add('p80w', { kind: 'port', value: 'www.example.com:80', host: '198.51.100.21', port: 80, protocol: 'tcp', service: 'http', product: 'nginx 1.24.0', discovered_by: ['nmap'], status: '調査済' })
  add('p443a', { kind: 'port', value: 'admin.example.com:443', host: '198.51.100.22', port: 443, protocol: 'tcp', service: 'https', product: 'nginx 1.24.0', discovered_by: ['nmap'], status: '調査済' })
  add('p443api', { kind: 'port', value: 'api.example.com:443', host: '198.51.100.23', port: 443, protocol: 'tcp', service: 'https', product: 'nginx 1.24.0', discovered_by: ['nmap'], status: '調査済' })
  add('p8080', { kind: 'port', value: 'stg.example.com:8080', host: '198.51.100.40', port: 8080, protocol: 'tcp', service: 'http-proxy', product: 'Apache Tomcat 9.0.71', discovered_by: ['nmap'], status: '調査中' })
  add('p22', { kind: 'port', value: 'stg.example.com:22', host: '198.51.100.40', port: 22, protocol: 'tcp', service: 'ssh', product: 'OpenSSH 9.6p1', discovered_by: ['nmap'], status: '未調査' })
  add('p443stg', { kind: 'port', value: 'stg.example.com:443', host: '198.51.100.40', port: 443, protocol: 'tcp', service: 'https', product: 'Apache Tomcat 9.0.71', discovered_by: ['nmap'], status: '調査中' })
  add('p25', { kind: 'port', value: 'mail.example.com:25', host: '198.51.100.30', port: 25, protocol: 'tcp', service: 'smtp', product: 'Postfix 3.8', discovered_by: ['nmap'], status: '対象外' })

  add('search', { kind: 'endpoint', value: 'https://www.example.com/search', host: '198.51.100.21', port: 443, service: 'https', product: 'PHP 8.1', discovered_by: ['gobuster'], status: '調査済' })
  add('login', { kind: 'endpoint', value: 'https://www.example.com/login', host: '198.51.100.21', port: 443, service: 'https', product: 'PHP 8.1', discovered_by: ['gobuster'], status: '調査済' })
  add('cart', { kind: 'endpoint', value: 'https://www.example.com/cart/checkout', host: '198.51.100.21', port: 443, service: 'https', product: 'PHP 8.1', discovered_by: ['Burp Suite'], status: '調査済' })
  add('orders', { kind: 'endpoint', value: 'https://api.example.com/v1/orders/{id}', host: '198.51.100.23', port: 443, service: 'https', product: 'PHP 8.1', discovered_by: ['Burp Suite'], status: '調査済' })
  add('users', { kind: 'endpoint', value: 'https://api.example.com/v1/users/me', host: '198.51.100.23', port: 443, service: 'https', product: 'PHP 8.1', discovered_by: ['Burp Suite'], status: '調査済' })
  add('upload', { kind: 'endpoint', value: 'https://www.example.com/mypage/avatar', host: '198.51.100.21', port: 443, service: 'https', product: 'PHP 8.1', discovered_by: ['Burp Suite'], status: '調査済' })
  add('adminLogin', { kind: 'endpoint', value: 'https://admin.example.com/login', host: '198.51.100.22', port: 443, service: 'https', product: 'nginx 1.24.0', discovered_by: ['gobuster'], status: '調査済' })
  add('gitdir', { kind: 'endpoint', value: 'https://stg.example.com/.git/config', host: '198.51.100.40', port: 443, service: 'https', product: 'Apache Tomcat 9.0.71', discovered_by: ['ffuf'], status: '調査中' })

  // 対象外のサーフェスはスコープから外します。
  for (const k of ['img', 'mail', 'p25']) {
    const sf = listSurfaces(eid).find((x) => x.id === S[k])
    if (sf) writeDoc(sf.file, { data: { in_scope: false } })
  }

  // --- ツール実行ログ ---
  const logs = [
    ['nmap', 'recon', 'ポート全走査（www / admin / api）', 'nmap -sV -p- -T4 198.51.100.21-23', ['p443w', 'p80w', 'p443a', 'p443api']],
    ['nmap', 'recon', 'ステージング環境の走査', 'nmap -sV -p- 198.51.100.40', ['p8080', 'p22', 'p443stg']],
    ['nmap', 'recon', 'TLS 設定の確認', 'nmap --script ssl-enum-ciphers -p 443 www.example.com', ['p443w']],
    ['subfinder', 'recon', 'サブドメイン列挙', 'subfinder -d example.com -all -silent', ['www', 'admin', 'api', 'stg']],
    ['gobuster', 'recon', 'ディレクトリ列挙（www）', 'gobuster dir -u https://www.example.com -w raft-medium-words.txt -t 20', ['search', 'login']],
    ['gobuster', 'recon', 'ディレクトリ列挙（admin）', 'gobuster dir -u https://admin.example.com -w common.txt', ['adminLogin']],
    ['ffuf', 'recon', '隠しファイルの探索（stg）', 'ffuf -u https://stg.example.com/FUZZ -w dotfiles.txt -mc 200', ['gitdir']],
    ['Burp Suite', 'survey', '検索フォームの出力コンテキスト確認', 'Repeater: GET /search?q=<test>', ['search']],
    ['Burp Suite', 'survey', '注文 API の認可検証', 'Repeater: GET /v1/orders/10427（別利用者の ID）', ['orders']],
    ['Burp Suite', 'survey', 'アバター画像アップロードの検証', 'Repeater: POST /mypage/avatar（Content-Type と拡張子を変えて送信）', ['upload']],
    ['Burp Suite', 'survey', '決済手続きの金額改ざん', 'Repeater: POST /cart/checkout（total を書き換え）', ['cart']],
    ['sqlmap', 'survey', '検索パラメータの注入検証', 'sqlmap -u "https://www.example.com/search?q=1" --batch --level 2', ['search']],
    ['Wireshark', 'survey', '平文通信の確認', 'tcp.port == 80 && http.request', ['p80w']],
    ['nuclei', 'survey', '既知脆弱性テンプレートの実行', 'nuclei -u https://stg.example.com -severity medium,high,critical', ['gitdir', 'p8080']],
    ['curl', 'survey', 'セキュリティヘッダの確認', 'curl -sI https://www.example.com/', ['p443w']],
  ]
  const L = {}
  for (const [tool, phase, title, command, surfaceKeys] of logs) {
    L[title] = createToolLog(eid, { tool, phase, title, command, surfaces: surfaceKeys.map((k) => S[k]) }).id
  }

  // --- 発見事項個票 ---
  const findings = [
    {
      key: 'idor',
      vuln_name: '注文 API における水平権限昇格（IDOR）',
      identifier: 'CWE-639', wstg_id: 'WSTG-ATHZ-04',
      target: 'https://api.example.com/v1/orders/{id}',
      cvss_score: 9.6, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:N',
      surfaces: ['orders'], tools: ['Burp Suite'], status: 'confirmed',
      sections: {
        '平易な説明': '買い物をした人が、自分の注文番号を少し変えるだけで、別の会員の注文内容を見られる状態です。氏名・メールアドレス・購入履歴・購入金額が、本人以外に読まれます。\n特別な道具は要らず、ブラウザの操作だけで起こります。放置すると、会員情報の漏えいとして公表と通知が必要になります。',
        '発見場所': '- URL: `https://api.example.com/v1/orders/10427`\n- 画面遷移: ログイン → マイページ → 注文履歴 → 任意の注文を開く\n- 画面キャプチャ: ![証跡](evidence/fnd-0001-idor-response.png)',
        'リクエスト / レスポンス': '```http\nGET /v1/orders/10427 HTTP/1.1\nHost: api.example.com\nAuthorization: Bearer eyJhbGciOi...（マスキング済み）\n\nHTTP/1.1 200 OK\nContent-Type: application/json\n\n{"order_id":10427,"user_id":883,"user_name":"███ ███","email":"███@example.jp","total":24800}\n```',
        '脆弱性があると判断した理由': 'テスト利用者 A（user_id=901）のトークンで、別の利用者（user_id=883）の注文を取得できました。\nサーバは注文 ID の存在だけを確認し、トークンの利用者と注文の所有者が一致するかを確認していません。\nID を 10400 から 10450 まで順に試したところ、48 件で 200 が返りました。',
        '脆弱性の解説': 'オブジェクト参照に利用者の識別子を含めず、所有権の検証を行わないと、ID を変えるだけで他人のリソースを読めます。\n本件では注文 ID が連番で、総当たりの難度も低い状態でした。',
        'システム・ビジネスへの影響': '- 技術的影響（機密性）: 会員の氏名・メールアドレス・購入履歴・購入金額が第三者に読まれます。\n- 事業的影響: 個人データの漏えいにあたり、個人情報保護法上の報告対象になり得ます。会員向けの説明と通知が必要になります。',
        '対策': '- 恒久対策（コードレベル）: 注文取得の処理で、トークンの `user_id` と注文の所有者 `user_id` が一致する場合だけ返すようにします。一致しないときは 404 を返し、存在の有無も伝えないようにします。\n- 短期回避策（設定レベル）: API ゲートウェイで `/v1/orders/` への連続アクセスをレート制限し、異常な件数のアクセスを検知します。',
        'リテスト': '- 判定: 未対応\n- 確認日・確認内容: 未実施',
      },
    },
    {
      key: 'adminauth',
      vuln_name: '管理画面の認証バイパス',
      identifier: 'CWE-287', wstg_id: 'WSTG-ATHN-04',
      target: 'https://admin.example.com/',
      cvss_score: 9.8, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      surfaces: ['adminLogin', 'admin'], tools: ['Burp Suite'], status: 'confirmed',
      sections: {
        '平易な説明': 'ログインしていない人が、管理者用の画面にそのまま入れる状態です。会員情報の閲覧、商品価格の変更、注文の取消まで実行できます。\n攻撃者は画面の住所を直接入力するだけで入れます。売上への直接の損害と、全会員の情報漏えいにつながります。',
        '発見場所': '- URL: `https://admin.example.com/dashboard`\n- 画面遷移: ログイン画面を経由せず直接アクセス',
        '脆弱性があると判断した理由': '認証状態を `Cookie: is_admin=0` の値だけで判定しています。この値を `1` に書き換えると、ログインしていない状態で管理ダッシュボードが表示されました。\nサーバ側にセッションの検証処理がありません。',
        'システム・ビジネスへの影響': '- 技術的影響: 管理機能（会員情報の閲覧、商品価格の変更、注文の取消）を誰でも実行できます。\n- 事業的影響: 全会員の情報が漏えいし、価格改ざんによる売上への直接の損害が生じます。',
        '対策': '- 恒久対策: 認証状態をサーバ側のセッションで保持し、Cookie には推測できないセッション ID だけを置きます。管理画面の全ルートで権限を確認します。\n- 短期回避策: 管理画面を社内 IP からのアクセスに限定します。',
        'リテスト': '- 判定: 未対応',
      },
    },
    {
      key: 'xss',
      vuln_name: '検索機能における反射型クロスサイトスクリプティング',
      identifier: 'CWE-79', wstg_id: 'WSTG-INPV-01',
      target: 'https://www.example.com/search',
      cvss_score: 6.1, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N',
      surfaces: ['search'], tools: ['Burp Suite'], status: 'confirmed',
      sections: {
        '平易な説明': '検索欄に細工した文字を入れたリンクを踏ませると、利用者のブラウザで攻撃者の指示が動く状態です。会員になりすまして買い物をされる恐れがあります。\nメールやSNSのリンクから被害が広がるため、利用者側では気づけません。',
        '発見場所': '- URL: `https://www.example.com/search?q=`\n- 画面位置: 検索結果ページの見出し部分\n- 画面キャプチャ: ![証跡](evidence/fnd-0003-xss-alert.png)',
        'リクエスト / レスポンス': '```http\nGET /search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E HTTP/1.1\nHost: www.example.com\n\nHTTP/1.1 200 OK\nContent-Type: text/html; charset=UTF-8\n\n<h2>「<script>alert(1)</script>」に一致する商品</h2>\n```',
        '脆弱性があると判断した理由': '`q` パラメータの値が HTML エスケープされずに応答へ出力されます。`<` と `>` がそのまま残るため、ブラウザは値をタグとして解釈します。',
        '脆弱性の解説': 'HTML 本文に値を出力する場面では、`& < > " \'` をエンティティへ変換する必要があります。本件では変換処理が入っていません。',
        'システム・ビジネスへの影響': '- 技術的影響: 利用者のブラウザで任意のスクリプトが動きます。セッション Cookie に HttpOnly が付いているため Cookie の直接窃取はできませんが、画面の書き換えと入力内容の送信は可能です。\n- 事業的影響: 偽のログインフォームを重ねる手口に使われます。',
        '対策': '- 恒久対策: テンプレートエンジンの自動エスケープを有効にし、`q` の出力箇所でエスケープを行います。\n- 短期回避策: CSP で `script-src \'self\'` を指定し、インラインスクリプトの実行を止めます。',
        'リテスト': '- 判定: 未対応',
      },
    },
    {
      key: 'upload',
      vuln_name: 'アバター画像アップロードにおける拡張子の検証不備',
      identifier: 'CWE-434', wstg_id: 'WSTG-BUSL-09',
      target: 'https://www.example.com/mypage/avatar',
      cvss_score: 8.8, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
      surfaces: ['upload'], tools: ['Burp Suite'], status: 'confirmed',
      sections: {
        '平易な説明': 'プロフィール画像の登録欄に、画像ではないファイルを登録できる状態です。登録したファイルがサーバ上で動くと、サーバそのものを乗っ取られます。\n会員登録さえすれば誰でも試せるため、影響は大きくなります。',
        '発見場所': '- URL: `https://www.example.com/mypage/avatar`',
        '脆弱性があると判断した理由': 'ファイル名の末尾だけで拡張子を判定しています。`avatar.php.png` という名前で送ると `.png` として受理され、保存先では `.php` として扱われました。保存先 `/uploads/` は PHP の実行対象に含まれています。\n検証では無害な `phpinfo()` を含まないテキスト出力だけを確認し、設置したファイルは撤去済みです。',
        'システム・ビジネスへの影響': '- 技術的影響: Web サーバ上で任意のコードが実行されます。\n- 事業的影響: サーバの掌握につながり、会員データベースへの到達も想定されます。',
        '対策': '- 恒久対策: 保存名をサーバ側で生成し、拡張子を画像形式に固定します。マジックバイトで形式を確認します。\n- 短期回避策: `/uploads/` を PHP の実行対象から外します。',
        'リテスト': '- 判定: 未対応',
      },
    },
    {
      key: 'gitexp',
      vuln_name: 'ステージング環境における .git ディレクトリの公開',
      identifier: 'CWE-538', wstg_id: 'WSTG-CONF-04',
      target: 'https://stg.example.com/.git/config',
      cvss_score: 7.5, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N',
      surfaces: ['gitdir', 'stg'], tools: ['ffuf', 'nuclei'], status: 'confirmed',
      sections: {
        '平易な説明': '開発用の設計図一式が、誰でも読める場所に置かれたままの状態です。社内のファイル構成や接続情報が外部から読み取れます。\n攻撃者はこれを手がかりに、他の弱点を効率よく探せます。',
        '発見場所': '- URL: `https://stg.example.com/.git/config`',
        '脆弱性があると判断した理由': '`.git/config` と `.git/HEAD` が認証なしで取得できました。リポジトリの構成とリモート URL が読み取れます。',
        'システム・ビジネスへの影響': '- 技術的影響: ソースコードと、コミットに含まれる設定値が第三者に読まれます。\n- 事業的影響: 認証情報が履歴に残っている場合、本番環境への侵入経路になります。',
        '対策': '- 恒久対策: デプロイ成果物に `.git` を含めないようにします。\n- 短期回避策: Web サーバで `.git` 以下へのアクセスを拒否します。',
        'リテスト': '- 判定: 未対応',
      },
    },
    {
      key: 'price',
      vuln_name: '決済手続きにおける金額の改ざん',
      identifier: 'CWE-472', wstg_id: 'WSTG-BUSL-01',
      target: 'https://www.example.com/cart/checkout',
      cvss_score: 6.5, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N',
      surfaces: ['cart'], tools: ['Burp Suite'], status: 'confirmed',
      sections: {
        '平易な説明': '支払い手続きの途中で金額を書き換えると、その金額のまま決済が通る状態です。商品を不当に安く購入されます。\n売上が直接目減りするうえ、会計の数字が実態と合わなくなります。',
        '発見場所': '- URL: `https://www.example.com/cart/checkout`',
        '脆弱性があると判断した理由': '`total` をリクエストボディで受け取り、サーバ側で再計算していません。24,800 円の注文を 1 円に書き換えた状態で確認画面まで到達しました。決済の実行は行っていません。',
        'システム・ビジネスへの影響': '- 事業的影響: 商品を不当な金額で購入されます。損害は注文ごとに直接発生します。',
        '対策': '- 恒久対策: 金額はサーバ側で商品マスタから再計算し、クライアントから受け取った値は使いません。',
        'リテスト': '- 判定: 未対応',
      },
    },
    {
      key: 'userenum',
      vuln_name: 'ログイン画面における利用者の列挙',
      identifier: 'CWE-204', wstg_id: 'WSTG-IDNT-04',
      target: 'https://www.example.com/login',
      cvss_score: 5.3, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N',
      surfaces: ['login'], tools: ['Burp Suite'], status: 'confirmed',
      sections: {
        '平易な説明': 'ログイン画面の反応の違いから、そのメールアドレスが会員かどうかを外部から判別できる状態です。\n会員であることが分かると、そのアドレスを狙った詐欺メールやパスワードの試行が行われます。',
        '発見場所': '- URL: `https://www.example.com/login`',
        '脆弱性があると判断した理由': '登録済みのアドレスでは「パスワードが違います」、未登録では「アカウントが見つかりません」と表示が分かれます。応答時間も 110ms と 42ms で差がありました。',
        'システム・ビジネスへの影響': '- 技術的影響: 登録済みアドレスの一覧を作られ、パスワードリスト攻撃の精度が上がります。',
        '対策': '- 恒久対策: 失敗時の表示を 1 種類にまとめ、未登録の場合もパスワード検証と同等の処理時間をかけます。',
        'リテスト': '- 判定: 未対応',
      },
    },
    {
      key: 'plaintext',
      vuln_name: 'HTTP での平文通信',
      identifier: 'CWE-319', wstg_id: 'WSTG-CRYP-03',
      target: 'http://www.example.com/',
      cvss_score: 5.9, cvss_vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N',
      surfaces: ['p80w'], tools: ['Wireshark'], status: 'confirmed',
      sections: {
        '平易な説明': '通信が暗号化されない経路が残っています。公衆無線LANなどでは、入力した内容を第三者に読み取られる恐れがあります。',
        '発見場所': '- URL: `http://www.example.com/`',
        '脆弱性があると判断した理由': '80 番ポートが HTTPS へリダイレクトせず、ログインフォームを含むページを平文で返します。パケットキャプチャで `POST /login` の本文を平文のまま取得できました。',
        'システム・ビジネスへの影響': '- 技術的影響: 同一ネットワーク上の第三者が認証情報を読み取れます。',
        '対策': '- 恒久対策: 80 番への要求を 301 で HTTPS へ転送し、HSTS を設定します。',
        'リテスト': '- 判定: 未対応',
      },
    },
    {
      key: 'headers',
      vuln_name: 'セキュリティヘッダの未設定',
      identifier: 'CWE-693', wstg_id: 'WSTG-CONF-07',
      target: 'https://www.example.com/',
      cvss_score: 3.7, cvss_vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N',
      surfaces: ['p443w'], tools: ['curl'], status: 'confirmed',
      sections: {
        '平易な説明': 'ブラウザ側の安全装置を有効にする設定が入っていません。単独で被害は起きませんが、他の弱点が見つかったときに被害が大きくなります。',
        '発見場所': '- URL: `https://www.example.com/`\n- 画面キャプチャ: ![証跡](evidence/fnd-0009-security-headers.png)',
        '脆弱性があると判断した理由': '応答に `Strict-Transport-Security` / `Content-Security-Policy` / `X-Content-Type-Options` / `Referrer-Policy` のいずれも含まれていません。',
        'システム・ビジネスへの影響': '- 技術的影響: 他の脆弱性が成立したときの被害が広がります。単体での悪用はできません。',
        '対策': '- 恒久対策: nginx の設定で 4 つのヘッダを付与します。CSP は report-only で開始し、違反を確認してから強制します。',
        'リテスト': '- 判定: 未対応',
      },
    },
    {
      key: 'cookie',
      vuln_name: 'セッション Cookie の SameSite 属性が未設定',
      identifier: 'CWE-1275', wstg_id: 'WSTG-SESS-02',
      target: 'https://www.example.com/',
      cvss_score: 3.1, cvss_vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N',
      surfaces: ['p443w', 'login'], tools: ['Burp Suite'], status: 'confirmed',
      sections: {
        '平易な説明': 'ログイン状態を保持する仕組みの設定が緩く、別のサイトから意図しない操作をさせられる余地が残っています。',
        '発見場所': '- URL: `https://www.example.com/login`',
        '脆弱性があると判断した理由': '`Set-Cookie: SESSID=...; Path=/; HttpOnly; Secure` に `SameSite` が付いていません。Chrome の既定値は Lax のため直ちには悪用できませんが、既定値に依存した状態です。',
        '対策': '- 恒久対策: `SameSite=Lax` を明示します。外部サイトからの POST を受ける画面がある場合は個別に検討します。',
        'リテスト': '- 判定: 未対応',
      },
    },
    {
      key: 'dirlist',
      vuln_name: 'ディレクトリ一覧の表示',
      identifier: 'CWE-548', wstg_id: 'WSTG-CONF-04',
      target: 'https://stg.example.com/static/',
      cvss_score: 3.7, cvss_vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N',
      surfaces: ['p443stg'], tools: ['gobuster'], status: 'draft',
      sections: {
        '平易な説明': 'サーバ上のファイル一覧がそのまま見える状態です。公開するつもりのないファイルの存在が外部に伝わります。',
        '脆弱性があると判断した理由': '`/static/` でファイル一覧が表示されます。公開前のバナー画像が含まれていました。',
        '対策': '- 恒久対策: ディレクトリ一覧の表示を無効にします。',
      },
    },
    {
      key: 'banner',
      vuln_name: 'バージョン情報の露出',
      identifier: 'CWE-200', wstg_id: 'WSTG-INFO-02',
      target: 'https://www.example.com/',
      cvss_score: 0, cvss_vector: '',
      surfaces: ['p443w', 'p22'], tools: ['nmap', 'curl'], status: 'confirmed',
      sections: {
        '平易な説明': '使っているソフトの種類と版が外部から分かる状態です。攻撃者は、その版に効く攻撃だけを選んで試せます。',
        '脆弱性があると判断した理由': '`Server: nginx/1.24.0` と `X-Powered-By: PHP/8.1.27` が返ります。SSH も `OpenSSH 9.6p1` を返します。いずれも既知の脆弱性が無いバージョンです。',
        'システム・ビジネスへの影響': '- 技術的影響: 単体では被害がありません。将来そのバージョンに脆弱性が公表されたとき、攻撃対象の選定に使われます。',
        '対策': '- 恒久対策: `server_tokens off;` と `expose_php = Off` を設定します。',
      },
    },
    {
      key: 'tomcat',
      vuln_name: 'ステージング環境の管理コンソールが公開されている',
      identifier: 'CWE-1188', wstg_id: 'WSTG-CONF-05',
      target: 'https://stg.example.com:8080/manager/html',
      cvss_score: 7.3, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:L',
      surfaces: ['p8080'], tools: ['nuclei'], status: 'draft',
      sections: {
        '平易な説明': '開発用サーバの管理コンソールが、インターネットから開ける状態です。初期設定のままだと、そこからサーバを操作されます。',
        '脆弱性があると判断した理由': 'Tomcat の Manager 画面が認証要求とともに外部へ公開されています。既定の資格情報は通りませんでした。',
        '対策': '- 恒久対策: Manager アプリを削除するか、社内 IP からのみ到達できるようにします。',
      },
    },
    {
      key: 'tls',
      vuln_name: 'TLS 1.0 / 1.1 の受け入れ',
      identifier: 'CWE-326', wstg_id: 'WSTG-CRYP-01',
      target: 'https://stg.example.com/',
      cvss_score: 3.7, cvss_vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N',
      surfaces: ['p443stg'], tools: ['nmap'], status: 'draft',
      sections: {
        '平易な説明': '古い暗号方式での接続を受け付けています。条件がそろうと、通信内容を第三者に解読される恐れがあります。',
        '脆弱性があると判断した理由': '`ssl-enum-ciphers` で TLS 1.0 と 1.1 のハンドシェイクが成立しました。本番（www）は TLS 1.2 以上のみを受け付けます。',
        '対策': '- 恒久対策: TLS 1.2 以上に限定します。',
      },
    },
    {
      key: 'robots',
      vuln_name: 'robots.txt による非公開パスの開示',
      identifier: 'CWE-200', wstg_id: 'WSTG-INFO-03',
      target: 'https://www.example.com/robots.txt',
      cvss_score: 0, cvss_vector: '',
      surfaces: ['p443w'], tools: ['curl'], status: 'confirmed',
      sections: {
        '平易な説明': '検索避けの設定ファイルに、非公開のはずの住所が並んでいます。隠したい場所を自ら知らせている状態です。',
        '脆弱性があると判断した理由': '`Disallow: /admin-tools/` と `Disallow: /internal-report/` が記載されています。どちらも認証が必要で、直ちに閲覧はできません。',
        '対策': '- 恒久対策: 非公開パスを robots.txt に書かず、検索エンジンへの非掲載は `X-Robots-Tag` で指定します。',
      },
    },
  ]

  const F = {}
  for (const f of findings) {
    const res = createFinding(eid, {
      vuln_name: f.vuln_name,
      identifier: f.identifier,
      wstg_id: f.wstg_id,
      target: f.target,
      cvss_score: f.cvss_score,
      cvss_vector: f.cvss_vector,
      surfaces: (f.surfaces || []).map((k) => S[k]),
      tools: f.tools,
      status: f.status,
    })
    F[f.key] = res
    for (const [heading, content] of Object.entries(f.sections || {})) {
      section(eid, res.file, heading, content)
    }
    writeDoc(res.file, { data: { status: f.status } })
  }

  // --- 証跡 ---
  const ev = [
    ['fnd-0001-idor-response.png', 'idor-response.png'],
    ['fnd-0003-xss-alert.png', 'xss-alert.png'],
    ['fnd-0009-security-headers.png', 'security-headers.png'],
  ]
  for (const [name, src] of ev) {
    const file = path.join(__dirname, 'mock-evidence', src)
    if (!fs.existsSync(file)) continue
    saveEvidence(eid, { name, dataUrl: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`, overwrite: true })
  }

  // --- チェックリスト（検証済みの項目を付ける） ---
  const checklistFile = docPaths(eid).checklist
  const done = [
    '詳細エラー・スタックトレース・デバッグモードの露出',
    'ディレクトリリスティング',
    '.git / .env / .bak / ~ などのバックアップ・設定ファイルの露出',
    'セキュリティヘッダの欠落（CSP / HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy）',
    'robots.txt / sitemap.xml / .well-known からの情報漏えい',
    'TLS バージョン（1.0 / 1.1 の有効性）と弱い暗号スイート',
    'HSTS の有無と HTTP から HTTPS へのリダイレクト',
    'CMS / フレームワーク / ライブラリのバージョン特定と既知 CVE の照合',
    '水平越境（IDOR）: id / uuid / ファイル名を他ユーザの値へ差し替え',
    '垂直越境: 一般権限で /admin/* や /api/internal/* へ到達できるか',
    '強制ブラウジング: 未リンクの管理画面・旧 API・バックアップ',
    'ユーザ列挙（ログイン・リセット・登録の応答差とタイミング差）',
    'Cookie 属性（Secure / HttpOnly / SameSite）',
    'セッションの再生成・ログアウト後の無効化・タイムアウト・セッション固定',
    '反射型 XSS（出力コンテキスト別: HTML 本文 / 属性 / JS / URL）',
    'SQLi（エラー / UNION / ブラインド。ヘッダ・Cookie・JSON も対象）',
    '価格・数量・割引の改ざん / 負数・上限バイパス',
    'ファイルアップロード（拡張子 / MIME / マジックバイト / 保存先の実行可否）',
  ]
  let cl = readDoc(checklistFile)
  for (const text of done) {
    const item = cl.checklist.find((c) => c.text === text && !c.checked)
    if (item) cl = toggleChecklist(checklistFile, item.line, true)
  }

  // --- スコープ / RoE ---
  section(eid, docPaths(eid).scope, '1. 当事者・体制',
    '| 役割 | 氏名 / 連絡先 |\n|---|---|\n| クライアント窓口 | 情報システム部 鈴木 |\n| 診断責任者（自社） | — |\n| 診断実施者 | — |\n| 緊急連絡先（両者） | 平日 9:00–18:00 の電話窓口を双方で設定済み |')
  section(eid, docPaths(eid).scope, '5. 実施条件',
    '- 検証時間帯: 平日 10:00–17:00\n- 診断元 IP（許可リストへ登録する値）: 203.0.113.64/28\n- WAF / IPS の有無と除外申請: Cloudflare WAF あり。診断元 IP を除外済み\n- 緊急停止条件（誰が、どの条件で停止を宣言するか）: 本番の注文処理に影響が出た時点で、双方いずれかが電話で停止を宣言する\n- データ取扱い: 証跡の機微情報はマスキングします。NDA: 有')

  writeDoc(docPaths(eid).scope, { data: { agreed: true, agreed_at: '2026-09-29', agreed_by: '情報システム部 部長 鈴木', status: 'agreed' } })

  // --- 攻撃面マップ ---
  section(eid, docPaths(eid).surfaceMap, '1. 構成の概観',
    '| 項目 | 内容 |\n|---|---|\n| ホスティング | AWS（ap-northeast-1）|\n| 共用か専有か | 専有。第三者テナントの同居はありません |\n| CDN / WAF | Cloudflare WAF あり。診断元 IP を除外済み |\n| 認証基盤 | 自前実装のセッション認証。SSO なし |')
  section(eid, docPaths(eid).surfaceMap, '5. スコープ外として除外したもの',
    '| 対象 | 除外の理由 |\n|---|---|\n| img.example.com | 画像配信のみ。RoE で対象外 |\n| mail.example.com | メール基盤。RoE で対象外 |')

  // --- 未検出記録 ---
  section(eid, docPaths(eid).negative, '1. 観点別の検証結果',
    [
      '| カテゴリ | 検証した観点 | 判定 | 根拠・確認内容 |',
      '|---|---|---|---|',
      '| A01 アクセス制御 | SSRF | 検出なし | 画像取り込み URL に `http://169.254.169.254/` と自前の受信サーバ URL を指定。いずれも 400 を返し、受信サーバへの到達もありませんでした |',
      '| A01 アクセス制御 | パストラバーサル / LFI | 検出なし | 配信パラメータに `../` を 1 段から 6 段まで与えて送信。すべて 404 を返し、応答本文と応答時間に差はありませんでした |',
      '| A05 インジェクション | SQL インジェクション | 検出なし | 検索・絞り込みの 7 パラメータに真偽式と 5 秒の遅延式を投入。応答サイズと応答時間はいずれも変化しませんでした |',
      '| A05 インジェクション | SSTI | 該当なし | サーバ側テンプレートに利用者入力を渡す画面が存在しません |',
      '| A06 設計・ロジック | レースコンディション | 未検証 | 在庫の二重消費を確認するには本番の注文処理が必要なため、RoE により実施していません |',
      '| 横断 | オープンリダイレクト | 検出なし | `?next=` に外部ドメインを 5 パターン指定。いずれも自ドメインへ丸められました |',
    ].join('\n'))
  section(eid, docPaths(eid).negative, '3. 防御が有効に機能していた点',
    '| 観点 | 観測した挙動 | 評価 |\n|---|---|---|\n| ログイン試行 | 10 回連続の失敗で 15 分のロックがかかりました | 有効 |\n| 画像取り込み | 外部ホストへの取得要求をすべて 400 で拒否しました | 有効 |')

  // --- 報告書 ---
  section(eid, docPaths(eid).report, '1.1 調査の目的と背景',
    '会員制の EC サイト「Example Shop」を対象に、外部から到達できる脆弱性の有無を調べました。\n対象は www / admin / api / stg の 4 ホストで、画像配信とメールの 2 ホストは対象外としています。\n本サイトは会員の氏名・連絡先・購入履歴を保持しており、漏えいした場合は個人情報保護法上の報告義務が生じます。')
  section(eid, docPaths(eid).report, '1.3 総評',
    '- 今回の調査で分かったこと: 管理画面と注文 API の 2 か所で、サーバが「誰からのリクエストか」を確認していませんでした。\n- 放置した場合に起きること: 会員情報が全件読み取られ、商品価格の改ざんと注文の取消も行われます。\n- 最優先で手を付けるべきこと: 認証と認可の確認処理を共通の層へ寄せ、画面ごとの実装差をなくすことです。')
  section(eid, docPaths(eid).report, '2.6 制限事項',
    '- 決済代行会社の本番環境は対象外のため、決済完了までの検証は行っていません。\n- 検証時間帯を平日 10:00–17:00 に限定したため、夜間バッチ処理に関する検証は行っていません。\n- ステージング環境（stg）は診断期間中に 2 回停止しており、一部の検証を完了できていません。')
  section(eid, docPaths(eid).report, '1.5 特に注意すべき発見',
    '| # | 発見事項 | なぜ優先するか |\n|---|---|---|\n| 1 | 管理画面の認証バイパス | 未認証で全会員の情報と価格変更に到達します |\n| 2 | 注文 API における水平権限昇格（IDOR） | 会員登録だけで他人の購入履歴を取得できます |\n| 3 | アバター画像アップロードにおける拡張子の検証不備 | サーバの掌握につながります |')

  buildReport(eid)

  console.log(`診断対象 ${eid}: サーフェス ${listSurfaces(eid).length} 件 / 発見事項 ${listFindings(eid).length} 件 / ツールログ ${logs.length} 件`)
}

/* ============================ 診断対象2: API 単体（完了済み） ============================ */

function seedApi() {
  const eid = '2026-09-example-bank-api'
  if (!nukeIfNeeded(eid)) return
  createEngagement({
    name: eid,
    client: '株式会社エグザンプル銀行',
    target_system: '残高照会 API（社内向け）',
    period_from: '2026-09-07',
    period_to: '2026-09-11',
  })
  setCreated(eid, '2026-09-07')

  const S = {}
  const add = (k, i) => { S[k] = createSurface(eid, i).id }
  add('api', { kind: 'subdomain', value: 'api-internal.example.jp', host: '203.0.113.12', product: 'Kong 3.6', tech: ['OpenAPI 3.1'], discovered_by: ['ヒアリング'], status: '調査済' })
  add('p443', { kind: 'port', value: 'api-internal.example.jp:443', host: '203.0.113.12', port: 443, protocol: 'tcp', service: 'https', product: 'Kong 3.6', discovered_by: ['nmap'], status: '調査済' })
  add('balance', { kind: 'endpoint', value: 'https://api-internal.example.jp/v2/accounts/{id}/balance', port: 443, service: 'https', product: 'Spring Boot 3.2', discovered_by: ['OpenAPI'], status: '調査済' })
  add('tx', { kind: 'endpoint', value: 'https://api-internal.example.jp/v2/accounts/{id}/transactions', port: 443, service: 'https', product: 'Spring Boot 3.2', discovered_by: ['OpenAPI'], status: '調査済' })
  add('token', { kind: 'endpoint', value: 'https://api-internal.example.jp/v2/oauth/token', port: 443, service: 'https', product: 'Kong 3.6', discovered_by: ['OpenAPI'], status: '調査済' })
  add('health', { kind: 'endpoint', value: 'https://api-internal.example.jp/actuator/health', port: 443, service: 'https', product: 'Spring Boot 3.2', discovered_by: ['ffuf'], status: '調査済' })

  for (const [tool, phase, title, command, keys] of [
    ['nmap', 'recon', 'ポート走査', 'nmap -sV -p- 203.0.113.12', ['p443']],
    ['Burp Suite', 'survey', 'JWT の署名検証', 'Repeater: alg を none に変更して送信', ['token']],
    ['Burp Suite', 'survey', '口座番号の総当たり', 'Intruder: /v2/accounts/§id§/balance', ['balance']],
    ['ffuf', 'recon', 'Actuator エンドポイントの探索', 'ffuf -u https://api-internal.example.jp/actuator/FUZZ -w actuator.txt', ['health']],
  ]) {
    createToolLog(eid, { tool, phase, title, command, surfaces: keys.map((k) => S[k]) })
  }

  for (const f of [
    { vuln_name: 'JWT の alg:none を受け入れる', identifier: 'CWE-347', wstg_id: 'WSTG-ATHN-10', target: 'https://api-internal.example.jp/v2/oauth/token', cvss_score: 9.8, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', surfaces: ['token'], tools: ['Burp Suite'], status: 'fixed', retest: '修正済' },
    { vuln_name: '口座残高 API における認可不備', identifier: 'CWE-639', wstg_id: 'WSTG-ATHZ-04', target: 'https://api-internal.example.jp/v2/accounts/{id}/balance', cvss_score: 8.1, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N', surfaces: ['balance'], tools: ['Burp Suite'], status: 'fixed', retest: '修正済' },
    { vuln_name: 'Actuator エンドポイントの公開', identifier: 'CWE-200', wstg_id: 'WSTG-CONF-05', target: 'https://api-internal.example.jp/actuator/health', cvss_score: 5.3, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N', surfaces: ['health'], tools: ['ffuf'], status: 'fixed', retest: '修正済' },
    { vuln_name: 'レート制限の未設定', identifier: 'CWE-770', wstg_id: 'WSTG-BUSL-06', target: 'https://api-internal.example.jp/v2/oauth/token', cvss_score: 5.3, cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L', surfaces: ['token'], tools: ['Burp Suite'], status: 'reported', retest: '部分対応' },
    { vuln_name: 'エラー応答でのスタックトレース出力', identifier: 'CWE-209', wstg_id: 'WSTG-ERRH-02', target: 'https://api-internal.example.jp/v2/accounts/abc/balance', cvss_score: 3.7, cvss_vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N', surfaces: ['balance'], tools: ['Burp Suite'], status: 'fixed', retest: '修正済' },
  ]) {
    const res = createFinding(eid, { ...f, surfaces: f.surfaces.map((k) => S[k]) })
    section(eid, res.file, 'リテスト', `- 判定: ${f.retest}\n- 確認日・確認内容: 2026-09-18 に再診断し、同じ手順で再現しないことを確認`)
    writeDoc(res.file, { data: { status: f.status, retest_result: f.retest } })
  }

  writeDoc(docPaths(eid).scope, { data: { agreed: true, agreed_at: '2026-08-28', agreed_by: '情報システム部 課長 佐藤', status: 'agreed' } })
  section(eid, docPaths(eid).report, '1.3 総評',
    'JWT の署名検証不備と口座残高 API の認可不備は、いずれも修正を確認しました。\nレート制限は本番の構成変更を伴うため、次回のリリースに合わせた対応で合意しています。')
  buildReport(eid)

  console.log(`診断対象 ${eid}: サーフェス ${listSurfaces(eid).length} 件 / 発見事項 ${listFindings(eid).length} 件`)
}

console.log(`保存先: ${dataRoot()}`)
seedShop()
seedApi()
console.log('モックデータを作りました。値はすべて架空です。')
