export class FontSizeManager {
  private currentSize: number;
  private container: HTMLElement;

  constructor() {
    this.container = document.getElementById('content')!;
    this.currentSize = parseInt(localStorage.getItem('mdview-font-size') || '100', 10);
    this.apply();
  }

  increase(): void {
    this.currentSize = Math.min(200, this.currentSize + 10);
    this.apply();
  }

  decrease(): void {
    this.currentSize = Math.max(50, this.currentSize - 10);
    this.apply();
  }

  private apply(): void {
    this.container.style.fontSize = `${this.currentSize}%`;
    localStorage.setItem('mdview-font-size', String(this.currentSize));
  }
}
