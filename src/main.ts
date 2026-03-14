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
import { getMarkdownIt } from './renderer';

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

editorController.setOnContentChange((markdown) => {
  currentContent = markdown;
  isDirty = true;
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

// Open a file in the current window (used for initial load)
async function openFileInCurrentWindow(filePath: string) {
  const content = await invoke<string>('read_file', { path: filePath });
  const fileName = filePath.split(/[\\/]/).pop() || 'Untitled';
  currentContent = content;
  currentTitle = fileName;

  editorController.updateContent(content);

  updateWindowTitle(currentTitle);
  await invoke('notify_saved', { path: filePath });
}


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
  const [body, title, _contentSet] = await invoke<[string, string, boolean]>('get_initial_content');
  currentContent = body;
  currentTitle = title || 'Untitled';
  editorController.enterEditMode(body);
  updateWindowTitle(currentTitle);
}
loadInitialContent();

// Content updates via IPC
listen('content-update', async (event) => {
  const update = event.payload as ContentUpdate;
  if (update.body !== undefined) {
    currentContent = update.body;
    isDirty = true;

    editorController.updateContent(update.body);
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
    case 'font_increase':
      debounced('font_increase', () => fontSizeManager.increase());
      break;
    case 'font_decrease':
      debounced('font_decrease', () => fontSizeManager.decrease());
      break;
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
