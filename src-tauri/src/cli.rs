use clap::{Parser, ValueEnum};

/// Unescape \n → newline, \\ → backslash
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
#[command(name = "mdcast", about = "Markdown viewer for the AI age")]
pub struct CliArgs {
    /// Markdown file path (positional argument)
    #[arg(value_name = "FILE")]
    pub file_pos: Option<String>,

    /// Open a markdown file (use with --id for AI tracking)
    #[arg(long, value_name = "PATH", conflicts_with = "file_pos")]
    pub file: Option<String>,

    /// Markdown body content (full replacement, use \n for newlines)
    #[arg(long, value_parser = unescape, conflicts_with_all = ["file_pos", "file", "delete", "insert", "replace", "grep", "lines"])]
    pub body: Option<String>,

    /// Window identifier (same ID updates existing window)
    #[arg(long)]
    pub id: Option<String>,

    /// Document title (window title / default save filename)
    #[arg(long, short)]
    pub title: Option<String>,

    /// Query existing instance properties (requires --id, repeatable)
    #[arg(long, value_name = "PROPERTY", conflicts_with_all = ["body", "file", "file_pos", "delete", "insert", "replace"])]
    pub query: Vec<QueryProperty>,

    /// List all open windows
    #[arg(long, conflicts_with_all = ["body", "file", "file_pos", "id", "title", "query", "grep", "lines", "delete", "insert", "replace"])]
    pub list: bool,

    // --- Search (read-only, requires --id) ---

    /// Search content with regex (returns line numbers)
    #[arg(long, value_name = "PATTERN", conflicts_with_all = ["body", "file", "file_pos", "delete", "insert", "replace", "lines"])]
    pub grep: Option<String>,

    /// Get content at line range (e.g. "10-20", "5")
    #[arg(long, value_name = "RANGE", conflicts_with_all = ["body", "file", "file_pos", "delete", "insert", "replace", "grep"])]
    pub lines: Option<String>,

    // --- Line editing (write, requires --id) ---

    /// Delete lines (e.g. "199-200,203")
    #[arg(long, value_name = "RANGE", conflicts_with_all = ["body", "file", "file_pos", "insert", "replace", "grep", "lines", "query"])]
    pub delete: Option<String>,

    /// Insert content before line (use with --content)
    #[arg(long, value_name = "LINE", conflicts_with_all = ["body", "file", "file_pos", "delete", "replace", "grep", "lines", "query"])]
    pub insert: Option<usize>,

    /// Replace line range with content (e.g. "42-45", use with --content)
    #[arg(long, value_name = "RANGE", conflicts_with_all = ["body", "file", "file_pos", "delete", "insert", "grep", "lines", "query"])]
    pub replace: Option<String>,

    /// Content for --insert / --replace (use \n for newlines)
    #[arg(long, value_parser = unescape)]
    pub content: Option<String>,

    /// Internal: run GUI in foreground (used by daemonize logic)
    #[arg(long = "_foreground", hide = true)]
    pub foreground: bool,
}

#[derive(Debug, Clone, ValueEnum)]
pub enum QueryProperty {
    /// Saved file path (empty + exit 1 if unsaved)
    Path,
    /// Current markdown source
    Body,
    /// Document title
    Title,
    /// Instance status as JSON
    Status,
    /// Total line count
    Linecount,
    /// All properties as JSON
    All,
}
