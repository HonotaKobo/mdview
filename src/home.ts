import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { t } from './i18n';

interface RecentEntry {
  path: string;
  title: string;
  last_opened: number;
}

interface TagEntry {
  path: string;
  tags: string[];
}

// SVG icons as template strings
const ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
const ICON_TAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
const ICON_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const ICON_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';

export class HomeScreen {
  private activeTab: 'home' | 'tags' = 'home';

  // Data
  private recentEntries: RecentEntry[] = [];
  private tagEntries: TagEntry[] = [];
  private tagCounts: [string, number][] = [];
  private pathStatus: Map<string, boolean> = new Map();
  private tagSearchQuery = '';
  private activeChips: Set<string> = new Set();

  // DOM refs
  private homeTabBtn!: HTMLButtonElement;
  private tagsTabBtn!: HTMLButtonElement;
  private contentArea!: HTMLElement;
  private statusBar!: HTMLElement;

  async init(): Promise<void> {
    // Hide editor elements
    document.getElementById('find-bar')!.style.display = 'none';
    document.getElementById('main-area')!.style.display = 'none';
    document.getElementById('status-bar')!.style.display = 'none';

    this.buildLayout();
    await this.loadData();
    this.renderActiveTab();
  }

  switchToTagsTab(): void {
    this.activeTab = 'tags';
    this.homeTabBtn.classList.remove('active');
    this.tagsTabBtn.classList.add('active');
    this.renderActiveTab();
  }

  applyTranslations(): void {
    // Rebuild nav labels
    this.homeTabBtn.querySelector('span')!.textContent = t('ui.home_tab');
    this.tagsTabBtn.querySelector('span')!.textContent = t('ui.home_tags_tab');
    this.renderActiveTab();
  }

  private buildLayout(): void {
    // Create home screen container
    const screen = document.createElement('div');
    screen.id = 'home-screen';

    // Sidebar nav
    const sidebar = document.createElement('div');
    sidebar.id = 'home-sidebar-nav';

    this.homeTabBtn = this.createNavItem(t('ui.home_tab'), ICON_HOME, () => {
      this.activeTab = 'home';
      this.homeTabBtn.classList.add('active');
      this.tagsTabBtn.classList.remove('active');
      this.renderActiveTab();
    });
    this.homeTabBtn.classList.add('active');
    sidebar.appendChild(this.homeTabBtn);

    this.tagsTabBtn = this.createNavItem(t('ui.home_tags_tab'), ICON_TAG, () => {
      this.activeTab = 'tags';
      this.tagsTabBtn.classList.add('active');
      this.homeTabBtn.classList.remove('active');
      this.renderActiveTab();
    });
    sidebar.appendChild(this.tagsTabBtn);

    screen.appendChild(sidebar);

    // Content area
    this.contentArea = document.createElement('div');
    this.contentArea.id = 'home-content-area';
    screen.appendChild(this.contentArea);

    // Insert before status bar
    const statusBar = document.getElementById('status-bar')!;
    document.body.insertBefore(screen, statusBar);

    // Create home status bar
    this.statusBar = document.createElement('div');
    this.statusBar.id = 'home-status-bar';
    document.body.insertBefore(this.statusBar, statusBar);
  }

  private createNavItem(label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'home-nav-item';
    btn.innerHTML = icon;
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener('click', onClick);
    return btn;
  }

  private async loadData(): Promise<void> {
    this.recentEntries = await invoke<RecentEntry[]>('recent_get_all');
    this.tagEntries = await invoke<TagEntry[]>('tag_get_all');
    this.tagCounts = await invoke<[string, number][]>('tag_get_counts');
    const validation = await invoke<[string, boolean][]>('tag_validate_paths');
    this.pathStatus.clear();
    for (const [path, exists] of validation) {
      this.pathStatus.set(path, exists);
    }
  }

  private renderActiveTab(): void {
    if (this.activeTab === 'home') {
      this.renderHomeTab();
    } else {
      this.renderTagsTab();
    }
    this.updateStatusBar();
  }

  // ===== Home Tab =====

  private renderHomeTab(): void {
    this.contentArea.innerHTML = '';

    // Panel header
    const header = document.createElement('div');
    header.className = 'home-panel-header';
    const title = document.createElement('span');
    title.className = 'home-panel-title';
    title.textContent = t('ui.home_tab');
    header.appendChild(title);
    this.contentArea.appendChild(header);

    // Scrollable content
    const scrollArea = document.createElement('div');
    scrollArea.className = 'home-tab-content';

    const inner = document.createElement('div');
    inner.className = 'home-inner';

    // Greeting
    const greeting = document.createElement('div');
    greeting.className = 'home-greeting';
    const h1 = document.createElement('h1');
    h1.textContent = t('ui.home_greeting');
    const p = document.createElement('p');
    p.textContent = t('ui.home_greeting_sub');
    greeting.appendChild(h1);
    greeting.appendChild(p);
    inner.appendChild(greeting);

    // Action cards
    const cards = document.createElement('div');
    cards.className = 'home-action-cards';

    cards.appendChild(this.createActionCard(
      ICON_PLUS,
      t('ui.home_new_file'),
      t('ui.home_new_file_desc'),
      () => this.newFile(),
    ));

    cards.appendChild(this.createActionCard(
      ICON_FOLDER,
      t('ui.home_open_file'),
      t('ui.home_open_file_desc'),
      () => this.openFile(),
    ));

    inner.appendChild(cards);

    // Recent files section
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'home-section-header';
    const h2 = document.createElement('h2');
    h2.textContent = t('ui.home_recent_files');
    sectionHeader.appendChild(h2);
    const line = document.createElement('div');
    line.className = 'home-section-line';
    sectionHeader.appendChild(line);
    inner.appendChild(sectionHeader);

    if (this.recentEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'home-no-recent';
      empty.textContent = t('ui.home_no_recent');
      inner.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'home-recent-list';

      // Build a tag lookup from tagEntries
      const tagMap = new Map<string, string[]>();
      for (const entry of this.tagEntries) {
        tagMap.set(entry.path, entry.tags);
      }

      for (const entry of this.recentEntries) {
        const item = document.createElement('div');
        item.className = 'home-recent-item';

        // File icon
        const icon = document.createElement('div');
        icon.className = 'home-recent-icon';
        icon.innerHTML = ICON_FILE;
        item.appendChild(icon);

        // Info
        const info = document.createElement('div');
        info.className = 'home-recent-info';
        const name = document.createElement('div');
        name.className = 'home-recent-name';
        name.textContent = entry.title;
        info.appendChild(name);
        const pathEl = document.createElement('div');
        pathEl.className = 'home-recent-path';
        pathEl.textContent = this.shortenPath(entry.path);
        pathEl.title = entry.path;
        info.appendChild(pathEl);
        item.appendChild(info);

        // Tags
        const tags = tagMap.get(entry.path);
        if (tags && tags.length > 0) {
          const tagsEl = document.createElement('div');
          tagsEl.className = 'home-recent-tags';
          for (const tag of tags.slice(0, 3)) {
            const badge = document.createElement('span');
            badge.className = 'home-tag-badge';
            badge.textContent = tag;
            tagsEl.appendChild(badge);
          }
          item.appendChild(tagsEl);
        }

        // Date
        const dateEl = document.createElement('div');
        dateEl.className = 'home-recent-date';
        dateEl.textContent = this.relativeTime(entry.last_opened);
        item.appendChild(dateEl);

        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'home-recent-remove';
        removeBtn.textContent = '\u00d7';
        removeBtn.title = t('ui.home_remove_recent');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeRecent(entry.path);
        });
        item.appendChild(removeBtn);

        // Click to open
        item.addEventListener('click', () => this.openRecentFile(entry.path));

        list.appendChild(item);
      }
      inner.appendChild(list);
    }

    scrollArea.appendChild(inner);
    this.contentArea.appendChild(scrollArea);
  }

  private createActionCard(icon: string, title: string, desc: string, onClick: () => void): HTMLElement {
    const card = document.createElement('div');
    card.className = 'home-action-card';

    const iconEl = document.createElement('div');
    iconEl.className = 'home-action-icon';
    iconEl.innerHTML = icon;
    card.appendChild(iconEl);

    const text = document.createElement('div');
    text.className = 'home-action-text';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    text.appendChild(h3);
    const p = document.createElement('p');
    p.textContent = desc;
    text.appendChild(p);
    card.appendChild(text);

    card.addEventListener('click', onClick);
    return card;
  }

  // ===== Tags Tab =====

  private renderTagsTab(): void {
    this.contentArea.innerHTML = '';

    // Panel header with search
    const header = document.createElement('div');
    header.className = 'home-panel-header';
    const title = document.createElement('span');
    title.className = 'home-panel-title';
    title.textContent = t('ui.home_tags_tab');
    header.appendChild(title);

    const spacer = document.createElement('div');
    spacer.className = 'home-panel-spacer';
    header.appendChild(spacer);

    const searchBox = document.createElement('div');
    searchBox.className = 'home-search-box';
    searchBox.innerHTML = ICON_SEARCH;
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = t('ui.tm_search_placeholder');
    searchInput.value = this.tagSearchQuery;
    searchInput.addEventListener('input', () => {
      this.tagSearchQuery = searchInput.value;
      this.renderTagTable();
    });
    searchBox.appendChild(searchInput);
    header.appendChild(searchBox);
    this.contentArea.appendChild(header);

    // Tag filter chips
    const toolbar = document.createElement('div');
    toolbar.className = 'home-tag-toolbar';
    const chips = document.createElement('div');
    chips.className = 'home-tag-chips';

    // "All" chip
    const allChip = document.createElement('button');
    allChip.className = 'home-tag-chip' + (this.activeChips.size === 0 ? ' active' : '');
    allChip.textContent = t('ui.tm_select_all').replace('選択', '');
    // Use a simpler label
    allChip.textContent = this.activeChips.size === 0 ? '\u2713 ' + t('ui.tm_all_tags') : t('ui.tm_all_tags');
    allChip.addEventListener('click', () => {
      this.activeChips.clear();
      this.renderTagsTab();
    });
    chips.appendChild(allChip);

    // Tag chips sorted by count
    const sorted = [...this.tagCounts].sort((a, b) => b[1] - a[1]);
    for (const [tagName] of sorted) {
      const chip = document.createElement('button');
      chip.className = 'home-tag-chip' + (this.activeChips.has(tagName) ? ' active' : '');
      chip.textContent = tagName;
      chip.addEventListener('click', () => {
        if (this.activeChips.has(tagName)) {
          this.activeChips.delete(tagName);
        } else {
          this.activeChips.add(tagName);
        }
        this.renderTagsTab();
      });
      chips.appendChild(chip);
    }
    toolbar.appendChild(chips);
    this.contentArea.appendChild(toolbar);

    // Table wrapper
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'home-tag-table-wrapper';
    tableWrapper.id = 'home-tag-table-wrapper';
    this.contentArea.appendChild(tableWrapper);

    this.renderTagTable();
  }

  private renderTagTable(): void {
    const wrapper = document.getElementById('home-tag-table-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    const filtered = this.getFilteredTagEntries();

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'home-tag-empty';
      empty.textContent = this.tagSearchQuery || this.activeChips.size > 0
        ? t('ui.tm_no_results')
        : t('ui.tm_no_files');
      wrapper.appendChild(empty);
      this.updateStatusBar();
      return;
    }

    const table = document.createElement('table');
    table.className = 'home-tag-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headerTexts = [
      { key: 'filename', width: '22%' },
      { key: 'path', width: '30%' },
      { key: 'tags', width: '28%' },
      { key: 'actions', width: '20%', align: 'right' },
    ];
    for (const h of headerTexts) {
      const th = document.createElement('th');
      th.style.width = h.width;
      if (h.align) th.style.textAlign = h.align;
      // Header labels
      if (h.key === 'filename') th.textContent = 'File';
      else if (h.key === 'path') th.textContent = 'Path';
      else if (h.key === 'tags') th.textContent = t('ui.home_tags_tab');
      else th.textContent = '';
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    for (const entry of filtered) {
      const exists = this.pathStatus.get(entry.path) ?? true;
      const tr = document.createElement('tr');
      if (!exists) tr.style.opacity = '0.5';

      // Filename
      const tdName = document.createElement('td');
      tdName.className = 'cell-filename';
      const filename = entry.path.split(/[/\\]/).pop() || entry.path;
      if (!exists) {
        tdName.textContent = '⚠ ' + filename;
      } else {
        tdName.textContent = filename;
      }
      tr.appendChild(tdName);

      // Path
      const tdPath = document.createElement('td');
      tdPath.className = 'cell-path';
      tdPath.textContent = this.shortenPath(entry.path);
      tdPath.title = entry.path;
      tr.appendChild(tdPath);

      // Tags
      const tdTags = document.createElement('td');
      const tagsDiv = document.createElement('div');
      tagsDiv.className = 'cell-tags';
      for (const tag of entry.tags) {
        const badge = document.createElement('span');
        badge.className = 'home-tag-badge';
        badge.textContent = tag;
        tagsDiv.appendChild(badge);
      }
      tdTags.appendChild(tagsDiv);
      tr.appendChild(tdTags);

      // Actions
      const tdActions = document.createElement('td');
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'cell-actions';

      // Open button
      const openBtn = this.createIconButton(ICON_OPEN, t('ui.tm_open'), () => {
        this.openFileFromTags(entry.path);
      });
      if (!exists) openBtn.disabled = true;
      actionsDiv.appendChild(openBtn);

      // Folder button
      const folderBtn = this.createIconButton(ICON_FOLDER, t('ui.tm_folder'), () => {
        revealItemInDir(entry.path).catch(() => {});
      });
      if (!exists) folderBtn.disabled = true;
      actionsDiv.appendChild(folderBtn);

      // Delete button
      const deleteBtn = this.createIconButton(ICON_TRASH, t('ui.tm_delete'), async () => {
        await invoke('tag_delete_entry', { path: entry.path });
        await this.loadData();
        this.renderTagsTab();
      });
      deleteBtn.classList.add('danger');
      actionsDiv.appendChild(deleteBtn);

      tdActions.appendChild(actionsDiv);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);

    this.updateStatusBar();
  }

  private createIconButton(icon: string, titleText: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'home-btn-icon';
    btn.innerHTML = icon;
    btn.title = titleText;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private getFilteredTagEntries(): TagEntry[] {
    let entries = this.tagEntries;

    // Filter by active chips
    if (this.activeChips.size > 0) {
      entries = entries.filter(e =>
        e.tags.some(tag => this.activeChips.has(tag))
      );
    }

    // Filter by search query
    if (this.tagSearchQuery) {
      const q = this.tagSearchQuery.toLowerCase();
      const keywords = q.split(/[\s,]+/).filter(k => k.length > 0);
      if (keywords.length > 0) {
        entries = entries.filter(e =>
          keywords.every(k =>
            e.path.toLowerCase().includes(k) ||
            e.tags.some(tag => tag.toLowerCase().includes(k))
          )
        );
      }
    }

    return entries;
  }

  // ===== Status Bar =====

  private updateStatusBar(): void {
    if (this.activeTab === 'home') {
      this.statusBar.innerHTML = '';
      const fileCount = document.createElement('span');
      fileCount.textContent = t('ui.tm_count').replace('{count}', String(this.recentEntries.length));
      this.statusBar.appendChild(fileCount);
    } else {
      this.statusBar.innerHTML = '';
      const filtered = this.getFilteredTagEntries();
      const fileCount = document.createElement('span');
      fileCount.textContent = t('ui.tm_count').replace('{count}', String(filtered.length));
      this.statusBar.appendChild(fileCount);

      const spacer = document.createElement('div');
      spacer.className = 'status-spacer';
      this.statusBar.appendChild(spacer);

      const tagCount = document.createElement('span');
      tagCount.textContent = t('ui.tag_count').replace('{count}', String(this.tagCounts.length));
      this.statusBar.appendChild(tagCount);
    }
  }

  // ===== Actions =====

  private newFile(): void {
    invoke('open_new_window', { file: null, closeSelf: true });
  }

  private async openFile(): Promise<void> {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (selected) {
      invoke('open_new_window', { file: selected as string, closeSelf: true });
    }
  }

  private openRecentFile(path: string): void {
    invoke('open_new_window', { file: path, closeSelf: true });
  }

  private openFileFromTags(path: string): void {
    invoke('open_new_window', { file: path, closeSelf: true });
  }

  private async removeRecent(path: string): Promise<void> {
    await invoke('recent_remove', { path });
    this.recentEntries = this.recentEntries.filter(e => e.path !== path);
    this.renderHomeTab();
  }

  // ===== Helpers =====

  private shortenPath(fullPath: string): string {
    const home = fullPath.replace(/\\/g, '/');
    // Try to shorten with ~
    const homeDir = home.includes('/Users/')
      ? home.replace(/^\/Users\/[^/]+/, '~')
      : home.includes('\\Users\\')
        ? home.replace(/^.*?\\Users\\[^\\]+/, '~')
        : home;
    // Show directory only (remove filename)
    const lastSlash = homeDir.lastIndexOf('/');
    if (lastSlash > 0) {
      return homeDir.substring(0, lastSlash + 1);
    }
    return homeDir;
  }

  private relativeTime(timestamp: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return t('ui.home_time_now');
    if (diff < 3600) return t('ui.home_time_minutes').replace('{count}', String(Math.floor(diff / 60)));
    if (diff < 86400) return t('ui.home_time_hours').replace('{count}', String(Math.floor(diff / 3600)));
    if (diff < 172800) return t('ui.home_time_yesterday');
    if (diff < 604800) return t('ui.home_time_days').replace('{count}', String(Math.floor(diff / 86400)));
    if (diff < 2592000) return t('ui.home_time_weeks').replace('{count}', String(Math.floor(diff / 604800)));
    return t('ui.home_time_older');
  }
}
