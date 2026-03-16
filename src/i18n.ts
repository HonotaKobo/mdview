import { invoke } from '@tauri-apps/api/core';

let translations: Record<string, string> = {};

export async function loadTranslations(): Promise<void> {
  translations = await invoke<Record<string, string>>('get_translations');
}

export function t(key: string): string {
  return translations[key] || key;
}
