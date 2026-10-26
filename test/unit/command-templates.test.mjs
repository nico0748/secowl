import test from 'node:test'
import assert from 'node:assert/strict'
import { ALLOWED, validateCommand, parseCommands, checkValue, templateHash } from '../../server/lib/command-templates.js'
import { knowledge } from '../../server/lib/knowledge.js'

const base = () => ({
  id: 'scan', label: 'テスト', program: 'nmap',
  args: ['-sV', '-p', '{{ports}}', '-oX', '{{out}}', '{{target}}'],
  out: { format: 'nmap', ext: 'xml' },
  vars: [{ name: 'target', kind: 'target', required: true }, { name: 'ports', kind: 'ports', default: '80,443' }],
  timeout_sec: 60,
})
const bad = (mut, pattern) => {
  const c = base()
  mut(c)
  const r = validateCommand(c)
  assert.equal(r.ok, false, '不正なはずのテンプレートが通りました')
  assert.match(r.errors.join('\n'), pattern)
}

test('正しいテンプレートは通り、指紋が付く', () => {
  const r = parseCommands([base()])
  assert.deepEqual(r.errors, [])
  assert.equal(r.commands.length, 1)
  assert.match(r.commands[0].hash, /^[0-9a-f]{16}$/)
  assert.equal(r.commands[0].hash, templateHash(r.commands[0]))
})

test('allow-list: curl と sudo は入っていない。list 外のプログラムは読み込めない', () => {
  assert.equal(ALLOWED.has('curl'), false)
  assert.equal(ALLOWED.has('sudo'), false)
  assert.equal(ALLOWED.has('bash'), false)
  bad((c) => { c.program = 'curl' }, /許可したプログラムではありません/)
  bad((c) => { c.program = '/usr/bin/nmap' }, /許可したプログラムではありません/)
  bad((c) => { c.program = 'nmap;id' }, /許可したプログラムではありません/)
})

test('{{out}} は 1 回まで。使うなら out が必要で、out を書くなら使う', () => {
  bad((c) => { c.args = ['{{out}}', '{{out}}', '{{target}}', '{{ports}}'] }, /1 回だけ/)
  bad((c) => { delete c.out }, /out: \{ ext \}/)
  bad((c) => { c.args = ['-sV', '{{target}}', '{{ports}}'] }, /{{out}} が必要/)
})

test('連結（-p{{ports}}）・未定義の変数・未使用の変数は不正', () => {
  bad((c) => { c.args = ['-sV', '-p{{ports}}', '-oX', '{{out}}', '{{target}}'] }, /連結は不可/)
  bad((c) => { c.args = ['-sV', '{{nope}}', '-oX', '{{out}}', '{{target}}', '{{ports}}'] }, /定義されていません/)
  bad((c) => { c.args = ['-oX', '{{out}}', '{{target}}'] }, /ports が args で使われていません/)
})

test('リテラルの引数に .. と絶対パスは書けない', () => {
  bad((c) => { c.args.push('../etc/passwd') }, /\.\./)
  bad((c) => { c.args.push('/etc/passwd') }, /絶対パス/)
  bad((c) => { c.args.push('') }, /空でない/)
})

test('target の変数はちょうど 1 つで required。timeout_sec は 1〜1800。未知のキーは不可', () => {
  bad((c) => { c.vars = c.vars.filter((v) => v.kind !== 'target'); c.args = c.args.filter((a) => a !== '{{target}}') }, /target の変数がちょうど 1 つ/)
  bad((c) => { c.vars[0].required = false }, /required: true/)
  bad((c) => { c.timeout_sec = 0 }, /timeout_sec/)
  bad((c) => { c.timeout_sec = 1801 }, /timeout_sec/)
  bad((c) => { c.shell = true }, /未知のキー/)
  bad((c) => { c.out.ext = 'x/y' }, /out.ext/)
  bad((c) => { c.vars[1].name = 'Ports'; c.args[2] = '{{Ports}}' }, /name/)
})

test('id は一意（同じページ内）', () => {
  const r = parseCommands([base(), base()])
  assert.equal(r.commands.length, 1)
  assert.match(r.errors.join(), /重複/)
})

test('同梱の knowledge/tools のテンプレートは、すべて読み込み時の検査を通る', () => {
  const tools = knowledge({ reload: true }).tools
  const withCommands = tools.filter((t) => t.commands.length)
  assert.ok(withCommands.length >= 5, 'テンプレートを持つツールページが足りません')
  for (const t of tools) assert.deepEqual(t.commandErrors, [], `${t.slug}: ${t.commandErrors.join()}`)
  const ids = new Set()
  for (const t of withCommands) for (const c of t.commands) {
    assert.ok(ALLOWED.has(c.program), c.id)
    assert.equal(ids.has(`${t.slug}/${c.id}`), false)
    ids.add(`${t.slug}/${c.id}`)
  }
})

test('値の検査: - で始まる値・メタ文字・配列・制御文字を拒否する', () => {
  const t = { name: 'target', kind: 'target', required: true }
  const w = { name: 'word', kind: 'text', required: true }
  assert.ok(checkValue(t, '-oNx.example.com').error)
  assert.ok(checkValue(t, '010.0.0.1').error)
  assert.ok(checkValue(t, ['a.example.com']).error)
  assert.ok(checkValue(t, 'a.example.com\n').error)
  assert.equal(checkValue(t, 'ＡＰＰ.example.com').value, 'app.example.com')
  for (const v of ['a b', 'a;b', 'a|b', 'a&b', '$HOME', '`id`', '(x)', '{x}', '<x>', "a'b", 'a"b', 'a\\b', 'a*', '']) assert.ok(checkValue(w, v).error, v)
  assert.equal(checkValue(w, 'common.txt').value, 'common.txt')
  // pattern は既定の禁止を緩められない（全体一致に包む）
  assert.ok(checkValue({ ...w, pattern: '.*' }, 'a;b').error)
  assert.ok(checkValue({ ...w, pattern: '[a-z]+' }, 'abc1').error)
  assert.equal(checkValue({ ...w, pattern: '[a-z]+' }, 'abc').value, 'abc')
  const p = { name: 'ports', kind: 'ports', required: true }
  assert.equal(checkValue(p, '443, 80,8000-8100').value, '443,80,8000-8100')
  assert.ok(checkValue(p, '0').error)
  assert.ok(checkValue(p, '-80').error)
  assert.ok(checkValue(p, '80;id').error)
})

test('target の accept: 許した形だけ通る', () => {
  const t = { name: 'target', kind: 'target', required: true, accept: ['host'] }
  assert.equal(checkValue(t, 'example.com').value, 'example.com')
  assert.ok(checkValue(t, '198.51.100.1').error)
  assert.ok(checkValue(t, 'https://example.com/').error)
  assert.ok(checkValue(t, 'example.com:8443').error)
})

test('ffuf / gobuster のワードリストは、既定の置き場所の .txt / .lst だけ。任意の絶対パスや .. は通さない（P3-13）', () => {
  const tools = knowledge({ reload: true }).tools
  for (const slug of ['ffuf', 'gobuster']) {
    const cmd = tools.find((t) => t.slug === slug).commands[0]
    const def = cmd.vars.find((v) => v.name === 'wordlist')
    const ok = (v) => !checkValue(def, v).error
    for (const good of [
      '/usr/share/wordlists/dirb/common.txt',
      '/usr/share/seclists/Discovery/Web-Content/raft-medium-words.txt',
      '/opt/homebrew/share/seclists/Discovery/Web-Content/common.txt',
      '/usr/share/dirbuster/wordlists/directory-list-2.3-medium.txt',
      '/usr/local/share/SecLists/Discovery/DNS/subdomains-top1million-5000.txt',
      '/usr/share/wordlists/dirb/others.lst',
      '/Users/yuma/wordlists/mine.txt',
      '/home/yuma/SecLists/Discovery/Web-Content/common.txt',
    ]) assert.equal(ok(good), true, `${slug}: ${good}`)
    for (const bad of [
      '/etc/passwd', '/etc/hosts', '/Users/me/.ssh/id_rsa', '/home/u/secrets.txt', '/Users/me/Documents/wordlists-notes.txt', '/Users/me/other/wordlists/x.txt',
      '/usr/share/wordlists/../../etc/passwd.txt', '/usr/share/wordlists/dirb/../../../etc/shadow.txt',
      '/usr/share/wordlists/dirb/common', '/usr/share/wordlists/dirb/common.txt.bak',
      '/usr/share/wordlists/dirb/common.txt/../x.txt', '/usr/share/other/list.txt',
      'wordlists/common.txt', '-w', '/usr/share/wordlists/dirb/a b.txt', '/usr/share/wordlists/dirb/common.txt;id',
    ]) assert.equal(ok(bad), false, `${slug}: ${bad}`)
  }
})

test('required: false の変数は default が要る。空のまま引数を省く書き方は無いので、default のない任意の変数は使えない（P3-7）', () => {
  const withVar = (extra) => {
    const c = base()
    c.vars = c.vars.map((v) => (v.name === 'ports' ? { name: 'ports', kind: 'ports', ...extra } : v))
    return validateCommand(c)
  }
  const bad = withVar({ required: false })
  assert.equal(bad.ok, false)
  assert.match(bad.errors.join('\n'), /任意の変数.*default/)
  // 既定値があれば、任意でよい（空なら default が入る）
  const ok = withVar({ required: false, default: '80,443' })
  assert.equal(ok.ok, true, ok.errors.join())
  assert.equal(ok.command.vars.find((v) => v.name === 'ports').required, false)
  // required を書かず default もない変数は、実際には必須として扱う
  const implicit = withVar({})
  assert.equal(implicit.ok, true)
  assert.equal(implicit.command.vars.find((v) => v.name === 'ports').required, true)
})
