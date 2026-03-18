import { renderMarkdown } from '../renderer';

/**
 * EditorController はビューモードとエディットモードを管理する。
 * ビューモード: renderMarkdown() でレンダリングし、フォーム要素は操作可能。
 * エディットモード: 1つの textarea に raw Markdown 全体を表示して編集。
 */
export class EditorController {
  private container: HTMLElement;
  private mode: 'view' | 'edit' = 'view';
  private currentContent: string = '';
  private onContentChange: ((markdown: string) => void) | null = null;
  private onModeChange: ((mode: 'view' | 'edit') => void) | null = null;

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

  /** モード変更時のコールバックを設定 */
  setOnModeChange(cb: (mode: 'view' | 'edit') => void): void {
    this.onModeChange = cb;
  }

  /** エディタ開始（ビューモードで表示） */
  enterEditMode(content: string): void {
    this.currentContent = content;
    this.mode = 'view';
    document.body.classList.add('edit-mode');
    this.undoStack = [content];
    this.redoStack = [];
    this.renderView();
  }

  /** エディタ終了 */
  exitEditMode(): string {
    this.syncFormInputs();
    this.syncFromEdit();
    document.body.classList.remove('edit-mode');
    return this.currentContent;
  }

  /** 現在の Markdown を返す */
  getCurrentContent(): string {
    this.syncFormInputs();
    this.syncFromEdit();
    return this.currentContent;
  }

  /** 外部からの更新（ファイル監視等） */
  updateContent(content: string): void {
    this.currentContent = content;
    this.undoStack = [content];
    this.redoStack = [];
    if (this.mode === 'view') {
      this.renderView();
    } else {
      const textarea = this.container.querySelector('.editor-textarea') as HTMLTextAreaElement;
      if (textarea) textarea.value = content;
    }
  }

  /** ビューモードに切替 */
  switchToView(): void {
    if (this.mode === 'view') return;
    this.syncFromEdit();
    this.mode = 'view';
    // undoスタックにエディット結果を追加（変更がある場合）
    if (this.undoStack.length === 0 || this.undoStack[this.undoStack.length - 1] !== this.currentContent) {
      this.undoStack.push(this.currentContent);
      this.redoStack = [];
      if (this.undoStack.length > 100) {
        this.undoStack.shift();
      }
    }
    this.renderView();
    if (this.onModeChange) this.onModeChange('view');
  }

  /** エディットモードに切替 */
  switchToEdit(): void {
    if (this.mode === 'edit') return;
    this.syncFormInputs();
    this.mode = 'edit';
    this.renderEdit();
    if (this.onModeChange) this.onModeChange('edit');
  }

  /** 最後の変更を元に戻す */
  undo(): void {
    if (this.undoStack.length <= 1) return;
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    const prev = this.undoStack[this.undoStack.length - 1];
    this.currentContent = prev;
    if (this.mode === 'view') {
      this.renderView();
    } else {
      const textarea = this.container.querySelector('.editor-textarea') as HTMLTextAreaElement;
      if (textarea) textarea.value = prev;
    }
    if (this.onContentChange) this.onContentChange(prev);
  }

  /** 最後に戻した変更をやり直す */
  redo(): void {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    this.currentContent = next;
    if (this.mode === 'view') {
      this.renderView();
    } else {
      const textarea = this.container.querySelector('.editor-textarea') as HTMLTextAreaElement;
      if (textarea) textarea.value = next;
    }
    if (this.onContentChange) this.onContentChange(next);
  }

  // --- ビューモード ---

  private renderView(): void {
    renderMarkdown(this.currentContent, this.container).then(() => {
      this.attachFormEvents();
    });
  }

  private attachFormEvents(): void {
    // チェックボックス
    const checkboxes = this.container.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb, index) => {
      (cb as HTMLInputElement).removeAttribute('disabled');
      cb.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.syncFormInputs();
        this.toggleCheckbox(index);
      });
    });

    // ラジオボタン
    const radios = this.container.querySelectorAll('input[type="radio"]');
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
        this.syncFormInputs();
        this.toggleRadio(index, groupIndices);
      });
    });

    // テキスト入力
    const textInputs = this.container.querySelectorAll('input[type="text"].deflist-text-input');
    textInputs.forEach((input) => {
      input.addEventListener('keydown', (e) => e.stopPropagation());
      input.addEventListener('change', () => {
        this.syncFormInputs();
        this.notifyChange();
      });
    });
  }

  // --- エディットモード ---

  private renderEdit(): void {
    this.container.textContent = '';
    const textarea = document.createElement('textarea');
    textarea.className = 'editor-textarea';
    textarea.value = this.currentContent;
    textarea.spellcheck = false;
    textarea.addEventListener('input', () => {
      this.currentContent = textarea.value;
      if (this.onContentChange) {
        this.onContentChange(this.currentContent);
      }
    });
    this.container.appendChild(textarea);
    textarea.focus();
  }

  // --- フォーム操作 ---

  /** テキスト入力の値を currentContent に同期 */
  private syncFormInputs(): void {
    if (this.mode !== 'view') return;
    const textInputs = this.container.querySelectorAll('input[type="text"].deflist-text-input');
    if (textInputs.length === 0) return;

    let count = 0;
    this.currentContent = this.currentContent.replace(/\[T:"([^"]*)"\]/g, (match) => {
      const input = textInputs[count] as HTMLInputElement | undefined;
      count++;
      if (input) {
        const safeValue = input.value.replace(/"/g, '');
        return `[T:"${safeValue}"]`;
      }
      return match;
    });
  }

  /** エディットモードの textarea の値を currentContent に同期 */
  private syncFromEdit(): void {
    if (this.mode !== 'edit') return;
    const textarea = this.container.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (textarea) this.currentContent = textarea.value;
  }

  private toggleCheckbox(index: number): void {
    let count = 0;
    this.currentContent = this.currentContent.replace(/\[([ xX])\]/g, (match, state) => {
      if (count === index) {
        count++;
        return state === ' ' ? '[x]' : '[ ]';
      }
      count++;
      return match;
    });
    this.renderView();
    this.notifyChange();
  }

  private toggleRadio(clickedIndex: number, groupIndices: number[]): void {
    let count = 0;
    this.currentContent = this.currentContent.replace(/\[R:"(x?)"\]/g, (match) => {
      const idx = count++;
      if (groupIndices.includes(idx)) {
        return idx === clickedIndex ? '[R:"x"]' : '[R:""]';
      }
      return match;
    });
    this.renderView();
    this.notifyChange();
  }

  private notifyChange(): void {
    if (this.undoStack.length === 0 || this.undoStack[this.undoStack.length - 1] !== this.currentContent) {
      this.undoStack.push(this.currentContent);
      this.redoStack = [];
      if (this.undoStack.length > 100) {
        this.undoStack.shift();
      }
    }
    if (this.onContentChange) {
      this.onContentChange(this.currentContent);
    }
  }
}
