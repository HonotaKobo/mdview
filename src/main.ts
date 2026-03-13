import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { renderMarkdown } from './renderer';
import { ScrollKeeper } from './scroll-keeper';
import { ThemeManager } from './theme';
import { handleSave, handleSaveAs, handleRename } from './save';
import { FindBar } from './find';
import { FontSizeManager } from './font-size';
import { CustomTitleBar } from './titlebar';

interface ContentUpdate {
  body?: string;
  title?: string;
}

interface MenuAction {
  action: string;
  value?: string;
}

let currentContent = '';
let currentTitle = 'Untitled';
let isDirty = false;

const themeManager = new ThemeManager();
const findBar = new FindBar();
const fontSizeManager = new FontSizeManager();

function updateWindowTitle(title: string) {
  getCurrentWindow().setTitle(`${title} — mdcast`);
}

// Initialize custom title bar on Windows
async function initPlatformUI() {
  const platform = await invoke<string>('get_platform');
  if (platform === 'windows') {
    const titleBar = new CustomTitleBar();
    await titleBar.init();
  }
}
initPlatformUI();

async function renderMarkdownWithScrollKeep(content: string): Promise<void> {
  const container = document.getElementById('content')!;
  const scrollKeeper = new ScrollKeeper(document.getElementById('scroll-area')!);

  const anchor = scrollKeeper.captureAnchor();
  await renderMarkdown(content, container);

  if (anchor) {
    scrollKeeper.restoreAnchor(anchor);
  }
}

// Open a file via dialog or path
async function openFile(filePath: string) {
  const content = await invoke<string>('read_file', { path: filePath });
  const fileName = filePath.split(/[\\/]/).pop() || 'Untitled';
  currentContent = content;
  currentTitle = fileName;
  const container = document.getElementById('content')!;
  await renderMarkdown(content, container);
  updateWindowTitle(currentTitle);
  await invoke('notify_saved', { path: filePath });
}

async function showOpenDialog() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
  });
  if (selected) {
    await openFile(selected as string);
  }
}

async function doSave() {
  await handleSave(currentContent, currentTitle);
  isDirty = false;
}

async function doSaveAs() {
  await handleSaveAs(currentContent, currentTitle);
  isDirty = false;
}

async function doRename() {
  const newPath = await handleRename();
  if (newPath) {
    const fileName = newPath.split(/[\\/]/).pop() || 'Untitled';
    currentTitle = fileName;
    updateWindowTitle(currentTitle);
  }
}

async function copyAsMarkdown() {
  await navigator.clipboard.writeText(currentContent);
}

async function copyAsPlaintext() {
  const text = document.getElementById('content')!.textContent || '';
  await navigator.clipboard.writeText(text);
}

function selectAll() {
  const selection = window.getSelection();
  const content = document.getElementById('content')!;
  const range = document.createRange();
  range.selectNodeContents(content);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

// Pull initial content from Rust backend (reliable, no race condition)
async function loadInitialContent() {
  const [body, title] = await invoke<[string, string]>('get_initial_content');
  if (body) {
    currentContent = body;
    currentTitle = title || 'Untitled';
    const container = document.getElementById('content')!;
    await renderMarkdown(body, container);
    updateWindowTitle(currentTitle);
  } else {
    // No content provided — show file open dialog
    await showOpenDialog();
  }
}
loadInitialContent();

// Content updates via IPC
listen('content-update', async (event) => {
  const update = event.payload as ContentUpdate;
  if (update.body !== undefined) {
    currentContent = update.body;
    isDirty = true;
    await renderMarkdownWithScrollKeep(update.body);
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
    case 'file_open':
      showOpenDialog();
      break;
    case 'file_save':
      doSave();
      break;
    case 'file_save_as':
      doSaveAs();
      break;
    case 'file_rename':
      doRename();
      break;
    case 'file_print':
      window.print();
      break;
    case 'edit_copy_markdown':
      copyAsMarkdown();
      break;
    case 'edit_copy_plaintext':
      copyAsPlaintext();
      break;
    case 'edit_select_all':
      selectAll();
      break;
    case 'edit_find':
      if (findBar.isVisible()) {
        findBar.hide();
      } else {
        findBar.show();
      }
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
      fontSizeManager.increase();
      break;
    case 'font_decrease':
      fontSizeManager.decrease();
      break;
  }
});

// Intercept link clicks: open external URLs in default browser, handle anchors in-page
document.getElementById('content')!.addEventListener('click', (e) => {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  e.preventDefault();

  if (href.startsWith('#')) {
    // In-page anchor navigation
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  } else {
    // External URL — open in system default browser
    openUrl(href);
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
    const container = document.getElementById('content')!;
    await renderMarkdown(text, container);
    updateWindowTitle(currentTitle);
  }
});

// Escape to close find bar
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && findBar.isVisible()) {
    findBar.hide();
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
