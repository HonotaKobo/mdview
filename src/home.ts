import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
  memo?: string;
}

// SVG アイコン（テンプレート文字列）
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

  // データ
  private recentEntries: RecentEntry[] = [];
  private tagEntries: TagEntry[] = [];
  private tagCounts: [string, number][] = [];
  private pathStatus: Map<string, boolean> = new Map();
  private tagSearchQuery = '';
  private activeChips: Set<string> = new Set();

  // DOM 参照
  private homeTabBtn!: HTMLButtonElement;
  private tagsTabBtn!: HTMLButtonElement;
  private contentArea!: HTMLElement;
  private statusBar!: HTMLElement;

  async init(): Promise<void> {
    // ホーム画面のウィンドウサイズを固定する
    try { await getCurrentWindow().setResizable(false); } catch { /* 権限がない可能性あり */ }

    // エディタ要素を非表示にする
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
    // ナビゲーションラベルを再構築する
    this.homeTabBtn.querySelector('span')!.textContent = t('ui.home_tab');
    this.tagsTabBtn.querySelector('span')!.textContent = t('ui.home_tags_tab');
    this.renderActiveTab();
  }

  private buildLayout(): void {
    // ホーム画面コンテナを作成する
    const screen = document.createElement('div');
    screen.id = 'home-screen';

    // サイドバーナビゲーション
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

    // コンテンツエリア
    this.contentArea = document.createElement('div');
    this.contentArea.id = 'home-content-area';
    screen.appendChild(this.contentArea);

    // ステータスバーの前に挿入する
    const statusBar = document.getElementById('status-bar')!;
    document.body.insertBefore(screen, statusBar);

    // ホーム用ステータスバーを作成する
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

  // ===== ホームタブ =====

  private renderHomeTab(): void {
    this.contentArea.innerHTML = '';

    // パネルヘッダー
    const header = document.createElement('div');
    header.className = 'home-panel-header';
    const title = document.createElement('span');
    title.className = 'home-panel-title';
    title.textContent = t('ui.home_tab');
    header.appendChild(title);
    this.contentArea.appendChild(header);

    // スクロール可能なコンテンツ
    const scrollArea = document.createElement('div');
    scrollArea.className = 'home-tab-content';

    const inner = document.createElement('div');
    inner.className = 'home-inner';

    // あいさつ文
    const greeting = document.createElement('div');
    greeting.className = 'home-greeting';
    const h1 = document.createElement('h1');
    h1.textContent = t('ui.home_greeting');
    const p = document.createElement('p');
    p.textContent = t('ui.home_greeting_sub');
    greeting.appendChild(h1);
    greeting.appendChild(p);
    inner.appendChild(greeting);

    // アクションカード
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

    // 最近使ったファイルセクション
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

      // tagEntries からタグの検索用マップを作成する
      const tagMap = new Map<string, string[]>();
      for (const entry of this.tagEntries) {
        tagMap.set(entry.path, entry.tags);
      }

      for (const entry of this.recentEntries) {
        const item = document.createElement('div');
        item.className = 'home-recent-item';

        // ファイルアイコン
        const icon = document.createElement('div');
        icon.className = 'home-recent-icon';
        icon.innerHTML = ICON_FILE;
        item.appendChild(icon);

        // ファイル情報
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

        // タグ
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

        // 日付
        const dateEl = document.createElement('div');
        dateEl.className = 'home-recent-date';
        dateEl.textContent = this.relativeTime(entry.last_opened);
        item.appendChild(dateEl);

        // 削除ボタン
        const removeBtn = document.createElement('button');
        removeBtn.className = 'home-recent-remove';
        removeBtn.textContent = '\u00d7';
        removeBtn.title = t('ui.home_remove_recent');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeRecent(entry.path);
        });
        item.appendChild(removeBtn);

        // クリックでファイルを開く
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

  // ===== タグタブ =====

  private renderTagsTab(): void {
    this.contentArea.innerHTML = '';

    // パネルヘッダー（検索付き）
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

    // タグフィルターチップ
    const toolbar = document.createElement('div');
    toolbar.className = 'home-tag-toolbar';
    const chips = document.createElement('div');
    chips.className = 'home-tag-chips';

    // 「すべて」チップ
    const allChip = document.createElement('button');
    allChip.className = 'home-tag-chip' + (this.activeChips.size === 0 ? ' active' : '');
    allChip.textContent = t('ui.tm_select_all').replace('選択', '');
    // よりシンプルなラベルを使用する
    allChip.textContent = this.activeChips.size === 0 ? '\u2713 ' + t('ui.tm_all_tags') : t('ui.tm_all_tags');
    allChip.addEventListener('click', () => {
      this.activeChips.clear();
      this.renderTagsTab();
    });
    chips.appendChild(allChip);

    // 件数順にソートされたタグチップ
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

    // テーブルラッパー
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

    // ヘッダー
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headerTexts = [
      { key: 'filename', width: '18%' },
      { key: 'path', width: '24%' },
      { key: 'memo', width: '18%' },
      { key: 'tags', width: '22%' },
      { key: 'actions', width: '18%', align: 'right' },
    ];
    for (const h of headerTexts) {
      const th = document.createElement('th');
      th.style.width = h.width;
      if (h.align) th.style.textAlign = h.align;
      if (h.key === 'filename') th.textContent = 'File';
      else if (h.key === 'path') th.textContent = 'Path';
      else if (h.key === 'memo') th.textContent = t('ui.tm_memo_header');
      else if (h.key === 'tags') th.textContent = t('ui.home_tags_tab');
      else th.textContent = '';
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // テーブル本体
    const tbody = document.createElement('tbody');
    for (const entry of filtered) {
      const exists = this.pathStatus.get(entry.path) ?? true;
      const tr = document.createElement('tr');
      if (!exists) tr.style.opacity = '0.5';

      // ファイル名
      const tdName = document.createElement('td');
      tdName.className = 'cell-filename';
      const filename = entry.path.split(/[/\\]/).pop() || entry.path;
      if (!exists) {
        tdName.textContent = '⚠ ' + filename;
      } else {
        tdName.textContent = filename;
      }
      tr.appendChild(tdName);

      // パス
      const tdPath = document.createElement('td');
      tdPath.className = 'cell-path';
      tdPath.textContent = this.shortenPath(entry.path);
      tdPath.title = entry.path;
      tr.appendChild(tdPath);

      // メモ
      const tdMemo = document.createElement('td');
      tdMemo.className = 'cell-memo';

      const memoDisplay = document.createElement('span');
      memoDisplay.className = 'home-memo-display';
      memoDisplay.textContent = entry.memo || '';
      memoDisplay.title = entry.memo || '';

      const memoInput = document.createElement('input');
      memoInput.type = 'text';
      memoInput.className = 'home-memo-input';
      memoInput.value = entry.memo || '';
      memoInput.maxLength = 100;
      memoInput.placeholder = t('ui.tm_memo_placeholder');
      memoInput.style.display = 'none';

      memoDisplay.addEventListener('click', (e) => {
        e.stopPropagation();
        memoDisplay.style.display = 'none';
        memoInput.style.display = 'block';
        memoInput.focus();
      });

      const saveMemo = async () => {
        const val = memoInput.value.trim();
        const memo = val || null;
        await invoke('tag_set_memo', { path: entry.path, memo });
        entry.memo = val || undefined;
        memoDisplay.textContent = val;
        memoDisplay.title = val;
        memoInput.style.display = 'none';
        memoDisplay.style.display = '';
      };

      memoInput.addEventListener('blur', saveMemo);
      memoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') memoInput.blur();
        else if (e.key === 'Escape') {
          memoInput.value = entry.memo || '';
          memoInput.style.display = 'none';
          memoDisplay.style.display = '';
        }
      });
      memoInput.addEventListener('click', (e) => e.stopPropagation());

      tdMemo.appendChild(memoDisplay);
      tdMemo.appendChild(memoInput);
      tr.appendChild(tdMemo);

      // タグ
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

      // アクション
      const tdActions = document.createElement('td');
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'cell-actions';

      // 開くボタン
      const openBtn = this.createIconButton(ICON_OPEN, t('ui.tm_open'), () => {
        this.openFileFromTags(entry.path);
      });
      if (!exists) openBtn.disabled = true;
      actionsDiv.appendChild(openBtn);

      // フォルダボタン
      const folderBtn = this.createIconButton(ICON_FOLDER, t('ui.tm_folder'), () => {
        revealItemInDir(entry.path).catch(() => {});
      });
      if (!exists) folderBtn.disabled = true;
      actionsDiv.appendChild(folderBtn);

      // 削除ボタン
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

    // アクティブなチップでフィルタリングする
    if (this.activeChips.size > 0) {
      entries = entries.filter(e =>
        e.tags.some(tag => this.activeChips.has(tag))
      );
    }

    // 検索クエリでフィルタリングする
    if (this.tagSearchQuery) {
      const q = this.tagSearchQuery.toLowerCase();
      const keywords = q.split(/[\s,]+/).filter(k => k.length > 0);
      if (keywords.length > 0) {
        entries = entries.filter(e =>
          keywords.every(k =>
            e.path.toLowerCase().includes(k) ||
            e.tags.some(tag => tag.toLowerCase().includes(k)) ||
            (e.memo && e.memo.toLowerCase().includes(k))
          )
        );
      }
    }

    return entries;
  }

  // ===== ステータスバー =====

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

  // ===== アクション =====

  private newFile(): void {
    invoke('open_new_window', { file: null, body: '', closeSelf: true });
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

  // ===== ヘルパー =====

  private shortenPath(fullPath: string): string {
    const home = fullPath.replace(/\\/g, '/');
    // ~ を使ってパスを短縮する
    const homeDir = home.includes('/Users/')
      ? home.replace(/^\/Users\/[^/]+/, '~')
      : home.includes('\\Users\\')
        ? home.replace(/^.*?\\Users\\[^\\]+/, '~')
        : home;
    // ディレクトリのみ表示する（ファイル名を除去）
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
