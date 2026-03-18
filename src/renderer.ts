import MarkdownIt from 'markdown-it';
import markdownItAnchor from 'markdown-it-anchor';
import markdownItTaskLists from 'markdown-it-task-lists';
import markdownItDeflist from 'markdown-it-deflist';
import markdownItFootnote from 'markdown-it-footnote';
import markdownItFrontMatter from 'markdown-it-front-matter';
import markdownItMark from 'markdown-it-mark';
import markdownItSup from 'markdown-it-sup';
import markdownItSub from 'markdown-it-sub';
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

const slugify = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');

let capturedFrontMatter = '';

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight: (str: string, lang: string): string => {
    // Mermaid ブロック: ハイライトせず、後処理に委ねる
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
    slugify,
  })
  .use(markdownItTaskLists, { enabled: true })
  .use(markdownItDeflist)
  .use(markdownItFootnote)
  .use(markdownItMark)
  .use(markdownItSup)
  .use(markdownItSub)
  .use(texmath, {
    engine: katex,
    delimiters: 'dollars',
    katexOptions: { throwOnError: false },
  });

let deflistRenderCount = 0;

// カスタムプラグイン: 定義リスト <dd> 要素内のチェックボックス、ラジオボタン、テキスト入力
function deflistTaskPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'deflist-task', (state) => {
    const tokens = state.tokens;
    deflistRenderCount++;
    const renderId = deflistRenderCount;
    let radioGroupId = 0;

    for (let i = 0; i < tokens.length; i++) {
      // ラジオグループの境界として dt_open を追跡する
      if (tokens[i].type === 'dt_open') {
        radioGroupId++;
        continue;
      }

      if (tokens[i].type !== 'dd_open') continue;

      // この dd 内の次の inline トークンを探す
      for (let j = i + 1; j < tokens.length && tokens[j].type !== 'dd_close'; j++) {
        if (tokens[j].type !== 'inline') continue;
        const content = tokens[j].content;
        const children = tokens[j].children ?? [];
        tokens[j].children = children;

        // 1) 複合: [R:"x?"][T:"value"] ラベル(任意)
        let match = content.match(/^\[R:"(x?)"\]\[T:"([^"]*)"\]\s?(.*)/);
        if (match) {
          const radioChecked = match[1] === 'x';
          const textValue = match[2];
          const label = match[3] || '';
          tokens[i].attrJoin('class', 'deflist-task-item deflist-form-item');

          const radioHtml = `<input type="radio" name="deflist-radio-${renderId}-${radioGroupId}"${radioChecked ? ' checked' : ''}> `;
          const textHtml = `<input type="text" value="${escapeHtml(textValue)}" class="deflist-text-input"${label ? ` placeholder="${escapeHtml(label)}"` : ''}> `;

          tokens[j].content = '';
          const combinedChildren: typeof children = [];
          tokens[j].children = combinedChildren;
          const radioToken = new state.Token('html_inline', '', 0);
          radioToken.content = radioHtml;
          const textToken = new state.Token('html_inline', '', 0);
          textToken.content = textHtml;
          combinedChildren.push(radioToken, textToken);
          break;
        }

        // 2) ラジオボタン: [R:"x?"] ラベル
        match = content.match(/^\[R:"(x?)"\]\s?/);
        if (match) {
          const checked = match[1] === 'x';
          tokens[i].attrJoin('class', 'deflist-task-item deflist-form-item');

          const radioHtml = `<input type="radio" name="deflist-radio-${renderId}-${radioGroupId}"${checked ? ' checked' : ''}> `;

          tokens[j].content = content.slice(match[0].length);
          for (const child of children) {
            if (child.type === 'text' && child.content.startsWith(match[0])) {
              child.content = child.content.slice(match[0].length);
              break;
            }
          }
          const radioToken = new state.Token('html_inline', '', 0);
          radioToken.content = radioHtml;
          const rdLabelOpen = new state.Token('html_inline', '', 0);
          rdLabelOpen.content = '<label>';
          const rdLabelClose = new state.Token('html_inline', '', 0);
          rdLabelClose.content = '</label>';
          children.unshift(radioToken);
          children.unshift(rdLabelOpen);
          children.push(rdLabelClose);
          break;
        }

        // 3) テキスト入力: [T:"value"] ラベル
        match = content.match(/^\[T:"([^"]*)"\]\s?(.*)/);
        if (match) {
          const textValue = match[1];
          const label = match[2] || '';
          tokens[i].attrJoin('class', 'deflist-task-item deflist-form-item');

          const textHtml = `<input type="text" value="${escapeHtml(textValue)}" class="deflist-text-input"${label ? ` placeholder="${escapeHtml(label)}"` : ''}> `;

          tokens[j].content = '';
          const textChildren: typeof children = [];
          tokens[j].children = textChildren;
          const textToken = new state.Token('html_inline', '', 0);
          textToken.content = textHtml;
          textChildren.push(textToken);
          break;
        }

        // 4) チェックボックス: [ ] または [x] (既存)
        match = content.match(/^\[([ xX])\]\s?/);
        if (match) {
          const checked = match[1] === 'x' || match[1] === 'X';
          tokens[i].attrJoin('class', 'deflist-task-item');
          const checkbox = `<input type="checkbox"${checked ? ' checked' : ''}> `;
          tokens[j].content = content.slice(match[0].length);
          for (const child of children) {
            if (child.type === 'text' && child.content.startsWith(match[0])) {
              child.content = child.content.slice(match[0].length);
              break;
            }
          }
          const checkboxToken = new state.Token('html_inline', '', 0);
          checkboxToken.content = checkbox;
          const cbLabelOpen = new state.Token('html_inline', '', 0);
          cbLabelOpen.content = '<label>';
          const cbLabelClose = new state.Token('html_inline', '', 0);
          cbLabelClose.content = '</label>';
          children.unshift(checkboxToken);
          children.unshift(cbLabelOpen);
          children.push(cbLabelClose);
          break;
        }

        break;
      }
    }
  });
}

md.use(deflistTaskPlugin);

function tocPlugin(mdInstance: MarkdownIt): void {
  mdInstance.core.ruler.after('inline', 'toc', (state) => {
    const tokens = state.tokens;

    const headings: { level: number; text: string; slug: string }[] = [];
    const usedSlugs = new Map<string, boolean>();
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'heading_open') {
        const level = parseInt(tokens[i].tag.slice(1), 10);
        if (i + 1 < tokens.length && tokens[i + 1].type === 'inline') {
          const children = tokens[i + 1].children ?? [];
          const text = children
            .filter((t: { type: string }) => t.type === 'text' || t.type === 'code_inline' || t.type === 'softbreak')
            .map((t: { type: string; content: string }) => t.type === 'softbreak' ? ' ' : t.content)
            .join('');
          let slug = slugify(text);
          let uniq = slug;
          let n = 1;
          while (usedSlugs.has(uniq)) {
            uniq = `${slug}-${n++}`;
          }
          usedSlugs.set(uniq, true);
          headings.push({ level, text, slug: uniq });
        }
      }
    }

    if (headings.length === 0) return;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'paragraph_open') continue;
      if (i + 1 >= tokens.length || tokens[i + 1].type !== 'inline') continue;

      const content = tokens[i + 1].content.trim();
      if (content !== '[TOC]' && content !== '[toc]') continue;

      let closeIdx = i + 2;
      while (closeIdx < tokens.length && tokens[closeIdx].type !== 'paragraph_close') {
        closeIdx++;
      }

      const minLevel = Math.min(...headings.map(h => h.level));
      let html = '<nav class="toc">\n';
      let prevLevel = minLevel - 1;

      for (const heading of headings) {
        const level = heading.level;
        if (level > prevLevel) {
          for (let j = prevLevel; j < level; j++) html += '<ul>';
        } else if (level < prevLevel) {
          html += '</li>';
          for (let j = prevLevel; j > level; j--) html += '</ul></li>';
        } else {
          if (prevLevel >= minLevel) html += '</li>';
        }
        html += `<li><a href="#${escapeHtml(heading.slug)}">${escapeHtml(heading.text)}</a>`;
        prevLevel = level;
      }

      html += '</li>';
      for (let j = prevLevel; j > minLevel; j--) html += '</ul></li>';
      html += '</ul>\n</nav>\n';

      const tocToken = new state.Token('html_block', '', 0);
      tocToken.content = html;
      tocToken.map = tokens[i].map;
      tokens.splice(i, closeIdx - i + 1, tocToken);
    }
  });
}

md.use(tocPlugin);

/** エディタモードでのブロックパースのために markdown-it インスタンスを公開する */
export function getMarkdownIt(): MarkdownIt {
  return md;
}

const PURIFY_CONFIG = {
  ADD_TAGS: ['semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext',
             'mfrac', 'msqrt', 'mroot', 'msup', 'msub', 'msubsup', 'munder',
             'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'mspace', 'mpadded',
             'menclose', 'mglyph', 'mmultiscripts', 'mprescripts', 'none',
             'math', 'mjx-container', 'eq', 'eqn'],
  ADD_ATTR: ['encoding', 'mathvariant', 'stretchy', 'fence', 'separator',
             'lspace', 'rspace', 'accent', 'accentunder', 'columnalign',
             'rowalign', 'columnspan', 'rowspan', 'depth', 'height', 'width',
             'displaystyle', 'scriptlevel', 'xmlns', 'class', 'style', 'aria-hidden'],
};

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
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
  container.innerHTML = sanitizeHtml(fmHtml + html);
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
    wrapper.className = 'mb-4 text-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto';

    try {
      const id = `mermaid-${mermaidCounter++}`;
      const { svg } = await mermaid.render(id, source);
      wrapper.innerHTML = sanitizeHtml(svg);
    } catch {
      wrapper.innerHTML = `<pre class="text-[var(--danger-color)] border-[var(--danger-color)]"><code>${escapeHtml(source)}</code></pre>`;
    }

    block.replaceWith(wrapper);
  }
}

const COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><g stroke="currentColor" stroke-width="1" fill="none"><path d="M 10 11 L 10 5 L 4 5 L 4 2 L 13 2 L 13 11 L 10 11 L 10 15 L 1 15 L 1 5 L 4 5"/></g></svg>';
const CHECK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/></svg>';

export function addCopyButtons(container: HTMLElement): void {
  const preBlocks = container.querySelectorAll('pre');
  for (const pre of preBlocks) {
    const wrapper = document.createElement('div');
    wrapper.className = 'group/code relative';
    pre.parentNode!.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const btn = document.createElement('button');
    btn.className = 'absolute top-2 right-2 p-1 text-xs text-[var(--text-secondary)] bg-transparent border-none rounded cursor-pointer opacity-0 transition-opacity duration-150 leading-[0] z-1 group-hover/code:opacity-100 hover:text-[var(--text-primary)]';
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

    wrapper.appendChild(btn);
  }
}
