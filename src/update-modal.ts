import { check } from '@tauri-apps/plugin-updater';
import { invoke } from '@tauri-apps/api/core';

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
    let update;
    try {
      update = await check();
    } catch {
      if (!silent) this.showMessage('アップデートの確認に失敗しました。');
      return;
    }
    if (update) {
      const available = update;
      this.showConfirm(
        `v${available.version} が利用可能です（現在 v${available.currentVersion}）。\n更新しますか？`,
        '更新', 'キャンセル',
        () => this.performUpdate(available),
      );
    } else if (!silent) {
      this.showMessage('最新バージョンを使用中です。');
    }
  }

  private async performUpdate(update: NonNullable<Awaited<ReturnType<typeof check>>>): Promise<void> {
    this.busy = true;
    this.showProgress(0);

    let contentLength = 0;
    let downloaded = 0;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          contentLength = (event.data as { contentLength?: number }).contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += (event.data as { chunkLength: number }).chunkLength;
          if (contentLength > 0) {
            const percent = Math.min(Math.round((downloaded / contentLength) * 100), 100);
            this.updateProgress(percent);
          }
        } else if (event.event === 'Finished') {
          this.updateProgress(100);
        }
      });
    } catch (e) {
      this.busy = false;
      this.showMessage(`更新に失敗しました。\n${e}`);
      return;
    }

    this.busy = false;
    this.showConfirm('更新が完了しました。再起動しますか？', '再起動', '閉じる', async () => {
      await invoke('restart_app');
    });
  }

  private showProgress(percent: number): void {
    this.body.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'update-modal-text';
    msg.textContent = 'ダウンロード中...';
    this.body.appendChild(msg);

    const track = document.createElement('div');
    track.className = 'update-progress-track';
    const bar = document.createElement('div');
    bar.className = 'update-progress-bar';
    bar.style.width = `${percent}%`;
    track.appendChild(bar);
    this.body.appendChild(track);

    const label = document.createElement('div');
    label.className = 'update-progress-label';
    label.textContent = `${percent}%`;
    this.body.appendChild(label);

    this.show();
  }

  private updateProgress(percent: number): void {
    const bar = this.body.querySelector('.update-progress-bar') as HTMLElement | null;
    if (bar) bar.style.width = `${percent}%`;
    const label = this.body.querySelector('.update-progress-label');
    if (label) label.textContent = `${percent}%`;

    const msg = this.body.querySelector('.update-modal-text');
    if (msg && percent >= 100) {
      msg.textContent = 'インストール中...';
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
