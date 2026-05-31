/**
 * Study Support - 設定コンポーネント
 * @module components/settings
 */
import { getAll, put, remove, generateId, getSetting, setSetting, exportAllData, importAllData, initDefaultSubjects } from '../db.js';

/**
 * 設定画面をレンダリング
 * @param {HTMLElement} container
 */
export async function renderSettings(container) {
  const subjects = await getAll('subjects');
  const googleClientId = await getSetting('googleClientId', '');
  const googleApiKey = await getSetting('googleApiKey', '');
  const geminiApiKey = await getSetting('geminiApiKey', '');
  const emailjsServiceId = await getSetting('emailjsServiceId', '');
  const emailjsTemplateId = await getSetting('emailjsTemplateId', '');
  const emailjsPublicKey = await getSetting('emailjsPublicKey', '');
  const emailAddress = await getSetting('emailAddress', '');
  const browserNotif = await getSetting('browserNotifEnabled', true);
  const emailNotif = await getSetting('emailNotifEnabled', false);
  const dailyTime = await getSetting('dailyNotifTime', '09:00');

  // 試験情報を取得
  const exams = await getAll('exams');
  const exam = exams.length > 0 ? exams[0] : null;
  const examName = exam?.name || '';
  const examDate = exam?.examDate || '';
  const dailyGoal = exam?.dailyGoal || 10;

  // カウントダウン計算
  let countdownText = '';
  if (examDate) {
    const days = Math.ceil((new Date(examDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (days > 0) countdownText = `⏰ 試験まで あと${days}日`;
    else if (days === 0) countdownText = '🔥 試験は今日です！';
    else countdownText = '✅ 試験日を過ぎています';
  }

  container.innerHTML = `
    <div class="settings-page">
      <header class="page-header">
        <h1 class="page-title">⚙️ 設定</h1>
      </header>

      <!-- 試験設定 -->
      <section class="card card-glass settings-section">
        <h2 class="section-title">🎓 試験設定</h2>
        <p class="section-desc">試験日から逆算して学習スケジュールを作成します</p>
        ${countdownText ? `<div class="exam-countdown" style="text-align:center;padding:12px;margin-bottom:16px;background:rgba(124,58,237,0.15);border-radius:12px;font-size:1.2em;font-weight:600;color:#a78bfa;">${countdownText}</div>` : ''}
        <form id="exam-form">
          <div class="form-group">
            <label>試験名</label>
            <input type="text" id="exam-name" class="input" value="${examName}" 
              placeholder="例: 簿記2級" required />
          </div>
          <div class="form-group">
            <label>試験日</label>
            <input type="date" id="exam-date" class="input" value="${examDate}" required />
          </div>
          <div class="form-group">
            <label>1日の目標問題数</label>
            <input type="number" id="daily-goal" class="input" value="${dailyGoal}" 
              min="3" max="50" />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      </section>

      <!-- Gemini API設定 -->
      <section class="card card-glass settings-section">
        <h2 class="section-title">🤖 Gemini API 設定</h2>
        <p class="section-desc">AIによる問題生成・分析に使用します（<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">API Key取得</a>）</p>
        <form id="gemini-api-form">
          <div class="form-group">
            <label>Gemini API Key</label>
            <input type="password" id="gemini-api-key" class="input" value="${geminiApiKey}" 
              placeholder="AIza..." />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">保存</button>
            <button type="button" class="btn btn-secondary" id="btn-test-gemini">接続テスト</button>
          </div>
        </form>
      </section>

      <!-- Google API設定 -->
      <section class="card card-glass settings-section">
        <h2 class="section-title">🔑 Google API 設定</h2>
        <p class="section-desc">Google DriveからPDFを取り込むために必要な設定です</p>
        <form id="google-api-form">
          <div class="form-group">
            <label>Client ID</label>
            <input type="text" id="google-client-id" class="input" value="${googleClientId}" 
              placeholder="xxxx.apps.googleusercontent.com" />
          </div>
          <div class="form-group">
            <label>API Key</label>
            <input type="text" id="google-api-key" class="input" value="${googleApiKey}" 
              placeholder="AIza..." />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">保存</button>
            <button type="button" class="btn btn-secondary" id="btn-test-google">接続テスト</button>
          </div>
        </form>
      </section>

      <!-- 通知設定 -->
      <section class="card card-glass settings-section">
        <h2 class="section-title">🔔 通知設定</h2>
        <form id="notification-form">
          <div class="form-group">
            <div class="toggle-row">
              <label>ブラウザ通知</label>
              <label class="toggle-switch">
                <input type="checkbox" id="browser-notif" ${browserNotif ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="form-group">
            <div class="toggle-row">
              <label>メール通知</label>
              <label class="toggle-switch">
                <input type="checkbox" id="email-notif" ${emailNotif ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="form-group">
            <label>毎日の通知時刻</label>
            <input type="time" id="daily-time" class="input" value="${dailyTime}" />
          </div>
          <div class="form-group">
            <label>通知先メールアドレス</label>
            <input type="email" id="email-address" class="input" value="${emailAddress}" 
              placeholder="you@example.com" />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">保存</button>
            <button type="button" class="btn btn-secondary" id="btn-test-notif">テスト通知</button>
          </div>
        </form>
      </section>

      <!-- EmailJS設定 -->
      <section class="card card-glass settings-section">
        <h2 class="section-title">📧 EmailJS 設定</h2>
        <p class="section-desc">メール通知の送信に <a href="https://www.emailjs.com/" target="_blank" rel="noopener">EmailJS</a> を使用します</p>
        <form id="emailjs-form">
          <div class="form-group">
            <label>Service ID</label>
            <input type="text" id="emailjs-service-id" class="input" value="${emailjsServiceId}" 
              placeholder="service_xxxx" />
          </div>
          <div class="form-group">
            <label>Template ID</label>
            <input type="text" id="emailjs-template-id" class="input" value="${emailjsTemplateId}" 
              placeholder="template_xxxx" />
          </div>
          <div class="form-group">
            <label>Public Key</label>
            <input type="text" id="emailjs-public-key" class="input" value="${emailjsPublicKey}" 
              placeholder="xxxx" />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      </section>

      <!-- 教科管理 -->
      <section class="card card-glass settings-section">
        <h2 class="section-title">📚 教科管理</h2>
        <div id="subjects-list" class="subjects-list">
          ${subjects.map(s => `
            <div class="subject-item" data-id="${s.id}">
              <span class="subject-color-dot" style="background: ${s.color}"></span>
              <span class="subject-icon-display">${s.icon}</span>
              <span class="subject-name-display">${s.name}</span>
              <button class="btn btn-icon btn-edit-subject" data-id="${s.id}" aria-label="編集">✏️</button>
              <button class="btn btn-icon btn-delete-subject" data-id="${s.id}" aria-label="削除">🗑️</button>
            </div>
          `).join('')}
        </div>
        <button id="btn-add-subject" class="btn btn-secondary btn-full">＋ 教科を追加</button>
      </section>

      <!-- データ管理 -->
      <section class="card card-glass settings-section">
        <h2 class="section-title">💾 データ管理</h2>
        <div class="data-actions">
          <button id="btn-export" class="btn btn-secondary">📤 データをエクスポート</button>
          <label class="btn btn-secondary" id="btn-import-label">
            📥 データをインポート
            <input type="file" id="import-file" accept=".json" hidden />
          </label>
          <button id="btn-reset-data" class="btn btn-danger">🗑️ 全データをリセット</button>
        </div>
      </section>
    </div>
  `;

  setupSettingsEvents();
}

/**
 * 設定画面のイベント設定
 */
function setupSettingsEvents() {
  // 試験設定保存
  document.getElementById('exam-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { get: getRecord } = await import('../db.js');
    const exams = await getAll('exams');
    const existing = exams.length > 0 ? exams[0] : null;
    const examData = {
      id: existing?.id || generateId(),
      name: document.getElementById('exam-name').value.trim(),
      examDate: document.getElementById('exam-date').value,
      dailyGoal: parseInt(document.getElementById('daily-goal').value) || 10,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await put('exams', examData);
    showSettingsToast('試験設定を保存しました');
  });

  // Gemini API Key保存
  document.getElementById('gemini-api-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await setSetting('geminiApiKey', document.getElementById('gemini-api-key').value.trim());
    showSettingsToast('Gemini API Keyを保存しました');
  });

  // Gemini接続テスト
  document.getElementById('btn-test-gemini')?.addEventListener('click', async () => {
    const key = document.getElementById('gemini-api-key').value.trim();
    if (!key) {
      showSettingsToast('API Keyを入力してください', 'error');
      return;
    }
    const btn = document.getElementById('btn-test-gemini');
    btn.textContent = 'テスト中...';
    btn.disabled = true;
    try {
      const { testApiKey } = await import('../services/gemini.js');
      const result = await testApiKey(key);
      if (result.success) {
        showSettingsToast('✅ Gemini API接続成功！', 'success');
      } else {
        showSettingsToast('❌ 接続失敗: ' + result.message, 'error');
      }
    } catch (err) {
      showSettingsToast('❌ エラー: ' + err.message, 'error');
    }
    btn.textContent = '接続テスト';
    btn.disabled = false;
  });

  // Google API設定保存
  document.getElementById('google-api-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await setSetting('googleClientId', document.getElementById('google-client-id').value.trim());
    await setSetting('googleApiKey', document.getElementById('google-api-key').value.trim());
    showSettingsToast('Google API設定を保存しました');
  });

  // Google接続テスト
  document.getElementById('btn-test-google')?.addEventListener('click', async () => {
    try {
      const { initGoogleAPI, authenticate } = await import('../services/google-drive.js');
      await initGoogleAPI();
      await authenticate();
      showSettingsToast('Google Driveに接続成功！', 'success');
    } catch (err) {
      showSettingsToast('接続に失敗しました: ' + err.message, 'error');
    }
  });

  // 通知設定保存
  document.getElementById('notification-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await setSetting('browserNotifEnabled', document.getElementById('browser-notif').checked);
    await setSetting('emailNotifEnabled', document.getElementById('email-notif').checked);
    await setSetting('dailyNotifTime', document.getElementById('daily-time').value);
    await setSetting('emailAddress', document.getElementById('email-address').value.trim());
    showSettingsToast('通知設定を保存しました');
  });

  // テスト通知
  document.getElementById('btn-test-notif')?.addEventListener('click', async () => {
    try {
      const { showBrowserNotification, sendEmailNotification } = await import('../services/scheduler.js');
      
      if (document.getElementById('browser-notif').checked) {
        await showBrowserNotification('テスト通知', '通知が正常に動作しています！');
      }
      
      if (document.getElementById('email-notif').checked) {
        await sendEmailNotification('Study Support テスト', 'メール通知が正常に動作しています！');
      }
      
      showSettingsToast('テスト通知を送信しました');
    } catch (err) {
      showSettingsToast('通知の送信に失敗しました: ' + err.message, 'error');
    }
  });

  // EmailJS設定保存
  document.getElementById('emailjs-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await setSetting('emailjsServiceId', document.getElementById('emailjs-service-id').value.trim());
    await setSetting('emailjsTemplateId', document.getElementById('emailjs-template-id').value.trim());
    await setSetting('emailjsPublicKey', document.getElementById('emailjs-public-key').value.trim());
    showSettingsToast('EmailJS設定を保存しました');
  });

  // 教科追加
  document.getElementById('btn-add-subject')?.addEventListener('click', showAddSubjectDialog);

  // 教科編集・削除
  document.querySelectorAll('.btn-edit-subject').forEach(btn => {
    btn.addEventListener('click', () => showEditSubjectDialog(btn.dataset.id));
  });
  document.querySelectorAll('.btn-delete-subject').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('この教科を削除しますか？関連する教材は残ります。')) {
        await remove('subjects', btn.dataset.id);
        showSettingsToast('教科を削除しました');
        // ページ再描画
        const container = document.querySelector('.settings-page')?.parentElement;
        if (container) {
          const { renderSettings } = await import('./settings.js');
          await renderSettings(container);
        }
      }
    });
  });

  // データエクスポート
  document.getElementById('btn-export')?.addEventListener('click', async () => {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `study-support-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showSettingsToast('データをエクスポートしました');
  });

  // データインポート
  document.getElementById('import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (confirm('現在のデータを上書きしてインポートしますか？')) {
        await importAllData(data);
        showSettingsToast('データをインポートしました。ページを再読み込みします。');
        setTimeout(() => location.reload(), 1500);
      }
    } catch (err) {
      showSettingsToast('インポートに失敗しました: ' + err.message, 'error');
    }
  });

  // データリセット
  document.getElementById('btn-reset-data')?.addEventListener('click', async () => {
    if (confirm('本当に全データをリセットしますか？この操作は取り消せません。')) {
      if (confirm('最終確認: すべての教材、テスト結果、進捗データが削除されます。')) {
        const { clear } = await import('../db.js');
        const stores = ['subjects', 'materials', 'pdfCache', 'materialContent', 'pageTracking',
                        'studySessions', 'questions', 'testResults', 'progress', 'settings',
                        'dailyLog', 'exams', 'schedule'];
        for (const store of stores) {
          await clear(store);
        }
        await initDefaultSubjects();
        showSettingsToast('データをリセットしました');
        setTimeout(() => location.reload(), 1500);
      }
    }
  });
}

/**
 * 教科追加ダイアログ
 */
function showAddSubjectDialog() {
  const modalContainer = document.getElementById('modal-container');
  const modalContent = document.getElementById('modal-content');
  if (!modalContainer || !modalContent) return;

  modalContent.innerHTML = `
    <h3>教科を追加</h3>
    <form id="add-subject-form">
      <div class="form-group">
        <label>教科名</label>
        <input type="text" id="subject-name" class="input" placeholder="例: 物理" required />
      </div>
      <div class="form-group">
        <label>アイコン（絵文字）</label>
        <input type="text" id="subject-icon" class="input" placeholder="例: 🔬" maxlength="4" />
      </div>
      <div class="form-group">
        <label>テーマカラー</label>
        <input type="color" id="subject-color" class="input" value="#6366f1" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-container').hidden=true">キャンセル</button>
        <button type="submit" class="btn btn-primary">追加</button>
      </div>
    </form>
  `;

  modalContainer.removeAttribute('hidden');

  document.getElementById('add-subject-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = {
      id: generateId(),
      name: document.getElementById('subject-name').value.trim(),
      icon: document.getElementById('subject-icon').value.trim() || '📖',
      color: document.getElementById('subject-color').value,
      createdAt: new Date().toISOString(),
    };
    await put('subjects', subject);
    modalContainer.setAttribute('hidden', '');
    showSettingsToast(`教科「${subject.name}」を追加しました`);
    
    const container = document.querySelector('.settings-page')?.parentElement;
    if (container) {
      const { renderSettings } = await import('./settings.js');
      await renderSettings(container);
    }
  });
}

/**
 * 教科編集ダイアログ
 */
async function showEditSubjectDialog(subjectId) {
  const { get } = await import('../db.js');
  const subject = await get('subjects', subjectId);
  if (!subject) return;

  const modalContainer = document.getElementById('modal-container');
  const modalContent = document.getElementById('modal-content');
  if (!modalContainer || !modalContent) return;

  modalContent.innerHTML = `
    <h3>教科を編集</h3>
    <form id="edit-subject-form">
      <div class="form-group">
        <label>教科名</label>
        <input type="text" id="edit-subject-name" class="input" value="${subject.name}" required />
      </div>
      <div class="form-group">
        <label>アイコン（絵文字）</label>
        <input type="text" id="edit-subject-icon" class="input" value="${subject.icon}" maxlength="4" />
      </div>
      <div class="form-group">
        <label>テーマカラー</label>
        <input type="color" id="edit-subject-color" class="input" value="${subject.color}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-container').hidden=true">キャンセル</button>
        <button type="submit" class="btn btn-primary">保存</button>
      </div>
    </form>
  `;

  modalContainer.removeAttribute('hidden');

  document.getElementById('edit-subject-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    subject.name = document.getElementById('edit-subject-name').value.trim();
    subject.icon = document.getElementById('edit-subject-icon').value.trim() || '📖';
    subject.color = document.getElementById('edit-subject-color').value;
    await put('subjects', subject);
    modalContainer.setAttribute('hidden', '');
    showSettingsToast(`教科「${subject.name}」を更新しました`);
    
    const container = document.querySelector('.settings-page')?.parentElement;
    if (container) {
      const { renderSettings } = await import('./settings.js');
      await renderSettings(container);
    }
  });
}

/**
 * 設定用トースト
 */
function showSettingsToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type} toast-show`;
  toast.innerHTML = `<span class="toast-message">${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
