import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { ThemeManager } from './theme';
import { handleSave, handleSaveAs } from './save';
import { FindBar } from './find';
import { FontSizeManager } from './font-size';
import { CustomTitleBar } from './titlebar';
import { EditorController } from './editor/editor-controller';
import { StatusBar } from './status-bar';
import { getMarkdownIt, sanitizeHtml } from './renderer';
import { exportAsPdf } from './pdf-export';
import { exportAsHtml } from './html-export';
import { TagAddModal } from './tag-add-modal';
import { TagSidebar } from './tag-sidebar';
import { TagManager } from './tag-manager';

interface UpdateInfo {
  has_update: boolean;
  current_version: string;
  latest_version: string;
  release_url: string;
}

interface UpdateResult {
  success: boolean;
  message: string;
}

async function checkForUpdates(silent: boolean) {
  try {
    const info = await invoke<UpdateInfo>('check_for_updates');
    if (info.has_update) {
      const yes = confirm(`v${info.latest_version} が利用可能です（現在 v${info.current_version}）。\n更新しますか？`);
      if (yes) {
        const result = await invoke<UpdateResult>('perform_update');
        if (result.success) {
          const restart = confirm('更新が完了しました。再起動しますか？');
          if (restart) {
            await invoke('restart_app');
          }
        } else {
          alert(`更新に失敗しました。\n${result.message}`);
        }
      }
    } else if (!silent) {
      alert(`最新バージョン（v${info.current_version}）を使用中です。`);
    }
  } catch (e) {
    if (!silent) {
      alert('アップデートの確認に失敗しました。');
    }
  }
}

interface ContentUpdate {
  body?: string;
  title?: string;
}

interface MenuAction {
  action: string;
  value?: string | boolean;
}

let currentContent = '';
let currentTitle = 'Untitled';
let isDirty = false;
let customTitleBar: CustomTitleBar | null = null;

const isTagManager = getCurrentWindow().label === 'tag-manager';

let themeManager: ThemeManager;
let findBar: FindBar;
let fontSizeManager: FontSizeManager;
let editorController: EditorController;
let statusBar: StatusBar;
let tagAddModal: TagAddModal;
let tagSidebar: TagSidebar;

if (!isTagManager) {
  themeManager = new ThemeManager();
  findBar = new FindBar();
  fontSizeManager = new FontSizeManager();
  editorController = new EditorController(document.getElementById('content')!);
  statusBar = new StatusBar();
  tagAddModal = new TagAddModal();
  tagSidebar = new TagSidebar();

  tagAddModal.onTagAdded(() => {
    tagSidebar.refresh();
  });

  findBar.setOnReplace((search, replace, all) => {
    let content = editorController.getCurrentContent();
    if (all) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      content = content.replace(regex, replace);
    } else {
      const idx = content.toLowerCase().indexOf(search.toLowerCase());
      if (idx === -1) return;
      content = content.slice(0, idx) + replace + content.slice(idx + search.length);
    }
    editorController.updateContent(content);
    currentContent = content;
    isDirty = true;
    invoke('sync_content', { content });
    findBar.search();
  });

  editorController.setOnContentChange((markdown) => {
    currentContent = markdown;
    isDirty = true;
    invoke('sync_content', { content: markdown });
    statusBar.update(markdown);
  });
}

function updateWindowTitle(title: string) {
  getCurrentWindow().setTitle(`${title} — tsumugi`);
  customTitleBar?.setTitle(title);
}

// Initialize custom title bar on Windows
async function initPlatformUI() {
  if (isTagManager) return;
  const platform = await invoke<string>('get_platform');
  if (platform === 'windows') {
    customTitleBar = new CustomTitleBar();
    await customTitleBar.init();
    if (currentTitle !== 'Untitled') {
      customTitleBar.setTitle(currentTitle);
    }
  }
}
initPlatformUI();



// Open file dialog that opens in a new window
async function openFileInNewWindow() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
  });
  if (selected) {
    await invoke('open_new_window', { file: selected as string });
  }
}

async function doSave() {
  currentContent = editorController.getCurrentContent();
  await handleSave(currentContent, currentTitle);
  isDirty = false;
}

async function doSaveAs() {
  currentContent = editorController.getCurrentContent();
  await handleSaveAs(currentContent, currentTitle);
  isDirty = false;
}

async function copyAsMarkdown() {
  currentContent = editorController.getCurrentContent();
  await navigator.clipboard.writeText(currentContent);
}

async function copyAsHtml() {
  currentContent = editorController.getCurrentContent();
  const md = getMarkdownIt();
  const html = sanitizeHtml(md.render(currentContent));
  await navigator.clipboard.writeText(html);
}

async function copyAsPlaintext() {
  const text = document.getElementById('content')!.textContent || '';
  await navigator.clipboard.writeText(text);
}

async function reloadCurrentFile() {
  const savedPath = await invoke<string | null>('get_saved_path');
  if (!savedPath) return;
  try {
    const content = await invoke<string>('read_file', { path: savedPath });
    currentContent = content;
    editorController.updateContent(content);
    isDirty = false;
  } catch (e) {
    console.error('Reload failed:', e);
  }
}

// Debounce guard to prevent double-firing from native menu + JS handler
const actionDebounce = new Set<string>();
function debounced(action: string, fn: () => void) {
  if (actionDebounce.has(action)) return;
  actionDebounce.add(action);
  setTimeout(() => actionDebounce.delete(action), 300);
  fn();
}

async function loadInitialContent() {
  if (isTagManager) {
    const tm = new TagManager();
    await tm.init();
    return;
  }
  const [body, title, _contentSet] = await invoke<[string, string, boolean]>('get_initial_content');
  currentContent = body;
  currentTitle = title || 'Untitled';
  editorController.enterEditMode(body);
  updateWindowTitle(currentTitle);
  statusBar.update(body);
}
loadInitialContent();

if (!isTagManager) {
  setTimeout(() => checkForUpdates(true), 3000);
}

if (!isTagManager) {
  listen('content-update', async (event) => {
    const update = event.payload as ContentUpdate;
    if (update.body !== undefined) {
      currentContent = update.body;
      isDirty = false;
      editorController.updateContent(update.body);
      statusBar.update(update.body);
    }
    if (update.title !== undefined) {
      currentTitle = update.title;
      updateWindowTitle(currentTitle);
    }
  });

  // Re-check for content set by macOS file open event (race condition workaround)
  setTimeout(async () => {
    const [body, title, contentSet] = await invoke<[string, string, boolean]>('get_initial_content');
    if (contentSet && body && body !== currentContent) {
      currentContent = body;
      currentTitle = title || 'Untitled';
      editorController.updateContent(body);
      updateWindowTitle(currentTitle);
      statusBar.update(body);
      isDirty = false;
    }
  }, 500);

  listen('menu-action', (event) => {
    const { action, value } = event.payload as MenuAction;

    switch (action) {
      case 'file_new_window':
        debounced('file_new_window', () => invoke('open_new_window', { file: null }));
        break;
      case 'file_open':
        debounced('file_open', () => openFileInNewWindow());
        break;
      case 'file_save':
        debounced('file_save', () => doSave());
        break;
      case 'file_save_as':
        debounced('file_save_as', () => doSaveAs());
        break;
      case 'file_reload':
        debounced('file_reload', () => reloadCurrentFile());
        break;
      case 'file_export_pdf':
        debounced('file_export_pdf', () => exportAsPdf(currentTitle));
        break;
      case 'file_export_html':
        debounced('file_export_html', () => {
          currentContent = editorController.getCurrentContent();
          exportAsHtml(currentTitle, currentContent);
        });
        break;
      case 'file_print':
        debounced('file_print', () => window.print());
        break;
      case 'edit_copy_markdown':
        debounced('edit_copy_markdown', () => copyAsMarkdown());
        break;
      case 'edit_copy_html':
        debounced('edit_copy_html', () => copyAsHtml());
        break;
      case 'edit_copy_plaintext':
        debounced('edit_copy_plaintext', () => copyAsPlaintext());
        break;
      case 'edit_find':
        debounced('edit_find', () => {
          if (findBar.isVisible()) {
            findBar.hide();
          } else {
            findBar.show();
          }
        });
        break;
      case 'edit_find_replace':
        debounced('edit_find_replace', () => {
          if (findBar.isReplaceVisible()) {
            findBar.hide();
          } else {
            findBar.showReplace();
          }
        });
        break;
      case 'edit_find_next':
        findBar.show();
        findBar.next();
        break;
      case 'edit_find_prev':
        findBar.show();
        findBar.prev();
        break;
      case 'theme_change':
        if (value === 'dark' || value === 'light' || value === 'auto') {
          themeManager.setTheme(value);
        }
        break;
      case 'view_status_bar':
        debounced('view_status_bar', () => statusBar.toggle());
        break;
      case 'font_increase':
        debounced('font_increase', () => fontSizeManager.increase());
        break;
      case 'font_decrease':
        debounced('font_decrease', () => fontSizeManager.decrease());
        break;
      case 'tag_add':
        debounced('tag_add', () => tagAddModal.show());
        break;
      case 'tag_edit':
        debounced('tag_edit', () => tagSidebar.toggle());
        break;
      case 'help_check_updates':
        debounced('help_check_updates', () => checkForUpdates(false));
        break;
    }
  });

  document.getElementById('scroll-area')!.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    if (target.id === 'scroll-area' || target.id === 'content') {
      const content = document.getElementById('content')!;
      const lastBlock = content.querySelector('.md-block:last-of-type, .block-gap:last-child');
      if (lastBlock) {
        const lastBottom = lastBlock.getBoundingClientRect().bottom;
        if (e.clientY <= lastBottom) return;
      }
      e.preventDefault();
      editorController.addBlockAtEnd();
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files[0];
    if (file && (file.name.endsWith('.md') || file.name.endsWith('.markdown') || file.name.endsWith('.txt'))) {
      const text = await file.text();
      currentContent = text;
      currentTitle = file.name;
      editorController.updateContent(text);
      statusBar.update(text);
      updateWindowTitle(currentTitle);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (findBar.isVisible()) {
        findBar.hide();
      }
      return;
    }

    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    const inTextarea = document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT';

    switch (e.key) {
      case 'z':
        if (!inTextarea) {
          e.preventDefault();
          if (e.shiftKey) {
            editorController.redo();
          } else {
            editorController.undo();
          }
        }
        break;
      case 'n':
        e.preventDefault();
        debounced('file_new_window', () => invoke('open_new_window', { file: null }));
        break;
      case 'o':
        e.preventDefault();
        debounced('file_open', () => openFileInNewWindow());
        break;
      case 's':
        e.preventDefault();
        if (e.shiftKey) {
          debounced('file_save_as', () => doSaveAs());
        } else {
          debounced('file_save', () => doSave());
        }
        break;
      case 'r':
        e.preventDefault();
        debounced('file_reload', () => reloadCurrentFile());
        break;
      case 'e':
      case 'E':
        if (e.shiftKey) {
          e.preventDefault();
          debounced('file_export_pdf', () => exportAsPdf(currentTitle));
        }
        break;
      case 'p':
        e.preventDefault();
        debounced('file_print', () => window.print());
        break;
      case 'f':
        if (!inTextarea) {
          e.preventDefault();
          debounced('edit_find', () => {
            if (findBar.isVisible()) {
              findBar.hide();
            } else {
              findBar.show();
            }
          });
        }
        break;
      case 'h':
        if (!inTextarea) {
          e.preventDefault();
          debounced('edit_find_replace', () => {
            if (findBar.isReplaceVisible()) {
              findBar.hide();
            } else {
              findBar.showReplace();
            }
          });
        }
        break;
      case 'g':
        e.preventDefault();
        if (e.shiftKey) {
          findBar.show();
          findBar.prev();
        } else {
          findBar.show();
          findBar.next();
        }
        break;
      case 'C':
      case 'c':
        if (e.shiftKey && !inTextarea) {
          e.preventDefault();
          debounced('edit_copy_markdown', () => copyAsMarkdown());
        }
        break;
      case 't':
        if (!inTextarea) {
          e.preventDefault();
          debounced('tag_add', () => tagAddModal.show());
        }
        break;
      case '=':
        e.preventDefault();
        debounced('font_increase', () => fontSizeManager.increase());
        break;
      case '-':
        e.preventDefault();
        debounced('font_decrease', () => fontSizeManager.decrease());
        break;
    }
  });

  getCurrentWindow().onCloseRequested(async (event) => {
    if (isDirty) {
      event.preventDefault();
      const confirmed = confirm('未保存の変更があります。閉じますか？');
      if (confirmed) {
        await getCurrentWindow().destroy();
      }
    }
  });
}
