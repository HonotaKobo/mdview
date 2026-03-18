import { invoke } from '@tauri-apps/api/core';
import { t } from './i18n';

export class TagAddModal {
  private overlay: HTMLElement;
  private input: HTMLInputElement;
  private currentPath: string | null = null;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'tag-add-overlay';
    this.overlay.className = 'tag-add-overlay fixed inset-0 bg-black/30 flex items-end justify-end p-4 z-[2000]';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <div class="tag-add-modal bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.2)] p-1 w-[360px]">
        <input id="tag-add-modal-input" class="w-full px-3.5 py-2.5 text-[15px] border-none rounded-md bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none" type="text" placeholder="" />
      </div>
    `;
    document.body.appendChild(this.overlay);
    this.input = document.getElementById('tag-add-modal-input') as HTMLInputElement;

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        this.hide();
      }
    });

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  async show(): Promise<void> {
    this.currentPath = await invoke<string | null>('get_saved_path');
    if (!this.currentPath) {
      alert(t('ui.tag_save_first_add'));
      return;
    }
    this.input.value = '';
    this.overlay.style.display = 'flex';
    this.input.focus();
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  applyTranslations(): void {
    this.input.placeholder = t('ui.tag_modal_placeholder');
  }

  private async submit(): Promise<void> {
    const tag = this.input.value.trim();
    if (!tag || !this.currentPath) return;
    await invoke('tag_add', { path: this.currentPath, tag });
    this.hide();
    this.overlay.dispatchEvent(new CustomEvent('tag-added'));
  }

  onTagAdded(callback: () => void): void {
    this.overlay.addEventListener('tag-added', () => callback());
  }
}
