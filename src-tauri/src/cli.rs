use clap::{Parser, ValueEnum};

/// \n → 改行、\\ → バックスラッシュにアンエスケープする
fn unescape(s: &str) -> Result<String, String> {
    let mut result = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => result.push('\n'),
                Some('\\') => result.push('\\'),
                Some(other) => {
                    result.push('\\');
                    result.push(other);
                }
                None => result.push('\\'),
            }
        } else {
            result.push(c);
        }
    }
    Ok(result)
}

#[derive(Parser, Debug)]
#[command(name = "tsumugi", about = "Markdown viewer for the AI age")]
pub struct CliArgs {
    /// Markdownファイルパス（位置引数）
    #[arg(value_name = "FILE")]
    pub file_pos: Option<String>,

    /// Markdownファイルを開く（AI追跡には--idと併用）
    #[arg(long, value_name = "PATH", conflicts_with = "file_pos")]
    pub file: Option<String>,

    /// Markdownボディコンテンツ（全置換、改行には\nを使用）
    #[arg(long, value_parser = unescape, conflicts_with_all = ["file_pos", "file", "delete", "insert", "replace", "grep", "lines"])]
    pub body: Option<String>,

    /// ウィンドウ識別子（同じIDで既存ウィンドウを更新）
    #[arg(long)]
    pub id: Option<String>,

    /// ドキュメントタイトル（ウィンドウタイトル / デフォルト保存ファイル名）
    #[arg(long, short)]
    pub title: Option<String>,

    /// 既存インスタンスのプロパティを問い合わせる（--idが必要、繰り返し可能）
    #[arg(long, value_name = "PROPERTY", conflicts_with_all = ["body", "file", "file_pos", "delete", "insert", "replace"])]
    pub query: Vec<QueryProperty>,

    /// 開いているすべてのウィンドウを一覧表示
    #[arg(long, conflicts_with_all = ["body", "file", "file_pos", "id", "title", "query", "grep", "lines", "delete", "insert", "replace"])]
    pub list: bool,

    // --- 検索（読み取り専用、--idが必要） ---

    /// 正規表現でコンテンツを検索する（行番号を返す）
    #[arg(long, value_name = "PATTERN", conflicts_with_all = ["body", "file", "file_pos", "delete", "insert", "replace", "lines"])]
    pub grep: Option<String>,

    /// 行範囲のコンテンツを取得する（例: "10-20", "5"）
    #[arg(long, value_name = "RANGE", conflicts_with_all = ["body", "file", "file_pos", "delete", "insert", "replace", "grep"])]
    pub lines: Option<String>,

    // --- 行編集（書き込み、--idが必要） ---

    /// 行を削除する（例: "199-200,203"）
    #[arg(long, value_name = "RANGE", conflicts_with_all = ["body", "file", "file_pos", "insert", "replace", "grep", "lines", "query"])]
    pub delete: Option<String>,

    /// 指定行の前にコンテンツを挿入する（--contentと併用）
    #[arg(long, value_name = "LINE", conflicts_with_all = ["body", "file", "file_pos", "delete", "replace", "grep", "lines", "query"])]
    pub insert: Option<usize>,

    /// 行範囲をコンテンツで置換する（例: "42-45"、--contentと併用）
    #[arg(long, value_name = "RANGE", conflicts_with_all = ["body", "file", "file_pos", "delete", "insert", "grep", "lines", "query"])]
    pub replace: Option<String>,

    /// --insert / --replace用のコンテンツ（改行には\nを使用）
    #[arg(long, value_parser = unescape)]
    pub content: Option<String>,

    /// 内部用: GUIをフォアグラウンドで実行する（デーモン化ロジックで使用）
    #[arg(long = "_foreground", hide = true)]
    pub foreground: bool,

}

#[derive(Debug, Clone, ValueEnum)]
pub enum QueryProperty {
    /// 保存済みファイルパス（未保存の場合は空 + 終了コード1）
    Path,
    /// 現在のMarkdownソース
    Body,
    /// ドキュメントタイトル
    Title,
    /// インスタンスの状態（JSON形式）
    Status,
    /// 総行数
    Linecount,
    /// 全プロパティ（JSON形式）
    All,
}
