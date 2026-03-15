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
import { getMarkdownIt } from './renderer';
import { exportAsPdf } from './pdf-export';
import { exportAsHtml } from './html-export';
import { TagAddModal } from './tag-add-modal';
import { TagSidebar } from './tag-sidebar';
import { TagManager } from './tag-manager';

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

const themeManager = new ThemeManager();
const findBar = new FindBar();
const fontSizeManager = new FontSizeManager();
const editorController = new EditorController(document.getElementById('content')!);
const statusBar = new StatusBar();
const tagAddModal = new TagAddModal();
const tagSidebar = new TagSidebar();

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

function updateWindowTitle(title: string) {
  getCurrentWindow().setTitle(`${title} — mdcast`);
  customTitleBar?.setTitle(title);
}

// Initialize custom title bar on Windows
async function initPlatformUI() {
  const platform = await invoke<string>('get_platform');
  if (platform === 'windows') {
    customTitleBar = new CustomTitleBar();
    await customTitleBar.init();
    // Set initial title if content was already loaded
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
  const html = md.render(currentContent);
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

// Pull initial content from Rust backend (reliable, no race condition)
async function loadInitialContent() {
  const mode = await invoke<string>('get_window_mode');
  if (mode === 'tag-manager') {
    const tm = new TagManager();
    await tm.init();
    getCurrentWindow().setTitle('Tag Manager — mdcast');
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

// Content updates via IPC
listen('content-update', async (event) => {
  const update = event.payload as ContentUpdate;
  if (update.body !== undefined) {
    currentContent = update.body;
    isDirty = true;

    editorController.updateContent(update.body);
    statusBar.update(update.body);
  }
  if (update.title !== undefined) {
    currentTitle = update.title;
    updateWindowTitle(currentTitle);
  }
});

// Menu actions from Rust
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
  }
});

// Double-click on empty area below last block to add a block
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

// Drag & drop support
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

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (findBar.isVisible()) {
      findBar.hide();
    }
    return;
  }

  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  // Skip if typing in a textarea or input (let standard editing work)
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

// Close confirmation for unsaved changes
getCurrentWindow().onCloseRequested(async (event) => {
  if (isDirty) {
    event.preventDefault();
    const confirmed = confirm('未保存の変更があります。閉じますか？');
    if (confirmed) {
      await getCurrentWindow().destroy();
    }
  }
});
