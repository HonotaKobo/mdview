import MarkdownIt from 'markdown-it';
import markdownItAnchor from 'markdown-it-anchor';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItDeflist from 'markdown-it-deflist';
import markdownItFootnote from 'markdown-it-footnote';
import markdownItFrontMatter from 'markdown-it-front-matter';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js';
import mermaid from 'mermaid';

import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let capturedFrontMatter = '';

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
  .use(markdownItFrontMatter, (fm: string) => {
    capturedFrontMatter = fm;
  })
  .use(markdownItAnchor, {
    permalink: false,
    slugify: (s: string) =>
      encodeURIComponent(s.trim().toLowerCase().replace(/\s+/g, '-')),
  })
  .use(markdownItTaskLists, { enabled: true })
  .use(markdownItDeflist)
  .use(markdownItFootnote)
  .use(texmath, {
    engine: katex,
    delimiters: 'dollars',
    katexOptions: { throwOnError: false },
  });

// Custom plugin: checkboxes in definition list <dd> elements
function deflistTaskPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'deflist-task', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'dd_open') continue;
      // Find the next inline token inside this dd
      for (let j = i + 1; j < tokens.length && tokens[j].type !== 'dd_close'; j++) {
        if (tokens[j].type !== 'inline') continue;
        const content = tokens[j].content;
        const match = content.match(/^\[([ xX])\]\s?/);
        if (!match) break;
        const checked = match[1] === 'x' || match[1] === 'X';
        // Add class to dd_open
        tokens[i].attrJoin('class', 'deflist-task-item');
        // Replace inline content: prepend checkbox HTML
        const checkbox = `<input type="checkbox"${checked ? ' checked' : ''}> `;
        tokens[j].content = content.slice(match[0].length);
        const children = tokens[j].children ?? [];
        tokens[j].children = children;
        // Replace the text token that starts with [ ] or [x]
        for (const child of children) {
          if (child.type === 'text' && child.content.startsWith(match[0])) {
            child.content = child.content.slice(match[0].length);
            break;
          }
        }
        // Insert html_inline token for the checkbox at the beginning
        const checkboxToken = new state.Token('html_inline', '', 0);
        checkboxToken.content = checkbox;
        children.unshift(checkboxToken);
        break;
      }
    }
  });
}

md.use(deflistTaskPlugin);

/** Expose the markdown-it instance for block parsing in editor mode */
export function getMarkdownIt(): MarkdownIt {
  return md;
}

export async function renderMarkdown(
  content: string,
  container: HTMLElement
): Promise<void> {
  capturedFrontMatter = '';
  const html = md.render(content);
  let fmHtml = '';
  if (capturedFrontMatter) {
    const highlighted = hljs.highlight(capturedFrontMatter, { language: 'yaml' }).value;
    fmHtml = `<pre class="hljs"><code>${highlighted}</code></pre>`;
  }
  container.innerHTML = DOMPurify.sanitize(fmHtml + html, {
    ADD_TAGS: ['semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext',
               'mfrac', 'msqrt', 'mroot', 'msup', 'msub', 'msubsup', 'munder',
               'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'mspace', 'mpadded',
               'menclose', 'mglyph', 'mmultiscripts', 'mprescripts', 'none',
               'math', 'mjx-container', 'eq', 'eqn'],
    ADD_ATTR: ['encoding', 'mathvariant', 'stretchy', 'fence', 'separator',
               'lspace', 'rspace', 'accent', 'accentunder', 'columnalign',
               'rowalign', 'columnspan', 'rowspan', 'depth', 'height', 'width',
               'displaystyle', 'scriptlevel', 'xmlns', 'class', 'style', 'aria-hidden'],
  });
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

export function addCopyButtons(container: HTMLElement): void {
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
