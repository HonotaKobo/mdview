import { invoke } from '@tauri-apps/api/core';
import { t } from './i18n';

interface HistoryConfig {
  enabled: boolean;
  snapshot_interval: number;
  include_network_paths: boolean;
  include_temp_files: boolean;
}

export class HistorySettingsModal {
  private overlay: HTMLElement;
  private modal: HTMLElement;

  private enabledCheck!: HTMLInputElement;
  private intervalInput!: HTMLInputElement;
  private networkCheck!: HTMLInputElement;
  private tempCheck!: HTMLInputElement;
  private titleEl!: HTMLElement;
  private enabledLabel!: HTMLElement;
  private intervalLabel!: HTMLElement;
  private networkLabel!: HTMLElement;
  private networkNote!: HTMLElement;
  private tempLabel!: HTMLElement;
  private saveBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'history-settings-overlay';
    this.overlay.style.display = 'none';

    this.modal = document.createElement('div');
    this.modal.id = 'history-settings-modal';
    this.overlay.appendChild(this.modal);
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    this.buildContent();
  }

  private buildContent(): void {
    // タイトル
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'history-settings-title';
    this.titleEl.textContent = t('ui.history_settings_title');
    this.modal.appendChild(this.titleEl);

    // 有効/無効
    this.modal.appendChild(this.createCheckRow(
      () => this.enabledCheck,
      (el) => { this.enabledCheck = el; },
      () => this.enabledLabel,
      (el) => { this.enabledLabel = el; },
      t('ui.history_settings_enabled'),
    ));

    // スナップショット間隔
    const intervalRow = document.createElement('div');
    intervalRow.className = 'history-settings-row';
    this.intervalLabel = document.createElement('label');
    this.intervalLabel.textContent = t('ui.history_settings_snapshot_interval');
    intervalRow.appendChild(this.intervalLabel);
    this.intervalInput = document.createElement('input');
    this.intervalInput.type = 'number';
    this.intervalInput.min = '5';
    this.intervalInput.max = '100';
    this.intervalInput.className = 'history-settings-number';
    intervalRow.appendChild(this.intervalInput);
    this.modal.appendChild(intervalRow);

    // ネットワークパス
    this.modal.appendChild(this.createCheckRow(
      () => this.networkCheck,
      (el) => { this.networkCheck = el; },
      () => this.networkLabel,
      (el) => { this.networkLabel = el; },
      t('ui.history_settings_network_paths'),
    ));

    // ネットワークパスの注意文
    this.networkNote = document.createElement('div');
    this.networkNote.className = 'history-settings-note';
    this.networkNote.textContent = t('ui.history_settings_network_paths_note');
    this.modal.appendChild(this.networkNote);

    // 一時ファイル
    this.modal.appendChild(this.createCheckRow(
      () => this.tempCheck,
      (el) => { this.tempCheck = el; },
      () => this.tempLabel,
      (el) => { this.tempLabel = el; },
      t('ui.history_settings_temp_files'),
    ));

    // ボタン行
    const actions = document.createElement('div');
    actions.className = 'history-settings-actions';

    this.cancelBtn = document.createElement('button');
    this.cancelBtn.className = 'update-modal-btn';
    this.cancelBtn.textContent = t('ui.history_settings_cancel');
    this.cancelBtn.addEventListener('click', () => this.hide());
    actions.appendChild(this.cancelBtn);

    this.saveBtn = document.createElement('button');
    this.saveBtn.className = 'update-modal-btn update-modal-btn-primary';
    this.saveBtn.textContent = t('ui.history_settings_save');
    this.saveBtn.addEventListener('click', () => this.save());
    actions.appendChild(this.saveBtn);

    this.modal.appendChild(actions);
  }

  private createCheckRow(
    _getCheck: () => HTMLInputElement,
    setCheck: (el: HTMLInputElement) => void,
    _getLabel: () => HTMLElement,
    setLabel: (el: HTMLElement) => void,
    text: string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'history-settings-row';
    const label = document.createElement('label');
    label.className = 'history-settings-check-label';
    const check = document.createElement('input');
    check.type = 'checkbox';
    setCheck(check);
    label.appendChild(check);
    const span = document.createElement('span');
    span.textContent = text;
    setLabel(span);
    label.appendChild(span);
    row.appendChild(label);
    return row;
  }

  async show(): Promise<void> {
    const config = await invoke<HistoryConfig>('history_get_config');
    this.enabledCheck.checked = config.enabled;
    this.intervalInput.value = String(config.snapshot_interval);
    this.networkCheck.checked = config.include_network_paths;
    this.tempCheck.checked = config.include_temp_files;
    this.overlay.style.display = 'flex';
  }

  private async save(): Promise<void> {
    const config: HistoryConfig = {
      enabled: this.enabledCheck.checked,
      snapshot_interval: Math.max(5, Math.min(100, parseInt(this.intervalInput.value) || 20)),
      include_network_paths: this.networkCheck.checked,
      include_temp_files: this.tempCheck.checked,
    };
    await invoke('history_set_config', { config });
    this.hide();
  }

  private hide(): void {
    this.overlay.style.display = 'none';
  }

  /** 未保存の変更履歴がある旨をモーダルで通知する */
  showUnsavedNotice(fileHash: string): void {
    // 設定フォームを一時的に隠して通知内容を表示
    const notice = document.createElement('div');
    notice.id = 'history-unsaved-notice';

    const msg = document.createElement('div');
    msg.className = 'update-modal-text';
    msg.textContent = t('ui.history_unsaved_notice');
    notice.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'history-settings-actions';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'update-modal-btn';
    closeBtn.textContent = t('ui.history_settings_cancel');
    closeBtn.addEventListener('click', () => {
      notice.remove();
      this.modal.style.display = '';
      this.hide();
    });
    actions.appendChild(closeBtn);

    const viewBtn = document.createElement('button');
    viewBtn.className = 'update-modal-btn update-modal-btn-primary';
    viewBtn.textContent = t('ui.history_unsaved_view');
    viewBtn.addEventListener('click', async () => {
      try {
        const body = await invoke<string>('history_restore_at', {
          fileHash,
          targetTimestamp: 0,
        });
        await invoke('open_new_window', { body });
      } catch (e) {
        console.error('History restore failed:', e);
      }
      notice.remove();
      this.modal.style.display = '';
      this.hide();
    });
    actions.appendChild(viewBtn);

    notice.appendChild(actions);

    // 設定フォームを隠して通知を表示
    this.modal.style.display = 'none';
    this.overlay.appendChild(notice);
    this.overlay.style.display = 'flex';

    // オーバーレイクリックで閉じる
    const onOverlayClick = (e: MouseEvent) => {
      if (e.target === this.overlay) {
        notice.remove();
        this.modal.style.display = '';
        this.hide();
        this.overlay.removeEventListener('click', onOverlayClick);
      }
    };
    this.overlay.addEventListener('click', onOverlayClick);
  }

  applyTranslations(): void {
    this.titleEl.textContent = t('ui.history_settings_title');
    this.enabledLabel.textContent = t('ui.history_settings_enabled');
    this.intervalLabel.textContent = t('ui.history_settings_snapshot_interval');
    this.networkLabel.textContent = t('ui.history_settings_network_paths');
    this.networkNote.textContent = t('ui.history_settings_network_paths_note');
    this.tempLabel.textContent = t('ui.history_settings_temp_files');
    this.saveBtn.textContent = t('ui.history_settings_save');
    this.cancelBtn.textContent = t('ui.history_settings_cancel');
  }
}
