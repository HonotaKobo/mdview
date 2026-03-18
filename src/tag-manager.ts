import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { t } from './i18n';

interface TagEntry {
  path: string;
  tags: string[];
  memo?: string;
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

  // 永続的な DOM 参照 (B1: 検索入力の再生成を避ける)
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

  // F2: AND 検索 - クエリをスペース/カンマで分割する
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
        e.tags.some(tag => tag.toLowerCase().includes(q)) ||
        (e.memo && e.memo.toLowerCase().includes(q))
      )
    );
  }

  // B1: フレーム構造を一度だけ作成する
  private renderFrame(): void {
    this.container.innerHTML = '';
    this.container.style.padding = '0';
    this.container.style.maxWidth = '100%';
    this.container.style.height = '100%';

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'flex flex-row h-full';

    // F7: 左サイドバー
    this.sidebarEl = document.createElement('div');
    this.sidebarEl.className = 'w-[220px] shrink-0 flex flex-col border-r border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden';
    this.sidebarEl.style.display = this.sidebarVisible ? 'flex' : 'none';
    this.wrapper.appendChild(this.sidebarEl);

    const mainArea = document.createElement('div');
    mainArea.className = 'flex flex-col flex-1 min-w-0';

    // 検索バー
    const searchBar = document.createElement('div');
    searchBar.className = 'flex items-center px-4 py-2 gap-2 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] shrink-0';

    // F7: ハンバーガーボタン
    const hamburger = document.createElement('button');
    hamburger.className = 'bg-transparent border border-[var(--border-color)] rounded text-[var(--text-primary)] cursor-pointer text-base px-2 py-0.5 leading-none shrink-0 transition-[background] duration-150 hover:bg-[rgba(128,128,128,0.15)]';
    hamburger.innerHTML = '&#9776;';
    hamburger.title = t('ui.tm_all_tags');
    hamburger.addEventListener('click', () => this.toggleSidebar());
    searchBar.appendChild(hamburger);

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = t('ui.tm_search_placeholder');
    this.searchInput.className = 'flex-1 max-w-[400px] px-3 py-1.5 border border-[var(--border-color)] rounded-md text-[13px] font-[inherit] bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none transition-[border-color] duration-200 placeholder:text-[var(--text-secondary)] focus:border-[var(--link-color)]';
    this.searchInput.value = this.searchQuery;
    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput!.value;
      this.renderCardList();
    });
    searchBar.appendChild(this.searchInput);

    this.searchCountEl = document.createElement('span');
    this.searchCountEl.className = 'text-[11px] text-[var(--text-secondary)] whitespace-nowrap';
    searchBar.appendChild(this.searchCountEl);

    // F4: 全選択チェックボックス
    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'flex items-center gap-1 text-[11px] text-[var(--text-secondary)] cursor-pointer whitespace-nowrap ml-2';
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
    selectAllText.className = 'select-none';
    selectAllText.textContent = t('ui.tm_select_all');
    selectAllLabel.appendChild(selectAllText);
    searchBar.appendChild(selectAllLabel);

    mainArea.appendChild(searchBar);

    // カードリスト
    this.cardListEl = document.createElement('div');
    this.cardListEl.className = 'tm-card-list flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-1.5';
    mainArea.appendChild(this.cardListEl);

    // 空の状態表示
    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'flex flex-col items-center justify-center flex-1 text-[var(--text-secondary)] gap-2 p-12 text-[13px]';
    this.emptyEl.style.display = 'none';
    mainArea.appendChild(this.emptyEl);

    // F4: 一括操作バー
    this.batchBarEl = document.createElement('div');
    this.batchBarEl.className = 'flex items-center gap-2 px-4 py-2 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] shrink-0';
    this.batchBarEl.style.display = 'none';
    mainArea.appendChild(this.batchBarEl);

    this.wrapper.appendChild(mainArea);
    this.container.appendChild(this.wrapper);
  }

  // B1: カードリストのみ更新する（検索入力のフォーカスを維持する）
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
      row.className = 'flex items-center gap-3 px-3.5 py-2.5 border rounded-md bg-[var(--bg-primary)] transition-[border-color] duration-200 hover:border-[var(--link-color)]' + (exists ? ' border-[var(--border-color)]' : ' border-[var(--danger-color)]');

      // F4: チェックボックス
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'shrink-0 cursor-pointer tm-checkbox';
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
      body.className = 'flex-1 min-w-0';

      // U3: ファイル名の表示
      const filename = entry.path.split(/[/\\]/).pop() || entry.path;
      const filenameEl = document.createElement('div');
      filenameEl.className = 'flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-primary)]';
      if (!exists) {
        const warn = document.createElement('span');
        warn.className = 'inline-flex items-center justify-center w-[18px] h-[18px] bg-[var(--danger-color)] text-white rounded-full text-[11px] font-bold shrink-0';
        warn.textContent = '!';
        warn.title = t('ui.tm_file_not_found');
        filenameEl.appendChild(warn);
      }
      const filenameText = document.createElement('span');
      filenameText.textContent = filename;
      filenameEl.appendChild(filenameText);
      body.appendChild(filenameEl);

      // パス（補足情報）
      const pathRow = document.createElement('div');
      pathRow.className = 'flex items-center gap-1.5';
      const pathEl = document.createElement('span');
      pathEl.className = 'text-xs text-[var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap font-[var(--font-mono)]';
      pathEl.textContent = entry.path;
      pathEl.title = entry.path;
      pathRow.appendChild(pathEl);
      body.appendChild(pathRow);

      // メモ行
      const memoRow = document.createElement('div');
      memoRow.className = 'flex items-center mt-0.5 min-h-5';

      const memoDisplay = document.createElement('span');
      memoDisplay.className = 'text-xs text-[var(--text-secondary)] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap max-w-full py-px hover:text-[var(--text-primary)]';
      memoDisplay.textContent = entry.memo || t('ui.tm_memo_placeholder');
      memoDisplay.title = entry.memo || '';
      if (!entry.memo) {
        memoDisplay.classList.add('tm-memo-placeholder');
      }

      const memoInput = document.createElement('input');
      memoInput.type = 'text';
      memoInput.className = 'w-full px-1.5 py-0.5 border border-[var(--border-color)] rounded text-xs font-[inherit] bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:border-[var(--link-color)]';
      memoInput.value = entry.memo || '';
      memoInput.maxLength = 100;
      memoInput.placeholder = t('ui.tm_memo_placeholder');
      memoInput.style.display = 'none';

      memoDisplay.addEventListener('click', () => {
        memoDisplay.style.display = 'none';
        memoInput.style.display = 'block';
        memoInput.focus();
      });

      const saveMemo = async () => {
        const val = memoInput.value.trim();
        const memo = val || null;
        await invoke('tag_set_memo', { path: entry.path, memo });
        entry.memo = val || undefined;
        memoDisplay.textContent = val || t('ui.tm_memo_placeholder');
        memoDisplay.title = val;
        memoDisplay.classList.toggle('tm-memo-placeholder', !val);
        memoInput.style.display = 'none';
        memoDisplay.style.display = '';
      };

      memoInput.addEventListener('blur', saveMemo);
      memoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          memoInput.blur();
        } else if (e.key === 'Escape') {
          memoInput.value = entry.memo || '';
          memoInput.style.display = 'none';
          memoDisplay.style.display = '';
        }
      });

      memoRow.appendChild(memoDisplay);
      memoRow.appendChild(memoInput);
      body.appendChild(memoRow);

      // タグ行（インライン CRUD 付き）(F3)
      const tagsRow = document.createElement('div');
      tagsRow.className = 'flex flex-wrap gap-1 mt-1';
      for (const tag of entry.tags) {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center py-px pl-2 pr-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-full text-[11px] text-[var(--text-secondary)] gap-0.5';

        // F1: クリックで検索に追加するラベル
        const chipLabel = document.createElement('span');
        chipLabel.className = 'cursor-pointer hover:underline hover:text-[var(--link-color)]';
        chipLabel.textContent = tag;
        chipLabel.addEventListener('click', () => this.addToSearch(tag));
        chip.appendChild(chipLabel);

        // F3: チップ上の削除ボタン
        const chipRemove = document.createElement('button');
        chipRemove.className = 'bg-transparent border-none text-[var(--text-secondary)] cursor-pointer text-xs leading-none px-0.5 rounded-full opacity-50 transition-[opacity,color] duration-150 hover:opacity-100 hover:text-[var(--danger-color)]';
        chipRemove.textContent = '\u00d7';
        chipRemove.title = t('ui.tm_remove_tag');
        chipRemove.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeTagFromEntry(entry.path, tag);
        });
        chip.appendChild(chipRemove);

        tagsRow.appendChild(chip);
      }

      // F3: インラインのタグ追加入力
      const addTagInput = document.createElement('input');
      addTagInput.type = 'text';
      addTagInput.className = 'py-px px-1.5 border border-[var(--border-color)] rounded-full text-[11px] font-[inherit] bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none w-20 transition-[border-color] duration-200 placeholder:text-[var(--text-secondary)] focus:border-[var(--link-color)]';
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

      // アクション
      const actions = document.createElement('div');
      actions.className = 'flex gap-1.5 shrink-0';

      if (!exists) {
        const relinkBtn = document.createElement('button');
        relinkBtn.className = 'px-2.5 py-[3px] text-[11px] font-[inherit] border border-[var(--border-color)] rounded bg-transparent text-[var(--text-primary)] cursor-pointer transition-all duration-150 hover:bg-[rgba(128,128,128,0.15)] disabled:opacity-40 disabled:cursor-default';
        relinkBtn.textContent = t('ui.tm_relink');
        relinkBtn.addEventListener('click', () => this.relinkEntry(entry.path));
        actions.appendChild(relinkBtn);
      }

      const openBtn = document.createElement('button');
      openBtn.className = 'px-2.5 py-[3px] text-[11px] font-[inherit] border border-[var(--border-color)] rounded bg-transparent text-[var(--text-primary)] cursor-pointer transition-all duration-150 hover:bg-[rgba(128,128,128,0.15)] disabled:opacity-40 disabled:cursor-default';
      openBtn.textContent = t('ui.tm_open');
      openBtn.addEventListener('click', () => this.openFile(entry.path));
      if (!exists) openBtn.disabled = true;
      actions.appendChild(openBtn);

      // U4: フォルダボタン
      const folderBtn = document.createElement('button');
      folderBtn.className = 'px-2.5 py-[3px] text-[11px] font-[inherit] border border-[var(--border-color)] rounded bg-transparent text-[var(--text-primary)] cursor-pointer transition-all duration-150 hover:bg-[rgba(128,128,128,0.15)] disabled:opacity-40 disabled:cursor-default';
      folderBtn.textContent = t('ui.tm_folder');
      folderBtn.addEventListener('click', () => this.revealInFolder(entry.path));
      if (!exists) folderBtn.disabled = true;
      actions.appendChild(folderBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'px-2.5 py-[3px] text-[11px] font-[inherit] border border-[var(--danger-color)] rounded bg-transparent text-[var(--danger-color)] cursor-pointer transition-all duration-150 disabled:opacity-40 disabled:cursor-default tm-btn-danger';
      deleteBtn.textContent = t('ui.tm_delete');
      deleteBtn.addEventListener('click', () => this.deleteEntry(entry.path));
      actions.appendChild(deleteBtn);

      row.appendChild(actions);
      this.cardListEl.appendChild(row);
    }

    this.updateBatchBar();
  }

  // F1: タグ名を検索クエリに追加する
  private addToSearch(tag: string): void {
    if (!this.searchInput) return;
    const current = this.searchInput.value.trim();
    const keywords = current.split(/[\s,]+/).filter(k => k.length > 0);
    if (keywords.some(k => k.toLowerCase() === tag.toLowerCase())) return;
    this.searchInput.value = current ? current + ' ' + tag : tag;
    this.searchQuery = this.searchInput.value;
    this.renderCardList();
  }

  // F4: 一括操作バーを更新する
  private updateBatchBar(): void {
    if (!this.batchBarEl) return;
    if (this.selectedPaths.size === 0) {
      this.batchBarEl.style.display = 'none';
      return;
    }
    this.batchBarEl.style.display = 'flex';
    this.batchBarEl.innerHTML = '';

    const countLabel = document.createElement('span');
    countLabel.className = 'text-xs text-[var(--text-secondary)] whitespace-nowrap';
    countLabel.textContent = t('ui.tm_selected_count').replace('{count}', String(this.selectedPaths.size));
    this.batchBarEl.appendChild(countLabel);

    const batchInput = document.createElement('input');
    batchInput.type = 'text';
    batchInput.className = 'flex-1 max-w-[200px] px-2.5 py-1 border border-[var(--border-color)] rounded text-xs font-[inherit] bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:border-[var(--link-color)]';
    batchInput.placeholder = t('ui.tm_batch_placeholder');
    this.batchBarEl.appendChild(batchInput);

    const batchBtn = document.createElement('button');
    batchBtn.className = 'px-2.5 py-[3px] text-[11px] font-[inherit] border border-[var(--border-color)] rounded bg-transparent text-[var(--text-primary)] cursor-pointer transition-all duration-150 hover:bg-[rgba(128,128,128,0.15)] disabled:opacity-40 disabled:cursor-default whitespace-nowrap';
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

  // F7: タグサイドバーを描画する
  private renderSidebar(): void {
    if (!this.sidebarEl) return;
    this.sidebarEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'px-3.5 py-3 border-b border-[var(--border-color)] shrink-0';

    const title = document.createElement('h3');
    title.className = 'text-xs font-semibold text-[var(--text-primary)] m-0 mb-2';
    title.textContent = t('ui.tm_all_tags');
    header.appendChild(title);

    const sortBtns = document.createElement('div');
    sortBtns.className = 'flex gap-1';

    const sortNameBtn = document.createElement('button');
    sortNameBtn.className = 'tm-sidebar-sort-btn px-2 py-0.5 text-[10px] font-[inherit] border border-[var(--border-color)] rounded-[3px] bg-transparent text-[var(--text-secondary)] cursor-pointer transition-all duration-150 hover:bg-[rgba(128,128,128,0.15)]' + (this.tagSortBy === 'name' ? ' active' : '');
    sortNameBtn.textContent = t('ui.tm_sort_name');
    sortNameBtn.addEventListener('click', () => {
      this.tagSortBy = 'name';
      this.renderSidebar();
    });
    sortBtns.appendChild(sortNameBtn);

    const sortCountBtn = document.createElement('button');
    sortCountBtn.className = 'tm-sidebar-sort-btn px-2 py-0.5 text-[10px] font-[inherit] border border-[var(--border-color)] rounded-[3px] bg-transparent text-[var(--text-secondary)] cursor-pointer transition-all duration-150 hover:bg-[rgba(128,128,128,0.15)]' + (this.tagSortBy === 'count' ? ' active' : '');
    sortCountBtn.textContent = t('ui.tm_sort_count');
    sortCountBtn.addEventListener('click', () => {
      this.tagSortBy = 'count';
      this.renderSidebar();
    });
    sortBtns.appendChild(sortCountBtn);

    header.appendChild(sortBtns);
    this.sidebarEl.appendChild(header);

    const list = document.createElement('div');
    list.className = 'flex-1 overflow-y-auto py-1';

    let sorted = [...this.tagCounts];
    if (this.tagSortBy === 'count') {
      sorted.sort((a, b) => b[1] - a[1]);
    } else {
      sorted.sort((a, b) => a[0].localeCompare(b[0]));
    }

    for (const [tagName, count] of sorted) {
      const item = document.createElement('div');
      item.className = 'group flex items-center gap-1.5 px-3.5 py-[5px] transition-[background] duration-100 hover:bg-[rgba(128,128,128,0.1)]';

      const tagLabel = document.createElement('span');
      tagLabel.className = 'flex-1 text-xs text-[var(--text-primary)] cursor-pointer min-w-0 overflow-hidden text-ellipsis whitespace-nowrap hover:text-[var(--link-color)] hover:underline';
      tagLabel.textContent = tagName;
      tagLabel.addEventListener('click', () => this.addToSearch(tagName));
      item.appendChild(tagLabel);

      const tagCount = document.createElement('span');
      tagCount.className = 'text-[10px] text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-[10px] px-1.5 shrink-0';
      tagCount.textContent = String(count);
      item.appendChild(tagCount);

      const tagActions = document.createElement('div');
      tagActions.className = 'flex gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100';

      const renameBtn = document.createElement('button');
      renameBtn.className = 'bg-transparent border-none text-[var(--text-secondary)] cursor-pointer text-xs px-1 py-px rounded-[3px] leading-none transition-[color,background] duration-150 hover:bg-[rgba(128,128,128,0.15)] hover:text-[var(--text-primary)]';
      renameBtn.title = t('ui.tm_rename_tag');
      renameBtn.textContent = '\u270f';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renameTag(tagName);
      });
      tagActions.appendChild(renameBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'bg-transparent border-none text-[var(--text-secondary)] cursor-pointer text-xs px-1 py-px rounded-[3px] leading-none transition-[color,background] duration-150 hover:bg-[rgba(128,128,128,0.15)] hover:text-[var(--danger-color)]';
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

  // F7: サイドバーの表示/非表示を切り替える
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

  // B3: 発行して忘れる方式（フリーズ防止のため await しない）
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

  // U4: システムのファイルマネージャーでファイルを表示する
  private async revealInFolder(path: string): Promise<void> {
    try {
      await revealItemInDir(path);
    } catch (e) {
      console.error('Failed to reveal in folder:', e);
    }
  }

  // F3: 特定のエントリからタグを削除する
  private async removeTagFromEntry(path: string, tag: string): Promise<void> {
    await invoke('tag_remove', { path, tag });
    await this.load();
    this.renderCardList();
    await this.loadTagCounts();
    if (this.sidebarVisible) this.renderSidebar();
  }

  // F3: 特定のエントリにタグを追加する
  private async addTagToEntry(path: string, tag: string): Promise<void> {
    await invoke('tag_add', { path, tag });
    await this.load();
    this.renderCardList();
    await this.loadTagCounts();
    if (this.sidebarVisible) this.renderSidebar();
  }

  // F4: 選択されたエントリにタグを一括追加する
  private async batchAddTag(tag: string): Promise<void> {
    const paths = Array.from(this.selectedPaths);
    await invoke('tag_batch_add', { paths, tag });
    this.selectedPaths.clear();
    await this.load();
    this.renderCardList();
    await this.loadTagCounts();
    if (this.sidebarVisible) this.renderSidebar();
  }

  // F5: 全エントリのタグ名を変更する
  private async renameTag(oldName: string): Promise<void> {
    const newName = prompt(t('ui.tm_rename_tag_prompt'), oldName);
    if (!newName || newName === oldName) return;
    await invoke('tag_rename_all', { oldName, newName });
    await this.load();
    this.renderCardList();
    await this.loadTagCounts();
    if (this.sidebarVisible) this.renderSidebar();
  }

  // F5: 全エントリからタグを削除する
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
