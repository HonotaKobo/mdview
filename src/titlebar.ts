import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

// --- 型定義 ---

type MenuEntry = NormalItem | CheckItem | SeparatorItem | SubMenuItem;

interface NormalItem {
  type: 'normal';
  id: string;
  label: string;
  accelerator?: string;
}

interface CheckItem {
  type: 'check';
  id: string;
  label: string;
}

interface SeparatorItem {
  type: 'separator';
}

interface SubMenuItem {
  type: 'submenu';
  label: string;
  items: (NormalItem | CheckItem | SeparatorItem)[];
}

interface MenuDef {
  id: string;
  label: string;
  items: MenuEntry[];
}

// --- カスタムタイトルバー ---

export class CustomTitleBar {
  private el!: HTMLElement;
  private titleEl!: HTMLElement;
  private openMenuId: string | null = null;
  private translations: Record<string, string> = {};
  private checkStates: Record<string, boolean> = {};
  private _maximizeDisabled = false;

  async init(): Promise<void> {
    this.translations = await invoke<Record<string, string>>('get_translations');

    // localStorage からチェック状態を初期化する
    const savedTheme = localStorage.getItem('tsumugi-theme') || 'auto';
    const savedLocale = localStorage.getItem('tsumugi-locale') || 'auto';
    this.checkStates = {
      theme_dark: savedTheme === 'dark',
      theme_light: savedTheme === 'light',
      theme_auto: savedTheme === 'auto',
      locale_en: savedLocale === 'en',
      locale_ja: savedLocale === 'ja',
      locale_custom: savedLocale === 'custom',
      view_status_bar: true,
      view_always_on_top: false,
    };

    this.el = this.build();
    document.body.insertBefore(this.el, document.body.firstChild);
    this.setupEvents();
    this.listenForStateChanges();
  }

  /** 表示タイトルを更新する（main.ts から呼び出される） */
  setTitle(title: string): void {
    if (this.titleEl) {
      this.titleEl.textContent = title ? `${title} \u2014 tsumugi` : 'tsumugi';
    }
  }

  /** 最大化ボタンを非表示にし、ダブルクリックによる最大化を無効にする（固定サイズウィンドウ用） */
  disableMaximize(): void {
    const btn = this.el.querySelector('#tb-maximize') as HTMLElement | null;
    if (btn) btn.style.display = 'none';
    this._maximizeDisabled = true;
  }

  private t(key: string): string {
    return this.translations[key] || key;
  }

  private getMenus(): MenuDef[] {
    return [
      {
        id: 'file',
        label: this.t('menu.file'),
        items: [
          { type: 'normal', id: 'file_new_window', label: this.t('menu.file_new_window'), accelerator: 'Ctrl+N' },
          { type: 'normal', id: 'file_open', label: this.t('menu.file_open'), accelerator: 'Ctrl+O' },
          { type: 'normal', id: 'file_home', label: this.t('menu.file_home') },
          { type: 'separator' },
          { type: 'normal', id: 'file_save', label: this.t('menu.file_save'), accelerator: 'Ctrl+S' },
          { type: 'normal', id: 'file_save_as', label: this.t('menu.file_save_as'), accelerator: 'Ctrl+Shift+S' },
          { type: 'separator' },
          { type: 'normal', id: 'file_reload', label: this.t('menu.file_reload'), accelerator: 'Ctrl+R' },
          { type: 'separator' },
          { type: 'normal', id: 'file_export_pdf', label: this.t('menu.file_export_pdf'), accelerator: 'Ctrl+Shift+E' },
          { type: 'normal', id: 'file_export_html', label: this.t('menu.file_export_html') },
          { type: 'normal', id: 'file_print', label: this.t('menu.file_print'), accelerator: 'Ctrl+P' },
          { type: 'separator' },
          { type: 'normal', id: 'file_quit', label: this.t('menu.file_quit'), accelerator: 'Ctrl+Q' },
        ],
      },
      {
        id: 'edit',
        label: this.t('menu.edit'),
        items: [
          { type: 'normal', id: 'edit_copy_markdown', label: this.t('menu.edit_copy_markdown'), accelerator: 'Ctrl+Shift+C' },
          { type: 'normal', id: 'edit_copy_html', label: this.t('menu.edit_copy_html') },
          { type: 'normal', id: 'edit_copy_plaintext', label: this.t('menu.edit_copy_plaintext') },
          { type: 'separator' },
          { type: 'normal', id: 'edit_find', label: this.t('menu.edit_find'), accelerator: 'Ctrl+F' },
          { type: 'normal', id: 'edit_find_replace', label: this.t('menu.edit_find_replace'), accelerator: 'Ctrl+H' },
          { type: 'normal', id: 'edit_find_next', label: this.t('menu.edit_find_next'), accelerator: 'Ctrl+G' },
          { type: 'normal', id: 'edit_find_prev', label: this.t('menu.edit_find_prev'), accelerator: 'Ctrl+Shift+G' },
        ],
      },
      {
        id: 'tag',
        label: this.t('menu.tag'),
        items: [
          { type: 'normal', id: 'tag_add', label: this.t('menu.tag_add'), accelerator: 'Ctrl+T' },
          { type: 'normal', id: 'tag_edit', label: this.t('menu.tag_edit') },
          { type: 'separator' },
          { type: 'normal', id: 'tag_manage', label: this.t('menu.tag_manage') },
        ],
      },
      {
        id: 'view',
        label: this.t('menu.view'),
        items: [
          {
            type: 'submenu',
            label: this.t('menu.view_theme'),
            items: [
              { type: 'check', id: 'theme_dark', label: this.t('menu.view_theme_dark') },
              { type: 'check', id: 'theme_light', label: this.t('menu.view_theme_light') },
              { type: 'check', id: 'theme_auto', label: this.t('menu.view_theme_auto') },
            ],
          },
          {
            type: 'submenu',
            label: this.t('menu.view_font_size'),
            items: [
              { type: 'normal', id: 'font_increase', label: this.t('menu.view_font_size_increase'), accelerator: 'Ctrl+=' },
              { type: 'normal', id: 'font_decrease', label: this.t('menu.view_font_size_decrease'), accelerator: 'Ctrl+-' },
            ],
          },
          {
            type: 'submenu',
            label: this.t('menu.view_language'),
            items: [
              { type: 'check', id: 'locale_en', label: this.t('menu.view_language_en') },
              { type: 'check', id: 'locale_ja', label: this.t('menu.view_language_ja') },
              { type: 'check', id: 'locale_custom', label: this.t('menu.view_language_custom') },
            ],
          },
          { type: 'separator' },
          { type: 'check', id: 'view_status_bar', label: this.t('menu.view_status_bar') },
          { type: 'check', id: 'view_always_on_top', label: this.t('menu.view_always_on_top') },
        ],
      },
      {
        id: 'help',
        label: this.t('menu.help'),
        items: [
          { type: 'normal', id: 'help_check_updates', label: this.t('menu.help_check_updates') },
          { type: 'separator' },
          { type: 'normal', id: 'help_about', label: this.t('menu.help_about') },
        ],
      },
    ];
  }

  // --- DOM 構築 ---

  private build(): HTMLElement {
    const titlebar = document.createElement('div');
    titlebar.id = 'custom-titlebar';

    // 行1: アイコン + タイトル + ウィンドウ操作ボタン
    const titleRow = document.createElement('div');
    titleRow.className = 'titlebar-title-row';

    const icon = document.createElement('img');
    icon.className = 'titlebar-icon';
    icon.src = '/app-icon.png';
    icon.alt = 'tsumugi';
    titleRow.appendChild(icon);

    const titleDrag = document.createElement('div');
    titleDrag.className = 'titlebar-title';
    titleDrag.setAttribute('data-tauri-drag-region', '');

    this.titleEl = document.createElement('span');
    this.titleEl.className = 'titlebar-title-text';
    this.titleEl.textContent = 'tsumugi';
    this.titleEl.setAttribute('data-tauri-drag-region', '');
    titleDrag.appendChild(this.titleEl);

    titleRow.appendChild(titleDrag);

    // ウィンドウ操作ボタン
    const controls = document.createElement('div');
    controls.className = 'titlebar-controls';
    controls.appendChild(this.createCtrlBtn('tb-minimize', 'minimize'));
    controls.appendChild(this.createCtrlBtn('tb-maximize', 'maximize'));
    controls.appendChild(this.createCtrlBtn('tb-close', 'close'));
    titleRow.appendChild(controls);

    titlebar.appendChild(titleRow);

    // 行2: メニューバー
    const menuRow = document.createElement('div');
    menuRow.className = 'titlebar-menu-row';

    const menuBar = document.createElement('div');
    menuBar.className = 'titlebar-menu';

    for (const menu of this.getMenus()) {
      const topItem = document.createElement('div');
      topItem.className = 'menu-top-item';
      topItem.dataset.menu = menu.id;

      const label = document.createElement('span');
      label.className = 'menu-top-label';
      label.textContent = menu.label;
      topItem.appendChild(label);

      const dropdown = this.buildDropdown(menu.items);
      topItem.appendChild(dropdown);

      menuBar.appendChild(topItem);
    }
    menuRow.appendChild(menuBar);
    titlebar.appendChild(menuRow);

    return titlebar;
  }

  private buildDropdown(items: MenuEntry[]): HTMLElement {
    const dropdown = document.createElement('div');
    dropdown.className = 'menu-dropdown';

    for (const item of items) {
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'menu-separator';
        dropdown.appendChild(sep);
      } else if (item.type === 'submenu') {
        dropdown.appendChild(this.buildSubmenuEntry(item));
      } else {
        dropdown.appendChild(this.buildMenuEntry(item));
      }
    }
    return dropdown;
  }

  private buildSubmenuEntry(item: SubMenuItem): HTMLElement {
    const entry = document.createElement('div');
    entry.className = 'menu-entry has-submenu';

    // 左揃えを統一するための空のチェック用 span を追加する
    const check = document.createElement('span');
    check.className = 'entry-check';
    check.textContent = '';
    entry.appendChild(check);

    const label = document.createElement('span');
    label.className = 'entry-label';
    label.textContent = item.label;
    entry.appendChild(label);

    const arrow = document.createElement('span');
    arrow.className = 'entry-arrow';
    arrow.textContent = '\u25B8'; // ▸
    entry.appendChild(arrow);

    const submenu = document.createElement('div');
    submenu.className = 'menu-submenu';
    for (const subItem of item.items) {
      if (subItem.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'menu-separator';
        submenu.appendChild(sep);
      } else {
        submenu.appendChild(this.buildMenuEntry(subItem));
      }
    }
    entry.appendChild(submenu);

    return entry;
  }

  private buildMenuEntry(item: NormalItem | CheckItem): HTMLElement {
    const entry = document.createElement('div');
    entry.className = 'menu-entry';
    entry.dataset.action = item.id;

    // 左揃えを統一するために常にチェック用 span を追加する
    const check = document.createElement('span');
    check.className = 'entry-check';
    if (item.type === 'check') {
      check.textContent = this.checkStates[item.id] ? '\u2713' : '';
    } else {
      check.textContent = '';
    }
    entry.appendChild(check);

    const label = document.createElement('span');
    label.className = 'entry-label';
    label.textContent = item.label;
    entry.appendChild(label);

    if (item.type === 'normal' && item.accelerator) {
      const accel = document.createElement('span');
      accel.className = 'entry-accel';
      accel.textContent = item.accelerator;
      entry.appendChild(accel);
    }

    return entry;
  }

  private createCtrlBtn(id: string, type: 'minimize' | 'maximize' | 'close'): HTMLElement {
    const btn = document.createElement('button');
    btn.className = `ctrl-btn ctrl-${type}`;
    btn.id = id;

    if (type === 'minimize') {
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="1"/></svg>';
    } else if (type === 'maximize') {
      btn.innerHTML = this.maximizeSvg();
    } else {
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10">'
        + '<line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1"/>'
        + '<line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1"/></svg>';
    }
    return btn;
  }

  private maximizeSvg(): string {
    return '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" stroke="currentColor" fill="none" stroke-width="1"/></svg>';
  }

  private restoreSvg(): string {
    return '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">'
      + '<g stroke="currentColor" stroke-width="1">'
      + '<path d="M 2 4 L 2 13 L 11 13 L 11 4 Z"/>'
      + '<path d="M 4 2 L 13 2 L 13 12"/>'
      + '</g></svg>';
  }

  // --- イベント処理 ---

  private setupEvents(): void {
    this.setupMenuItemEvents();

    // メニュー外をクリックしたら閉じる
    document.addEventListener('mousedown', (e) => {
      if (this.openMenuId) {
        const menuArea = this.el.querySelector('.titlebar-menu')!;
        if (!menuArea.contains(e.target as Node)) {
          this.closeAll();
        }
      }
    });

    // アクション項目のクリック（イベント委譲 — DOM 再構築後も動作する）
    this.el.addEventListener('click', (e) => {
      const entry = (e.target as HTMLElement).closest('.menu-entry[data-action]') as HTMLElement | null;
      if (entry && !entry.classList.contains('has-submenu')) {
        const action = entry.dataset.action!;
        this.executeAction(action);
        this.closeAll();
      }
    });

    // Escape キーでメニューを閉じる
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.openMenuId) {
        this.closeAll();
      }
    });

    // ウィンドウ操作ボタン
    this.el.querySelector('#tb-minimize')!.addEventListener('click', () => {
      getCurrentWindow().minimize();
    });

    this.el.querySelector('#tb-maximize')!.addEventListener('click', async () => {
      if (this._maximizeDisabled) return;
      const win = getCurrentWindow();
      if (await win.isMaximized()) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    });

    this.el.querySelector('#tb-close')!.addEventListener('click', () => {
      getCurrentWindow().close();
    });

    // タイトル行のダブルクリックで最大化/元に戻す
    this.el.querySelector('.titlebar-title')!.addEventListener('dblclick', async () => {
      if (this._maximizeDisabled) return;
      const win = getCurrentWindow();
      if (await win.isMaximized()) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    });

    // ウィンドウリサイズ時に最大化/元に戻すアイコンを更新する
    window.addEventListener('resize', async () => {
      const maximized = await getCurrentWindow().isMaximized();
      this.updateMaximizeIcon(maximized);
    });
  }

  private setupMenuItemEvents(): void {
    // トップレベルのメニューラベルをクリック
    this.el.querySelectorAll('.menu-top-label').forEach(label => {
      label.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const menuId = (label.parentElement as HTMLElement).dataset.menu!;
        this.toggleMenu(menuId);
      });
    });

    // メニューが開いている状態でホバーすると別のメニューに切り替わる
    this.el.querySelectorAll('.menu-top-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        if (this.openMenuId) {
          const menuId = (item as HTMLElement).dataset.menu!;
          if (menuId !== this.openMenuId) {
            this.openMenu(menuId);
          }
        }
      });
    });
  }

  private listenForStateChanges(): void {
    listen('menu-action', (event) => {
      const { action, value } = event.payload as { action: string; value?: unknown };
      if (action === 'theme_change' && typeof value === 'string') {
        this.setThemeCheck(value);
      } else if (action === 'always_on_top_changed') {
        this.setCheck('view_always_on_top', value === true);
      } else if (action === 'view_status_bar') {
        this.setCheck('view_status_bar', !this.checkStates['view_status_bar']);
      }
    });
  }

  // --- メニュー状態管理 ---

  private toggleMenu(menuId: string): void {
    if (this.openMenuId === menuId) {
      this.closeAll();
    } else {
      this.openMenu(menuId);
    }
  }

  private openMenu(menuId: string): void {
    this.closeAll();
    this.openMenuId = menuId;
    const item = this.el.querySelector(`.menu-top-item[data-menu="${menuId}"]`);
    item?.classList.add('open');
  }

  private closeAll(): void {
    this.openMenuId = null;
    this.el.querySelectorAll('.menu-top-item.open').forEach(el => el.classList.remove('open'));
  }

  private async executeAction(id: string): Promise<void> {
    await invoke('execute_menu_action', { id });
    // 言語変更 — 翻訳データを再取得してメニューを再構築する
    if (id === 'locale_en' || id === 'locale_ja' || id === 'locale_custom') {
      const locale = id.replace('locale_', '');
      localStorage.setItem('tsumugi-locale', locale);
      this.checkStates['locale_en'] = id === 'locale_en';
      this.checkStates['locale_ja'] = id === 'locale_ja';
      this.checkStates['locale_custom'] = id === 'locale_custom';
      this.translations = await invoke<Record<string, string>>('get_translations');
      this.rebuildMenuBar();
    }
  }

  private setThemeCheck(theme: string): void {
    for (const id of ['theme_dark', 'theme_light', 'theme_auto']) {
      const isSelected = id === `theme_${theme}`;
      this.checkStates[id] = isSelected;
      const check = this.el.querySelector(`.menu-entry[data-action="${id}"] .entry-check`);
      if (check) check.textContent = isSelected ? '\u2713' : '';
    }
  }

  private setCheck(id: string, checked: boolean): void {
    this.checkStates[id] = checked;
    const check = this.el.querySelector(`.menu-entry[data-action="${id}"] .entry-check`);
    if (check) check.textContent = checked ? '\u2713' : '';
  }

  private rebuildMenuBar(): void {
    const menuBar = this.el.querySelector('.titlebar-menu');
    if (!menuBar) return;
    menuBar.innerHTML = '';
    for (const menu of this.getMenus()) {
      const topItem = document.createElement('div');
      topItem.className = 'menu-top-item';
      topItem.dataset.menu = menu.id;

      const label = document.createElement('span');
      label.className = 'menu-top-label';
      label.textContent = menu.label;
      topItem.appendChild(label);

      const dropdown = this.buildDropdown(menu.items);
      topItem.appendChild(dropdown);

      menuBar.appendChild(topItem);
    }
    // メニュー固有のイベントを再登録する
    this.setupMenuItemEvents();
  }

  private updateMaximizeIcon(maximized: boolean): void {
    const btn = this.el.querySelector('#tb-maximize') as HTMLElement | null;
    if (btn) {
      btn.innerHTML = maximized ? this.restoreSvg() : this.maximizeSvg();
    }
  }
}
