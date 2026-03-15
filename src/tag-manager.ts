import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

interface TagEntry {
  path: string;
  tags: string[];
}

export class TagManager {
  private container: HTMLElement;
  private entries: TagEntry[] = [];
  private pathStatus: Map<string, boolean> = new Map();
  private searchQuery = '';

  constructor() {
    this.container = document.getElementById('content')!;
  }

  async init(): Promise<void> {
    document.getElementById('scroll-area')!.style.overflow = 'auto';
    document.getElementById('status-bar')!.style.display = 'none';
    document.getElementById('tag-sidebar')!.style.display = 'none';
    await this.load();
    this.render();
  }

  private async load(): Promise<void> {
    this.entries = await invoke<TagEntry[]>('tag_get_all');
    const validation = await invoke<[string, boolean][]>('tag_validate_paths');
    this.pathStatus.clear();
    for (const [path, exists] of validation) {
      this.pathStatus.set(path, exists);
    }
  }

  private render(): void {
    const filtered = this.entries.filter(e => {
      if (!this.searchQuery) return true;
      const q = this.searchQuery.toLowerCase();
      return e.path.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q));
    });

    this.container.innerHTML = '';
    this.container.style.padding = '16px 24px';
    this.container.style.maxWidth = '100%';

    const header = document.createElement('div');
    header.className = 'tm-header';

    const title = document.createElement('h2');
    title.textContent = 'Tag Manager';
    title.style.margin = '0';
    title.style.fontSize = '18px';
    title.style.color = 'var(--text-primary)';
    header.appendChild(title);

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Search tags or files...';
    search.className = 'tm-search';
    search.value = this.searchQuery;
    search.addEventListener('input', () => {
      this.searchQuery = search.value;
      this.render();
    });
    header.appendChild(search);

    this.container.appendChild(header);

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tm-empty';
      empty.textContent = this.searchQuery ? 'No matches found.' : 'No tagged files.';
      this.container.appendChild(empty);
      return;
    }

    for (const entry of filtered) {
      const exists = this.pathStatus.get(entry.path) ?? true;
      const row = document.createElement('div');
      row.className = 'tm-row' + (exists ? '' : ' tm-invalid');

      const pathRow = document.createElement('div');
      pathRow.className = 'tm-path-row';

      if (!exists) {
        const warn = document.createElement('span');
        warn.className = 'tm-warn';
        warn.textContent = '!';
        warn.title = 'File not found';
        pathRow.appendChild(warn);
      }

      const pathEl = document.createElement('span');
      pathEl.className = 'tm-path';
      pathEl.textContent = entry.path;
      pathEl.title = entry.path;
      pathRow.appendChild(pathEl);

      row.appendChild(pathRow);

      const tagsRow = document.createElement('div');
      tagsRow.className = 'tm-tags';
      for (const tag of entry.tags) {
        const chip = document.createElement('span');
        chip.className = 'tm-tag-chip';
        chip.textContent = tag;
        tagsRow.appendChild(chip);
      }
      row.appendChild(tagsRow);

      const actions = document.createElement('div');
      actions.className = 'tm-actions';

      if (!exists) {
        const relinkBtn = document.createElement('button');
        relinkBtn.className = 'tm-btn';
        relinkBtn.textContent = 'Relink';
        relinkBtn.addEventListener('click', () => this.relinkEntry(entry.path));
        actions.appendChild(relinkBtn);
      }

      const openBtn = document.createElement('button');
      openBtn.className = 'tm-btn';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', () => this.openFile(entry.path));
      if (!exists) openBtn.disabled = true;
      actions.appendChild(openBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'tm-btn tm-btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => this.deleteEntry(entry.path));
      actions.appendChild(deleteBtn);

      row.appendChild(actions);
      this.container.appendChild(row);
    }
  }

  private async relinkEntry(oldPath: string): Promise<void> {
    const parent = oldPath.substring(0, oldPath.lastIndexOf('/')) || oldPath.substring(0, oldPath.lastIndexOf('\\'));
    const selected = await open({
      multiple: false,
      defaultPath: parent || undefined,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (selected) {
      await invoke('tag_relink', { oldPath, newPath: selected as string });
      await this.load();
      this.render();
    }
  }

  private async openFile(path: string): Promise<void> {
    await invoke('open_new_window', { file: path });
  }

  private async deleteEntry(path: string): Promise<void> {
    await invoke('tag_delete_entry', { path });
    await this.load();
    this.render();
  }
}
