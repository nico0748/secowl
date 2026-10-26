/**
 * 取得するワードリストの固定表（S6）。
 *
 * SecLists の、ある時点（タグ）の中身だけを取りに行きます。取得先も、ファイルの大きさも、
 * 中身のハッシュもここに書いてあり、`knowledge/` などからは変えられません。
 * 取ったあとに SHA-256 を照合するので、途中で差し替えられたものは保存しません。
 *
 * 更新するときは、新しいタグのコミットを選び、各ファイルの bytes・lines・sha256 を取り直してください。
 */

export const SOURCE = Object.freeze({
  name: 'SecLists',
  repo: 'https://github.com/danielmiessler/SecLists',
  license: 'MIT',
  tag: '2026.1',
  commit: '190c6f7bd58c847ceadfe57d9853592737f059e8',
  raw: 'https://raw.githubusercontent.com/danielmiessler/SecLists',
})

/** 置き場所の名前。ホームフォルダの直下に作ります（ffuf・gobuster が受け付ける場所です）。 */
export const DIR_NAME = 'wordlists'
/** SecLists 全体を置く場所（ホームフォルダ/wordlists/SecLists）。 */
export const FULL_DIR_NAME = 'SecLists'

export const FILES = Object.freeze([
  Object.freeze({
    id: 'common',
    name: 'よく使われるディレクトリ・ファイル名',
    use: 'ffuf・gobuster の最初の 1 本',
    path: 'Discovery/Web-Content/common.txt',
    saveAs: 'common.txt',
    bytes: 38506,
    lines: 4750,
    sha256: 'fc320bacd30d93f5080029912b93667cd739401f81634579a7125fc0c027e6d5',
  }),
  Object.freeze({
    id: 'raft-medium-directories',
    name: 'ディレクトリ（中くらいの量）',
    use: '共通のものだけでは足りないときの総当たり',
    path: 'Discovery/Web-Content/raft-medium-directories.txt',
    saveAs: 'raft-medium-directories.txt',
    bytes: 250427,
    lines: 29999,
    sha256: 'a9626959f818d9e198259665c5a88053b7b061c538f46da215d172bcba305fe9',
  }),
  Object.freeze({
    id: 'subdomains-top5000',
    name: 'サブドメイン（上位 5,000）',
    use: 'amass・subfinder の総当たり',
    path: 'Discovery/DNS/subdomains-top1million-5000.txt',
    saveAs: 'subdomains-top1million-5000.txt',
    bytes: 30075,
    lines: 5000,
    sha256: 'e331367c140298cb179114fdeefa78f58f696219f0dec017a28bb79487cfcf19',
  }),
])
