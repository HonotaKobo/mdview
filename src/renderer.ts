import MarkdownIt from 'markdown-it';
import markdownItAnchor from 'markdown-it-anchor';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItFootnote from 'markdown-it-footnote';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js';
import mermaid from 'mermaid';

import 'katex/dist/katex.min.css';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight: (str: string, lang: string): string => {
    // Mermaid blocks: don't highlight, leave for post-processing
    if (lang === 'mermaid') {
      return `<pre class="mermaid-source"><code>${escapeHtml(str)}</code></pre>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
      } catch {
        // fall through
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`;
  },
})
  .use(markdownItAnchor, {
    permalink: false,
    slugify: (s: string) =>
      encodeURIComponent(s.trim().toLowerCase().replace(/\s+/g, '-')),
  })
  .use(markdownItTaskLists, { enabled: false })
  .use(markdownItFootnote)
  .use(texmath, {
    engine: katex,
    delimiters: 'dollars',
    katexOptions: { throwOnError: false },
  });

export async function renderMarkdown(
  content: string,
  container: HTMLElement
): Promise<void> {
  const html = md.render(content);
  container.innerHTML = html;
  await renderMermaidDiagrams(container);
  addCopyButtons(container);
}

let mermaidCounter = 0;

async function renderMermaidDiagrams(container: HTMLElement): Promise<void> {
  const blocks = container.querySelectorAll('pre.mermaid-source');

  for (const block of blocks) {
    const code = block.querySelector('code');
    const source = code ? code.textContent || '' : '';
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-container';

    try {
      const id = `mermaid-${mermaidCounter++}`;
      const { svg } = await mermaid.render(id, source);
      wrapper.innerHTML = svg;
    } catch {
      wrapper.innerHTML = `<pre class="mermaid-error"><code>${escapeHtml(source)}</code></pre>`;
    }

    block.replaceWith(wrapper);
  }
}

const COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M0 0 C3.3 0 6.6 0 10 0 C10 3.3 10 6.6 10 10 C9.34 10 8.68 10 8 10 C8 10.66 8 11.32 8 12 C4.7 12 1.4 12 -2 12 C-2 8.7 -2 5.4 -2 2 C-1.34 2 -0.68 2 0 2 C0 1.34 0 0.68 0 0 Z M1 1 C1 1.33 1 1.66 1 2 C3.31 2 5.62 2 8 2 C8 4.31 8 6.62 8 9 C8.33 9 8.66 9 9 9 C9 6.36 9 3.72 9 1 C6.36 1 3.72 1 1 1 Z M-1 3 C-1 5.64 -1 8.28 -1 11 C1.64 11 4.28 11 7 11 C7 8.36 7 5.72 7 3 C4.36 3 1.72 3 -1 3 Z" fill="currentColor" transform="translate(4,2)"/></svg>';
const CHECK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/></svg>';

function addCopyButtons(container: HTMLElement): void {
  const preBlocks = container.querySelectorAll('pre');
  for (const pre of preBlocks) {
    pre.style.position = 'relative';

    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.innerHTML = COPY_ICON;
    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code');
      const text = code ? code.textContent || '' : pre.textContent || '';
      await navigator.clipboard.writeText(text);
      btn.innerHTML = CHECK_ICON;
      setTimeout(() => {
        btn.innerHTML = COPY_ICON;
      }, 1500);
    });

    pre.appendChild(btn);
  }
}
