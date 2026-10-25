/**
 * ソースから `npm run app` で起動したとき、Dock とメニューバーに「Electron」と出ないよう、
 * node_modules にある Electron.app の表示名とアイコンを SecOwl に差し替えます。
 * macOS 以外では何もしません。npm install のたびに戻るので、postinstall と app の前に実行します。
 *
 * .app として配布する版（npm run dist:mac）は electron-builder が名前とアイコンを入れるため、
 * この処理は要りません。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NAME = 'SecOwl'

if (process.platform !== 'darwin') process.exit(0)

const app = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app')
const plist = path.join(app, 'Contents', 'Info.plist')
if (!fs.existsSync(plist)) {
  console.warn('Electron.app が見つからないため、表示名の差し替えを飛ばしました')
  process.exit(0)
}

let changed = false
for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  let current = ''
  try {
    current = execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim()
  } catch { /* キーがなければ下で足します */ }
  if (current === NAME) continue
  execFileSync('/usr/bin/plutil', ['-replace', key, '-string', NAME, plist])
  changed = true
}

const icns = path.join(ROOT, 'build', 'icon.icns')
const target = path.join(app, 'Contents', 'Resources', 'electron.icns')
if (fs.existsSync(icns) && !fs.readFileSync(icns).equals(fs.readFileSync(target))) {
  fs.copyFileSync(icns, target)
  changed = true
}

if (changed) {
  // Finder と Dock に変更を知らせます（キャッシュが残るときは Dock の再起動で直ります）
  const now = new Date()
  fs.utimesSync(app, now, now)
  try {
    execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', app])
  } catch { /* 登録し直せなくても次の起動から反映されます */ }
  console.log(`Electron.app の表示名とアイコンを ${NAME} にしました`)
}
