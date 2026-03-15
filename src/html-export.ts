import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { renderMarkdown } from './renderer';

export async function exportAsHtml(title: string, markdown: string): Promise<void> {
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

    const styles = collectStyles();
    const theme = document.documentElement.getAttribute('data-theme') || 'light';

    const html = buildDocument(title, theme, styles, container.innerHTML);
    await invoke('save_file', { path: filePath, content: html });
  } finally {
    document.body.removeChild(container);
  }
}

function collectStyles(): string {
  const css: string[] = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        css.push(rule.cssText);
      }
    } catch {
      // Skip inaccessible stylesheets
    }
  }
  return css.join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDocument(title: string, theme: string, styles: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
