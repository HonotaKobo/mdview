import { invoke } from '@tauri-apps/api/core';

export class TagAddModal {
  private overlay: HTMLElement;
  private input: HTMLInputElement;
  private currentPath: string | null = null;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'tag-add-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <div id="tag-add-modal">
        <input id="tag-add-modal-input" type="text" placeholder="タグ名を入力..." />
      </div>
    `;
    document.body.appendChild(this.overlay);
    this.input = document.getElementById('tag-add-modal-input') as HTMLInputElement;

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        this.hide();
      }
    });

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  async show(): Promise<void> {
    this.currentPath = await invoke<string | null>('get_saved_path');
    if (!this.currentPath) {
      alert('ファイルを保存してからタグを追加してください。');
      return;
    }
    this.input.value = '';
    this.overlay.style.display = 'flex';
    this.input.focus();
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  private async submit(): Promise<void> {
    const tag = this.input.value.trim();
    if (!tag || !this.currentPath) return;
    await invoke('tag_add', { path: this.currentPath, tag });
    this.hide();
    this.overlay.dispatchEvent(new CustomEvent('tag-added'));
  }

  onTagAdded(callback: () => void): void {
    this.overlay.addEventListener('tag-added', () => callback());
  }
}
