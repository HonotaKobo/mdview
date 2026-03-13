import type { Block } from './block-model';
import { generateBlockKey } from './block-model';
import { parseBlocks } from './block-parser';
import { exportMarkdown } from './block-export';
import { renderBlockElement } from './block-renderer';

/**
 * EditorController manages the edit mode lifecycle.
 * Handles block rendering, contenteditable, and block operations.
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
      // Empty document: create a single empty paragraph
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
    // Focus tracking
    el.addEventListener('focusin', () => {
      if (this.activeBlockKey && this.activeBlockKey !== block.key) {
        this.syncAndRerenderBlock(this.activeBlockKey);
      }
      this.activeBlockKey = block.key;
    });

    // Keyboard events for block operations
    el.addEventListener('keydown', (e) => this.handleKeyDown(e, block));
  }

  private handleKeyDown(e: KeyboardEvent, block: Block): void {
    if (e.key === 'Enter' && !e.shiftKey && block.type !== 'fence' && block.type !== 'code') {
      // Don't split in generic blocks (lists, tables, etc.) — let default behavior work
      if (block.type !== 'paragraph' && block.type !== 'heading') return;

      e.preventDefault();
      this.splitBlock(block);
    } else if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed) {
        const offset = this.getCursorOffsetInBlock(block);
        if (offset === 0) {
          e.preventDefault();
          this.mergeWithPrevious(block);
        }
      }
    } else if (e.key === 'Delete') {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed) {
        const el = this.container.querySelector(`[data-block-key="${block.key}"]`);
        if (el) {
          const editable = el.querySelector('[contenteditable="true"]') as HTMLElement;
          if (editable) {
            const textLen = this.getTextContent(editable).length;
            const offset = this.getCursorOffsetInBlock(block);
            if (offset >= textLen) {
              e.preventDefault();
              this.mergeWithNext(block);
            }
          }
        }
      }
    } else if (e.key === 'ArrowUp') {
      const offset = this.getCursorOffsetInBlock(block);
      if (offset === 0) {
        e.preventDefault();
        this.focusPreviousBlock(block, 'end');
      }
    } else if (e.key === 'ArrowDown') {
      const el = this.container.querySelector(`[data-block-key="${block.key}"]`);
      if (el) {
        const editable = el.querySelector('[contenteditable="true"]') as HTMLElement;
        if (editable) {
          const textLen = this.getTextContent(editable).length;
          const offset = this.getCursorOffsetInBlock(block);
          if (offset >= textLen) {
            e.preventDefault();
            this.focusNextBlock(block, 'start');
          }
        }
      }
    }
  }

  // --- Block operations ---

  private splitBlock(block: Block): void {
    this.syncActiveBlock();
    const idx = this.blocks.indexOf(block);
    if (idx === -1) return;

    const offset = this.getCursorOffsetInBlock(block);
    const fullText = block.text;

    // For headings, we need to account for the marker in the offset
    let textOffset = offset;
    if (block.type === 'heading') {
      const match = block.text.match(/^(#{1,6}\s+)/);
      if (match) {
        textOffset = offset; // offset includes marker since ag-remove is in DOM
      }
    }

    const before = fullText.slice(0, textOffset);
    const after = fullText.slice(textOffset);

    // Update current block
    block.text = before;

    // Create new paragraph block
    const newBlock: Block = {
      key: generateBlockKey(),
      type: 'paragraph',
      text: after,
      sourceStart: block.sourceEnd,
      sourceEnd: block.sourceEnd,
    };

    this.blocks.splice(idx + 1, 0, newBlock);

    // Re-render both blocks
    this.rerenderBlock(block);
    const newEl = renderBlockElement(newBlock);
    this.attachBlockEvents(newEl, newBlock);
    const currentEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (currentEl) {
      currentEl.after(newEl);
    }

    // Focus the new block at the start
    this.activeBlockKey = newBlock.key;
    this.focusBlock(newBlock, 'start');
    this.notifyChange();
  }

  private mergeWithPrevious(block: Block): void {
    const idx = this.blocks.indexOf(block);
    if (idx <= 0) return;

    this.syncActiveBlock();
    const prevBlock = this.blocks[idx - 1];

    // Only merge simple blocks
    if (prevBlock.type !== 'paragraph' && prevBlock.type !== 'heading') return;

    const prevTextLen = prevBlock.text.length;
    prevBlock.text = prevBlock.text + block.text;

    // Remove current block
    this.blocks.splice(idx, 1);
    const currentEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    currentEl?.remove();

    // Re-render previous block and set cursor at merge point
    this.rerenderBlock(prevBlock);
    this.activeBlockKey = prevBlock.key;

    // Calculate cursor position accounting for heading marker
    let cursorPos = prevTextLen;
    if (prevBlock.type === 'heading') {
      // The marker is shown in ag-remove, cursor offset includes it
      cursorPos = prevTextLen;
    }

    this.focusBlock(prevBlock, cursorPos);
    this.notifyChange();
  }

  private mergeWithNext(block: Block): void {
    const idx = this.blocks.indexOf(block);
    if (idx >= this.blocks.length - 1) return;

    this.syncActiveBlock();
    const nextBlock = this.blocks[idx + 1];

    // Only merge simple blocks
    if (nextBlock.type !== 'paragraph' && nextBlock.type !== 'heading') return;

    const currentTextLen = block.text.length;
    // If next is heading, strip the # prefix
    let nextText = nextBlock.text;
    if (nextBlock.type === 'heading') {
      const match = nextText.match(/^#{1,6}\s+(.*)/s);
      if (match) nextText = match[1];
    }
    block.text = block.text + nextText;

    // Remove next block
    this.blocks.splice(idx + 1, 1);
    const nextEl = this.container.querySelector(`[data-block-key="${nextBlock.key}"]`);
    nextEl?.remove();

    // Re-render current block and set cursor at merge point
    this.rerenderBlock(block);
    this.activeBlockKey = block.key;
    this.focusBlock(block, currentTextLen);
    this.notifyChange();
  }

  // --- Cursor utilities ---

  private getCursorOffsetInBlock(block: Block): number {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return 0;

    const blockEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (!blockEl) return 0;

    const editable = blockEl.querySelector('[contenteditable="true"]') as HTMLElement;
    if (!editable) return 0;

    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(editable);
    preRange.setEnd(range.startContainer, range.startOffset);

    return preRange.toString().length;
  }

  private focusBlock(block: Block, position: 'start' | 'end' | number): void {
    const blockEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (!blockEl) return;

    const editable = blockEl.querySelector('[contenteditable="true"]') as HTMLElement;
    if (!editable) return;

    editable.focus();

    const sel = window.getSelection();
    if (!sel) return;

    if (position === 'start') {
      this.setCursorOffset(editable, 0);
    } else if (position === 'end') {
      const textLen = this.getTextContent(editable).length;
      this.setCursorOffset(editable, textLen);
    } else {
      this.setCursorOffset(editable, position);
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

  private setCursorOffset(element: HTMLElement, offset: number): void {
    const sel = window.getSelection();
    if (!sel) return;

    const range = document.createRange();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

    let currentOffset = 0;
    let node: Text | null = null;

    while ((node = walker.nextNode() as Text | null)) {
      const nodeLen = node.textContent?.length || 0;
      if (currentOffset + nodeLen >= offset) {
        range.setStart(node, offset - currentOffset);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      currentOffset += nodeLen;
    }

    // If offset is beyond all text, place at end
    range.selectNodeContents(element);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  private getTextContent(element: HTMLElement): string {
    return element.textContent || '';
  }

  // --- Sync ---

  /** Sync the currently active block's DOM content back to block.text */
  private syncActiveBlock(): void {
    if (!this.activeBlockKey) return;

    const block = this.blocks.find(b => b.key === this.activeBlockKey);
    if (!block) return;

    const el = this.container.querySelector(`[data-block-key="${this.activeBlockKey}"]`);
    if (!el) return;

    const editable = el.querySelector('[contenteditable="true"]') as HTMLElement;
    if (!editable) return;

    const text = this.getTextContent(editable);

    switch (block.type) {
      case 'heading': {
        // textContent includes the # marker since ag-remove spans contain text
        block.text = text;
        break;
      }
      case 'fence': {
        // Code content only (fences are separate elements)
        block.text = text;
        break;
      }
      default:
        block.text = text;
        break;
    }
  }

  /** Sync and re-render a specific block (called when focus leaves a block) */
  private syncAndRerenderBlock(blockKey: string): void {
    const block = this.blocks.find(b => b.key === blockKey);
    if (!block) return;

    const el = this.container.querySelector(`[data-block-key="${blockKey}"]`);
    if (!el) return;

    const editable = el.querySelector('[contenteditable="true"]') as HTMLElement;
    if (!editable) return;

    const text = this.getTextContent(editable);

    // Update block text
    if (block.type === 'heading' || block.type === 'fence') {
      block.text = text;
    } else {
      block.text = text;
    }

    // Detect type changes (e.g., user typed # at start of paragraph)
    this.detectTypeChange(block);

    // Re-render the block
    this.rerenderBlock(block);
    this.notifyChange();
  }

  /** Detect if block type should change based on content */
  private detectTypeChange(block: Block): void {
    if (block.type === 'paragraph') {
      // Check if it became a heading
      const match = block.text.match(/^(#{1,6})\s+/);
      if (match) {
        block.type = 'heading';
        block.level = match[1].length;
      }
    } else if (block.type === 'heading') {
      // Check if heading prefix was removed
      const match = block.text.match(/^(#{1,6})\s+/);
      if (!match) {
        block.type = 'paragraph';
        block.level = undefined;
      } else {
        block.level = match[1].length;
      }
    }
  }

  private notifyChange(): void {
    if (this.onContentChange) {
      this.onContentChange(exportMarkdown(this.blocks));
    }
  }
}
