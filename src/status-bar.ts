import { invoke } from '@tauri-apps/api/core';
import { t } from './i18n';

export class StatusBar {
  private bar: HTMLElement;
  private charCountEl: HTMLElement;
  private wordCountEl: HTMLElement;
  private readTimeEl: HTMLElement;
  private onModeChangeCb: ((mode: 'view' | 'edit' | 'split') => void) | null = null;

  constructor() {
    this.bar = document.getElementById('status-bar')!;
    this.charCountEl = document.getElementById('status-chars')!;
    this.wordCountEl = document.getElementById('status-words')!;
    this.readTimeEl = document.getElementById('status-read-time')!;
    this.bar.style.display = 'flex';

    document.getElementById('mode-view')?.addEventListener('click', () => {
      if (this.onModeChangeCb) this.onModeChangeCb('view');
    });
    document.getElementById('mode-edit')?.addEventListener('click', () => {
      if (this.onModeChangeCb) this.onModeChangeCb('edit');
    });
    document.getElementById('mode-split')?.addEventListener('click', () => {
      if (this.onModeChangeCb) this.onModeChangeCb('split');
    });

    document.getElementById('status-tag-add')?.addEventListener('click', () => {
      invoke('execute_menu_action', { id: 'tag_add' });
    });
    document.getElementById('status-tag-edit')?.addEventListener('click', () => {
      invoke('execute_menu_action', { id: 'tag_edit' });
    });
  }

  /** モード切替タブクリック時のコールバックを設定 */
  setOnModeChange(cb: (mode: 'view' | 'edit' | 'split') => void): void {
    this.onModeChangeCb = cb;
  }

  /** タブの active 状態を切替 */
  setActiveTab(mode: 'view' | 'edit' | 'split'): void {
    document.getElementById('mode-view')?.classList.toggle('active', mode === 'view');
    document.getElementById('mode-edit')?.classList.toggle('active', mode === 'edit');
    document.getElementById('mode-split')?.classList.toggle('active', mode === 'split');
  }

  /** 現在のアクティブモードを返す */
  getActiveMode(): 'view' | 'edit' | 'split' {
    if (document.getElementById('mode-split')?.classList.contains('active')) return 'split';
    if (document.getElementById('mode-edit')?.classList.contains('active')) return 'edit';
    return 'view';
  }

  /** 画面幅に応じてSplitタブの表示/非表示を制御 */
  updateSplitTabVisibility(): void {
    const splitTab = document.getElementById('mode-split');
    if (!splitTab) return;
    const narrow = window.innerWidth < 800;
    splitTab.style.display = narrow ? 'none' : '';
    // Splitが非表示の時、Editタブに右端の丸みを付ける
    const editTab = document.getElementById('mode-edit');
    if (editTab) {
      editTab.classList.toggle('mode-tab-end', narrow);
    }
  }

  update(markdown: string): void {
    const text = stripMarkdown(markdown);
    const chars = text.length;
    const words = countWords(text);
    const minutes = estimateReadTime(text, words);

    this.charCountEl.textContent = t('ui.status_chars').replace('{count}', chars.toLocaleString());
    this.wordCountEl.textContent = t('ui.status_words').replace('{count}', words.toLocaleString());
    this.readTimeEl.textContent = minutes < 1
      ? t('ui.status_read_time_short')
      : t('ui.status_read_time').replace('{count}', String(Math.ceil(minutes)));
  }

  applyTranslations(): void {
    const addEl = document.getElementById('status-tag-add')!;
    addEl.textContent = t('ui.status_tag_add');
    addEl.title = t('menu.tag_add');

    const editEl = document.getElementById('status-tag-edit')!;
    editEl.textContent = t('ui.status_tag_edit');
    editEl.title = t('menu.tag_edit');

  }
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^---[\s\S]*?---\n?/, '')   // front matter
    .replace(/^#{1,6}\s+/gm, '')          // headings
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/(`{3,})[\s\S]*?\1/g, '')    // fenced code blocks
    .replace(/`[^`]+`/g, '')              // inline code
    .replace(/[*_~]{1,3}/g, '')           // bold/italic/strikethrough markers
    .replace(/^\s*[-*+]\s+/gm, '')        // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, '')        // ordered list markers
    .replace(/^\s*>\s+/gm, '')            // blockquotes
    .replace(/\|/g, ' ')                  // table pipes
    .replace(/^[-:| ]+$/gm, '')           // table separator rows
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const CJK_RANGE = /[\u3000-\u9fff\uf900-\ufaff\uff66-\uff9f]/g;

function countWords(text: string): number {
  if (!text) return 0;
  const cjkChars = text.match(CJK_RANGE);
  const cjkCount = cjkChars ? cjkChars.length : 0;
  const withoutCjk = text.replace(CJK_RANGE, ' ');
  const latinWords = withoutCjk.split(/\s+/).filter(w => w.length > 0);
  return latinWords.length + cjkCount;
}

function estimateReadTime(text: string, totalWords: number): number {
  if (totalWords === 0) return 0;
  const cjkChars = text.match(CJK_RANGE);
  const cjkCount = cjkChars ? cjkChars.length : 0;
  const latinWords = totalWords - cjkCount;
  return latinWords / 230 + cjkCount / 500;
}
