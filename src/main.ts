import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { renderMarkdown } from './renderer';
import { ScrollKeeper } from './scroll-keeper';
import { ThemeManager } from './theme';
import { handleSave } from './save';

interface ContentUpdate {
  body?: string;
  title?: string;
}

let currentContent = '';
let currentTitle = 'Untitled';
let isDirty = false;

const themeManager = new ThemeManager();

function updateWindowTitle(title: string) {
  document.getElementById('doc-title')!.textContent = title;
  getCurrentWindow().setTitle(`${title} — mdview`);
}

function updateDirtyIndicator(dirty: boolean) {
  const indicator = document.getElementById('dirty-indicator');
  if (indicator) {
    indicator.style.display = dirty ? 'inline' : 'none';
  }
}

async function renderMarkdownWithScrollKeep(content: string): Promise<void> {
  const container = document.getElementById('content')!;
  const scrollKeeper = new ScrollKeeper(container);

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
    updateDirtyIndicator(true);
    await renderMarkdownWithScrollKeep(update.body);
  }
  if (update.title !== undefined) {
    currentTitle = update.title;
    updateWindowTitle(currentTitle);
  }
});

// File change detection (file mode) — handled by Rust watcher via content-update event

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

// Save button
document.getElementById('btn-save')?.addEventListener('click', async () => {
  await handleSave(currentContent, currentTitle);
  isDirty = false;
  updateDirtyIndicator(false);
});

// Keyboard shortcut: Cmd+S / Ctrl+S
document.addEventListener('keydown', async (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    await handleSave(currentContent, currentTitle);
    isDirty = false;
    updateDirtyIndicator(false);
  }
});

// Theme toggle
document.getElementById('btn-theme')?.addEventListener('click', () => {
  themeManager.toggle();
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
