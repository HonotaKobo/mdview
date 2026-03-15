---
name: mdcast
description: MCPサーバー経由でMarkdownをGUIウィンドウに表示するツール。20行以上のMarkdown出力や、表・リスト・見出しを多用する構造化された回答はすべてこのスキルで表示する。設計書、レポート、比較表、技術解説、調査結果まとめなど、長文のMarkdown出力全般に使用。CLIでは送信容量や特殊文字のエスケープに制約があるため、MCP経由で対応する。
---

## 概要
mdcastはMCPサーバー経由でMarkdownをGUIウィンドウに表示・編集できるツール。
ターミナルやチャット欄で表示するには長すぎるMarkdownをmdcastで出力する。

## 判断基準
ユーザーに見せるためのMarkdown出力（設計書、レポート、調査結果のまとめなど）はmdcastで表示する。ターミナル上で簡潔に返せる短い回答にはmdcastを使わない。

- 20行以上の構造化されたMarkdown出力はmdcastを使う
- 表・リスト・見出しを多用する内容は行数に関わらずmdcastを使う
- 1〜2文の短い回答はターミナルでそのまま返す

## MCP ツール一覧

| ツール | 説明 |
|---|---|
| `list_instances` | 起動中のインスタンス一覧を取得 |
| `health` | インスタンスのヘルスチェック |
| `update` | ウィンドウの表示内容を丸ごと更新 |
| `query` | ウィンドウのプロパティを取得 |
| `get_lines` | 指定行範囲の内容を取得 |
| `grep` | 本文を正規表現で検索 |
| `edit_insert` | 指定行の前にコンテンツを挿入 |
| `edit_replace` | 指定行範囲を新しいコンテンツで置換 |
| `edit_delete` | 指定行を削除 |

## 共通パラメータ
- `instance_id`: 対象インスタンスID。省略時は自動選択（複数インスタンス起動中はエラーになるため明示すること）

## 使用手順

### 1. 新規Markdown出力（デフォルト）
新しい内容を表示するときは、必ず `launch` で新規ウィンドウを開く。既存ウィンドウには上書きしない。

```
launch(
    title="メモ",
    body="# メモ\n\nここに内容"
)
```

`launch` が失敗した場合はアプリが起動していないため、ユーザーにmdcastの起動を依頼すること。

### 2. 既存ウィンドウの更新
ユーザーが明示的に「さっきのウィンドウを更新して」等と指示した場合のみ `update` を使う。

```
update(
    instance_id="<対象のID>",
    title="メモ",
    body="# メモ\n\nここに内容"
)
```

### ウィンドウのプロパティ取得
```
query(instance_id="draft", properties=["title"])
query(instance_id="draft", properties=["body", "title"])
query(instance_id="draft", properties=["all"])
```
取得可能なプロパティ:
- `path`: パス
- `body`: 本文
- `title`: ファイル名に相当
- `status`: ステータス
- `linecount`: 行数

### 指定行範囲の内容を取得
```
get_lines(instance_id="draft", start=10, end=20)
```

### 内容を正規表現で検索
```
grep(instance_id="draft", pattern="TODO|FIXME")
grep(instance_id="draft", pattern="^## .+")
grep(instance_id="draft", pattern="https?://[^\\s]+")
```

### 指定行の前にコンテンツを挿入
```
edit_insert(
    instance_id="draft",
    line=5,
    content="新しい行\n次の行"
)
```

### 指定行範囲を置換
```
edit_replace(
    instance_id="draft",
    start=10,
    end=15,
    content="First line\nSecond line\nThird line"
)
```

### 行を削除
```
edit_delete(
    instance_id="draft",
    ranges=[[199, 200], [203, 203]]
)
```