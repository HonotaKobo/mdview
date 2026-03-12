interface ScrollAnchor {
  selector: string;
  tagName: string;
  textPrefix: string;
  offsetFromTop: number;
}

export class ScrollKeeper {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  captureAnchor(): ScrollAnchor | null {
    const containerRect = this.container.getBoundingClientRect();
    const candidates = this.container.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, table, hr'
    );

    let bestElement: Element | null = null;
    let bestOffset = Infinity;

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const relativeTop = rect.top - containerRect.top;

      if (Math.abs(relativeTop) < Math.abs(bestOffset)) {
        bestOffset = relativeTop;
        bestElement = el;
      }
    }

    if (!bestElement) return null;

    return {
      selector: this.buildSelector(bestElement),
      tagName: bestElement.tagName.toLowerCase(),
      textPrefix: (bestElement.textContent || '').slice(0, 30).trim(),
      offsetFromTop: bestOffset,
    };
  }

  restoreAnchor(anchor: ScrollAnchor): void {
    let element = this.container.querySelector(anchor.selector);

    if (!element) {
      element = this.findByText(anchor.tagName, anchor.textPrefix);
    }

    if (!element) return;

    const containerRect = this.container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const currentRelativeTop = elementRect.top - containerRect.top;

    this.container.scrollTop += currentRelativeTop - anchor.offsetFromTop;
  }

  private buildSelector(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;

    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();

    const siblings = Array.from(parent.children).filter(
      (s) => s.tagName === el.tagName
    );
    const index = siblings.indexOf(el) + 1;
    return `${el.tagName.toLowerCase()}:nth-of-type(${index})`;
  }

  private findByText(tagName: string, textPrefix: string): Element | null {
    if (!textPrefix) return null;
    const elements = this.container.querySelectorAll(tagName);
    for (const el of elements) {
      const text = (el.textContent || '').slice(0, 30).trim();
      if (text === textPrefix) return el;
    }
    return null;
  }
}
