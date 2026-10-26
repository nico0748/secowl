/**
 * ツールの入れ方の固定表（S6）。
 *
 * ここに書いたものだけが、画面の「入れ方」に出ます。`knowledge/tools/*.md` からは変えられません。
 * Markdown を書き換えて任意のパッケージを入れられないように、コードの中に置いています。
 * 対象は実行を許すプログラム（command-templates.js の ALLOWED）と同じ範囲です。
 *
 * brew  … Homebrew の formula 名（`brew install <formula>`）
 * go    … Go のモジュール（`go install <module>`）。`~/go/bin` に入るので権限の問題が起きません
 * どちらも無いものは、配布元の手順で入れてもらいます（knowledge/tools/*.md の url を案内）。
 */
import { ALLOWED } from './command-templates.js'

const r = (brew, go) => Object.freeze({ brew, go })

export const INSTALL = Object.freeze({
  nmap: r('nmap', null),
  httpx: r('httpx', 'github.com/projectdiscovery/httpx/cmd/httpx@latest'),
  nuclei: r('nuclei', 'github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest'),
  ffuf: r('ffuf', 'github.com/ffuf/ffuf/v2@latest'),
  gobuster: r('gobuster', 'github.com/OJ/gobuster/v3@latest'),
  subfinder: r('subfinder', 'github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest'),
  amass: r('amass', 'github.com/owasp-amass/amass/v4/...@master'),
  dnsx: r('dnsx', 'github.com/projectdiscovery/dnsx/cmd/dnsx@latest'),
  naabu: r('naabu', 'github.com/projectdiscovery/naabu/v2/cmd/naabu@latest'),
  katana: r('katana', 'github.com/projectdiscovery/katana/cmd/katana@latest'),
  gau: r('gau', 'github.com/lc/gau/v2/cmd/gau@latest'),
  whatweb: r(null, null), // Homebrew の formula がありません。配布元の手順で入れてください
})

// 表に ALLOWED の外が混ざっていないこと（読み込み時に 1 度だけ確かめます）。
for (const name of Object.keys(INSTALL)) {
  if (!ALLOWED.has(name)) throw new Error(`入れ方の表に、実行を許していないプログラムがあります: ${name}`)
}

/** 入れ方。表に無いものは、どちらの手段も無いものとして返します。 */
export function installRecipe(program) {
  return INSTALL[program] || r(null, null)
}
