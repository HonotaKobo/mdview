# mdview

AIエージェントが作り、人が確認する。そのための Markdown ビューア。

## これは何？

AIエージェントを使って作業をしていると、エージェントがまとめた情報を確認する場面が頻繁にあります。その表示先は、Claude Desktop などのチャット画面だったり、ターミナル上だったり、一時的に生成された Markdown ファイルだったり様々ですが、どの方法にも不便な点があります。

チャット画面やターミナルに表示された内容は、やり取りが続くとすぐに埋もれてしまいます。内容に修正があればゼロから書き直しになり、後でファイルとして残したければコピー＆ペーストで自分で保存する必要があります。一方、ファイルとして出力すれば別画面で参照しながら作業でき、部分的な修正もできますが、不要になったファイルを整理しないとフォルダがすぐに散らかります。

mdview は、こうした問題のいいとこ取りを目指して作りました。

AIエージェントが CLI 経由で Markdown の内容をウィンドウに表示するので、一時ファイルを作る必要がありません。内容の確認が済んでファイルとして保存する必要がなければ、ウィンドウを閉じるだけで終わりです。保存したければ、ウィンドウ上の保存ボタンからいつでもファイルに書き出せます。ファイルとして保存していない状態でも、AIエージェントは CLI 経由でウィンドウ上の内容を自由に更新できます。

## 想定する使い方

AIエージェントが文章を生成しながら、同じウィンドウに逐次反映していく流れを想定しています。

```bash
# 1. AIがウィンドウを開き、生成した Markdown を表示する
mdview --id draft --title "設計書" --body "## 第1章\n概要を書いています..."

# 2. 内容を追記・更新する（同じ --id なので同じウィンドウが更新される）
mdview --id draft --body "## 第1章\n概要\n\n## 第2章\n詳細設計..."

# 3. 全文再送せずに行単位で編集する
mdview --id draft --grep "古い記述"                          # 検索して行番号を確認
mdview --id draft --replace 42-43 --content "新しい記述"      # その行だけ置換

# 4. ユーザーが💾ボタンで保存すると、AIは保存先パスを取得できる
mdview --id draft --query path
# → /Users/xxx/Documents/設計書.md

# 5. 以降はファイルを直接編集すれば、mdview が変更を検知して自動反映する
```

`--id` がこのツールの核です。同じ ID なら既存ウィンドウを更新し、なければ新規作成します。AIエージェントはウィンドウの参照を保持する必要がなく、毎回同じコマンドを叩くだけで済みます。

もちろん、AIエージェントを使わずに普通の Markdown ビューアとしても使えます。

```bash
mdview README.md          # ファイルを開く
mdview                    # GUIファイル選択ダイアログから開く
```

## インストール

[GitHub Releases](../../releases) から最新版をダウンロードしてください。

| プラットフォーム | フォーマット |
|----------|--------|
| macOS | `.dmg` |
| Linux | `.deb`, `.AppImage` |
| Windows | `.msi`, `.exe` |

## 使い方

### 基本

```bash
mdview README.md                    # ファイルを開く
mdview --title "メモ" notes.md      # タイトルを指定して開く
mdview                              # GUIファイル選択ダイアログから開く
```

### ウィンドウの操作（`--id` を使った CLI 操作）

```bash
# ID を指定してファイルを開く
mdview --file notes.md --id my-notes

# 情報を取得
mdview --id my-notes --query body        # Markdown ソース
mdview --id my-notes --query title       # タイトル
mdview --id my-notes --query path        # 保存先パス
mdview --id my-notes --query linecount   # 総行数
mdview --id my-notes --query status      # 状態（JSON）

# 検索・行の取得
mdview --id my-notes --grep "TODO"       # 正規表現検索（行番号付き）
mdview --id my-notes --lines 10-20       # 10〜20行目を取得

# 編集
mdview --id my-notes --body "# 新しい内容"                    # 全体を置換
mdview --id my-notes --insert 5 --content "新しい行"           # 5行目の前に挿入
mdview --id my-notes --replace 10-12 --content "置換テキスト"   # 10〜12行目を置換
mdview --id my-notes --delete 3-5                              # 3〜5行目を削除

# 開いているウィンドウの一覧
mdview --list
```
## ライセンス

MIT
