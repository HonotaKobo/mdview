export class FindBar {
  private bar: HTMLElement;
  private input: HTMLInputElement;
  private countEl: HTMLElement;
  private container: HTMLElement;
  private highlights: HTMLElement[] = [];
  private currentIndex = -1;

  constructor() {
    this.bar = document.getElementById('find-bar')!;
    this.input = document.getElementById('find-input') as HTMLInputElement;
    this.countEl = document.getElementById('find-count')!;
    this.container = document.getElementById('content')!;

    this.input.addEventListener('input', () => this.search());

    document.getElementById('find-next')!.addEventListener('click', () => this.next());
    document.getElementById('find-prev')!.addEventListener('click', () => this.prev());
    document.getElementById('find-close')!.addEventListener('click', () => this.hide());

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
  }

  show(): void {
    this.bar.style.display = 'flex';
    this.input.focus();
    this.input.select();
  }

  hide(): void {
    this.bar.style.display = 'none';
    this.clearHighlights();
    this.input.value = '';
    this.countEl.textContent = '';
  }

  isVisible(): boolean {
    return this.bar.style.display !== 'none';
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

  private search(): void {
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

      // Build replacement nodes in reverse order to preserve offsets
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
    // Remove active class from all
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
