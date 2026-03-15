import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import html2pdf from 'html2pdf.js';

export async function exportAsPdf(title: string): Promise<void> {
  const filePath = await save({
    defaultPath: `${title}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!filePath) return;

  const content = document.getElementById('content')!;
  const clone = content.cloneNode(true) as HTMLElement;

  clone.style.position = 'fixed';
  clone.style.left = '-9999px';
  clone.style.top = '0';
  clone.style.width = '800px';
  clone.style.maxWidth = 'none';
  clone.style.padding = '24px 32px';
  clone.style.background = '#ffffff';
  clone.style.color = '#24292f';
  clone.style.setProperty('--bg-primary', '#ffffff');
  clone.style.setProperty('--bg-secondary', '#f6f8fa');
  clone.style.setProperty('--text-primary', '#24292f');
  clone.style.setProperty('--text-secondary', '#57606a');
  clone.style.setProperty('--border-color', '#d0d7de');
  clone.style.setProperty('--link-color', '#0969da');
  clone.style.setProperty('--code-bg', '#f6f8fa');

  clone.querySelectorAll('pre').forEach(pre => {
    (pre as HTMLElement).style.overflowX = 'visible';
    (pre as HTMLElement).style.whiteSpace = 'pre-wrap';
    (pre as HTMLElement).style.wordWrap = 'break-word';
  });

  clone.querySelectorAll('table').forEach(table => {
    (table as HTMLElement).style.overflow = 'visible';
  });

  clone.querySelectorAll('.mermaid-container').forEach(el => {
    (el as HTMLElement).style.overflowX = 'visible';
  });

  clone.querySelectorAll('.katex-display > .katex').forEach(el => {
    (el as HTMLElement).style.overflowX = 'visible';
  });

  clone.querySelectorAll('.code-copy-btn').forEach(btn => btn.remove());

  document.body.appendChild(clone);

  try {
    const blob: Blob = await html2pdf()
      .set({
        margin: [10, 10, 10, 10],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
      })
      .from(clone)
      .outputPdf('blob');

    const buffer = await blob.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buffer));
    await invoke('save_binary_file', { path: filePath, data: bytes });
  } finally {
    document.body.removeChild(clone);
  }
}
