// S4: 機械可読スコープ（shared/scope.js）。批評の B1 の表のすべての行で、正規化の結果（argv に入る値）と判定の両方を確かめます。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalTarget, parsePattern, matchHost, evaluate, normalizeScope, parsePortList, scopeWarnings, inPeriod, VERDICT_LABELS,
} from '../../shared/scope.js'

const SCOPE = {
  scope_targets: ['app.example.com', '*.example.com', '198.51.100.0/24', '2001:db8::/32', 'h'],
  scope_allow: ['10.10.0.0/16', 'lab.test'],
  scope_deny: ['payment.example.com', '198.51.100.66'],
  scope_ports: [],
}

const verdict = (raw, scope = SCOPE, opts) => evaluate(canonicalTarget(raw), scope, opts).verdict

test('B1 表: h:443 / example.com:8080 は host と port に分かれ、host は空にならない', () => {
  assert.deepEqual(canonicalTarget('h:443'), { kind: 'host', host: 'h', ip: null, port: 443, portExplicit: true, value: 'h:443' })
  assert.equal(verdict('h:443'), 'in')
  const c = canonicalTarget('example.com:8080')
  assert.equal(c.host, 'example.com')
  assert.equal(c.port, 8080)
  assert.equal(c.value, 'example.com:8080')
  // *.example.com は example.com 自身を含まない
  assert.equal(verdict('example.com:8080'), 'out')
})

test('B1 表: 素の IPv6 は分割せず、そのまま 1 つの IP として扱う', () => {
  const c = canonicalTarget('2001:db8::1')
  assert.equal(c.kind, 'ip')
  assert.equal(c.ip, 6)
  assert.equal(c.value, '2001:db8::1')
  assert.equal(c.port, null)
  assert.equal(verdict('2001:db8::1'), 'in')
  assert.equal(canonicalTarget('2001:0DB8:0:0:0:0:0:0001').value, '2001:db8::1')
  assert.equal(verdict('2001:db9::1'), 'out')
})

test('B1 表: http://[::ffff:198.51.100.1]/ は IPv4 の 198.51.100.1 にそろえ、CIDR に一致する', () => {
  const c = canonicalTarget('http://[::ffff:198.51.100.1]/')
  assert.equal(c.kind, 'url')
  assert.equal(c.ip, 4)
  assert.equal(c.host, '198.51.100.1')
  assert.equal(c.value, 'http://198.51.100.1/')
  assert.equal(verdict('http://[::ffff:198.51.100.1]/'), 'in')
  assert.equal(verdict('::ffff:198.51.100.66'), 'deny')
})

test('B1 表: 010.0.0.1・2130706433・0x7f.1 はエラー（argv に入らない）', () => {
  for (const raw of ['010.0.0.1', 'http://010.0.0.1/', '2130706433', 'http://2130706433/', '0x7f.1', '0x7f.0.0.1', '127.1', '198.51.100.256']) {
    const c = canonicalTarget(raw)
    assert.ok(c.error, raw)
    assert.equal(c.value, undefined, raw)
    assert.equal(verdict(raw), 'invalid', raw)
  }
})

test('B1 表: 全角の ＰＡＹＭＥＮＴ.example.com は payment.example.com になり、deny に一致する', () => {
  const c = canonicalTarget('ＰＡＹＭＥＮＴ.example.com')
  assert.equal(c.host, 'payment.example.com')
  assert.equal(c.value, 'payment.example.com')
  assert.equal(verdict('ＰＡＹＭＥＮＴ.example.com'), 'deny')
  assert.equal(verdict('https://ＰＡＹＭＥＮＴ.example.com/'), 'deny')
})

test('B1 表: 末尾ドットの payment.example.com. は除去して deny に一致する', () => {
  assert.equal(canonicalTarget('payment.example.com.').value, 'payment.example.com')
  assert.equal(verdict('payment.example.com.'), 'deny')
  assert.equal(canonicalTarget('https://payment.example.com./x').value, 'https://payment.example.com/x')
  assert.equal(verdict('https://payment.example.com./x'), 'deny')
  assert.ok(canonicalTarget('payment.example.com..').error)
})

test('B1 表: -oNx.example.com はエラー（オプション注入を防ぐ）', () => {
  for (const raw of ['-oNx.example.com', '-iLx.example.com', '--script=x', ' -oN x']) {
    assert.ok(canonicalTarget(raw).error, raw)
    assert.equal(verdict(raw), 'invalid', raw)
  }
  // ラベルの先頭の - も不可
  assert.ok(canonicalTarget('a.-b.example.com').error)
})

test('範囲・複数・URL の危ない形はエラー', () => {
  for (const raw of [
    '198.51.100.0/24', '198.51.100.1-50', '198.51.100.*', '*.example.com', 'a.example.com,b.example.com',
    'a.example.com b.example.com', 'https://user:pw@a.example.com/', 'https://a.example.com\\@evil/', 'fe80::1%en0',
    'a_b.example.com', 'file:///etc/passwd', 'gopher://a.example.com/', 'http://a.example.com:0/', 'http://a.example.com:65536/',
    'a.example.com\n', '', '   ', 'x'.repeat(2049),
  ]) {
    assert.ok(canonicalTarget(raw).error, JSON.stringify(raw))
  }
  assert.ok(canonicalTarget(['a.example.com']).error)
  assert.ok(canonicalTarget({ host: 'a' }).error)
})

test('URL の正規化: スキームと host を小文字、既定のポートは省き、port には既定値を入れる', () => {
  const c = canonicalTarget('HTTPS://App.Example.com:443/a?b=1#f')
  assert.equal(c.value, 'https://app.example.com/a?b=1#f')
  assert.equal(c.port, 443)
  assert.equal(c.portExplicit, true)
  assert.equal(canonicalTarget('http://app.example.com').value, 'http://app.example.com/')
  assert.equal(canonicalTarget('http://app.example.com').port, 80)
  assert.equal(canonicalTarget('http://[2001:db8::1]:8443/').value, 'http://[2001:db8::1]:8443/')
  assert.equal(canonicalTarget('bücher.example').value, 'xn--bcher-kva.example')
})

test('matchHost: ワイルドカードは多段に一致し、example.com 自身は含まない', () => {
  const c = (s) => canonicalTarget(s)
  assert.equal(matchHost(c('a.example.com'), '*.example.com'), true)
  assert.equal(matchHost(c('a.b.example.com'), '*.example.com'), true)
  assert.equal(matchHost(c('example.com'), '*.example.com'), false)
  assert.equal(matchHost(c('badexample.com'), '*.example.com'), false)
  assert.equal(matchHost(c('example.com.evil.test'), '*.example.com'), false)
  assert.equal(matchHost(c('APP.example.com'), 'app.example.com'), true)
  // ワイルドカードとホスト名は IP に一致しない
  assert.equal(matchHost(c('198.51.100.1'), '*.example.com'), false)
})

test('matchHost: IPv4 / IPv6 の CIDR の包含と、素の IP の完全一致', () => {
  const c = (s) => canonicalTarget(s)
  assert.equal(matchHost(c('198.51.100.0'), '198.51.100.0/24'), true)
  assert.equal(matchHost(c('198.51.100.255'), '198.51.100.0/24'), true)
  assert.equal(matchHost(c('198.51.101.0'), '198.51.100.0/24'), false)
  assert.equal(matchHost(c('10.1.2.3'), '0.0.0.0/0'), true)
  assert.equal(matchHost(c('2001:db8:ffff::1'), '2001:db8::/32'), true)
  assert.equal(matchHost(c('2001:db9::1'), '2001:db8::/32'), false)
  assert.equal(matchHost(c('2001:db8::1'), '198.51.100.0/24'), false)
  assert.equal(matchHost(c('198.51.100.7'), '198.51.100.7'), true)
  assert.equal(matchHost(c('198.51.100.70'), '198.51.100.7'), false)
  assert.equal(matchHost(c('198.51.100.7'), '::ffff:198.51.100.0/120'), true)
  // ホスト名は IP の範囲に一致しない（DNS の解決は実行の段階で確かめる）
  assert.equal(matchHost(c('a.example.com'), '0.0.0.0/0'), false)
})

test('evaluate: deny が最優先、既定は out、allow は警告付きで許可', () => {
  const both = { ...SCOPE, scope_allow: ['payment.example.com', ...SCOPE.scope_allow] }
  assert.equal(verdict('payment.example.com', both), 'deny')
  const r = evaluate(canonicalTarget('evil.test'), SCOPE)
  assert.equal(r.verdict, 'out')
  assert.equal(r.blocked, true)
  assert.equal(r.label, 'スコープ外')
  const a = evaluate(canonicalTarget('10.10.3.4'), SCOPE)
  assert.equal(a.verdict, 'allow')
  assert.equal(a.blocked, false)
  assert.equal(a.matched, '10.10.0.0/16')
  assert.match(a.warning, /自分の検証環境だけを登録してください/)
  const i = evaluate(canonicalTarget('api.example.com'), SCOPE)
  assert.equal(i.verdict, 'in')
  assert.equal(i.matched, '*.example.com')
  assert.equal(i.label, 'スコープ内')
  assert.equal(VERDICT_LABELS.deny, '除外（実行不可）')
})

test('evaluate: 空のスコープ（既存のデータ）は、すべてスコープ外', () => {
  assert.equal(verdict('app.example.com', {}), 'out')
  assert.equal(verdict('app.example.com', null), 'out')
})

test('fail-closed: 壊れたパターンが 1 つでもあれば、どの対象も実行させない', () => {
  for (const bad of [
    { scope_deny: ['payment.example.com', '-oN'] },
    { scope_deny: ['payment.example..com'] },
    { scope_targets: ['*.example.com', '198.51.100.0/33'] },
    { scope_allow: ['010.0.0.1'] },
    { scope_targets: { a: 1 } },
    { scope_ports: ['https'] },
    { scope_ports: [0] },
    { scope_deny: [null] },
  ]) {
    const r = evaluate(canonicalTarget('app.example.com'), { ...SCOPE, ...bad })
    assert.equal(r.verdict, 'invalid', JSON.stringify(bad))
    assert.equal(r.blocked, true)
    assert.ok(r.problems.length >= 1)
  }
})

test('scope_ports: [443] のとき h:80 は in にならない。ポートなしは ports 変数で照合する', () => {
  const sc = { ...SCOPE, scope_ports: [443, '8000-8100'] }
  assert.equal(verdict('h:80', sc), 'out')
  assert.match(evaluate(canonicalTarget('h:80'), sc).reason, /ポート 80 はスコープ外/)
  assert.equal(verdict('h:443', sc), 'in')
  assert.equal(verdict('h:8050', sc), 'in')
  assert.equal(verdict('https://app.example.com/', sc), 'in') // URL は既定の 443
  assert.equal(verdict('http://app.example.com/', sc), 'out') // 80
  // 対象にポートがなく ports 変数もなければブロック
  assert.equal(verdict('app.example.com', sc), 'out')
  assert.match(evaluate(canonicalTarget('app.example.com'), sc).reason, /ポートを指定してください/)
  // kind:'ports' の変数から渡るポートで照合する（対象にポートがないことだけではブロックしない）
  assert.equal(verdict('app.example.com', sc, { ports: '443,8000-8010' }), 'in')
  assert.equal(verdict('app.example.com', sc, { ports: '443,8000-8200' }), 'out')
  assert.equal(verdict('app.example.com', sc, { ports: [[443, 443]] }), 'in')
  assert.equal(verdict('app.example.com', sc, { ports: '1-65535' }), 'out')
  // 範囲検査は対象のポートと ports 変数の両方
  assert.equal(verdict('h:80', sc, { ports: '443' }), 'out')
  // scope_ports が空なら全ポート
  assert.equal(verdict('h:80', SCOPE), 'in')
})

test('parsePortList', () => {
  assert.deepEqual(parsePortList('80,443 8000-8100').ranges, [[80, 80], [443, 443], [8000, 8100]])
  assert.deepEqual(parsePortList([443, '8080']).ranges, [[443, 443], [8080, 8080]])
  for (const bad of ['0', '65536', '100-50', '08', 'http', '-p', '80;id', [{}]]) assert.ok(parsePortList(bad).error, JSON.stringify(bad))
})

test('parsePattern と normalizeScope', () => {
  assert.equal(parsePattern('*').kind, 'any')
  assert.equal(parsePattern('*.EXAMPLE.com').suffix, 'example.com')
  assert.ok(parsePattern('*.*.example.com').error)
  assert.ok(parsePattern('*example.com').error)
  assert.equal(parsePattern('198.51.100.0/24').kind, 'cidr')
  assert.equal(parsePattern('https://app.example.com/').host, 'app.example.com')
  const sc = normalizeScope({ scope_targets: 'app.example.com', scope_ports: 443 })
  assert.equal(sc.targets.length, 1)
  assert.deepEqual(sc.ports, [[443, 443]])
  assert.equal(sc.problems.length, 0)
})

test('scopeWarnings: 広すぎるパターン', () => {
  const w = scopeWarnings({ scope_targets: ['*', '*.com', '*.co.jp', '0.0.0.0/0', '::/0', '10.0.0.0/8', '*.example.com', '198.51.100.0/24'] })
  assert.deepEqual(w.map((x) => x.raw), ['*', '*.com', '*.co.jp', '0.0.0.0/0', '::/0', '10.0.0.0/8'])
})

test('inPeriod', () => {
  const d = { period_from: '2026-10-01', period_to: new Date('2026-10-31T00:00:00Z') }
  assert.equal(inPeriod(d, '2026-10-15').ok, true)
  assert.equal(inPeriod(d, '2026-10-31').ok, true)
  assert.equal(inPeriod(d, '2026-11-01').ok, false)
  assert.equal(inPeriod(d, '2026-09-30').ok, false)
  assert.equal(inPeriod({ period_from: '2026-10-01' }, '2026-10-15').ok, false)
})

/* ---------------- スコープ文書（store.readScope） ---------------- */

import fs from 'node:fs'
import { createEngagement, readScope, writeDoc, docPaths, resolveFile, readDoc } from '../../server/lib/store.js'

test('新しいスコープ文書は 4 つのキーを空で持ち、何も一致しない', () => {
  createEngagement({ name: 'scope-doc', period_from: '2026-10-01', period_to: '2026-10-31' })
  const d = readDoc(docPaths('scope-doc').scope).data
  for (const k of ['scope_targets', 'scope_allow', 'scope_deny', 'scope_ports']) assert.deepEqual(d[k], [], k)
  const r = readScope('scope-doc', { on: '2026-10-15' })
  assert.equal(r.ok, true)
  assert.equal(r.approved, false)
  assert.equal(r.period.ok, true)
  assert.equal(evaluate(canonicalTarget('app.example.com'), r.scope).verdict, 'out')
})

test('保存したパターンは引用符付きの YAML になり、読み戻して判定できる', () => {
  const rel = docPaths('scope-doc').scope
  writeDoc(rel, { data: { scope_targets: ['*.example.com', '198.51.100.0/24'], scope_deny: ['payment.example.com'], scope_ports: [443, '8000-8100'] } })
  const text = fs.readFileSync(resolveFile(rel), 'utf8')
  assert.match(text, /^ {2}- '\*\.example\.com'$/m)
  const r = readScope('scope-doc', { on: '2026-10-15' })
  assert.equal(r.ok, true)
  assert.equal(evaluate(canonicalTarget('https://api.example.com/'), r.scope).verdict, 'in')
  assert.equal(evaluate(canonicalTarget('payment.example.com:443'), r.scope).verdict, 'deny')
})

test('Obsidian で引用符なしの - *.example.com と書いて YAML が壊れたら ok: false（fail-closed）', () => {
  const abs = resolveFile(docPaths('scope-doc').scope)
  fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace("  - '*.example.com'", '  - *.example.com'))
  const r = readScope('scope-doc')
  assert.equal(r.ok, false)
  assert.match(r.error, /スコープ文書を読めません/)
})

test('解釈できないパターンがあれば ok: false', () => {
  const abs = resolveFile(docPaths('scope-doc').scope)
  fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace('  - *.example.com', "  - '*.example.com'").replace('  - payment.example.com', '  - payment..example.com'))
  const r = readScope('scope-doc')
  assert.equal(r.ok, false)
  assert.equal(r.scope.problems[0].key, 'scope_deny')
})

test('% を含む値の拒否理由: IPv6 のゾーン ID だけをゾーン ID と説明し、ホスト名への % は別の理由にする', () => {
  assert.match(canonicalTarget('fe80::1%en0').error, /ゾーン ID/)
  for (const raw of ['app.example.com%0aid', 'app%20x.example.com']) {
    const e = canonicalTarget(raw).error
    assert.ok(e, raw)
    assert.doesNotMatch(e, /ゾーン ID/, raw)
  }
})
