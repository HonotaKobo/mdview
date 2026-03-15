# mdcast

AIエージェントが作り、人が確認する。そのための Markdown エディタ。

## どのようなエディタか

AIエージェントを使って作業をしていると、エージェントがまとめた情報を確認する場面が頻繁にあります。その表示先は、Claude Desktop などのチャット画面だったり、ターミナル上だったり、一時的に生成された Markdown ファイルだったり様々ですが、どの方法にも不便な点があります。

チャット画面やターミナルに表示された内容は、やり取りが続くとすぐに埋もれてしまいます。内容に修正があればゼロから書き直しになり、後でファイルとして残したければコピー＆ペーストで自分で保存する必要があります。一方、ファイルとして出力すれば別画面で参照しながら作業でき、部分的な修正もできますが、不要になったファイルを整理しないとフォルダがすぐに散らかります。

mdcast は、こうした問題のいいとこ取りを目指して作りました。

AIエージェントが MCP サーバー経由で Markdown の内容をウィンドウに表示するので、一時ファイルを作る必要がありません。内容の確認が済んでファイルとして保存する必要がなければ、ウィンドウを閉じるだけで終わりです。保存したければ、ウィンドウ上の保存ボタンからいつでもファイルに書き出せます。ファイルとして保存していない状態でも、AIエージェントは MCP 経由でウィンドウ上の内容を自由に更新できます。

AIエージェントとのやり取りをよりスムーズにするために、独自のカスタム記法にも対応しています。

## 想定する使い方

AIエージェントが文章を生成しながら、同じウィンドウに逐次反映していく流れを想定しています。MCP サーバーを導入すると、自然言語で指示するだけで mdcast が操作されます。

```
「mdcast に調査結果をまとめて表示して」
→ launch ツールで新しいウィンドウが開き、Markdown が表示される

「内容を更新して」
→ update ツールで既存ウィンドウの内容が更新される

「10〜20 行目だけ書き換えて」
→ edit_replace ツールで指定行だけが置換される

「内容を確認して」
→ query ツールで現在の本文が取得される
```

ウィンドウごとにインスタンス ID が自動的に割り振られ、複数のウィンドウを同時に扱うこともできます。

MCP サーバーの導入方法は [mcp-server/MCP-SERVER.md](mcp-server/MCP-SERVER.md) を参照してください。

もちろん、AIエージェントを使わずに普通の Markdown ビューアとしても使えます。

```bash
mdcast README.md          # ファイルを開く
mdcast                    # GUIファイル選択ダイアログから開く
```

## インストール

### macOS（Homebrew）

```bash
brew tap HonotaKobo/mdcast
brew install --cask mdcast
```

### Windows（Scoop）

[Scoop](https://scoop.sh/) が未インストールの場合は、先にインストールしてください。

```powershell
scoop bucket add mdcast https://github.com/HonotaKobo/scoop-mdcast
scoop install mdcast
```

### その他

[GitHub Releases](../../releases) から最新版をダウンロードしてください。

| プラットフォーム | フォーマット |
|----------|--------|
| macOS | `.dmg` |
| Linux | `.deb`, `.AppImage` |
| Windows | `.msi`, `.exe` |

## 使い方

### Markdown ビューアとして

```bash
mdcast README.md                    # ファイルを開く
mdcast --title "メモ" notes.md      # タイトルを指定して開く
mdcast                              # GUIファイル選択ダイアログから開く
```

### AIエージェントから（MCP サーバー）

MCP サーバーを登録すると、Claude Code / Claude Desktop / Codex CLI から mdcast を操作できます。

導入方法・使えるツールの一覧は [mcp-server/MCP-SERVER.md](mcp-server/MCP-SERVER.md) を参照してください。

## ライセンス

MIT