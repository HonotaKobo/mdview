import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { t } from './i18n';

interface TagEntry {
  path: string;
  tags: string[];
}

export class TagManager {
  private container: HTMLElement;
  private entries: TagEntry[] = [];
  private pathStatus: Map<string, boolean> = new Map();
  private searchQuery = '';
  private selectedPaths: Set<string> = new Set();
  private sidebarVisible = false;
  private tagCounts: [string, number][] = [];
  private tagSortBy: 'name' | 'count' = 'name';

  // Persistent DOM refs (B1: avoid re-creating search input)
  private wrapper: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private cardListEl: HTMLElement | null = null;
  private sidebarEl: HTMLElement | null = null;
  private batchBarEl: HTMLElement | null = null;
  private searchCountEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private selectAllCheckbox: HTMLInputElement | null = null;

  constructor() {
    this.container = document.getElementById('content')!;
  }

  async init(): Promise<void> {
    document.getElementById('scroll-area')!.style.overflow = 'hidden';
    document.getElementById('status-bar')!.style.display = 'none';
    document.getElementById('tag-sidebar')!.style.display = 'none';
    this.entries = await invoke<TagEntry[]>('tag_get_all');
    this.renderFrame();
    this.renderCardList();
    const validation = await invoke<[string, boolean][]>('tag_validate_paths');
    this.pathStatus.clear();
    for (const [path, exists] of validation) {
      this.pathStatus.set(path, exists);
    }
    this.renderCardList();
    await this.loadTagCounts();
  }

  applyTranslations(): void {
    this.renderFrame();
    this.renderCardList();
    if (this.sidebarVisible) this.renderSidebar();
  }

  private async load(): Promise<void> {
    this.entries = await invoke<TagEntry[]>('tag_get_all');
    const validation = await invoke<[string, boolean][]>('tag_validate_paths');
    this.pathStatus.clear();
    for (const [path, exists] of validation) {
      this.pathStatus.set(path, exists);
    }
  }

  // F2: AND search - split query by spaces/commas
  private getFilteredEntries(): TagEntry[] {
    if (!this.searchQuery) return this.entries;
    const keywords = this.searchQuery
      .split(/[\s,]+/)
      .map(k => k.toLowerCase())
      .filter(k => k.length > 0);
    if (keywords.length === 0) return this.entries;
    return this.entries.filter(e =>
      keywords.every(q =>
        e.path.toLowerCase().includes(q) ||
        e.tags.some(tag => tag.toLowerCase().includes(q))
      )
    );
  }

  // B1: Create frame structure once
  private renderFrame(): void {
    this.container.innerHTML = '';
    this.container.style.padding = '0';
    this.container.style.maxWidth = '100%';
    this.container.style.height = '100%';

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'tm-container';

    // F7: Left sidebar
    this.sidebarEl = document.createElement('div');
    this.sidebarEl.className = 'tm-sidebar';
    this.sidebarEl.style.display = this.sidebarVisible ? 'flex' : 'none';
    this.wrapper.appendChild(this.sidebarEl);

    const mainArea = document.createElement('div');
    mainArea.className = 'tm-main';

    // Search bar
    const searchBar = document.createElement('div');
    searchBar.className = 'tm-search-bar';

    // F7: Hamburger button
    const hamburger = document.createElement('button');
    hamburger.className = 'tm-hamburger';
    hamburger.innerHTML = '&#9776;';
    hamburger.title = t('ui.tm_all_tags');
    hamburger.addEventListener('click', () => this.toggleSidebar());
    searchBar.appendChild(hamburger);

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = t('ui.tm_search_placeholder');
    this.searchInput.className = 'tm-search';
    this.searchInput.value = this.searchQuery;
    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput!.value;
      this.renderCardList();
    });
    searchBar.appendChild(this.searchInput);

    this.searchCountEl = document.createElement('span');
    this.searchCountEl.className = 'tm-search-count';
    searchBar.appendChild(this.searchCountEl);

    // F4: Select all checkbox
    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'tm-select-all-label';
    this.selectAllCheckbox = document.createElement('input');
    this.selectAllCheckbox.type = 'checkbox';
    this.selectAllCheckbox.className = 'tm-select-all';
    this.selectAllCheckbox.addEventListener('change', () => {
      const filtered = this.getFilteredEntries();
      if (this.selectAllCheckbox!.checked) {
        filtered.forEach(e => this.selectedPaths.add(e.path));
      } else {
        this.selectedPaths.clear();
      }
      this.renderCardList();
      this.updateBatchBar();
    });
    selectAllLabel.appendChild(this.selectAllCheckbox);
    const selectAllText = document.createElement('span');
    selectAllText.className = 'tm-select-all-text';
    selectAllText.textContent = t('ui.tm_select_all');
    selectAllLabel.appendChild(selectAllText);
    searchBar.appendChild(selectAllLabel);

    mainArea.appendChild(searchBar);

    // Card list
    this.cardListEl = document.createElement('div');
    this.cardListEl.className = 'tm-card-list';
    mainArea.appendChild(this.cardListEl);

    // Empty state
    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'tm-empty';
    this.emptyEl.style.display = 'none';
    mainArea.appendChild(this.emptyEl);

    // F4: Batch action bar
    this.batchBarEl = document.createElement('div');
    this.batchBarEl.className = 'tm-batch-bar';
    this.batchBarEl.style.display = 'none';
    mainArea.appendChild(this.batchBarEl);

    this.wrapper.appendChild(mainArea);
    this.container.appendChild(this.wrapper);
  }

  // B1: Update only the card list (preserves search input focus)
  private renderCardList(): void {
    if (!this.cardListEl || !this.searchCountEl || !this.emptyEl) return;

    const filtered = this.getFilteredEntries();
    this.searchCountEl.textContent = t('ui.tm_count').replace('{count}', String(filtered.length));

    if (this.selectAllCheckbox) {
      const allSelected = filtered.length > 0 && filtered.every(e => this.selectedPaths.has(e.path));
      this.selectAllCheckbox.checked = allSelected;
    }

    if (filtered.length === 0) {
      this.cardListEl.style.display = 'none';
      this.emptyEl.style.display = 'flex';
      this.emptyEl.textContent = this.searchQuery ? t('ui.tm_no_results') : t('ui.tm_no_files');
      return;
    }

    this.cardListEl.style.display = 'flex';
    this.emptyEl.style.display = 'none';
    this.cardListEl.innerHTML = '';

    for (const entry of filtered) {
      const exists = this.pathStatus.get(entry.path) ?? true;
      const row = document.createElement('div');
      row.className = 'tm-row' + (exists ? '' : ' tm-invalid');

      // F4: Checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'tm-checkbox';
      checkbox.checked = this.selectedPaths.has(entry.path);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedPaths.add(entry.path);
        } else {
          this.selectedPaths.delete(entry.path);
        }
        this.updateBatchBar();
        if (this.selectAllCheckbox) {
          const allFiltered = this.getFilteredEntries();
          this.selectAllCheckbox.checked = allFiltered.length > 0 &&
            allFiltered.every(e => this.selectedPaths.has(e.path));
        }
      });
      row.appendChild(checkbox);

      const body = document.createElement('div');
      body.className = 'tm-body';

      // U3: Filename display
      const filename = entry.path.split(/[/\\]/).pop() || entry.path;
      const filenameEl = document.createElement('div');
      filenameEl.className = 'tm-filename';
      if (!exists) {
        const warn = document.createElement('span');
        warn.className = 'tm-warn';
        warn.textContent = '!';
        warn.title = t('ui.tm_file_not_found');
        filenameEl.appendChild(warn);
      }
      const filenameText = document.createElement('span');
      filenameText.textContent = filename;
      filenameEl.appendChild(filenameText);
      body.appendChild(filenameEl);

      // Path (secondary info)
      const pathRow = document.createElement('div');
      pathRow.className = 'tm-path-row';
      const pathEl = document.createElement('span');
      pathEl.className = 'tm-path';
      pathEl.textContent = entry.path;
      pathEl.title = entry.path;
      pathRow.appendChild(pathEl);
      body.appendChild(pathRow);

      // Tags row with inline CRUD (F3)
      const tagsRow = document.createElement('div');
      tagsRow.className = 'tm-tags';
      for (const tag of entry.tags) {
        const chip = document.createElement('span');
        chip.className = 'tm-tag-chip';

        // F1: Clickable label to add to search
        const chipLabel = document.createElement('span');
        chipLabel.className = 'tm-tag-chip-label';
        chipLabel.textContent = tag;
        chipLabel.addEventListener('click', () => this.addToSearch(tag));
        chip.appendChild(chipLabel);

        // F3: Remove button on chip
        const chipRemove = document.createElement('button');
        chipRemove.className = 'tm-tag-chip-remove';
        chipRemove.textContent = '\u00d7';
        chipRemove.title = t('ui.tm_remove_tag');
        chipRemove.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeTagFromEntry(entry.path, tag);
        });
        chip.appendChild(chipRemove);

        tagsRow.appendChild(chip);
      }

      // F3: Inline add tag input
      const addTagInput = document.createElement('input');
      addTagInput.type = 'text';
      addTagInput.className = 'tm-inline-tag-input';
      addTagInput.placeholder = t('ui.tm_add_tag');
      addTagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const val = addTagInput.value.trim();
          if (val) {
            this.addTagToEntry(entry.path, val);
            addTagInput.value = '';
          }
        }
      });
      tagsRow.appendChild(addTagInput);

      body.appendChild(tagsRow);
      row.appendChild(body);

      // Actions
      const actions = document.createElement('div');
      actions.className = 'tm-actions';

      if (!exists) {
        const relinkBtn = document.createElement('button');
        relinkBtn.className = 'tm-btn';
        relinkBtn.textContent = t('ui.tm_relink');
        relinkBtn.addEventListener('click', () => this.relinkEntry(entry.path));
        actions.appendChild(relinkBtn);
      }

      const openBtn = document.createElement('button');
      openBtn.className = 'tm-btn';
      openBtn.textContent = t('ui.tm_open');
      openBtn.addEventListener('click', () => this.openFile(entry.path));
      if (!exists) openBtn.disabled = true;
      actions.appendChild(openBtn);

      // U4: Folder button
      const folderBtn = document.createElement('button');
      folderBtn.className = 'tm-btn';
      folderBtn.textContent = t('ui.tm_folder');
      folderBtn.addEventListener('click', () => this.revealInFolder(entry.path));
      if (!exists) folderBtn.disabled = true;
      actions.appendChild(folderBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'tm-btn tm-btn-danger';
      deleteBtn.textContent = t('ui.tm_delete');
      deleteBtn.addEventListener('click', () => this.deleteEntry(entry.path));
      actions.appendChild(deleteBtn);

      row.appendChild(actions);
      this.cardListEl.appendChild(row);
    }

    this.updateBatchBar();
  }

  // F1: Add tag name to search query
  private addToSearch(tag: string): void {
    if (!this.searchInput) return;
    const current = this.searchInput.value.trim();
    const keywords = current.split(/[\s,]+/).filter(k => k.length > 0);
    if (keywords.some(k => k.toLowerCase() === tag.toLowerCase())) return;
    this.searchInput.value = current ? current + ' ' + tag : tag;
    this.searchQuery = this.searchInput.value;
    this.renderCardList();
  }

  // F4: Update batch action bar
  private updateBatchBar(): void {
    if (!this.batchBarEl) return;
    if (this.selectedPaths.size === 0) {
      this.batchBarEl.style.display = 'none';
      return;
    }
    this.batchBarEl.style.display = 'flex';
    this.batchBarEl.innerHTML = '';

    const countLabel = document.createElement('span');
    countLabel.className = 'tm-batch-count';
    countLabel.textContent = t('ui.tm_selected_count').replace('{count}', String(this.selectedPaths.size));
    this.batchBarEl.appendChild(countLabel);

    const batchInput = document.createElement('input');
    batchInput.type = 'text';
    batchInput.className = 'tm-batch-input';
    batchInput.placeholder = t('ui.tm_batch_placeholder');
    this.batchBarEl.appendChild(batchInput);

    const batchBtn = document.createElement('button');
    batchBtn.className = 'tm-btn tm-batch-btn';
    batchBtn.textContent = t('ui.tm_batch_add_btn');
    batchBtn.addEventListener('click', () => {
      const tag = batchInput.value.trim();
      if (tag) {
        this.batchAddTag(tag);
        batchInput.value = '';
      }
    });
    this.batchBarEl.appendChild(batchBtn);

    batchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const tag = batchInput.value.trim();
        if (tag) {
          this.batchAddTag(tag);
          batchInput.value = '';
        }
      }
    });
  }

  // F7: Render tag sidebar
  private renderSidebar(): void {
    if (!this.sidebarEl) return;
    this.sidebarEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'tm-sidebar-header';

    const title = document.createElement('h3');
    title.textContent = t('ui.tm_all_tags');
    header.appendChild(title);

    const sortBtns = document.createElement('div');
    sortBtns.className = 'tm-sidebar-sort';

    const sortNameBtn = document.createElement('button');
    sortNameBtn.className = 'tm-sidebar-sort-btn' + (this.tagSortBy === 'name' ? ' active' : '');
    sortNameBtn.textContent = t('ui.tm_sort_name');
    sortNameBtn.addEventListener('click', () => {
      this.tagSortBy = 'name';
      this.renderSidebar();
    });
    sortBtns.appendChild(sortNameBtn);

    const sortCountBtn = document.createElement('button');
    sortCountBtn.className = 'tm-sidebar-sort-btn' + (this.tagSortBy === 'count' ? ' active' : '');
    sortCountBtn.textContent = t('ui.tm_sort_count');
    sortCountBtn.addEventListener('click', () => {
      this.tagSortBy = 'count';
      this.renderSidebar();
    });
    sortBtns.appendChild(sortCountBtn);

    header.appendChild(sortBtns);
    this.sidebarEl.appendChild(header);

    const list = document.createElement('div');
    list.className = 'tm-sidebar-list';

    let sorted = [...this.tagCounts];
    if (this.tagSortBy === 'count') {
      sorted.sort((a, b) => b[1] - a[1]);
    } else {
      sorted.sort((a, b) => a[0].localeCompare(b[0]));
    }

    for (const [tagName, count] of sorted) {
      const item = document.createElement('div');
      item.className = 'tm-sidebar-item';

      const tagLabel = document.createElement('span');
      tagLabel.className = 'tm-sidebar-tag-name';
      tagLabel.textContent = tagName;
      tagLabel.addEventListener('click', () => this.addToSearch(tagName));
      item.appendChild(tagLabel);

      const tagCount = document.createElement('span');
      tagCount.className = 'tm-sidebar-tag-count';
      tagCount.textContent = String(count);
      item.appendChild(tagCount);

      const tagActions = document.createElement('div');
      tagActions.className = 'tm-sidebar-tag-actions';

      const renameBtn = document.createElement('button');
      renameBtn.className = 'tm-sidebar-action-btn';
      renameBtn.title = t('ui.tm_rename_tag');
      renameBtn.textContent = '\u270f';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renameTag(tagName);
      });
      tagActions.appendChild(renameBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'tm-sidebar-action-btn tm-sidebar-action-danger';
      deleteBtn.title = t('ui.tm_delete');
      deleteBtn.textContent = '\u00d7';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeAllTag(tagName);
      });
      tagActions.appendChild(deleteBtn);

      item.appendChild(tagActions);
      list.appendChild(item);
    }

    this.sidebarEl.appendChild(list);
  }

  // F7: Toggle sidebar visibility
  private toggleSidebar(): void {
    this.sidebarVisible = !this.sidebarVisible;
    if (this.sidebarEl) {
      this.sidebarEl.style.display = this.sidebarVisible ? 'flex' : 'none';
    }
    if (this.sidebarVisible) {
      this.loadTagCounts().then(() => this.renderSidebar());
    }
  }

  private async loadTagCounts(): Promise<void> {
    this.tagCounts = await invoke<[string, number][]>('tag_get_counts');
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
      this.renderCardList();
    }
  }

  // B3: Fire-and-forget (no await to prevent freeze)
  private openFile(path: string): void {
    invoke('open_new_window', { file: path });
  }

  private async deleteEntry(path: string): Promise<void> {
    await invoke('tag_delete_entry', { path });
    this.selectedPaths.delete(path);
    await this.load();
    this.renderCardList();
    await this.loadTagCounts();
    if (this.sidebarVisible) this.renderSidebar();
  }

  // U4: Reveal file in system file manager
  private async revealInFolder(path: string): Promise<void> {
    try {
      await revealItemInDir(path);
    } catch (e) {
      console.error('Failed to reveal in folder:', e);
    }
  }

  // F3: Remove tag from a specific entry
  private async removeTagFromEntry(path: string, tag: string): Promise<void> {
    await invoke('tag_remove', { path, tag });
    await this.load();
    this.renderCardList();
    await this.loadTagCounts();
    if (this.sidebarVisible) this.renderSidebar();
  }

  // F3: Add tag to a specific entry
  private async addTagToEntry(path: string, tag: string): Promise<void> {
    await invoke('tag_add', { path, tag });
    await this.load();
    this.renderCardList();
    await this.loadTagCounts();
    if (this.sidebarVisible) this.renderSidebar();
  }

  // F4: Batch add tag to selected entries
  private async batchAddTag(tag: string): Promise<void> {
    const paths = Array.from(this.selectedPaths);
    await invoke('tag_batch_add', { paths, tag });
    this.selectedPaths.clear();
    await this.load();
    this.renderCardList();
    await this.loadTagCounts();
    if (this.sidebarVisible) this.renderSidebar();
  }

  // F5: Rename tag across all entries
  private async renameTag(oldName: string): Promise<void> {
    const newName = prompt(t('ui.tm_rename_tag_prompt'), oldName);
    if (!newName || newName === oldName) return;
    await invoke('tag_rename_all', { oldName, newName });
    await this.load();
    this.renderCardList();
    await this.loadTagCounts();
    if (this.sidebarVisible) this.renderSidebar();
  }

  // F5: Remove tag from all entries
  private async removeAllTag(tagName: string): Promise<void> {
    const msg = t('ui.tm_delete_tag_confirm').replace('{tag}', tagName);
    if (!confirm(msg)) return;
    await invoke('tag_remove_all', { tagName });
    await this.load();
    this.renderCardList();
    await this.loadTagCounts();
    if (this.sidebarVisible) this.renderSidebar();
  }
}
