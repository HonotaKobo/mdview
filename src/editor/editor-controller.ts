import type { Block } from './block-model';
import { generateBlockKey } from './block-model';
import { parseBlocks } from './block-parser';
import { exportMarkdown } from './block-export';
import { renderBlockElement } from './block-renderer';

/**
 * EditorController manages the edit mode lifecycle.
 * Blocks show rendered previews by default. Clicking the edit icon
 * opens a textarea for raw markdown editing.
 */
export class EditorController {
  private blocks: Block[] = [];
  private container: HTMLElement;
  private activeBlockKey: string | null = null;
  private onContentChange: ((markdown: string) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** Set callback for content changes */
  setOnContentChange(cb: (markdown: string) => void): void {
    this.onContentChange = cb;
  }

  /** Enter edit mode: parse content and render editable blocks */
  enterEditMode(content: string): void {
    this.blocks = parseBlocks(content);
    document.body.classList.add('edit-mode');
    this.renderAllBlocks();
  }

  /** Exit edit mode: return current markdown content */
  exitEditMode(): string {
    this.syncActiveBlock();
    document.body.classList.remove('edit-mode');
    return exportMarkdown(this.blocks);
  }

  /** Get current markdown content without exiting edit mode */
  getCurrentContent(): string {
    this.syncActiveBlock();
    return exportMarkdown(this.blocks);
  }

  /** Update content from external source (e.g., file watcher) */
  updateContent(content: string): void {
    this.blocks = parseBlocks(content);
    this.activeBlockKey = null;
    this.renderAllBlocks();
  }

  // --- Rendering ---

  private renderAllBlocks(): void {
    this.container.innerHTML = '';

    if (this.blocks.length === 0) {
      const emptyBlock: Block = {
        key: generateBlockKey(),
        type: 'paragraph',
        text: '',
        sourceStart: 0,
        sourceEnd: 0,
      };
      this.blocks.push(emptyBlock);
    }

    for (const block of this.blocks) {
      const el = renderBlockElement(block);
      this.attachBlockEvents(el, block);
      this.container.appendChild(el);
    }
  }

  private rerenderBlock(block: Block): void {
    const oldEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (!oldEl) return;

    const newEl = renderBlockElement(block);
    this.attachBlockEvents(newEl, block);
    oldEl.replaceWith(newEl);
  }

  // --- Event handling ---

  private attachBlockEvents(el: HTMLElement, block: Block): void {
    // Focus tracking: when a textarea in this block gets focus,
    // sync and re-render the previously active block.
    el.addEventListener('focusin', () => {
      if (this.activeBlockKey && this.activeBlockKey !== block.key) {
        this.syncAndRerenderBlock(this.activeBlockKey);
      }
      this.activeBlockKey = block.key;
    });

    // Keyboard events
    el.addEventListener('keydown', (e) => this.handleKeyDown(e, block));

    // Checkbox toggle in preview
    const checkboxes = el.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb, index) => {
      (cb as HTMLInputElement).removeAttribute('disabled');
      cb.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleCheckbox(block, index);
      });
    });
  }

  private handleKeyDown(e: KeyboardEvent, block: Block): void {
    const textarea = this.getTextarea(block);
    if (!textarea) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      // Split paragraph/heading on Enter
      if (block.type === 'paragraph' || block.type === 'heading') {
        e.preventDefault();
        this.splitBlock(block);
      }
    } else if (e.key === 'Backspace') {
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        e.preventDefault();
        this.mergeWithPrevious(block);
      }
    } else if (e.key === 'Delete') {
      if (textarea.selectionStart === textarea.value.length &&
          textarea.selectionEnd === textarea.value.length) {
        e.preventDefault();
        this.mergeWithNext(block);
      }
    } else if (e.key === 'ArrowUp') {
      if (textarea.selectionStart === 0) {
        e.preventDefault();
        this.focusPreviousBlock(block, 'end');
      }
    } else if (e.key === 'ArrowDown') {
      if (textarea.selectionStart === textarea.value.length) {
        e.preventDefault();
        this.focusNextBlock(block, 'start');
      }
    }
  }

  // --- Block operations ---

  private splitBlock(block: Block): void {
    this.syncActiveBlock();
    const idx = this.blocks.indexOf(block);
    if (idx === -1) return;

    const textarea = this.getTextarea(block);
    if (!textarea) return;

    const offset = textarea.selectionStart;
    const before = block.text.slice(0, offset);
    const after = block.text.slice(offset);

    block.text = before;

    const newBlock: Block = {
      key: generateBlockKey(),
      type: 'paragraph',
      text: after,
      sourceStart: block.sourceEnd,
      sourceEnd: block.sourceEnd,
    };

    this.blocks.splice(idx + 1, 0, newBlock);

    // Re-render current block (exits editing, shows preview)
    this.rerenderBlock(block);

    // Render and insert new block
    const newEl = renderBlockElement(newBlock);
    this.attachBlockEvents(newEl, newBlock);
    const currentEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (currentEl) {
      currentEl.after(newEl);
    }

    // Focus the new block
    this.activeBlockKey = newBlock.key;
    this.focusBlock(newBlock, 'start');
    this.notifyChange();
  }

  private mergeWithPrevious(block: Block): void {
    const idx = this.blocks.indexOf(block);
    if (idx <= 0) return;

    this.syncActiveBlock();
    const prevBlock = this.blocks[idx - 1];
    if (prevBlock.type !== 'paragraph' && prevBlock.type !== 'heading') return;

    const prevTextLen = prevBlock.text.length;
    prevBlock.text = prevBlock.text + block.text;

    this.blocks.splice(idx, 1);
    const currentEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    currentEl?.remove();

    this.rerenderBlock(prevBlock);
    this.activeBlockKey = prevBlock.key;
    this.focusBlock(prevBlock, prevTextLen);
    this.notifyChange();
  }

  private mergeWithNext(block: Block): void {
    const idx = this.blocks.indexOf(block);
    if (idx >= this.blocks.length - 1) return;

    this.syncActiveBlock();
    const nextBlock = this.blocks[idx + 1];
    if (nextBlock.type !== 'paragraph' && nextBlock.type !== 'heading') return;

    const currentTextLen = block.text.length;
    let nextText = nextBlock.text;
    if (nextBlock.type === 'heading') {
      const match = nextText.match(/^#{1,6}\s+(.*)/s);
      if (match) nextText = match[1];
    }
    block.text = block.text + nextText;

    this.blocks.splice(idx + 1, 1);
    const nextEl = this.container.querySelector(`[data-block-key="${nextBlock.key}"]`);
    nextEl?.remove();

    this.rerenderBlock(block);
    this.activeBlockKey = block.key;
    this.focusBlock(block, currentTextLen);
    this.notifyChange();
  }

  // --- Textarea utilities ---

  private getTextarea(block: Block): HTMLTextAreaElement | null {
    const blockEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (!blockEl) return null;
    return blockEl.querySelector('.block-editor-textarea') as HTMLTextAreaElement | null;
  }

  private focusBlock(block: Block, position: 'start' | 'end' | number): void {
    const blockEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (!blockEl) return;

    // Enter editing mode
    blockEl.classList.add('editing');

    const textarea = blockEl.querySelector('.block-editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    textarea.focus();

    // Auto-resize after becoming visible
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';

    if (position === 'start') {
      textarea.selectionStart = textarea.selectionEnd = 0;
    } else if (position === 'end') {
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    } else {
      textarea.selectionStart = textarea.selectionEnd = Math.min(position, textarea.value.length);
    }
  }

  private focusPreviousBlock(block: Block, position: 'start' | 'end'): void {
    const idx = this.blocks.indexOf(block);
    if (idx <= 0) return;
    this.focusBlock(this.blocks[idx - 1], position);
  }

  private focusNextBlock(block: Block, position: 'start' | 'end'): void {
    const idx = this.blocks.indexOf(block);
    if (idx >= this.blocks.length - 1) return;
    this.focusBlock(this.blocks[idx + 1], position);
  }

  // --- Sync ---

  private syncActiveBlock(): void {
    if (!this.activeBlockKey) return;

    const block = this.blocks.find(b => b.key === this.activeBlockKey);
    if (!block) return;

    const textarea = this.getTextarea(block);
    if (!textarea) return;

    block.text = textarea.value;
  }

  private syncAndRerenderBlock(blockKey: string): void {
    const block = this.blocks.find(b => b.key === blockKey);
    if (!block) return;

    const el = this.container.querySelector(`[data-block-key="${blockKey}"]`);
    if (!el || !el.classList.contains('editing')) return;

    const textarea = el.querySelector('.block-editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    block.text = textarea.value;

    // Detect type changes (e.g., user typed # at start of paragraph)
    this.detectTypeChange(block);

    // Re-render the block (exits editing, shows updated preview)
    this.rerenderBlock(block);
    this.notifyChange();
  }

  private detectTypeChange(block: Block): void {
    if (block.type === 'paragraph') {
      const match = block.text.match(/^(#{1,6})\s+/);
      if (match) {
        block.type = 'heading';
        block.level = match[1].length;
      }
    } else if (block.type === 'heading') {
      const match = block.text.match(/^(#{1,6})\s+/);
      if (!match) {
        block.type = 'paragraph';
        block.level = undefined;
      } else {
        block.level = match[1].length;
      }
    }
  }

  private toggleCheckbox(block: Block, index: number): void {
    let count = 0;
    block.text = block.text.replace(/\[([ xX])\]/g, (match, state) => {
      if (count === index) {
        count++;
        return state === ' ' ? '[x]' : '[ ]';
      }
      count++;
      return match;
    });
    this.rerenderBlock(block);
    this.notifyChange();
  }

  private notifyChange(): void {
    if (this.onContentChange) {
      this.onContentChange(exportMarkdown(this.blocks));
    }
  }
}
