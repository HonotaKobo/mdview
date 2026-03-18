import type { Block } from './block-model';
import { getMarkdownIt, addCopyButtons, sanitizeHtml } from '../renderer';
import katex from 'katex';
import hljs from 'highlight.js';

const EDIT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

/** 脚注定義コンテキスト */
let _footnoteContext = '';

export function setFootnoteContext(defs: string): void {
  _footnoteContext = defs;
}

/**
 * 編集モード用に単一ブロックをHTML要素にレンダリングする。
 * 各ブロックはレンダリング済みプレビュー（デフォルト）と、
 * 編集アイコンクリック時に表示されるtoolbar付きtextareaエディタを持つ。
 */
export function renderBlockElement(block: Block): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-block group/block relative border-l-2 border-transparent [&.editing]:border-l-[var(--link-color)] pl-1.5 -ml-2 transition-[border-color] duration-150 rounded-sm';
  wrapper.dataset.blockKey = block.key;
  wrapper.dataset.blockType = block.type;

  // HR: 編集不要
  if (block.type === 'hr') {
    wrapper.appendChild(document.createElement('hr'));
    return wrapper;
  }

  // 編集ボタン（ホバー時に表示）
  const editBtn = document.createElement('button');
  editBtn.className = 'absolute top-1 -left-[26px] bg-transparent border-none rounded text-[var(--text-secondary)] cursor-pointer p-1 leading-none opacity-0 transition-opacity duration-150 z-10 group-hover/block:opacity-100 group-[.editing]/block:hidden hover:text-[var(--text-primary)] print:hidden';
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

  // プレビュー（レンダリング済みmarkdown）
  const preview = document.createElement('div');
  preview.className = 'block-preview group-[.editing]/block:hidden';
  renderPreview(block, preview);
  wrapper.appendChild(preview);

  // プレビューをダブルクリックで編集モードに入る
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

  // ソース（textarea + toolbar、デフォルトで非表示）
  const source = document.createElement('div');
  source.className = 'block-source hidden group-[.editing]/block:block';
  renderSource(block, source);
  wrapper.appendChild(source);

  return wrapper;
}

// --- プレビュー ---

function renderPreview(block: Block, preview: HTMLElement): void {
  const md = getMarkdownIt();
  switch (block.type) {
    case 'front_matter': {
      // --- 区切りを除去してYAMLハイライト付きコードとしてレンダリング
      const yamlContent = block.text.replace(/^---\s*\n?/, '').replace(/\n?---\s*$/, '');
      const highlighted = hljs.highlight(yamlContent, { language: 'yaml' }).value;
      preview.innerHTML = sanitizeHtml(`<pre class="hljs"><code>${highlighted}</code></pre>`);
      break;
    }
    case 'math':
      try {
        preview.innerHTML = sanitizeHtml(katex.renderToString(block.text, {
          throwOnError: false,
          displayMode: true,
        }));
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

  // プレビュー内の<pre>要素にコピーボタンを追加
  addCopyButtons(preview);
}

// --- ソース（textarea + toolbar）---

function renderSource(block: Block, source: HTMLElement): void {
  // textarea — fence/mathの場合、区切り文字も編集領域に含める
  const textarea = document.createElement('textarea');
  textarea.className = 'block-editor-textarea block w-full min-h-[1.6em] p-2 m-0 border border-[var(--border-color)] rounded bg-[var(--bg-secondary)] text-[var(--text-color)] font-[var(--font-mono)] text-sm leading-normal resize-none overflow-hidden box-border focus:outline-none focus:border-[var(--link-color)]';

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

  // 書式設定toolbar（テキスト系ブロックのみ）
  if (!['fence', 'code', 'math'].includes(block.type)) {
    source.appendChild(createToolbar(textarea));
  }
}

function autoResize(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}

// --- 書式設定toolbar ---

function createToolbar(textarea: HTMLTextAreaElement): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'flex gap-0.5 pt-1';

  // インライン書式ボタン
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
    button.className = 'py-0.5 px-2 border border-[var(--border-color)] rounded-[3px] bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs leading-[1.4] cursor-pointer select-none hover:text-[var(--text-color)] hover:bg-[var(--bg-hover,var(--bg-secondary))] hover:border-[var(--text-secondary)]';
    button.innerHTML = btn.html;
    button.title = btn.title;
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      wrapSelection(textarea, btn.prefix, btn.suffix);
    });
    toolbar.appendChild(button);
  }

  // 区切り
  const sep = document.createElement('span');
  sep.className = 'w-px h-[18px] bg-[var(--border-color)] mx-1 self-center';
  toolbar.appendChild(sep);

  // 行頭プレフィックスボタン
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
    button.className = 'py-0.5 px-2 border border-[var(--border-color)] rounded-[3px] bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs leading-[1.4] cursor-pointer select-none hover:text-[var(--text-color)] hover:bg-[var(--bg-hover,var(--bg-secondary))] hover:border-[var(--text-secondary)]';
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
 * str の pos の直前にある ch の連続出現数をカウントする。
 */
function countCharBefore(str: string, pos: number, ch: string): number {
  let count = 0;
  for (let i = pos - 1; i >= 0 && str[i] === ch; i--) count++;
  return count;
}

/**
 * str の pos から始まる ch の連続出現数をカウントする。
 */
function countCharAt(str: string, pos: number, ch: string): number {
  let count = 0;
  for (let i = pos; i < str.length && str[i] === ch; i++) count++;
  return count;
}

/**
 * Bold/Italic（* ベースのマーカー）用に、カーソルが *text* 内にあり選択なしの場合、
 * マーカー間の単語全体に選択を拡張する。
 * 有効な選択範囲 [start, end] を返す。
 */
function expandSelectionForAsterisks(value: string, start: number, end: number): [number, number] {
  if (start !== end) return [start, end];

  // Find how many * are immediately before/after the cursor region
  // 左に移動してアスタリスク間の「単語」の開始位置を見つける
  let wordStart = start;
  let wordEnd = start;

  // * または文字列の先頭に到達するまで左に移動
  while (wordStart > 0 && value[wordStart - 1] !== '*' && value[wordStart - 1] !== '\n') {
    wordStart--;
  }
  // * または文字列の末尾に到達するまで右に移動
  while (wordEnd < value.length && value[wordEnd] !== '*' && value[wordEnd] !== '\n') {
    wordEnd++;
  }

  // 実際に * マーカーの間にいることを確認
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

  // * ベースの書式で選択なしの場合、マーカー間の単語に拡張
  if (isAsteriskBased && start === end) {
    [start, end] = expandSelectionForAsterisks(value, start, end);
  }

  if (isAsteriskBased) {
    // スマートアスタリスク処理: * = italic (1), ** = bold (2), *** = bold+italic (3)
    const markerLen = prefix.length; // 1 for italic, 2 for bold
    const starsBefore = countCharBefore(value, start, '*');
    const starsAfter = countCharAt(value, end, '*');
    const currentMarkers = Math.min(starsBefore, starsAfter);

    if (currentMarkers >= markerLen) {
      // 既にこの書式がある — markerLen 個のアスタリスクを正確に削除
      const newBefore = value.slice(0, start - markerLen);
      const inner = value.slice(start, end);
      const newAfter = value.slice(end + markerLen);
      textarea.value = newBefore + inner + newAfter;
      textarea.selectionStart = start - markerLen;
      textarea.selectionEnd = end - markerLen;
    } else {
      // アスタリスクを追加
      const inner = value.slice(start, end) || 'text';
      textarea.value = value.slice(0, start) + prefix + inner + suffix + value.slice(end);
      textarea.selectionStart = start + prefix.length;
      textarea.selectionEnd = start + prefix.length + inner.length;
    }
  } else {
    // 非アスタリスクマーカー: 周囲のテキストをチェックしてトグルオフ
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

/** 現在の行の行頭プレフィックス（例: '# ', '> ', '- '）をトグルする */
function toggleLinePrefix(textarea: HTMLTextAreaElement, prefix: string): void {
  const { selectionStart: start, value } = textarea;

  // 現在の行の開始位置を見つける
  let lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', start);
  const lineEndPos = lineEnd === -1 ? value.length : lineEnd;
  const line = value.slice(lineStart, lineEndPos);

  // 見出しプレフィックスの場合、既存の見出しプレフィックスを先に削除
  const headingPrefixes = ['# ', '## ', '### ', '#### ', '##### ', '###### '];
  const isHeadingBtn = headingPrefixes.includes(prefix);

  if (isHeadingBtn) {
    const existingMatch = line.match(/^(#{1,6})\s+/);
    if (existingMatch && existingMatch[0] === prefix) {
      // 同じ見出しレベル: トグルオフ（プレフィックスを削除）
      textarea.value = value.slice(0, lineStart) + line.slice(prefix.length) + value.slice(lineEndPos);
      textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - prefix.length);
    } else if (existingMatch) {
      // 異なる見出しレベル: 置換
      const oldPrefix = existingMatch[0];
      textarea.value = value.slice(0, lineStart) + prefix + line.slice(oldPrefix.length) + value.slice(lineEndPos);
      textarea.selectionStart = textarea.selectionEnd = start + (prefix.length - oldPrefix.length);
    } else {
      // 見出しなし: プレフィックスを追加
      textarea.value = value.slice(0, lineStart) + prefix + line + value.slice(lineEndPos);
      textarea.selectionStart = textarea.selectionEnd = start + prefix.length;
    }
  } else if (line.startsWith(prefix)) {
    // プレフィックスあり: 削除
    textarea.value = value.slice(0, lineStart) + line.slice(prefix.length) + value.slice(lineEndPos);
    textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - prefix.length);
  } else {
    // プレフィックスなし: 追加
    textarea.value = value.slice(0, lineStart) + prefix + line + value.slice(lineEndPos);
    textarea.selectionStart = textarea.selectionEnd = start + prefix.length;
  }

  textarea.focus();
  textarea.dispatchEvent(new Event('input'));
}
