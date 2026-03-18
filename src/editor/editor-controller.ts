import type { Block } from './block-model';
import { generateBlockKey } from './block-model';
import { parseBlocks } from './block-parser';
import { exportMarkdown } from './block-export';
import { renderBlockElement, setFootnoteContext } from './block-renderer';

/**
 * EditorController は編集モードのライフサイクルを管理する。
 * ブロックはデフォルトでレンダリング済みプレビューを表示する。
 * 編集アイコンをクリックすると、生の markdown 編集用の textarea が開く。
 */
export class EditorController {
  private blocks: Block[] = [];
  private container: HTMLElement;
  private activeBlockKey: string | null = null;
  private onContentChange: ((markdown: string) => void) | null = null;

  /** Escapeキャンセル用の元のブロック状態 */
  private originalBlockState: Map<string, { text: string; lang?: string }> = new Map();

  /** Undo/Redo スタック（markdown スナップショット）*/
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** コンテンツ変更時のコールバックを設定 */
  setOnContentChange(cb: (markdown: string) => void): void {
    this.onContentChange = cb;
  }

  /** 編集モードに入る: コンテンツを解析して編集可能なブロックをレンダリング */
  enterEditMode(content: string): void {
    this.blocks = parseBlocks(content);
    this.container.classList.add('cursor-default', 'min-h-full');
    this.undoStack = [content];
    this.redoStack = [];
    this.renderAllBlocks();
  }

  /** 編集モードを終了: 現在の markdown コンテンツを返す */
  exitEditMode(): string {
    this.syncActiveBlock();
    this.container.classList.remove('cursor-default', 'min-h-full');
    return exportMarkdown(this.blocks);
  }

  /** 編集モードを終了せずに現在の markdown コンテンツを取得 */
  getCurrentContent(): string {
    this.syncActiveBlock();
    return exportMarkdown(this.blocks);
  }

  /** 外部ソースからコンテンツを更新（例: ファイル監視）*/
  updateContent(content: string): void {
    this.blocks = parseBlocks(content);
    this.activeBlockKey = null;
    this.undoStack = [content];
    this.redoStack = [];
    this.renderAllBlocks();
  }

  /** 最後の変更を元に戻す（textarea 内でない時に呼び出す）*/
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

  /** 最後に戻した変更をやり直す */
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

  // --- レンダリング ---

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

    this.updateFootnoteContext();

    const isSingleEmpty = this.blocks.length === 1 && this.blocks[0].text.trim() === '';

    for (let i = 0; i < this.blocks.length; i++) {
      // 唯一の空ブロックの場合、最初のブロック前のギャップをスキップ
      if (!(isSingleEmpty && i === 0)) {
        this.container.appendChild(this.createGapElement());
      }

      const block = this.blocks[i];
      const el = renderBlockElement(block);
      this.attachBlockEvents(el, block);
      this.container.appendChild(el);
    }

    // 最後のブロックの後のギャップ
    this.container.appendChild(this.createGapElement());

  }

  private rerenderBlock(block: Block): void {
    const oldEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (!oldEl) return;

    this.updateFootnoteContext();

    const newEl = renderBlockElement(block);
    this.attachBlockEvents(newEl, block);
    oldEl.replaceWith(newEl);
  }

  // --- ギャップ / ブロック追加 ---

  private createGapElement(): HTMLElement {
    const gap = document.createElement('div');
    gap.className = 'group/gap relative h-2 flex items-center justify-center print:hidden';

    const addBtn = document.createElement('button');
    addBtn.className = 'absolute w-5 h-5 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-sm leading-none cursor-pointer opacity-0 transition-opacity duration-150 flex items-center justify-center z-5 group-hover/gap:opacity-100 hover:text-[var(--text-color)] hover:bg-[var(--bg-hover,var(--bg-secondary))] hover:border-[var(--text-secondary)]';
    addBtn.textContent = '+';
    addBtn.title = 'Add block';
    // mousedown 時に textarea がフォーカスを失うのを防止
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
    // 現在のアクティブブロックを同期
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

    // このギャップの前のブロック数から挿入位置を決定
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
    // notifyChange を呼ばない — 空ブロックは一時的
  }

  // --- イベント処理 ---

  private attachBlockEvents(el: HTMLElement, block: Block): void {
    // フォーカス追跡
    el.addEventListener('focusin', () => {
      if (this.activeBlockKey && this.activeBlockKey !== block.key) {
        this.syncAndRerenderBlock(this.activeBlockKey);
      }
      if (!this.originalBlockState.has(block.key)) {
        this.originalBlockState.set(block.key, { text: block.text, lang: block.lang });
      }
      this.activeBlockKey = block.key;
    });

    // フォーカス喪失: このブロックからフォーカスが離れたら編集モードを終了
    el.addEventListener('focusout', (e) => {
      const related = (e as FocusEvent).relatedTarget as HTMLElement | null;
      if (related && el.contains(related)) return;

      requestAnimationFrame(() => {
        if (this.activeBlockKey !== block.key) return;
        this.activeBlockKey = null;
        this.originalBlockState.delete(block.key);

        // ブロックを同期
        const textarea = this.getTextarea(block);
        if (textarea) this.syncBlockText(block, textarea);

        // 空ブロックを削除
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

        // 貼り付けコンテンツが複数ブロックに分割されるべき場合は再解析
        if (this.reparseIfBlockStructureChanged()) {
          this.notifyChange();
          return;
        }

        this.rerenderBlock(block);
        this.notifyChange();
      });
    });

    // キーボードイベント
    el.addEventListener('keydown', (e) => this.handleKeyDown(e, block));

    // プレビュー内のチェックボックストグル
    const checkboxes = el.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb, index) => {
      (cb as HTMLInputElement).removeAttribute('disabled');
      cb.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleCheckbox(block, index);
      });
    });

    // プレビュー内のラジオボタントグル
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

    // プレビュー内のテキスト入力処理
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

    // Escape: 編集をキャンセルし、元のテキストを復元
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

      // 復元後に空のブロックを削除
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

  }

  // --- ブロック操作 ---

  // --- textarea ユーティリティ ---

  private getTextarea(block: Block): HTMLTextAreaElement | null {
    const blockEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (!blockEl) return null;
    return blockEl.querySelector('.block-editor-textarea') as HTMLTextAreaElement | null;
  }

  private focusBlock(block: Block, position: 'start' | 'end' | number): void {
    const blockEl = this.container.querySelector(`[data-block-key="${block.key}"]`);
    if (!blockEl) return;

    // 編集モードに入る
    blockEl.classList.add('editing');

    const textarea = blockEl.querySelector('.block-editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    textarea.focus();

    // 表示後に自動リサイズ
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


  // --- 同期 ---

  /** textarea のコンテンツをブロックモデルに同期し、fence/math の区切り文字を処理 */
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

    // 型変更を検出（例: ユーザーが段落の先頭に # を入力）
    this.detectTypeChange(block);

    // 貼り付けコンテンツが複数ブロックに分割されるべき場合は再解析
    if (this.reparseIfBlockStructureChanged()) {
      this.notifyChange();
      return;
    }

    // ブロックを再レンダリング（編集を終了し、更新されたプレビューを表示）
    this.rerenderBlock(block);
    this.notifyChange();
  }

  /** ブロック構造が変わった場合（例: 複数ブロックコンテンツの貼り付け）全ブロックを再解析 */
  private reparseIfBlockStructureChanged(): boolean {
    const fullContent = exportMarkdown(this.blocks);
    const reparsed = parseBlocks(fullContent);

    if (reparsed.length === this.blocks.length) return false;

    this.blocks = reparsed;
    this.activeBlockKey = null;
    this.renderAllBlocks();
    return true;
  }

  /** 末尾に新しいブロックを追加（スクロール領域のダブルクリックから呼び出し）*/
  addBlockAtEnd(): void {
    // 唯一のブロックが空の場合、フォーカスするだけ
    if (this.blocks.length === 1 && this.blocks[0].text.trim() === '') {
      const block = this.blocks[0];
      this.originalBlockState.set(block.key, { text: '', lang: undefined });
      this.activeBlockKey = block.key;
      this.focusBlock(block, 'start');
      return;
    }

    // 現在のアクティブブロックを同期
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

    const newBlock: Block = {
      key: generateBlockKey(),
      type: 'paragraph',
      text: '',
      sourceStart: 0,
      sourceEnd: 0,
    };

    this.blocks.push(newBlock);
    this.renderAllBlocks();

    this.originalBlockState.set(newBlock.key, { text: '', lang: undefined });
    this.activeBlockKey = newBlock.key;
    this.focusBlock(newBlock, 'start');
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
    // 再レンダリング前にテキスト入力値を同期
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

  /** 全ブロックから脚注定義を収集し、プレビュー用のコンテキストを設定 */
  private updateFootnoteContext(): void {
    const footnoteDefs = this.blocks
      .filter(b => /^\[\^[^\]]+\]:/m.test(b.text))
      .map(b => b.text)
      .join('\n');
    setFootnoteContext(footnoteDefs);
  }

  private notifyChange(): void {
    const content = exportMarkdown(this.blocks);
    // 最後のエントリと異なる場合、undo スタックに追加
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
