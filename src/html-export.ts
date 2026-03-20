import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { renderMarkdown } from './renderer';

type ExportStyle = 'styled' | 'structure-only';

// エクスポートスタイル選択ダイアログを表示する
function showExportDialog(): Promise<ExportStyle | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'html-export-overlay';

    const modal = document.createElement('div');
    modal.id = 'html-export-modal';

    const title = document.createElement('div');
    title.className = 'update-modal-text';
    title.textContent = 'HTMLエクスポート';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '12px';
    modal.appendChild(title);

    const label = document.createElement('div');
    label.className = 'update-modal-text';
    label.textContent = 'スタイル:';
    label.style.marginBottom = '8px';
    modal.appendChild(label);

    let selected: ExportStyle = 'styled';

    const radioGroup = document.createElement('div');
    radioGroup.style.marginBottom = '16px';

    for (const [value, text] of [['styled', 'スタイル付き'], ['structure-only', '構造のみ']] as const) {
      const radioLabel = document.createElement('label');
      radioLabel.style.display = 'block';
      radioLabel.style.marginBottom = '4px';
      radioLabel.style.cursor = 'pointer';
      radioLabel.style.fontSize = '14px';
      radioLabel.style.color = 'var(--text-primary)';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'export-style';
      radio.value = value;
      radio.checked = value === 'styled';
      radio.style.marginRight = '6px';
      radio.addEventListener('change', () => { selected = value; });

      radioLabel.appendChild(radio);
      radioLabel.appendChild(document.createTextNode(text));
      radioGroup.appendChild(radioLabel);
    }
    modal.appendChild(radioGroup);

    const actions = document.createElement('div');
    actions.className = 'update-modal-actions';

    const cancel = document.createElement('button');
    cancel.className = 'update-modal-btn';
    cancel.textContent = 'キャンセル';
    cancel.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(null);
    });
    actions.appendChild(cancel);

    const ok = document.createElement('button');
    ok.className = 'update-modal-btn update-modal-btn-primary';
    ok.textContent = 'エクスポート';
    ok.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(selected);
    });
    actions.appendChild(ok);

    modal.appendChild(actions);
    overlay.appendChild(modal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        resolve(null);
      }
    });

    document.body.appendChild(overlay);
    ok.focus();
  });
}

export async function exportAsHtml(title: string, markdown: string): Promise<void> {
  const style = await showExportDialog();
  if (!style) return;

  const filePath = await save({
    defaultPath: `${title}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!filePath) return;

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  try {
    await renderMarkdown(markdown, container);

    container.querySelectorAll('.code-copy-btn').forEach(btn => btn.remove());
    container.querySelectorAll('.code-block-wrapper').forEach(wrapper => {
      const pre = wrapper.querySelector('pre');
      if (pre) wrapper.parentNode!.insertBefore(pre, wrapper);
      wrapper.remove();
    });

    const styles = style === 'styled' ? collectStyles() : '';
    const theme = document.documentElement.getAttribute('data-theme') || 'light';

    const html = buildDocument(title, theme, styles, container.innerHTML);
    await invoke('save_file', { path: filePath, content: html });
  } finally {
    document.body.removeChild(container);
  }
}

// エクスポートに必要なCSSルールのみ収集するセレクタパターン
const EXPORT_SELECTOR_PATTERNS = [
  /^:root\[data-theme/,
  /^#content/,
  /^\.hljs/,
  /^\.katex/,
  /^\.code-block-wrapper/,
  /^\.code-copy-btn/,
  /^\.mermaid/,
  /^\.toc/,
  /^\.task-list/,
  /^\.footnote/,
  /^body$/,
];

function selectorMatchesExport(selectorText: string): boolean {
  return EXPORT_SELECTOR_PATTERNS.some(pattern => pattern.test(selectorText));
}

export function collectStyles(): string {
  const css: string[] = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSStyleRule) {
          // セレクタがエクスポート対象にマッチするルールのみ収集
          if (selectorMatchesExport(rule.selectorText)) {
            // bodyルールはフォント関連プロパティのみ抽出
            if (rule.selectorText === 'body') {
              const fontCss = extractFontProperties(rule);
              if (fontCss) css.push(fontCss);
            } else {
              css.push(rule.cssText);
            }
          }
        } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
          // @media, @supports内のルールも探索する
          const nested = collectFromGroupRule(rule);
          if (nested) css.push(nested);
        } else {
          // @font-face等はそのまま含める
          const text = rule.cssText;
          if (text.startsWith('@font-face')) {
            css.push(text);
          }
        }
      }
    } catch {
      // アクセスできないスタイルシートはスキップする
    }
  }
  return css.join('\n');
}

function extractFontProperties(rule: CSSStyleRule): string | null {
  const props = ['font-family', 'font-size', 'line-height', 'font-weight', 'font-style'];
  const parts: string[] = [];
  for (const prop of props) {
    const val = rule.style.getPropertyValue(prop);
    if (val) parts.push(`${prop}: ${val};`);
  }
  if (parts.length === 0) return null;
  return `body { ${parts.join(' ')} }`;
}

function collectFromGroupRule(rule: CSSMediaRule | CSSSupportsRule): string | null {
  const matched: string[] = [];
  for (const inner of rule.cssRules) {
    if (inner instanceof CSSStyleRule && selectorMatchesExport(inner.selectorText)) {
      if (inner.selectorText === 'body') {
        const fontCss = extractFontProperties(inner);
        if (fontCss) matched.push(fontCss);
      } else {
        matched.push(inner.cssText);
      }
    }
  }
  if (matched.length === 0) return null;
  const conditionText = rule instanceof CSSMediaRule
    ? `@media ${rule.conditionText}`
    : `@supports ${rule.conditionText}`;
  return `${conditionText} {\n${matched.join('\n')}\n}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildDocument(title: string, theme: string, styles: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;">
<title>${escapeHtml(title)}</title>
<style>
${styles}
body { overflow: auto; }
</style>
</head>
<body>
<div id="content">
${body}
</div>
</body>
</html>`;
}
