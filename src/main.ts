import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { ThemeManager } from './theme';
import { handleSave, handleSaveAs, handleRename } from './save';
import { FindBar } from './find';
import { FontSizeManager } from './font-size';
import { CustomTitleBar } from './titlebar';
import { EditorController } from './editor/editor-controller';

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

// Open a file via dialog or path
async function openFile(filePath: string) {
  const content = await invoke<string>('read_file', { path: filePath });
  const fileName = filePath.split(/[\\/]/).pop() || 'Untitled';
  currentContent = content;
  currentTitle = fileName;

  editorController.updateContent(content);

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
  currentContent = editorController.getCurrentContent();
  await handleSave(currentContent, currentTitle);
  isDirty = false;
}

async function doSaveAs() {
  currentContent = editorController.getCurrentContent();
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
  currentContent = editorController.getCurrentContent();
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
    editorController.enterEditMode(body);
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

// In edit mode, link clicks are handled by contenteditable

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
