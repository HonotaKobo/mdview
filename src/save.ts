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
    const filePath = await save({
      defaultPath: `${defaultTitle}.md`,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });

    if (filePath) {
      await invoke('save_file', { path: filePath, content });
      await invoke('notify_saved', { path: filePath });
    }
  }
}
