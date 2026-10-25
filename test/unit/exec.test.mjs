import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createExec, cleanLine, displayCommand, defaultSearchPaths, Collector, trimToBoundary } from '../../server/lib/exec.js'

const SKIP = process.platform === 'win32' ? 'POSIX のみ' : false

const mkbin = (mode = 0o755, dirMode = 0o700) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secowl-unit-bin-'))
  fs.chmodSync(dir, dirMode)
  const file = path.join(dir, 'fakenmap')
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n')
  fs.chmodSync(file, mode)
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 片付け */ } })
  return { dir, file }
}

test('プログラムの解決: allow-list の名前だけを、探索パスの絶対パスに解決する', { skip: SKIP }, () => {
  const { dir } = mkbin()
  const x = createExec({ allowed: new Set(['fakenmap']), searchPaths: [dir] })
  const r = x.resolveProgram('fakenmap')
  assert.equal(r.found, true)
  assert.equal(r.path, fs.realpathSync(path.join(dir, 'fakenmap')))
  assert.equal(r.unsafe, undefined)
  // allow-list にない名前・パスを含む名前は解決しない
  assert.equal(x.resolveProgram('sh').found, false)
  assert.equal(x.resolveProgram('../x').found, false)
  assert.equal(x.resolveProgram('/bin/sh').found, false)
  assert.match(x.resolveProgram('nmap').error, /許可したプログラムではありません/)
})

test('プログラムの解決: 見つからないときは探した場所を示す。他者が書き換えられるものは unsafe', { skip: SKIP }, () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'secowl-unit-empty-'))
  const x = createExec({ allowed: new Set(['fakenmap']), searchPaths: [empty] })
  const missing = x.resolveProgram('fakenmap')
  assert.equal(missing.found, false)
  assert.ok(missing.error.includes(empty))
  fs.rmSync(empty, { recursive: true })

  const writableFile = mkbin(0o775)
  const a = createExec({ allowed: new Set(['fakenmap']), searchPaths: [writableFile.dir] }).resolveProgram('fakenmap')
  assert.equal(a.found, true)
  assert.match(a.unsafe, /ほかのユーザーも書き換えられる/)
  const writableDir = mkbin(0o755, 0o777)
  const b = createExec({ allowed: new Set(['fakenmap']), searchPaths: [writableDir.dir] }).resolveProgram('fakenmap')
  assert.match(b.unsafe, /書き換えられる/)
  // 実行権限のないファイルは見つからない扱い
  const noexec = mkbin(0o644)
  assert.equal(createExec({ allowed: new Set(['fakenmap']), searchPaths: [noexec.dir] }).resolveProgram('fakenmap').found, false)
})

test('プログラムの解決: 探索パスのディレクトリが書き換えられるなら、リンク先が安全でも unsafe（P2-3）', { skip: SKIP }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secowl-unit-link-'))
  process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 片付け */ } })
  fs.chmodSync(root, 0o755)
  const mk = (rel, mode) => { const d = path.join(root, rel); fs.mkdirSync(d, { recursive: true }); fs.chmodSync(d, mode); return d }
  const real = (dir, name = 'fakenmap') => { const f = path.join(dir, name); fs.writeFileSync(f, '#!/bin/sh\nexit 0\n'); fs.chmodSync(f, 0o755); return f }
  const resolve = (...dirs) => createExec({ allowed: new Set(['fakenmap']), searchPaths: dirs }).resolveProgram('fakenmap')

  const safe = mk('safe', 0o755)
  const evil = real(safe, 'evil')
  // 書き換えられない場所のリンク → 安全
  const okBin = mk('okbin', 0o755)
  fs.symlinkSync(evil, path.join(okBin, 'fakenmap'))
  const ok = resolve(okBin)
  assert.equal(ok.found, true)
  assert.equal(ok.unsafe, undefined, ok.unsafe)
  assert.equal(ok.path, fs.realpathSync(evil))

  // グループが書ける探索パスに置かれたリンク → リンク先（safe/evil）は 755 でも unsafe。Intel 版 Homebrew の /usr/local/bin と同じ形
  const wbin = mk('wbin', 0o775)
  fs.symlinkSync(evil, path.join(wbin, 'fakenmap'))
  const w = resolve(wbin)
  assert.equal(w.found, true)
  assert.match(w.unsafe, /ほかのユーザーも書き換えられる/)
  assert.equal(w.unsafeAt, wbin)
  assert.ok(w.unsafe.includes(wbin))

  // 途中のディレクトリが書き換えられる（ルートからの道筋）
  const outer = mk('outer', 0o777)
  const inner = path.join(outer, 'inner'); fs.mkdirSync(inner); fs.chmodSync(inner, 0o755)
  real(inner)
  const o = resolve(inner)
  assert.match(o.unsafe, /書き換えられる/)
  assert.equal(o.unsafeAt, outer)

  // リンクの途中（リンク → リンク → 実体）で、2 つ目のリンクが書き換えられる場所にある
  const hop = mk('hop', 0o777)
  fs.symlinkSync(evil, path.join(hop, 'second'))
  const first = mk('first', 0o755)
  fs.symlinkSync(path.join(hop, 'second'), path.join(first, 'fakenmap'))
  assert.match(resolve(first).unsafe, /書き換えられる/)

  // sticky の共有領域（/tmp など）の下に自分が作った 700 のディレクトリ → 通す
  const mine = mk('mine', 0o700)
  real(mine)
  assert.equal(resolve(mine).unsafe, undefined)
  const sticky = mk('sticky', 0o1777)
  const inSticky = path.join(sticky, 'mine'); fs.mkdirSync(inSticky); fs.chmodSync(inSticky, 0o755)
  real(inSticky)
  assert.equal(resolve(inSticky).unsafe, undefined, 'sticky の下の自分のディレクトリまで止めない')
})

test('探索パス: Finder 起動の細い PATH でも、よくある場所を足す。相対パスは捨てる', () => {
  const list = defaultSearchPaths({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin:relative/bin::.' }, '/Users/me')
  assert.ok(list.includes('/opt/homebrew/bin') && list.includes('/usr/local/bin'))
  assert.ok(list.includes('/Users/me/go/bin') && list.includes('/Users/me/.local/bin'))
  assert.equal(list.some((p) => !path.isAbsolute(p)), false)
  assert.equal(new Set(list).size, list.length)
  assert.ok(list.indexOf('/opt/homebrew/bin') < list.indexOf('/usr/bin'))
})

test('環境: 最小限だけを渡し、トークン・SECOWL_・ELECTRON_ は渡さない。プロキシは設定したときだけ', () => {
  const base = {
    PATH: '/x', HOME: '/home/u', LANG: 'ja_JP.UTF-8', LC_ALL: 'ja_JP.UTF-8', TMPDIR: '/tmp/t',
    SECOWL_DATA: '/d', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', GITHUB_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 'k', OPENAI_API_KEY: 'k',
    HTTPS_PROXY: 'http://127.0.0.1:8080', NO_PROXY: 'localhost',
  }
  const off = createExec({ env: base, searchPaths: ['/a', '/b'], passProxy: false }).minimalEnv()
  assert.deepEqual(Object.keys(off).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TERM', 'TMPDIR'])
  assert.equal(off.PATH, '/a:/b')
  assert.equal(off.TERM, 'dumb')
  const on = createExec({ env: base, searchPaths: ['/a'], passProxy: true }).minimalEnv()
  assert.equal(on.HTTPS_PROXY, 'http://127.0.0.1:8080')
  assert.equal(on.NO_PROXY, 'localhost')
  for (const k of Object.keys(on)) assert.equal(/SECOWL_|ELECTRON_|NODE_OPTIONS|_TOKEN|_KEY/.test(k), false, k)
})

test('端末の制御列と制御文字を除き、\\r の進捗は最後の表示に畳む', () => {
  assert.equal(cleanLine('\u001b[31mred\u001b[0m'), 'red')
  assert.equal(cleanLine('\u001b]0;title\u0007text'), 'text')
  assert.equal(cleanLine('10%\r50%\r100%'), '100%')
  assert.equal(cleanLine('line\r'), 'line')
  assert.equal(cleanLine('a\u0000b\u0007c\u007fd\te'), 'abcd\te')
  assert.equal(cleanLine('日本語 ✓'), '日本語 ✓')
})

test('表示用のコマンド行は引用符つき。バッククォートは % 表記にして、ログの囲みを壊さない', () => {
  assert.equal(displayCommand('/usr/bin/nmap', ['-p', '80,443', 'a b', "it's", 'x`y']), "/usr/bin/nmap -p 80,443 'a b' 'it'\\''s' 'x%60y'")
})

/* ---------------- 出力の集め方（Collector） ---------------- */

const savedOf = (c) => { c.flush(); return c.logText().text }

test('Collector: 強制フラッシュした断片は保存用では 1 行につながる（境界をまたぐ値を見失わない）', () => {
  const c = new Collector()
  c.push('out', `${'a'.repeat(5000)}SECRET`)
  c.push('out', 'TAIL\nnext\n')
  assert.equal(savedOf(c), `${'a'.repeat(5000)}SECRETTAIL\nnext\n`)
  // 画面向けには、断片がそのまま流れる（改行は行の終わりにだけ付く）
  assert.equal(c.ring.map((x) => x.x).join(''), `${'a'.repeat(5000)}SECRETTAIL\nnext\n`)
  assert.ok(c.ring.length >= 3)
})

test('Collector: 標準出力と標準エラーが交互に来ても、それぞれの行を混ぜない', () => {
  const c = new Collector()
  c.push('out', `${'a'.repeat(5000)}1`)
  c.push('err', 'warning\n')
  c.push('out', '2\n')
  assert.equal(savedOf(c), `warning\n${'a'.repeat(5000)}12\n`)
})

test('Collector: 端末の制御列が強制フラッシュの位置で切れても、半端な文字を残さない', () => {
  const c = new Collector()
  c.push('out', `${'a'.repeat(4096)}\u001b[3`)
  c.push('out', '1mred\u001b[0m\n')
  assert.equal(savedOf(c), `${'a'.repeat(4096)}red\n`)
})

test('Collector: 改行の無いまま終わった出力も、最後に 1 行として確定する', () => {
  const c = new Collector()
  c.push('out', `${'b'.repeat(5000)}end`)
  assert.equal(savedOf(c), `${'b'.repeat(5000)}end\n`)
  const d = new Collector()
  d.push('out', 'no newline')
  assert.equal(savedOf(d), 'no newline\n')
})

test('Collector: 長い行は先頭を残して省略の文字数を書き、全体が上限を超えたら途中の値を残さない', () => {
  const c = new Collector()
  const total = 40000
  for (let left = total; left > 0; left -= 10000) c.push('out', 'z'.repeat(Math.min(10000, left)))
  c.push('out', '\nok\n')
  const text = savedOf(c)
  const m = /^(z+) \[長すぎる行の途中を省略しました（(\d+) 文字）\]\nok\n$/.exec(text)
  assert.ok(m, text.slice(-80))
  assert.equal(m[1].length + Number(m[2]), total)
  assert.ok(m[1].length <= 32 * 1024)
})

test('trimToBoundary: 区切りまで戻す。区切りが近くに無ければ決まった長さだけ戻す', () => {
  assert.equal(trimToBoundary('key=abc token=eyJabc'), 'key=abc token=')
  assert.equal(trimToBoundary('"a":"bcd'), '"a":"')
  const long = 'q'.repeat(20000)
  assert.equal(trimToBoundary(long).length, 20000 - 8192)
})
