import { invoke } from '@tauri-apps/api/core';
import { t } from './i18n';

export interface UnsavedDiffResult {
  saved_content: string;
  latest_content: string;
  diff_lines: { op: string; text: string }[];
  unsaved_count: number;
  last_saved_timestamp: number;
}

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

  /** 未保存デルタの差分を表示するモーダル */
  showUnsavedDiffModal(
    fileHash: string,
    diff: UnsavedDiffResult,
    callbacks: {
      onDiscard: () => void;
      onOpenTemp: (content: string) => void;
      onSave: (content: string) => void;
    },
  ): void {
    // 独立したオーバーレイを作成
    const overlay = document.createElement('div');
    overlay.id = 'unsaved-diff-overlay';

    const modal = document.createElement('div');
    modal.id = 'unsaved-diff-modal';

    // タイトル
    const title = document.createElement('div');
    title.className = 'history-settings-title';
    title.textContent = t('ui.history_unsaved_diff_title');
    modal.appendChild(title);

    // 説明文
    const desc = document.createElement('div');
    desc.className = 'update-modal-text';
    desc.textContent = t('ui.history_unsaved_diff_desc').replace('{count}', String(diff.unsaved_count));
    modal.appendChild(desc);

    // 差分表示エリア
    const diffView = document.createElement('div');
    diffView.className = 'unsaved-diff-view';
    for (const line of diff.diff_lines) {
      const row = document.createElement('div');
      row.className = `diff-line diff-${line.op}`;

      const prefix = document.createElement('span');
      prefix.className = 'diff-prefix';
      if (line.op === 'delete') {
        prefix.textContent = '-';
      } else if (line.op === 'insert') {
        prefix.textContent = '+';
      } else {
        prefix.textContent = ' ';
      }
      row.appendChild(prefix);
      row.appendChild(document.createTextNode(line.text));
      diffView.appendChild(row);
    }
    modal.appendChild(diffView);

    // ボタン行
    const actions = document.createElement('div');
    actions.className = 'history-settings-actions';

    const close = () => {
      overlay.remove();
    };

    // 反映しない（削除）
    const discardBtn = document.createElement('button');
    discardBtn.className = 'update-modal-btn';
    discardBtn.textContent = t('ui.history_unsaved_discard');
    discardBtn.addEventListener('click', async () => {
      try {
        await invoke('history_delete_unsaved', { fileHash });
      } catch (e) {
        console.error('Failed to delete unsaved entries:', e);
      }
      callbacks.onDiscard();
      close();
    });
    actions.appendChild(discardBtn);

    // 一時ファイルで開く
    const openTempBtn = document.createElement('button');
    openTempBtn.className = 'update-modal-btn';
    openTempBtn.textContent = t('ui.history_unsaved_open_temp');
    openTempBtn.addEventListener('click', () => {
      callbacks.onOpenTemp(diff.latest_content);
    });
    actions.appendChild(openTempBtn);

    // 保存
    const saveBtn = document.createElement('button');
    saveBtn.className = 'update-modal-btn update-modal-btn-primary';
    saveBtn.textContent = t('ui.history_unsaved_save');
    saveBtn.addEventListener('click', () => {
      callbacks.onSave(diff.latest_content);
      close();
    });
    actions.appendChild(saveBtn);

    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

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
