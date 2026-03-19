import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { collectStyles, buildDocument } from './html-export';

export async function exportAsPdf(title: string): Promise<void> {
  const filePath = await save({
    defaultPath: `${title}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!filePath) return;

  const content = document.getElementById('content')!;
  const styles = collectStyles() + getPdfExtraCss();
  const html = buildDocument(title, 'light', styles, content.innerHTML);

  await invoke('export_pdf', { htmlContent: html, outputPath: filePath });
}

function getPdfExtraCss(): string {
  return `
@page { margin: 15mm; }
.code-copy-btn { display: none !important; }
h1, h2, h3 { break-after: avoid; }
pre, table, .mermaid-container { break-inside: avoid; }
img { max-width: 100% !important; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;
}
