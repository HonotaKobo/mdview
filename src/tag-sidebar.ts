import { invoke } from '@tauri-apps/api/core';

export class TagSidebar {
  private sidebar: HTMLElement;
  private input: HTMLElement;
  private addBtn: HTMLElement;
  private tagList: HTMLElement;
  private closeBtn: HTMLElement;
  private currentPath: string | null = null;

  constructor() {
    this.sidebar = document.getElementById('tag-sidebar')!;
    this.input = document.getElementById('tag-input')!;
    this.addBtn = document.getElementById('tag-add-btn')!;
    this.tagList = document.getElementById('tag-list')!;
    this.closeBtn = document.getElementById('tag-sidebar-close')!;

    this.addBtn.addEventListener('click', () => this.addTagFromInput());
    (this.input as HTMLInputElement).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.addTagFromInput();
    });
    this.closeBtn.addEventListener('click', () => this.hide());
  }

  isVisible(): boolean {
    return this.sidebar.style.display !== 'none';
  }

  async show(mode: 'add' | 'edit' = 'edit'): Promise<void> {
    this.currentPath = await invoke<string | null>('get_saved_path');
    if (!this.currentPath) {
      alert('ファイルを保存してからタグを追加してください。');
      return;
    }
    this.sidebar.style.display = 'flex';
    await this.loadTags();
    if (mode === 'add') {
      (this.input as HTMLInputElement).value = '';
      this.input.focus();
    }
  }

  hide(): void {
    this.sidebar.style.display = 'none';
  }

  toggle(): void {
    if (this.isVisible()) {
      this.hide();
    } else {
      this.show('edit');
    }
  }

  async refresh(): Promise<void> {
    this.currentPath = await invoke<string | null>('get_saved_path');
    if (this.isVisible() && this.currentPath) {
      await this.loadTags();
    }
  }

  private async loadTags(): Promise<void> {
    if (!this.currentPath) return;
    const tags = await invoke<string[]>('tag_get', { path: this.currentPath });
    this.renderTags(tags);
  }

  private renderTags(tags: string[]): void {
    this.tagList.innerHTML = '';
    if (tags.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tag-empty';
      empty.textContent = 'No tags';
      this.tagList.appendChild(empty);
      return;
    }
    for (const tag of tags) {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';

      const label = document.createElement('span');
      label.className = 'tag-chip-label';
      label.textContent = tag;
      chip.appendChild(label);

      const del = document.createElement('button');
      del.className = 'tag-chip-delete';
      del.textContent = '\u00d7';
      del.addEventListener('click', () => this.removeTag(tag));
      chip.appendChild(del);

      this.tagList.appendChild(chip);
    }
  }

  private async addTagFromInput(): Promise<void> {
    const input = this.input as HTMLInputElement;
    const tag = input.value.trim();
    if (!tag || !this.currentPath) return;
    await invoke('tag_add', { path: this.currentPath, tag });
    input.value = '';
    await this.loadTags();
  }

  private async removeTag(tag: string): Promise<void> {
    if (!this.currentPath) return;
    await invoke('tag_remove', { path: this.currentPath, tag });
    await this.loadTags();
  }
}
