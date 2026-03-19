import { renderMarkdown } from '../renderer';

/**
 * EditorController はビューモード、エディットモード、スプリットモードを管理する。
 * ビューモード: renderMarkdown() でレンダリングし、フォーム要素は操作可能。
 * エディットモード: 1つの textarea に raw Markdown 全体を表示して編集。
 * スプリットモード: 左にエディタ、右にプレビューをリアルタイム表示。
 */
export class EditorController {
  private container: HTMLElement;
  private mode: 'view' | 'edit' | 'split' = 'view';
  private currentContent: string = '';
  private onContentChange: ((markdown: string) => void) | null = null;
  private onModeChange: ((mode: 'view' | 'edit' | 'split') => void) | null = null;

  /** Undo/Redo スタック（markdown スナップショット）*/
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  /** スプリットモードのプレビューコンテナ */
  private splitPreviewContainer: HTMLElement | null = null;
  /** スプリットプレビューのデバウンスタイマー */
  private splitPreviewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** コンテンツ変更時のコールバックを設定 */
  setOnContentChange(cb: (markdown: string) => void): void {
    this.onContentChange = cb;
  }

  /** モード変更時のコールバックを設定 */
  setOnModeChange(cb: (mode: 'view' | 'edit' | 'split') => void): void {
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
    document.body.classList.remove('split-mode');
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
    } else if (this.mode === 'split') {
      this.updateTextarea(content);
      this.renderSplitPreview();
    } else {
      this.updateTextarea(content);
    }
  }

  /** ビューモードに切替 */
  switchToView(): void {
    if (this.mode === 'view') return;
    this.syncFromEdit();
    this.splitPreviewContainer = null;
    this.mode = 'view';
    document.body.classList.remove('split-mode');
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
    this.syncFromEdit();
    this.syncFormInputs();
    this.splitPreviewContainer = null;
    this.mode = 'edit';
    document.body.classList.remove('split-mode');
    this.renderEdit();
    if (this.onModeChange) this.onModeChange('edit');
  }

  /** スプリットモードに切替 */
  switchToSplit(): void {
    if (this.mode === 'split') return;
    this.syncFromEdit();
    this.syncFormInputs();
    this.mode = 'split';
    document.body.classList.add('split-mode');
    this.renderSplit();
    if (this.onModeChange) this.onModeChange('split');
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
      this.updateTextarea(prev);
      if (this.mode === 'split') this.debouncedRenderSplitPreview();
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
      this.updateTextarea(next);
      if (this.mode === 'split') this.debouncedRenderSplitPreview();
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
    this.buildEditUI(this.container, false);
  }

  /** スプリットモードのレンダリング */
  private renderSplit(): void {
    this.container.textContent = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'split-wrapper';

    // 左ペイン: エディタ
    const editPane = document.createElement('div');
    editPane.className = 'split-pane split-edit-pane';
    this.buildEditUI(editPane, true);

    // リサイザー
    const resizer = document.createElement('div');
    resizer.className = 'split-resizer';

    // 右ペイン: プレビュー
    const previewPane = document.createElement('div');
    previewPane.className = 'split-pane split-preview-pane';
    this.splitPreviewContainer = previewPane;

    wrapper.appendChild(editPane);
    wrapper.appendChild(resizer);
    wrapper.appendChild(previewPane);
    this.container.appendChild(wrapper);

    // ドラッグリサイズロジック
    let isResizing = false;
    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      e.preventDefault();
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e: MouseEvent) {
      if (!isResizing) return;
      const rect = wrapper.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const clamped = Math.max(0.2, Math.min(0.8, ratio));
      editPane.style.flex = `${clamped}`;
      previewPane.style.flex = `${1 - clamped}`;
    }

    function onMouseUp() {
      isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    this.renderSplitPreview();
  }

  /** スプリットプレビューパネルのみ再レンダリング */
  private renderSplitPreview(): void {
    if (!this.splitPreviewContainer) return;
    renderMarkdown(this.currentContent, this.splitPreviewContainer);
  }

  /** デバウンス付きスプリットプレビュー更新 */
  private debouncedRenderSplitPreview(): void {
    if (this.splitPreviewTimer) clearTimeout(this.splitPreviewTimer);
    this.splitPreviewTimer = setTimeout(() => {
      this.splitPreviewTimer = null;
      this.renderSplitPreview();
    }, 300);
  }

  /**
   * エディタUI（行番号 + textarea）を指定コンテナに構築する。
   * isSplit=true の場合、input イベントでスプリットプレビューも更新する。
   */
  private buildEditUI(target: HTMLElement, isSplit: boolean): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'editor-wrapper';

    const lineNumbers = document.createElement('div');
    lineNumbers.className = 'line-numbers';

    const textarea = document.createElement('textarea');
    textarea.className = 'editor-textarea';
    textarea.value = this.currentContent;
    textarea.spellcheck = false;

    textarea.addEventListener('input', () => {
      this.currentContent = textarea.value;
      this.updateLineNumbers();
      if (isSplit) this.debouncedRenderSplitPreview();
      if (this.onContentChange) {
        this.onContentChange(this.currentContent);
      }
    });

    // スクロール同期（行番号とtextarea間）
    textarea.addEventListener('scroll', () => {
      lineNumbers.scrollTop = textarea.scrollTop;
    });

    wrapper.appendChild(lineNumbers);
    wrapper.appendChild(textarea);
    target.appendChild(wrapper);

    this.updateLineNumbers();
    textarea.focus();
  }

  /** textarea の値を更新し行番号も再描画する共通ヘルパー */
  private updateTextarea(content: string): void {
    const textarea = this.container.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.value = content;
      this.updateLineNumbers();
    }
  }

  /** 行番号を textarea の内容に合わせて更新 */
  private updateLineNumbers(): void {
    const lineNumbers = this.container.querySelector('.line-numbers');
    const textarea = this.container.querySelector('.editor-textarea') as HTMLTextAreaElement;
    if (!lineNumbers || !textarea) return;

    const count = textarea.value.split('\n').length;
    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= count; i++) {
      const span = document.createElement('span');
      span.textContent = String(i);
      fragment.appendChild(span);
    }
    lineNumbers.textContent = '';
    lineNumbers.appendChild(fragment);
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

  /** エディット/スプリットモードの textarea の値を currentContent に同期 */
  private syncFromEdit(): void {
    if (this.mode !== 'edit' && this.mode !== 'split') return;
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
