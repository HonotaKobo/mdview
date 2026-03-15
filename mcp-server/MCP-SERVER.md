# mdcast MCP Server

Claude Code / Claude Desktop / Codex CLI から mdcast を操作するための MCP サーバー。

シェルのエスケープ問題を回避し、コードブロックや特殊文字を含む Markdown も安全に送信できる。

## セットアップ

### 1. Python のインストール

Python 3.10 以上が必要。未インストールの場合は [python.org](https://www.python.org/downloads/) からダウンロードしてインストールする。

### 2. MCP サーバーのダウンロード

このリポジトリの `mcp-server/mdcast_mcp.py` をダウンロードし、任意の場所に保存する。

### 3. 依存パッケージのインストール

```bash
pip install "mcp[cli]" httpx
```

### 4. MCP サーバーの登録

以下の例では `<保存先>` を、`mdcast_mcp.py` を保存した実際のパスに置き換えること。

#### Claude Code の場合

macOS / Linux:
```bash
claude mcp add mdcast -- python3 <保存先>/mdcast_mcp.py
```

Windows:
```bash
claude mcp add mdcast -- python <保存先>\mdcast_mcp.py
```

#### Claude Desktop の場合

設定ファイルを編集する。

| OS | 設定ファイルのパス |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

macOS / Linux:
```json
{
  "mcpServers": {
    "mdcast": {
      "command": "python3",
      "args": ["<保存先>/mdcast_mcp.py"]
    }
  }
}
```

Windows:
```json
{
  "mcpServers": {
    "mdcast": {
      "command": "python",
      "args": ["<保存先>\\mdcast_mcp.py"]
    }
  }
}
```

設定後、Claude Desktop を再起動する。

#### Codex CLI の場合

macOS / Linux:
```bash
codex mcp add mdcast -- python3 <保存先>/mdcast_mcp.py
```

Windows:
```bash
codex mcp add mdcast -- python <保存先>\mdcast_mcp.py
```

または `~/.codex/config.toml` を直接編集する:

```toml
[mcp_servers.mdcast]
command = "python3"  # Windows の場合は "python"
args = ["<保存先>/mdcast_mcp.py"]
```

以上で準備完了。AI エージェントから mdcast のツールが使えるようになる。
mdcast が起動していなくても `launch` ツールで MCP 経由でウィンドウを開ける。

## 使えるツール

| ツール | 説明 |
|---|---|
| `launch` | 新しいウィンドウを開いてコンテンツを表示（インスタンスIDを自動生成して返す） |
| `update` | 既存ウィンドウの表示内容を更新 |
| `query` | プロパティの取得（body, title, path, status, linecount, all） |
| `grep` | 本文を正規表現で検索 |
| `get_lines` | 指定行範囲の取得 |
| `edit_insert` | 指定行の前にコンテンツを挿入 |
| `edit_replace` | 指定行範囲を置換 |
| `edit_delete` | 指定行を削除 |
| `list_instances` | 起動中のインスタンス一覧 |
| `health` | ヘルスチェック |

## 使用例

### Claude Code での利用

Claude Code に対して自然言語で指示するだけで、MCP ツールが自動的に呼ばれる。

```
「mdcast に調査結果をまとめて表示して」
→ launch ツールで新しいウィンドウが開き、Markdown が表示される
→ 返されたインスタンスIDで以降の操作が可能

「mdcast の内容を更新して」
→ update ツールが呼ばれ、既存ウィンドウの内容が更新される

「mdcast の内容を確認して」
→ query ツールが呼ばれ、現在の本文が取得される

「mdcast の 10〜20 行目を取得して」
→ get_lines ツールが呼ばれる
```

### 新規ウィンドウと既存ウィンドウ

- `launch`: 常に新しいウィンドウを開く。IDは自動生成されて返される。
- `update`: 既存ウィンドウの内容を更新する。`instance_id` で対象を指定。

複数インスタンスが起動している場合は `instance_id` を指定する。
1つだけ起動している場合は自動選択される。

## 仕組み

```
Claude Code / Claude Desktop / Codex CLI → MCP(stdio) → Python → HTTP API → mdcast
```

- Claude が MCP ツールを呼び出す
- `launch` の場合: Python スクリプトが mdcast バイナリを実行し、新ウィンドウを起動
- `update` 等の場合: Python スクリプトが mdcast の HTTP API にリクエストを送る
- mdcast がウィンドウを表示・更新する

MCP プロトコルが JSON 直列化を正しく処理するため、コードブロック（`` ` ``）、`$`、`\n` 等を含む Markdown もエスケープ問題なく送信できる。
