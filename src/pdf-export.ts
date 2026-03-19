import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import html2pdf from 'html2pdf.js';

// html2pdf.js の内部再クローンでセレクタベースのスタイルが失われる問題に対処するため、
// computedStyle をインラインスタイルとして焼き込む
function inlineComputedStyles(element: HTMLElement): void {
  const computed = window.getComputedStyle(element);
  const properties = [
    'font-family', 'font-size', 'font-weight', 'font-style',
    'line-height', 'color', 'background-color', 'background',
    'border', 'border-radius', 'padding', 'margin',
    'text-decoration', 'text-align', 'white-space',
    'display', 'list-style-type',
  ];
  for (const prop of properties) {
    element.style.setProperty(prop, computed.getPropertyValue(prop));
  }
  for (const child of element.children) {
    if (child instanceof HTMLElement) {
      inlineComputedStyles(child);
    }
  }
}

export async function exportAsPdf(title: string): Promise<void> {
  const filePath = await save({
    defaultPath: `${title}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!filePath) return;

  const content = document.getElementById('content')!;
  const clone = content.cloneNode(true) as HTMLElement;

  clone.style.position = 'fixed';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.zIndex = '-1';
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

  // html2canvas は SVG のレンダリングに問題を起こしやすいため、Mermaid SVG を img に変換
  clone.querySelectorAll('.mermaid-container svg').forEach(svg => {
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = document.createElement('img');
    img.src = url;
    img.style.maxWidth = '100%';
    svg.parentNode!.replaceChild(img, svg);
  });

  // #content セレクタのCSSルールがクローンに適用されるよう、元要素のIDを一時変更
  content.id = 'content-original';
  clone.id = 'content';

  document.body.appendChild(clone);

  // DOMに追加後、CSSが適用された状態でスタイルを焼き込む
  inlineComputedStyles(clone);

  try {
    const blob: Blob = await html2pdf()
      .set({
        margin: [10, 10, 10, 10],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0, windowWidth: 800 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
      })
      .from(clone)
      .outputPdf('blob');

    const buffer = await blob.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buffer));
    await invoke('save_binary_file', { path: filePath, data: bytes });
  } finally {
    // Mermaid SVG変換で作成した Blob URL を解放
    clone.querySelectorAll('.mermaid-container img').forEach(img => {
      URL.revokeObjectURL((img as HTMLImageElement).src);
    });
    document.body.removeChild(clone);
    // 元要素のIDを復元
    content.id = 'content';
  }
}
