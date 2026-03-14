import type { Block } from './block-model';
import { generateBlockKey } from './block-model';
import { parseBlocks } from './block-parser';
import { exportMarkdown } from './block-export';
import { renderBlockElement, setFootnoteContext } from './block-renderer';

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

  /** Original block state for Escape cancellation */
  private originalBlockState: Map<string, { text: string; lang?: string }> = new Map();

  /** Undo/Redo stacks (markdown snapshots) */
  private undoStack: string[] = [];
  private redoStack: string[] = [];

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
    this.undoStack = [content];
    this.redoStack = [];
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
    this.undoStack = [content];
    this.redoStack = [];
    this.renderAllBlocks();
  }

  /** Undo last change (call when not inside a textarea) */
  undo(): void {
    if (this.undoStack.length <= 1) return;
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    const prev = this.undoStack[this.undoStack.length - 1];
    this.blocks = parseBlocks(prev);
    this.activeBlockKey = null;
    this.renderAllBlocks();
    if (this.onContentChange) {
      this.onContentChange(prev);
    }
  }

  /** Redo last undone change */
  redo(): void {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    this.blocks = parseBlocks(next);
    this.activeBlockKey = null;
    this.renderAllBlocks();
    if (this.onContentChange) {
      this.onContentChange(next);
    }
  }

  // --- Rendering ---

  private renderAllBlocks(): void {
    this.container.innerHTML = '';

    let autoFocusEmpty = false;
    if (this.blocks.length === 0) {
      const emptyBlock: Block = {
        key: generateBlockKey(),
        type: 'paragraph',
        text: '',
        sourceStart: 0,
        sourceEnd: 0,
      };
      this.blocks.push(emptyBlock);
      autoFocusEmpty = true;
    }

    this.updateFootnoteContext();

    for (let i = 0; i < this.blocks.length; i++) {
      this.container.appendChild(this.createGapElement());

      const block = this.blocks[i];
      const el = renderBlockElement(block);
      this.attachBlockEvents(el, block);
      this.container.appendChild(el);
    }

    // Gap after last block
    this.container.appendChild(this.createGapElement());

    // Auto-focus empty block on new/blank view
    if (autoFocusEmpty && this.blocks.length === 1) {
      const block = this.blocks[0];
      this.originalBlockState.set(block.key, { text: '', lang: undefined });
      this.activeBlockKey = block.key;
      requestAnimationFrame(() => {
        this.focusBlock(block, 'start');
      });
    }
  }

  private rerenderBlock(block: Block): void {
    const oldEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (!oldEl) return;

    this.updateFootnoteContext();

    const newEl = renderBlockElement(block);
    this.attachBlockEvents(newEl, block);
    oldEl.replaceWith(newEl);
  }

  // --- Gap / Add block ---

  private createGapElement(): HTMLElement {
    const gap = document.createElement('div');
    gap.className = 'block-gap';

    const addBtn = document.createElement('button');
    addBtn.className = 'block-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add block';
    // Prevent textarea from losing focus on mousedown
    addBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.insertBlockAtGap(gap);
    });

    gap.appendChild(addBtn);

    gap.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.insertBlockAtGap(gap);
    });

    return gap;
  }

  private insertBlockAtGap(gap: HTMLElement): void {
    // Sync current active block
    if (this.activeBlockKey) {
      const activeBlock = this.blocks.find(b => b.key === this.activeBlockKey);
      if (activeBlock) {
        const textarea = this.getTextarea(activeBlock);
        if (textarea) {
          this.syncBlockText(activeBlock, textarea);
          if (activeBlock.text.trim() === '' && this.blocks.length > 1) {
            const idx = this.blocks.indexOf(activeBlock);
            if (idx !== -1) this.blocks.splice(idx, 1);
          } else {
            this.detectTypeChange(activeBlock);
          }
        }
      }
      this.activeBlockKey = null;
    }

    // Determine insert position by counting blocks before this gap
    const children = Array.from(this.container.children);
    const gapIndex = children.indexOf(gap);
    let blockIndex = 0;
    for (let i = 0; i < gapIndex; i++) {
      if (children[i].classList.contains('md-block')) blockIndex++;
    }

    const newBlock: Block = {
      key: generateBlockKey(),
      type: 'paragraph',
      text: '',
      sourceStart: 0,
      sourceEnd: 0,
    };

    this.blocks.splice(blockIndex, 0, newBlock);
    this.renderAllBlocks();

    this.originalBlockState.set(newBlock.key, { text: '', lang: undefined });
    this.activeBlockKey = newBlock.key;
    this.focusBlock(newBlock, 'start');
    // Don't call notifyChange — empty block is temporary
  }

  // --- Event handling ---

  private attachBlockEvents(el: HTMLElement, block: Block): void {
    // Focus tracking
    el.addEventListener('focusin', () => {
      if (this.activeBlockKey && this.activeBlockKey !== block.key) {
        this.syncAndRerenderBlock(this.activeBlockKey);
      }
      if (!this.originalBlockState.has(block.key)) {
        this.originalBlockState.set(block.key, { text: block.text, lang: block.lang });
      }
      this.activeBlockKey = block.key;
    });

    // Focus lost: exit edit mode if focus leaves this block
    el.addEventListener('focusout', (e) => {
      const related = (e as FocusEvent).relatedTarget as HTMLElement | null;
      if (related && el.contains(related)) return;

      requestAnimationFrame(() => {
        if (this.activeBlockKey !== block.key) return;
        this.activeBlockKey = null;
        this.originalBlockState.delete(block.key);

        // Sync the block
        const textarea = this.getTextarea(block);
        if (textarea) this.syncBlockText(block, textarea);

        // Remove empty blocks
        if (block.text.trim() === '' && this.blocks.length > 1) {
          const idx = this.blocks.indexOf(block);
          if (idx !== -1) {
            this.blocks.splice(idx, 1);
            this.renderAllBlocks();
            this.notifyChange();
            return;
          }
        }

        this.detectTypeChange(block);
        this.rerenderBlock(block);
        this.notifyChange();
      });
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

    // Radio button toggle in preview
    const radios = el.querySelectorAll('input[type="radio"]');
    radios.forEach((radio, index) => {
      const groupName = (radio as HTMLInputElement).name;
      const groupIndices: number[] = [];
      radios.forEach((r, idx) => {
        if ((r as HTMLInputElement).name === groupName) {
          groupIndices.push(idx);
        }
      });
      (radio as HTMLInputElement).removeAttribute('disabled');
      radio.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleRadio(block, index, groupIndices);
      });
    });

    // Text input handling in preview
    const formTextInputs = el.querySelectorAll('input[type="text"].deflist-text-input');
    formTextInputs.forEach((input, index) => {
      input.addEventListener('keydown', (e) => e.stopPropagation());
      input.addEventListener('dblclick', (e) => e.stopPropagation());
      input.addEventListener('change', () => {
        const value = (input as HTMLInputElement).value.replace(/"/g, '');
        this.updateTextInput(block, index, value);
        const textarea = this.getTextarea(block);
        if (textarea) textarea.value = block.text;
      });
    });
  }

  private handleKeyDown(e: KeyboardEvent, block: Block): void {
    const textarea = this.getTextarea(block);
    if (!textarea) return;

    // Escape: cancel editing, restore original text
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();

      const original = this.originalBlockState.get(block.key);
      if (original) {
        block.text = original.text;
        block.lang = original.lang;
      }
      this.originalBlockState.delete(block.key);
      this.activeBlockKey = null;

      // Remove block if empty after restore
      if (block.text.trim() === '' && this.blocks.length > 1) {
        const idx = this.blocks.indexOf(block);
        if (idx !== -1) {
          this.blocks.splice(idx, 1);
          this.renderAllBlocks();
          return;
        }
      }

      this.rerenderBlock(block);
      return;
    }

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
    this.originalBlockState.delete(block.key);
    this.rerenderBlock(block);

    // Render and insert new block (with gap)
    const newGap = this.createGapElement();
    const newEl = renderBlockElement(newBlock);
    this.attachBlockEvents(newEl, newBlock);
    const currentEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (currentEl) {
      currentEl.after(newGap);
      newGap.after(newEl);
    }

    // Focus the new block
    this.originalBlockState.set(newBlock.key, { text: after, lang: undefined });
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
    // Remove the block and the gap before it
    currentEl?.previousElementSibling?.remove();
    currentEl?.remove();

    this.originalBlockState.delete(block.key);
    this.rerenderBlock(prevBlock);
    this.originalBlockState.set(prevBlock.key, { text: prevBlock.text, lang: prevBlock.lang });
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
    // Remove the block and the gap before it
    nextEl?.previousElementSibling?.remove();
    nextEl?.remove();

    this.originalBlockState.delete(nextBlock.key);
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

  /** Sync textarea content to block model, handling fence/math delimiters */
  private syncBlockText(block: Block, textarea: HTMLTextAreaElement): void {
    if (block.type === 'fence') {
      const lines = textarea.value.split('\n');
      const first = lines[0] || '';
      const fenceMatch = first.match(/^(`{3,})(.*)/);
      if (fenceMatch) {
        block.lang = fenceMatch[2].trim() || undefined;
        const last = lines[lines.length - 1] || '';
        if (/^`{3,}\s*$/.test(last) && lines.length > 1) {
          block.text = lines.slice(1, -1).join('\n');
        } else {
          block.text = lines.slice(1).join('\n');
        }
      } else {
        block.text = textarea.value;
      }
    } else if (block.type === 'math') {
      const lines = textarea.value.split('\n');
      const first = lines[0] || '';
      const last = lines[lines.length - 1] || '';
      if (/^\$\$/.test(first) && /^\$\$/.test(last) && lines.length > 1) {
        block.text = lines.slice(1, -1).join('\n');
      } else {
        block.text = textarea.value;
      }
    } else {
      block.text = textarea.value;
    }
  }

  private syncActiveBlock(): void {
    if (!this.activeBlockKey) return;

    const block = this.blocks.find(b => b.key === this.activeBlockKey);
    if (!block) return;

    const textarea = this.getTextarea(block);
    if (!textarea) return;

    this.syncBlockText(block, textarea);
  }

  private syncAndRerenderBlock(blockKey: string): void {
    const block = this.blocks.find(b => b.key === blockKey);
    if (!block) return;

    const el = this.container.querySelector(`[data-block-key="${blockKey}"]`);
    if (!el || !el.classList.contains('editing')) return;

    const textarea = el.querySelector('.block-editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    this.syncBlockText(block, textarea);
    this.originalBlockState.delete(blockKey);

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

  private toggleRadio(block: Block, clickedIndex: number, groupIndices: number[]): void {
    // Sync text input values before re-rendering
    const blockEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (blockEl) this.syncFormTextInputs(block, blockEl as HTMLElement);

    let count = 0;
    block.text = block.text.replace(/\[R:"(x?)"\]/g, (match) => {
      const idx = count++;
      if (groupIndices.includes(idx)) {
        return idx === clickedIndex ? '[R:"x"]' : '[R:""]';
      }
      return match;
    });
    this.rerenderBlock(block);
    this.notifyChange();
  }

  private updateTextInput(block: Block, textIndex: number, value: string): void {
    let count = 0;
    block.text = block.text.replace(/\[T:"([^"]*)"\]/g, (match) => {
      if (count === textIndex) {
        count++;
        return `[T:"${value}"]`;
      }
      count++;
      return match;
    });
    this.notifyChange();
  }

  private syncFormTextInputs(block: Block, blockEl: HTMLElement): void {
    const textInputs = blockEl.querySelectorAll('input[type="text"].deflist-text-input');
    if (textInputs.length === 0) return;

    let count = 0;
    block.text = block.text.replace(/\[T:"([^"]*)"\]/g, (match) => {
      const input = textInputs[count] as HTMLInputElement | undefined;
      count++;
      if (input) {
        const safeValue = input.value.replace(/"/g, '');
        return `[T:"${safeValue}"]`;
      }
      return match;
    });
  }

  /** Collect footnote definitions from all blocks and set context for preview */
  private updateFootnoteContext(): void {
    const footnoteDefs = this.blocks
      .filter(b => /^\[\^[^\]]+\]:/m.test(b.text))
      .map(b => b.text)
      .join('\n');
    setFootnoteContext(footnoteDefs);
  }

  private notifyChange(): void {
    const content = exportMarkdown(this.blocks);
    // Push to undo stack if different from last entry
    if (this.undoStack.length === 0 || this.undoStack[this.undoStack.length - 1] !== content) {
      this.undoStack.push(content);
      this.redoStack = [];
      if (this.undoStack.length > 100) {
        this.undoStack.shift();
      }
    }
    if (this.onContentChange) {
      this.onContentChange(content);
    }
  }
}
