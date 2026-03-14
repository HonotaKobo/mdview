import type { Block } from './block-model';
import { getMarkdownIt } from '../renderer';
import hljs from 'highlight.js';

/**
 * Render a single block into an HTML element for edit mode.
 * Inline markers (**,*,`,~~) are wrapped in .ag-remove spans.
 */
export function renderBlockElement(block: Block): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-block';
  wrapper.dataset.blockKey = block.key;
  wrapper.dataset.blockType = block.type;

  switch (block.type) {
    case 'heading':
      renderHeading(block, wrapper);
      break;
    case 'paragraph':
      renderParagraph(block, wrapper);
      break;
    case 'fence':
      renderFence(block, wrapper);
      break;
    case 'code':
      renderCodeBlock(block, wrapper);
      break;
    case 'math':
      renderMath(block, wrapper);
      break;
    case 'hr':
      renderHr(block, wrapper);
      break;
    default:
      // Lists, blockquotes, tables, etc. — render via markdown-it, make contenteditable
      renderGeneric(block, wrapper);
      break;
  }

  return wrapper;
}

function renderHeading(block: Block, wrapper: HTMLElement): void {
  const level = block.level || 1;
  const el = document.createElement(`h${level}`);
  el.setAttribute('contenteditable', 'true');

  // Extract the heading text (remove # prefix)
  const match = block.text.match(/^(#{1,6})\s+(.*)/s);
  if (match) {
    const marker = match[1] + ' ';
    const content = match[2];

    const markerSpan = document.createElement('span');
    markerSpan.className = 'ag-remove';
    markerSpan.textContent = marker;

    el.appendChild(markerSpan);
    appendInlineContent(content, el);
  } else {
    el.textContent = block.text;
  }

  wrapper.appendChild(el);
}

function renderParagraph(block: Block, wrapper: HTMLElement): void {
  const el = document.createElement('p');
  el.setAttribute('contenteditable', 'true');
  appendInlineContent(block.text, el);
  wrapper.appendChild(el);
}

function renderFence(block: Block, wrapper: HTMLElement): void {
  wrapper.classList.add('md-block-code');

  // Top fence line
  const topFence = document.createElement('div');
  topFence.className = 'ag-fence';
  topFence.textContent = '```' + (block.lang || '');
  wrapper.appendChild(topFence);

  // Code content
  const pre = document.createElement('pre');
  pre.className = 'hljs';
  const code = document.createElement('code');
  code.setAttribute('contenteditable', 'true');

  // Syntax highlight if language is known
  if (block.lang && hljs.getLanguage(block.lang)) {
    try {
      code.innerHTML = hljs.highlight(block.text, { language: block.lang }).value;
    } catch {
      code.textContent = block.text;
    }
  } else {
    code.textContent = block.text;
  }

  pre.appendChild(code);
  wrapper.appendChild(pre);

  // Bottom fence line
  const bottomFence = document.createElement('div');
  bottomFence.className = 'ag-fence';
  bottomFence.textContent = '```';
  wrapper.appendChild(bottomFence);
}

function renderCodeBlock(block: Block, wrapper: HTMLElement): void {
  const pre = document.createElement('pre');
  pre.className = 'hljs';
  const code = document.createElement('code');
  code.setAttribute('contenteditable', 'true');
  code.textContent = block.text;
  pre.appendChild(code);
  wrapper.appendChild(pre);
}

function renderMath(block: Block, wrapper: HTMLElement): void {
  wrapper.classList.add('md-block-code');

  // Top $$ marker
  const topMarker = document.createElement('div');
  topMarker.className = 'ag-fence';
  topMarker.textContent = '$$';
  wrapper.appendChild(topMarker);

  // Math content (editable as raw text)
  const pre = document.createElement('pre');
  pre.className = 'hljs';
  const code = document.createElement('code');
  code.setAttribute('contenteditable', 'true');
  code.textContent = block.text;
  pre.appendChild(code);
  wrapper.appendChild(pre);

  // Bottom $$ marker
  const bottomMarker = document.createElement('div');
  bottomMarker.className = 'ag-fence';
  bottomMarker.textContent = '$$';
  wrapper.appendChild(bottomMarker);
}

function renderHr(_block: Block, wrapper: HTMLElement): void {
  const hr = document.createElement('hr');
  wrapper.appendChild(hr);
}

function renderGeneric(block: Block, wrapper: HTMLElement): void {
  const md = getMarkdownIt();
  const html = md.render(block.text);
  const container = document.createElement('div');
  container.innerHTML = html;

  // Make leaf text elements contenteditable
  const editableElements = container.querySelectorAll('li, td, th, dd, dt, p');
  for (const el of editableElements) {
    // Only set contenteditable on leaf-level elements
    if (!el.querySelector('li, td, th, dd, dt, p')) {
      el.setAttribute('contenteditable', 'true');
    }
  }

  // Move children to wrapper
  while (container.firstChild) {
    wrapper.appendChild(container.firstChild);
  }
}

/**
 * Parse inline markdown and append elements with ag-remove markers.
 * Uses markdown-it's inline parser to identify markers.
 */
function appendInlineContent(text: string, parent: HTMLElement): void {
  const md = getMarkdownIt();
  const tokens = md.parseInline(text, {})[0]?.children || [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token.type) {
      case 'text':
        parent.appendChild(document.createTextNode(token.content));
        break;

      case 'softbreak':
        parent.appendChild(document.createElement('br'));
        break;

      case 'hardbreak':
        parent.appendChild(document.createElement('br'));
        break;

      case 'strong_open': {
        const marker = token.markup; // ** or __
        const markerSpan = document.createElement('span');
        markerSpan.className = 'ag-remove';
        markerSpan.textContent = marker;
        parent.appendChild(markerSpan);

        const strong = document.createElement('strong');
        // Collect until strong_close
        i++;
        while (i < tokens.length && tokens[i].type !== 'strong_close') {
          appendTokenToElement(tokens[i], strong);
          i++;
        }
        parent.appendChild(strong);

        // Close marker
        if (i < tokens.length) {
          const closeSpan = document.createElement('span');
          closeSpan.className = 'ag-remove';
          closeSpan.textContent = tokens[i].markup;
          parent.appendChild(closeSpan);
        }
        break;
      }

      case 'em_open': {
        const marker = token.markup;
        const markerSpan = document.createElement('span');
        markerSpan.className = 'ag-remove';
        markerSpan.textContent = marker;
        parent.appendChild(markerSpan);

        const em = document.createElement('em');
        i++;
        while (i < tokens.length && tokens[i].type !== 'em_close') {
          appendTokenToElement(tokens[i], em);
          i++;
        }
        parent.appendChild(em);

        if (i < tokens.length) {
          const closeSpan = document.createElement('span');
          closeSpan.className = 'ag-remove';
          closeSpan.textContent = tokens[i].markup;
          parent.appendChild(closeSpan);
        }
        break;
      }

      case 's_open': {
        const marker = token.markup;
        const markerSpan = document.createElement('span');
        markerSpan.className = 'ag-remove';
        markerSpan.textContent = marker;
        parent.appendChild(markerSpan);

        const s = document.createElement('s');
        i++;
        while (i < tokens.length && tokens[i].type !== 's_close') {
          appendTokenToElement(tokens[i], s);
          i++;
        }
        parent.appendChild(s);

        if (i < tokens.length) {
          const closeSpan = document.createElement('span');
          closeSpan.className = 'ag-remove';
          closeSpan.textContent = tokens[i].markup;
          parent.appendChild(closeSpan);
        }
        break;
      }

      case 'code_inline': {
        const marker = token.markup; // ` or ``
        const openSpan = document.createElement('span');
        openSpan.className = 'ag-remove';
        openSpan.textContent = marker;
        parent.appendChild(openSpan);

        const code = document.createElement('code');
        code.textContent = token.content;
        parent.appendChild(code);

        const closeSpan = document.createElement('span');
        closeSpan.className = 'ag-remove';
        closeSpan.textContent = marker;
        parent.appendChild(closeSpan);
        break;
      }

      case 'link_open': {
        const href = token.attrGet('href') || '';
        // [marker
        const openSpan = document.createElement('span');
        openSpan.className = 'ag-remove';
        openSpan.textContent = '[';
        parent.appendChild(openSpan);

        const a = document.createElement('a');
        a.href = href;
        i++;
        while (i < tokens.length && tokens[i].type !== 'link_close') {
          appendTokenToElement(tokens[i], a);
          i++;
        }
        parent.appendChild(a);

        // ](url) marker
        const closeSpan = document.createElement('span');
        closeSpan.className = 'ag-remove';
        closeSpan.textContent = `](${href})`;
        parent.appendChild(closeSpan);
        break;
      }

      case 'math_inline': {
        const marker = token.markup || '$';
        const openSpan = document.createElement('span');
        openSpan.className = 'ag-remove';
        openSpan.textContent = marker;
        parent.appendChild(openSpan);

        const span = document.createElement('span');
        span.textContent = token.content;
        parent.appendChild(span);

        const closeSpan = document.createElement('span');
        closeSpan.className = 'ag-remove';
        closeSpan.textContent = marker;
        parent.appendChild(closeSpan);
        break;
      }

      case 'image': {
        const src = token.attrGet('src') || '';
        const alt = token.content || '';
        const img = document.createElement('img');
        img.src = src;
        img.alt = alt;
        parent.appendChild(img);
        break;
      }

      case 'html_inline':
        parent.insertAdjacentHTML('beforeend', token.content);
        break;

      default:
        // Fallback: just append text content
        if (token.content) {
          parent.appendChild(document.createTextNode(token.content));
        }
        break;
    }
  }
}

function appendTokenToElement(token: { type: string; content: string; markup?: string }, parent: HTMLElement): void {
  if (token.type === 'text') {
    parent.appendChild(document.createTextNode(token.content));
  } else if (token.type === 'code_inline') {
    const code = document.createElement('code');
    code.textContent = token.content;
    parent.appendChild(code);
  } else if (token.type === 'math_inline') {
    const marker = token.markup || '$';
    parent.appendChild(document.createTextNode(marker + token.content + marker));
  } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
    parent.appendChild(document.createElement('br'));
  } else if (token.content) {
    parent.appendChild(document.createTextNode(token.content));
  }
}
