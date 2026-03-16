import { invoke } from '@tauri-apps/api/core';

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

export class UpdateModal {
  private overlay: HTMLElement;
  private body: HTMLElement;
  private busy = false;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'update-overlay';
    this.overlay.style.display = 'none';
    this.body = document.createElement('div');
    this.body.id = 'update-modal';
    this.overlay.appendChild(this.body);
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay && !this.busy) this.hide();
    });
  }

  async checkForUpdates(silent: boolean): Promise<void> {
    if (this.busy) return;
    let info: UpdateInfo;
    try {
      info = await invoke<UpdateInfo>('check_for_updates');
    } catch {
      if (!silent) this.showMessage('アップデートの確認に失敗しました。');
      return;
    }
    if (info.has_update) {
      this.showConfirm(
        `v${info.latest_version} が利用可能です（現在 v${info.current_version}）。\n更新しますか？`,
        '更新', 'キャンセル',
        () => this.performUpdate(),
      );
    } else if (!silent) {
      this.showMessage(`最新バージョン（v${info.current_version}）を使用中です。`);
    }
  }

  private async performUpdate(): Promise<void> {
    this.busy = true;
    this.showMessage('更新中...');
    const result = await invoke<UpdateResult>('perform_update');
    this.busy = false;
    if (result.success) {
      this.showConfirm('更新が完了しました。再起動しますか？', '再起動', '閉じる', async () => {
        await invoke('restart_app');
      });
    } else {
      this.showMessage(`更新に失敗しました。\n${result.message}`);
    }
  }

  private showMessage(text: string): void {
    this.body.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'update-modal-text';
    msg.textContent = text;
    this.body.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'update-modal-actions';
    const ok = document.createElement('button');
    ok.className = 'update-modal-btn update-modal-btn-primary';
    ok.textContent = 'OK';
    ok.addEventListener('click', () => this.hide());
    actions.appendChild(ok);
    this.body.appendChild(actions);

    this.show();
    ok.focus();
  }

  private showConfirm(text: string, yesLabel: string, noLabel: string, onYes: () => void): void {
    this.body.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'update-modal-text';
    msg.textContent = text;
    this.body.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'update-modal-actions';

    const no = document.createElement('button');
    no.className = 'update-modal-btn';
    no.textContent = noLabel;
    no.addEventListener('click', () => this.hide());
    actions.appendChild(no);

    const yes = document.createElement('button');
    yes.className = 'update-modal-btn update-modal-btn-primary';
    yes.textContent = yesLabel;
    yes.addEventListener('click', () => onYes());
    actions.appendChild(yes);

    this.body.appendChild(actions);
    this.show();
    yes.focus();
  }

  private show(): void {
    this.overlay.style.display = 'flex';
  }

  private hide(): void {
    this.overlay.style.display = 'none';
    this.body.innerHTML = '';
  }
}
