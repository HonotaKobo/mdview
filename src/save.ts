import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

export async function handleSave(
  content: string,
  defaultTitle: string
): Promise<void> {
  const savedPath = await invoke<string | null>('get_saved_path');

  if (savedPath) {
    // Overwrite existing file
    await invoke('save_file', { path: savedPath, content });
    await invoke('notify_saved', { path: savedPath });
  } else {
    // Save As dialog
    await handleSaveAs(content, defaultTitle);
  }
}

export async function handleSaveAs(
  content: string,
  defaultTitle: string
): Promise<void> {
  const filePath = await save({
    defaultPath: `${defaultTitle}.md`,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });

  if (filePath) {
    await invoke('save_file', { path: filePath, content });
    await invoke('notify_saved', { path: filePath });
  }
}

export async function handleRename(): Promise<string | null> {
  const savedPath = await invoke<string | null>('get_saved_path');
  if (!savedPath) return null;

  const dir = savedPath.substring(0, savedPath.lastIndexOf('/') + 1) ||
    savedPath.substring(0, savedPath.lastIndexOf('\\') + 1);
  const oldName = savedPath.split(/[\\/]/).pop() || '';

  const newPath = await save({
    defaultPath: dir + oldName,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });

  if (newPath && newPath !== savedPath) {
    const absPath = await invoke<string>('rename_file', {
      oldPath: savedPath,
      newPath,
    });
    return absPath;
  }
  return null;
}
