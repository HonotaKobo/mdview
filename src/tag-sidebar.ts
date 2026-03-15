import { invoke } from '@tauri-apps/api/core';

export class TagSidebar {
  private sidebar: HTMLElement;
  private input: HTMLElement;
  private addBtn: HTMLElement;
  private tagList: HTMLElement;
  private closeBtn: HTMLElement;
  private fileLabel: HTMLElement;
  private tagCount: HTMLElement;
  private currentPath: string | null = null;

  constructor() {
    this.sidebar = document.getElementById('tag-sidebar')!;
    this.input = document.getElementById('tag-input')!;
    this.addBtn = document.getElementById('tag-add-btn')!;
    this.tagList = document.getElementById('tag-list')!;
    this.closeBtn = document.getElementById('tag-sidebar-close')!;
    this.fileLabel = document.getElementById('tag-sidebar-file-label')!;
    this.tagCount = document.getElementById('tag-count')!;

    this.addBtn.addEventListener('click', () => this.addTagFromInput());
    (this.input as HTMLInputElement).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.addTagFromInput();
    });
    this.closeBtn.addEventListener('click', () => this.hide());
  }

  isVisible(): boolean {
    return this.sidebar.style.display !== 'none';
  }

  async show(): Promise<void> {
    this.currentPath = await invoke<string | null>('get_saved_path');
    if (!this.currentPath) {
      alert('ファイルを保存してからタグを編集してください。');
      return;
    }
    this.sidebar.style.display = 'flex';
    this.fileLabel.textContent = this.currentPath.split(/[/\\]/).pop() || '';
    this.fileLabel.title = this.currentPath;
    await this.loadTags();
  }

  hide(): void {
    this.sidebar.style.display = 'none';
  }

  toggle(): void {
    if (this.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  async refresh(): Promise<void> {
    this.currentPath = await invoke<string | null>('get_saved_path');
    if (this.isVisible() && this.currentPath) {
      this.fileLabel.textContent = this.currentPath.split(/[/\\]/).pop() || '';
      this.fileLabel.title = this.currentPath;
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
      empty.textContent = 'タグがありません';
      this.tagList.appendChild(empty);
      this.tagCount.textContent = '';
      return;
    }

    const label = document.createElement('div');
    label.className = 'tag-list-label';
    label.textContent = 'タグ一覧';
    this.tagList.appendChild(label);

    for (const tag of tags) {
      const item = document.createElement('div');
      item.className = 'tag-item';

      const name = document.createElement('span');
      name.className = 'tag-item-name';
      name.textContent = tag;
      item.appendChild(name);

      const del = document.createElement('button');
      del.className = 'tag-item-remove';
      del.textContent = '\u00d7';
      del.title = '削除';
      del.addEventListener('click', () => this.removeTag(tag));
      item.appendChild(del);

      this.tagList.appendChild(item);
    }

    this.tagCount.textContent = tags.length + ' 個のタグ';
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
