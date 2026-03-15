import type { Block } from './block-model';
import { getMarkdownIt, addCopyButtons, sanitizeHtml } from '../renderer';
import katex from 'katex';
import hljs from 'highlight.js';

const EDIT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

/** Footnote definitions context for resolving references in previews */
let _footnoteContext = '';

export function setFootnoteContext(defs: string): void {
  _footnoteContext = defs;
}

/**
 * Render a single block into an HTML element for edit mode.
 * Each block has a rendered preview (default) and a textarea editor
 * with formatting toolbar (shown when the edit icon is clicked).
 */
export function renderBlockElement(block: Block): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-block';
  wrapper.dataset.blockKey = block.key;
  wrapper.dataset.blockType = block.type;

  // HR: no editing needed
  if (block.type === 'hr') {
    wrapper.appendChild(document.createElement('hr'));
    return wrapper;
  }

  // Edit button (visible on hover)
  const editBtn = document.createElement('button');
  editBtn.className = 'block-edit-btn';
  editBtn.innerHTML = EDIT_ICON;
  editBtn.title = 'Edit';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!wrapper.classList.contains('editing')) {
      wrapper.classList.add('editing');
      const textarea = wrapper.querySelector('.block-editor-textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        autoResize(textarea);
      }
    }
  });
  wrapper.appendChild(editBtn);

  // Preview (rendered markdown)
  const preview = document.createElement('div');
  preview.className = 'block-preview';
  renderPreview(block, preview);
  wrapper.appendChild(preview);

  // Double-click preview to enter edit mode
  preview.addEventListener('dblclick', () => {
    if (!wrapper.classList.contains('editing')) {
      wrapper.classList.add('editing');
      const textarea = wrapper.querySelector('.block-editor-textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        autoResize(textarea);
      }
    }
  });

  // Source (textarea + toolbar, hidden by default)
  const source = document.createElement('div');
  source.className = 'block-source';
  renderSource(block, source);
  wrapper.appendChild(source);

  return wrapper;
}

// --- Preview ---

function renderPreview(block: Block, preview: HTMLElement): void {
  const md = getMarkdownIt();
  switch (block.type) {
    case 'front_matter': {
      // Strip --- delimiters and render as YAML-highlighted code
      const yamlContent = block.text.replace(/^---\s*\n?/, '').replace(/\n?---\s*$/, '');
      const highlighted = hljs.highlight(yamlContent, { language: 'yaml' }).value;
      preview.innerHTML = `<pre class="hljs"><code>${highlighted}</code></pre>`;
      break;
    }
    case 'math':
      try {
        preview.innerHTML = katex.renderToString(block.text, {
          throwOnError: false,
          displayMode: true,
        });
      } catch {
        preview.textContent = block.text;
      }
      break;
    case 'fence':
      preview.innerHTML = sanitizeHtml(md.render('```' + (block.lang || '') + '\n' + block.text + '\n```'));
      break;
    case 'code':
      preview.innerHTML = sanitizeHtml(md.render(block.text.split('\n').map(l => '    ' + l).join('\n')));
      break;
    default: {
      const isFootnoteDef = /^\[\^[^\]]+\]:/m.test(block.text);

      if (isFootnoteDef) {
        const refs: string[] = [];
        block.text.replace(/^\[\^([^\]]+)\]:/gm, (_m, id) => {
          refs.push(`[^${id}]`);
          return '';
        });
        const dummyRefs = refs.join(' ');
        const renderText = dummyRefs + '\n\n' + block.text;
        let html = md.render(renderText);
        html = html.replace(/^<p>.*?<\/p>\n?/, '');
        preview.innerHTML = sanitizeHtml(html);
      } else {
        let renderText = block.text;

        if (_footnoteContext) {
          renderText += '\n\n' + _footnoteContext;
        }

        let html = md.render(renderText);

        if (_footnoteContext) {
          html = html.replace(/<hr class="footnotes-sep">[\s\S]*$/, '');
        }

        preview.innerHTML = sanitizeHtml(html);
      }
      break;
    }
  }

  // Add copy buttons to any <pre> elements in the preview
  addCopyButtons(preview);
}

// --- Source (textarea + toolbar) ---

function renderSource(block: Block, source: HTMLElement): void {
  // Textarea — for fence/math, include delimiters in the editable area
  const textarea = document.createElement('textarea');
  textarea.className = 'block-editor-textarea';

  if (block.type === 'fence') {
    textarea.value = '```' + (block.lang || '') + '\n' + block.text + '\n```';
  } else if (block.type === 'math') {
    textarea.value = '$$\n' + block.text + '\n$$';
  } else {
    textarea.value = block.text;
  }

  textarea.rows = 1;
  textarea.spellcheck = false;
  textarea.addEventListener('input', () => autoResize(textarea));
  textarea.addEventListener('focus', () => autoResize(textarea));
  source.appendChild(textarea);

  // Formatting toolbar (text-oriented blocks only)
  if (!['fence', 'code', 'math'].includes(block.type)) {
    source.appendChild(createToolbar(textarea));
  }
}

function autoResize(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}

// --- Formatting toolbar ---

function createToolbar(textarea: HTMLTextAreaElement): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'block-editor-toolbar';

  // Inline formatting buttons
  const inlineButtons: { html: string; title: string; prefix: string; suffix: string }[] = [
    { html: '<strong>B</strong>', title: 'Bold', prefix: '**', suffix: '**' },
    { html: '<em>I</em>', title: 'Italic', prefix: '*', suffix: '*' },
    { html: '<s>S</s>', title: 'Strikethrough', prefix: '~~', suffix: '~~' },
    { html: 'Code', title: 'Inline Code', prefix: '`', suffix: '`' },
    { html: 'Link', title: 'Link', prefix: '[', suffix: '](url)' },
    { html: '$', title: 'Math', prefix: '$', suffix: '$' },
    { html: '<mark>M</mark>', title: 'Highlight', prefix: '==', suffix: '==' },
    { html: 'X<sup>2</sup>', title: 'Superscript', prefix: '^', suffix: '^' },
    { html: 'X<sub>2</sub>', title: 'Subscript', prefix: '~', suffix: '~' },
  ];

  for (const btn of inlineButtons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toolbar-btn';
    button.innerHTML = btn.html;
    button.title = btn.title;
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      wrapSelection(textarea, btn.prefix, btn.suffix);
    });
    toolbar.appendChild(button);
  }

  // Separator
  const sep = document.createElement('span');
  sep.className = 'toolbar-sep';
  toolbar.appendChild(sep);

  // Line-prefix buttons
  const lineButtons: { html: string; title: string; prefix: string }[] = [
    { html: 'H1', title: 'Heading 1', prefix: '# ' },
    { html: 'H2', title: 'Heading 2', prefix: '## ' },
    { html: 'H3', title: 'Heading 3', prefix: '### ' },
    { html: '&gt;', title: 'Quote', prefix: '> ' },
    { html: '&bull;', title: 'Bullet List', prefix: '- ' },
    { html: '1.', title: 'Ordered List', prefix: '1. ' },
  ];

  for (const btn of lineButtons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toolbar-btn';
    button.innerHTML = btn.html;
    button.title = btn.title;
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      toggleLinePrefix(textarea, btn.prefix);
    });
    toolbar.appendChild(button);
  }

  return toolbar;
}

/**
 * Count consecutive occurrences of `ch` immediately before `pos` in `str`.
 */
function countCharBefore(str: string, pos: number, ch: string): number {
  let count = 0;
  for (let i = pos - 1; i >= 0 && str[i] === ch; i--) count++;
  return count;
}

/**
 * Count consecutive occurrences of `ch` starting at `pos` in `str`.
 */
function countCharAt(str: string, pos: number, ch: string): number {
  let count = 0;
  for (let i = pos; i < str.length && str[i] === ch; i++) count++;
  return count;
}

/**
 * For Bold/Italic (* based markers), expand selection to the full word
 * between markers when cursor is inside *text* with no selection.
 * Returns [start, end] of the effective selection.
 */
function expandSelectionForAsterisks(value: string, start: number, end: number): [number, number] {
  if (start !== end) return [start, end];

  // Find how many * are immediately before/after the cursor region
  // Walk left to find start of the "word" between asterisks
  let wordStart = start;
  let wordEnd = start;

  // Walk left until we hit * or start of string
  while (wordStart > 0 && value[wordStart - 1] !== '*' && value[wordStart - 1] !== '\n') {
    wordStart--;
  }
  // Walk right until we hit * or end of string
  while (wordEnd < value.length && value[wordEnd] !== '*' && value[wordEnd] !== '\n') {
    wordEnd++;
  }

  // Check that we're actually between * markers
  const starsBefore = countCharBefore(value, wordStart, '*');
  const starsAfter = countCharAt(value, wordEnd, '*');

  if (starsBefore > 0 && starsAfter > 0 && wordStart < wordEnd) {
    return [wordStart, wordEnd];
  }

  return [start, end];
}

function wrapSelection(textarea: HTMLTextAreaElement, prefix: string, suffix: string): void {
  const { value } = textarea;
  let start = textarea.selectionStart;
  let end = textarea.selectionEnd;

  const isAsteriskBased = /^\*+$/.test(prefix) && /^\*+$/.test(suffix);

  // For * based formatting with no selection, expand to word between markers
  if (isAsteriskBased && start === end) {
    [start, end] = expandSelectionForAsterisks(value, start, end);
  }

  if (isAsteriskBased) {
    // Smart asterisk handling: * = italic (1), ** = bold (2), *** = bold+italic (3)
    const markerLen = prefix.length; // 1 for italic, 2 for bold
    const starsBefore = countCharBefore(value, start, '*');
    const starsAfter = countCharAt(value, end, '*');
    const currentMarkers = Math.min(starsBefore, starsAfter);

    if (currentMarkers >= markerLen) {
      // Already has this formatting — remove exactly `markerLen` asterisks
      const newBefore = value.slice(0, start - markerLen);
      const inner = value.slice(start, end);
      const newAfter = value.slice(end + markerLen);
      textarea.value = newBefore + inner + newAfter;
      textarea.selectionStart = start - markerLen;
      textarea.selectionEnd = end - markerLen;
    } else {
      // Add asterisks
      const inner = value.slice(start, end) || 'text';
      textarea.value = value.slice(0, start) + prefix + inner + suffix + value.slice(end);
      textarea.selectionStart = start + prefix.length;
      textarea.selectionEnd = start + prefix.length + inner.length;
    }
  } else {
    // Non-asterisk markers: check surrounding text for toggle off
    const beforePrefix = value.slice(start - prefix.length, start);
    const afterSuffix = value.slice(end, end + suffix.length);

    if (beforePrefix === prefix && afterSuffix === suffix) {
      const inner = value.slice(start, end);
      textarea.value = value.slice(0, start - prefix.length) + inner + value.slice(end + suffix.length);
      textarea.selectionStart = start - prefix.length;
      textarea.selectionEnd = end - prefix.length;
    } else {
      const selected = value.slice(start, end);
      if (selected.length >= prefix.length + suffix.length &&
          selected.startsWith(prefix) && selected.endsWith(suffix)) {
        const inner = selected.slice(prefix.length, -suffix.length);
        textarea.value = value.slice(0, start) + inner + value.slice(end);
        textarea.selectionStart = start;
        textarea.selectionEnd = start + inner.length;
      } else {
        const sel = selected || 'text';
        const inserted = prefix + sel + suffix;
        textarea.value = value.slice(0, start) + inserted + value.slice(end);
        textarea.selectionStart = start + prefix.length;
        textarea.selectionEnd = start + prefix.length + sel.length;
      }
    }
  }

  textarea.focus();
  textarea.dispatchEvent(new Event('input'));
}

/** Toggle a line prefix (e.g., '# ', '> ', '- ') on the current line */
function toggleLinePrefix(textarea: HTMLTextAreaElement, prefix: string): void {
  const { selectionStart: start, value } = textarea;

  // Find start of the current line
  let lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', start);
  const lineEndPos = lineEnd === -1 ? value.length : lineEnd;
  const line = value.slice(lineStart, lineEndPos);

  // For heading prefixes, remove any existing heading prefix first
  const headingPrefixes = ['# ', '## ', '### ', '#### ', '##### ', '###### '];
  const isHeadingBtn = headingPrefixes.includes(prefix);

  if (isHeadingBtn) {
    const existingMatch = line.match(/^(#{1,6})\s+/);
    if (existingMatch && existingMatch[0] === prefix) {
      // Same heading level: toggle off (remove prefix)
      textarea.value = value.slice(0, lineStart) + line.slice(prefix.length) + value.slice(lineEndPos);
      textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - prefix.length);
    } else if (existingMatch) {
      // Different heading level: replace
      const oldPrefix = existingMatch[0];
      textarea.value = value.slice(0, lineStart) + prefix + line.slice(oldPrefix.length) + value.slice(lineEndPos);
      textarea.selectionStart = textarea.selectionEnd = start + (prefix.length - oldPrefix.length);
    } else {
      // No heading: add prefix
      textarea.value = value.slice(0, lineStart) + prefix + line + value.slice(lineEndPos);
      textarea.selectionStart = textarea.selectionEnd = start + prefix.length;
    }
  } else if (line.startsWith(prefix)) {
    // Has prefix: remove it
    textarea.value = value.slice(0, lineStart) + line.slice(prefix.length) + value.slice(lineEndPos);
    textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - prefix.length);
  } else {
    // No prefix: add it
    textarea.value = value.slice(0, lineStart) + prefix + line + value.slice(lineEndPos);
    textarea.selectionStart = textarea.selectionEnd = start + prefix.length;
  }

  textarea.focus();
  textarea.dispatchEvent(new Event('input'));
}
