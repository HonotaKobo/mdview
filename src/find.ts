import { t } from './i18n';

export class FindBar {
  private bar: HTMLElement;
  private input: HTMLInputElement;
  private replaceInput: HTMLInputElement;
  private replaceRow: HTMLElement;
  private countEl: HTMLElement;
  private container: HTMLElement;
  private highlights: HTMLElement[] = [];
  private currentIndex = -1;
  private replaceMode = false;
  private onReplace: ((search: string, replace: string, all: boolean) => void) | null = null;

  constructor() {
    this.bar = document.getElementById('find-bar')!;
    this.input = document.getElementById('find-input') as HTMLInputElement;
    this.replaceInput = document.getElementById('replace-input') as HTMLInputElement;
    this.replaceRow = document.getElementById('replace-row')!;
    this.countEl = document.getElementById('find-count')!;
    this.container = document.getElementById('content')!;

    this.input.addEventListener('input', () => this.search());

    document.getElementById('find-next')!.addEventListener('click', () => this.next());
    document.getElementById('find-prev')!.addEventListener('click', () => this.prev());
    document.getElementById('find-close')!.addEventListener('click', () => this.hide());
    document.getElementById('replace-one')!.addEventListener('click', () => this.replaceOne());
    document.getElementById('replace-all')!.addEventListener('click', () => this.replaceAll());

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.prev();
        } else {
          this.next();
        }
      }
      if (e.key === 'Escape') {
        this.hide();
      }
    });

    this.replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.replaceOne();
      }
      if (e.key === 'Escape') {
        this.hide();
      }
    });
  }

  applyTranslations(): void {
    this.input.placeholder = t('ui.find_placeholder');
    this.replaceInput.placeholder = t('ui.replace_placeholder');
    document.getElementById('find-prev')!.title = t('ui.find_prev_title');
    document.getElementById('find-next')!.title = t('ui.find_next_title');
    document.getElementById('find-close')!.title = t('ui.find_close_title');
    const replaceOne = document.getElementById('replace-one')!;
    replaceOne.textContent = t('ui.replace_btn');
    replaceOne.title = t('ui.replace_title');
    const replaceAll = document.getElementById('replace-all')!;
    replaceAll.textContent = t('ui.replace_all_btn');
    replaceAll.title = t('ui.replace_all_title');
  }

  setOnReplace(cb: (search: string, replace: string, all: boolean) => void): void {
    this.onReplace = cb;
  }

  show(): void {
    this.bar.style.display = 'flex';
    this.replaceRow.style.display = this.replaceMode ? 'flex' : 'none';
    this.input.focus();
    this.input.select();
  }

  showReplace(): void {
    this.replaceMode = true;
    this.bar.style.display = 'flex';
    this.replaceRow.style.display = 'flex';
    this.input.focus();
    this.input.select();
  }

  hide(): void {
    this.bar.style.display = 'none';
    this.replaceRow.style.display = 'none';
    this.replaceMode = false;
    this.clearHighlights();
    this.input.value = '';
    this.replaceInput.value = '';
    this.countEl.textContent = '';
  }

  isVisible(): boolean {
    return this.bar.style.display !== 'none';
  }

  isReplaceVisible(): boolean {
    return this.replaceRow.style.display !== 'none';
  }

  next(): void {
    if (this.highlights.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.highlights.length;
    this.scrollToCurrent();
  }

  prev(): void {
    if (this.highlights.length === 0) return;
    this.currentIndex = (this.currentIndex - 1 + this.highlights.length) % this.highlights.length;
    this.scrollToCurrent();
  }

  private replaceOne(): void {
    const query = this.input.value;
    const replacement = this.replaceInput.value;
    if (!query || !this.onReplace) return;
    this.onReplace(query, replacement, false);
  }

  private replaceAll(): void {
    const query = this.input.value;
    const replacement = this.replaceInput.value;
    if (!query || !this.onReplace) return;
    this.onReplace(query, replacement, true);
  }

  search(): void {
    this.clearHighlights();
    const query = this.input.value;
    if (!query) {
      this.countEl.textContent = '';
      return;
    }

    const walker = document.createTreeWalker(
      this.container,
      NodeFilter.SHOW_TEXT,
      null
    );

    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    const lowerQuery = query.toLowerCase();

    for (const textNode of textNodes) {
      const text = textNode.textContent || '';
      const lowerText = text.toLowerCase();
      let startIdx = 0;
      const ranges: { start: number; end: number }[] = [];

      while (true) {
        const idx = lowerText.indexOf(lowerQuery, startIdx);
        if (idx === -1) break;
        ranges.push({ start: idx, end: idx + query.length });
        startIdx = idx + 1;
      }

      if (ranges.length === 0) continue;

      const parent = textNode.parentNode;
      if (!parent) continue;

      const frag = document.createDocumentFragment();
      let lastEnd = 0;
      for (const range of ranges) {
        if (range.start > lastEnd) {
          frag.appendChild(document.createTextNode(text.slice(lastEnd, range.start)));
        }
        const mark = document.createElement('mark');
        mark.className = 'find-highlight';
        mark.textContent = text.slice(range.start, range.end);
        this.highlights.push(mark);
        frag.appendChild(mark);
        lastEnd = range.end;
      }
      if (lastEnd < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastEnd)));
      }
      parent.replaceChild(frag, textNode);
    }

    if (this.highlights.length > 0) {
      this.currentIndex = 0;
      this.scrollToCurrent();
    } else {
      this.countEl.textContent = this.highlights.length === 0 && query ? '0/0' : '';
    }
  }

  private scrollToCurrent(): void {
    for (const h of this.highlights) {
      h.classList.remove('active');
    }

    if (this.currentIndex >= 0 && this.currentIndex < this.highlights.length) {
      const current = this.highlights[this.currentIndex];
      current.classList.add('active');
      current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    this.countEl.textContent =
      this.highlights.length > 0
        ? `${this.currentIndex + 1}/${this.highlights.length}`
        : '0/0';
  }

  private clearHighlights(): void {
    for (const mark of this.highlights) {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    }
    this.highlights = [];
    this.currentIndex = -1;
  }
}
