import type { Block } from './block-model';
import { getMarkdownIt } from '../renderer';
import katex from 'katex';

const EDIT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

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
      preview.innerHTML = md.render('```' + (block.lang || '') + '\n' + block.text + '\n```');
      break;
    case 'code':
      preview.innerHTML = md.render(block.text.split('\n').map(l => '    ' + l).join('\n'));
      break;
    default:
      preview.innerHTML = md.render(block.text);
      break;
  }
}

// --- Source (textarea + toolbar) ---

function renderSource(block: Block, source: HTMLElement): void {
  // Top delimiter label for fence/math
  if (block.type === 'fence') {
    addLabel(source, '```' + (block.lang || ''));
  } else if (block.type === 'math') {
    addLabel(source, '$$');
  }

  // Textarea
  const textarea = document.createElement('textarea');
  textarea.className = 'block-editor-textarea';
  textarea.value = block.text;
  textarea.rows = 1;
  textarea.spellcheck = false;
  textarea.addEventListener('input', () => autoResize(textarea));
  textarea.addEventListener('focus', () => autoResize(textarea));
  source.appendChild(textarea);

  // Bottom delimiter label for fence/math
  if (block.type === 'fence') {
    addLabel(source, '```');
  } else if (block.type === 'math') {
    addLabel(source, '$$');
  }

  // Formatting toolbar (text-oriented blocks only)
  if (!['fence', 'code', 'math'].includes(block.type)) {
    source.appendChild(createToolbar(textarea));
  }
}

function addLabel(parent: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.className = 'source-label';
  el.textContent = text;
  parent.appendChild(el);
}

function autoResize(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}

// --- Formatting toolbar ---

function createToolbar(textarea: HTMLTextAreaElement): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'block-editor-toolbar';

  const buttons: { html: string; title: string; prefix: string; suffix: string }[] = [
    { html: '<strong>B</strong>', title: 'Bold', prefix: '**', suffix: '**' },
    { html: '<em>I</em>', title: 'Italic', prefix: '*', suffix: '*' },
    { html: '<s>S</s>', title: 'Strikethrough', prefix: '~~', suffix: '~~' },
    { html: 'Code', title: 'Inline Code', prefix: '`', suffix: '`' },
    { html: 'Link', title: 'Link', prefix: '[', suffix: '](url)' },
    { html: '$', title: 'Math', prefix: '$', suffix: '$' },
  ];

  for (const btn of buttons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toolbar-btn';
    button.innerHTML = btn.html;
    button.title = btn.title;
    // mousedown to prevent textarea losing focus
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      wrapSelection(textarea, btn.prefix, btn.suffix);
    });
    toolbar.appendChild(button);
  }

  return toolbar;
}

function wrapSelection(textarea: HTMLTextAreaElement, prefix: string, suffix: string): void {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const selected = value.slice(start, end) || 'text';
  const inserted = prefix + selected + suffix;

  textarea.value = value.slice(0, start) + inserted + value.slice(end);
  textarea.selectionStart = start + prefix.length;
  textarea.selectionEnd = start + prefix.length + selected.length;
  textarea.focus();
  textarea.dispatchEvent(new Event('input'));
}
