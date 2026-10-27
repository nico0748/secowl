/**
 * electron-builder の afterPack で呼ばれ、.app に ad-hoc 署名をかけ直します。
 *
 * Apple Developer Program に入っていないので、Developer ID での署名と公証はしません（mac.identity: null）。
 * ただ、electron-builder は Info.plist やアイコンを書き換えるため、Electron 本体に最初から付いている
 * 署名が中身と合わなくなります。そのままだと Apple Silicon では「壊れているため開けません」と出て、
 * 隔離属性を外すまで起動できません。ad-hoc 署名をかけ直して、中身と署名を一致させておきます。
 *
 * ad-hoc 署名は「誰が作ったか」を証明しません。初回起動の許可は docs/INSTALL.md の手順で行います。
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' })
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`ad-hoc 署名をかけました: ${app}`)
}
