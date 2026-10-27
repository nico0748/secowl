# SecOwl の入れ方（チームメイト向け）

SecOwl は macOS 用のデスクトップアプリです。`.dmg` を開いてアプリケーションフォルダへ入れるだけで使えます。
Node.js や開発環境は要りません。

## 1. 自分の Mac に合う .dmg を選ぶ

メニューの  →「この Mac について」の「チップ」を見てください。

| 表示 | 選ぶファイル |
|---|---|
| Apple M1 / M2 / M3 / M4 … | `SecOwl-<版>-arm64.dmg` |
| Intel | `SecOwl-<版>-x64.dmg` |

ファイルはリポジトリの Releases（<https://github.com/nico0748/secowl/releases>）に置いてあります。
同じ場所の `SHA256SUMS.txt` と、ダウンロードしたファイルのハッシュが一致するか確かめてください。

```bash
shasum -a 256 ~/Downloads/SecOwl-*.dmg
```

## 2. アプリケーションフォルダへ入れる

`.dmg` を開き、SecOwl のアイコンを「Applications」へドラッグします。

## 3. 初回だけ起動を許可する

SecOwl は Apple の公証を受けていない（Apple Developer Program で署名していない）ため、
初回は macOS が起動を止めます。どちらかの方法で一度だけ許可してください。2 回目以降はそのまま開きます。

**画面で許可する（macOS 15 Sequoia 以降）**

1. アプリケーションフォルダの SecOwl を開きます。「“SecOwl”は開いていません」と出たら「完了」を押します
2. システム設定 →「プライバシーとセキュリティ」を開き、下のほうの「“SecOwl”は Mac を保護するためにブロックされました」の横にある「このまま開く」を押します
3. もう一度 SecOwl を開き、「このまま開く」を押してパスワードを入れます

macOS 14 以前は、Finder で SecOwl を右クリック →「開く」→「開く」でも許可できます。

**ターミナルで許可する**

```bash
xattr -dr com.apple.quarantine /Applications/SecOwl.app
```

ダウンロードしたときに付く「インターネットから来たファイル」の印を外すだけで、ほかの設定は変えません。

## 4. 使い始める

- 調査データは `~/Documents/SecOwl` に保存されます。場所は「設定」画面で変えられます
- ほかの人から診断対象の ZIP を受け取ったら、「設定」画面の「ZIP から取り込む」で開きます。渡すときは診断対象の一覧の「ZIP に書き出す」です
- 診断ツール（nmap・ffuf など）は「実行」画面の上にある「このPCの状態」から入れられます。Homebrew か Go が要ります。
  Intel Mac の Homebrew（`/usr/local`）は、先に同じ画面の「権限を直す」が要ることがあります（README の「環境構築」）
- 保存先の Git 版管理を使うときは、Xcode Command Line Tools が要ります（`xcode-select --install`。Homebrew を入れてあれば入っています）
- Claude との MCP 連携は「設定」画面に出る設定をコピーして使います。Node.js は要りません

## 更新するとき

新しい `.dmg` を同じ手順で入れ、アプリケーションフォルダの SecOwl を置き換えます。
調査データと設定はアプリの外にあるので消えません。置き換えたあとは、もう一度 3. の許可が要ることがあります。

## 消すとき

アプリケーションフォルダの SecOwl をゴミ箱へ入れます。設定は `~/Library/Application Support/` の中の
`secowl` フォルダにあります。調査データ（`~/Documents/SecOwl`）は自分で消してください。

---

## 配る側の手順（メンテナ向け）

1. `package.json` の `version` を上げてコミットし、`main` に入れます
2. 同じ版のタグを付けて push します

   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```

3. GitHub Actions の `release` が macOS で `.dmg`（arm64・x64）と `SHA256SUMS.txt` を作り、Releases に置きます。
   タグと `version` が違うと止まります
4. チームメイトには Releases のページを伝えます。リポジトリが非公開なら、コラボレーターに招待しておきます

手元の Mac で作るときは `npm run dist:mac` です（`release/` に出ます）。
署名は ad-hoc 署名だけです（`scripts/after-pack.cjs`）。中身と署名を一致させて「壊れているため開けません」を防ぐためのもので、
作った人の証明にはなりません。Apple Developer Program に入ったら、`build.mac.identity` に Developer ID を入れ、公証を足します。
