import { invoke } from '@tauri-apps/api/core';
import { t } from './i18n';

export class TagSidebar {
  private sidebar: HTMLElement;
  private input: HTMLElement;
  private addBtn: HTMLElement;
  private tagList: HTMLElement;
  private closeBtn: HTMLElement;
  private fileLabel: HTMLElement;
  private tagCount: HTMLElement;
  private currentPath: string | null = null;

  // F6: Autocomplete state
  private autocompleteEl: HTMLElement;
  private allTags: string[] = [];
  private autocompleteIndex = -1;

  constructor() {
    this.sidebar = document.getElementById('tag-sidebar')!;
    this.input = document.getElementById('tag-input')!;
    this.addBtn = document.getElementById('tag-add-btn')!;
    this.tagList = document.getElementById('tag-list')!;
    this.closeBtn = document.getElementById('tag-sidebar-close')!;
    this.fileLabel = document.getElementById('tag-sidebar-file-label')!;
    this.tagCount = document.getElementById('tag-count')!;

    this.addBtn.addEventListener('click', () => this.addTagFromInput());

    // Modified keydown handler with autocomplete support (F6)
    (this.input as HTMLInputElement).addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.moveAutocomplete(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.moveAutocomplete(-1);
      } else if (e.key === 'Enter') {
        if (this.autocompleteIndex >= 0) {
          e.preventDefault();
          this.selectAutocomplete();
        } else {
          this.addTagFromInput();
        }
      } else if (e.key === 'Escape') {
        this.hideAutocomplete();
      }
    });

    this.closeBtn.addEventListener('click', () => this.hide());

    // F6: Setup autocomplete
    this.autocompleteEl = document.createElement('div');
    this.autocompleteEl.className = 'tag-autocomplete';
    this.autocompleteEl.style.display = 'none';
    const addRow = document.getElementById('tag-add-row')!;
    addRow.style.position = 'relative';
    addRow.appendChild(this.autocompleteEl);

    (this.input as HTMLInputElement).addEventListener('input', () => this.updateAutocomplete());

    document.addEventListener('click', (e) => {
      if (!this.autocompleteEl.contains(e.target as Node) && e.target !== this.input) {
        this.hideAutocomplete();
      }
    });
  }

  isVisible(): boolean {
    return this.sidebar.style.display !== 'none';
  }

  // U2: Focus the tag input
  focusInput(): void {
    (this.input as HTMLInputElement).focus();
  }

  async show(): Promise<void> {
    this.currentPath = await invoke<string | null>('get_saved_path');
    if (!this.currentPath) {
      alert(t('ui.tag_save_first_edit'));
      return;
    }
    this.sidebar.style.display = 'flex';
    this.fileLabel.textContent = this.currentPath.split(/[/\\]/).pop() || '';
    this.fileLabel.title = this.currentPath;
    await this.loadTags();
  }

  hide(): void {
    this.sidebar.style.display = 'none';
    this.hideAutocomplete();
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

  applyTranslations(): void {
    document.getElementById('tag-sidebar-title')!.textContent = t('ui.tag_sidebar_title');
    (this.input as HTMLInputElement).placeholder = t('ui.tag_input_placeholder');
    this.addBtn.textContent = t('ui.tag_add_action');
    if (this.isVisible()) this.loadTags();
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
      empty.textContent = t('ui.tag_empty');
      this.tagList.appendChild(empty);
      this.tagCount.textContent = '';
      return;
    }

    const label = document.createElement('div');
    label.className = 'tag-list-label';
    label.textContent = t('ui.tag_list_label');
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
      del.title = t('ui.tag_delete');
      del.addEventListener('click', () => this.removeTag(tag));
      item.appendChild(del);

      this.tagList.appendChild(item);
    }

    this.tagCount.textContent = t('ui.tag_count').replace('{count}', String(tags.length));
  }

  private async addTagFromInput(): Promise<void> {
    const input = this.input as HTMLInputElement;
    const tag = input.value.trim();
    if (!tag || !this.currentPath) return;
    await invoke('tag_add', { path: this.currentPath, tag });
    input.value = '';
    this.allTags = []; // Clear autocomplete cache
    this.hideAutocomplete();
    await this.loadTags();
  }

  private async removeTag(tag: string): Promise<void> {
    if (!this.currentPath) return;
    await invoke('tag_remove', { path: this.currentPath, tag });
    this.allTags = []; // Clear autocomplete cache
    await this.loadTags();
  }

  // F6: Autocomplete methods
  private async updateAutocomplete(): Promise<void> {
    const input = this.input as HTMLInputElement;
    const value = input.value.trim().toLowerCase();
    if (!value) {
      this.hideAutocomplete();
      return;
    }

    if (this.allTags.length === 0) {
      this.allTags = await invoke<string[]>('tag_get_all_unique_tags');
    }

    const matches = this.allTags
      .filter(tag => tag.toLowerCase().includes(value) && tag.toLowerCase() !== value)
      .slice(0, 8);

    if (matches.length === 0) {
      this.hideAutocomplete();
      return;
    }

    this.autocompleteEl.innerHTML = '';
    this.autocompleteIndex = -1;

    for (const match of matches) {
      const item = document.createElement('div');
      item.className = 'tag-autocomplete-item';
      item.textContent = match;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = match;
        this.hideAutocomplete();
      });
      this.autocompleteEl.appendChild(item);
    }

    this.autocompleteEl.style.display = 'block';
  }

  private moveAutocomplete(delta: number): void {
    const items = this.autocompleteEl.querySelectorAll('.tag-autocomplete-item');
    if (items.length === 0) return;

    if (this.autocompleteIndex >= 0 && this.autocompleteIndex < items.length) {
      items[this.autocompleteIndex].classList.remove('active');
    }

    this.autocompleteIndex += delta;
    if (this.autocompleteIndex < 0) this.autocompleteIndex = items.length - 1;
    if (this.autocompleteIndex >= items.length) this.autocompleteIndex = 0;

    items[this.autocompleteIndex].classList.add('active');
  }

  private selectAutocomplete(): void {
    const items = this.autocompleteEl.querySelectorAll('.tag-autocomplete-item');
    if (this.autocompleteIndex >= 0 && this.autocompleteIndex < items.length) {
      (this.input as HTMLInputElement).value = items[this.autocompleteIndex].textContent || '';
      this.hideAutocomplete();
    }
  }

  private hideAutocomplete(): void {
    this.autocompleteEl.style.display = 'none';
    this.autocompleteIndex = -1;
  }
}
