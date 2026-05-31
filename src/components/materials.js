/**
 * Study Support - 教材管理コンポーネント
 * @module components/materials
 */
import { getAll, put, remove, generateId, logDailyStudy } from '../db.js';

/**
 * 教材管理画面をレンダリング
 * @param {HTMLElement} container
 */
export async function renderMaterials(container) {
  const subjects = await getAll('subjects');

  container.innerHTML = `
    <div class="materials-page">
      <header class="page-header">
        <h1 class="page-title">📖 教材管理</h1>
        <div class="page-actions">
          <button id="btn-create-schedule" class="btn btn-primary">
            <span>📅</span> スケジュール作成
          </button>
          <button id="btn-add-material" class="btn btn-secondary">
            <span>＋</span> 教材を追加
          </button>
          <button id="btn-sync-drive" class="btn btn-secondary">
            <span>🔄</span> Drive同期
          </button>
        </div>
      </header>

      <!-- フィルター -->
      <div class="filter-bar card-glass">
        <div class="tabs" id="type-tabs">
          <button class="tab tab-active" data-type="all">すべて</button>
          <button class="tab" data-type="textbook">📚 教材</button>
          <button class="tab" data-type="exercise">📝 演習問題</button>
        </div>
        <div class="subject-filter">
          <select id="subject-filter" class="select">
            <option value="">全教科</option>
            ${subjects.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- 教材カードグリッド -->
      <div id="materials-grid" class="materials-grid">
        <div class="loading-placeholder">読み込み中...</div>
      </div>

      <!-- 手動セッション記録モーダル -->
      <div id="session-modal" class="modal-container" hidden>
        <div class="modal-backdrop"></div>
        <div class="modal-content">
          <h3>📝 学習セッションを記録</h3>
          <form id="session-form">
            <input type="hidden" id="session-material-id" />
            <div class="form-group">
              <label>学習したページ範囲</label>
              <div class="range-input-group">
                <input type="number" id="session-start-page" class="input" placeholder="開始ページ" min="1" />
                <span class="range-separator">〜</span>
                <input type="number" id="session-end-page" class="input" placeholder="終了ページ" min="1" />
              </div>
            </div>
            <div class="form-group">
              <label>学習時間（分）</label>
              <input type="number" id="session-duration" class="input" placeholder="例: 30" min="1" />
            </div>
            <div class="form-group">
              <label>メモ（任意）</label>
              <textarea id="session-notes" class="textarea" placeholder="学習内容のメモ..." rows="3"></textarea>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" id="btn-cancel-session">キャンセル</button>
              <button type="submit" class="btn btn-primary">記録する</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  // イベントリスナー
  setupMaterialsEvents(subjects);
  
  // 教材一覧を読み込み
  await loadMaterials();
}

/**
 * イベントリスナーを設定
 */
function setupMaterialsEvents(subjects) {
  // スケジュール作成ボタン
  document.getElementById('btn-create-schedule')?.addEventListener('click', createSchedule);

  // 教材追加ボタン
  document.getElementById('btn-add-material')?.addEventListener('click', () => {
    showAddMaterialDialog(subjects);
  });

  // Drive同期ボタン
  document.getElementById('btn-sync-drive')?.addEventListener('click', async () => {
    await syncAllFromDrive();
  });

  // タイプフィルター
  document.getElementById('type-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#type-tabs .tab').forEach(t => t.classList.remove('tab-active'));
    tab.classList.add('tab-active');
    loadMaterials();
  });

  // 教科フィルター
  document.getElementById('subject-filter')?.addEventListener('change', () => {
    loadMaterials();
  });

  // セッション記録モーダル
  document.getElementById('btn-cancel-session')?.addEventListener('click', () => {
    document.getElementById('session-modal')?.setAttribute('hidden', '');
  });

  document.getElementById('session-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveManualSession();
  });
}

/**
 * スケジュール作成（PDFアップロード無し / 目次テキスト→配分→コードで日付確定）
 */
async function createSchedule() {
  const { getSetting, clear } = await import('../db.js');

  const apiKey = await getSetting('geminiApiKey', '');
  if (!apiKey) {
    showToast('先に設定画面でGemini API Keyを登録してください', 'warning');
    return;
  }

  const exams = await getAll('exams');
  if (exams.length === 0) {
    showToast('先に設定画面で試験日を登録してください', 'warning');
    return;
  }
  const exam = exams[0];

  const daysRemaining = Math.ceil((new Date(exam.examDate) - new Date()) / (1000 * 60 * 60 * 24));
  if (!exam.examDate || !Number.isFinite(daysRemaining) || daysRemaining < 1) {
    showToast('試験日は未来の日付で設定してください', 'warning');
    return;
  }

  const materials = await getAll('materials');
  if (materials.length === 0) {
    showToast('先に教材を追加してください', 'warning');
    return;
  }

  const modalContainer = document.getElementById('modal-container');
  const modalContent = document.getElementById('modal-content');
  if (modalContainer && modalContent) {
    modalContent.innerHTML = `
      <div style="text-align: center; padding: 32px;">
        <div class="loading-spinner"></div>
        <p id="schedule-progress" style="margin-top: 16px; color: #a78bfa;">教材を解析中...</p>
      </div>
    `;
    modalContainer.removeAttribute('hidden');
  }
  const setP = (t) => { const e = document.getElementById('schedule-progress'); if (e) e.textContent = t; };

  try {
    const { getOrParseContent } = await import('../services/material-manager.js');
    const { chaptersToText, fallbackChapters, capChapters } = await import('../services/pdf-parser.js');
    const { generateScheduleAllocation } = await import('../services/gemini.js');
    const { buildScheduleFromAllocation } = await import('../services/scheduler.js');

    // 教材が多いほど1冊あたりの章数を絞り、配分出力の肥大化（トークン上限切れ）を防ぐ
    const perMaterialCap = materials.length >= 8 ? 6 : (materials.length >= 4 ? 8 : 12);

    // 各教材のローカル解析結果（目次）を集める。未解析なら自動再解析
    const outlines = [];
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      setP(`📖 教材を解析中... (${i + 1}/${materials.length}) ${m.title}`);
      const content = await getOrParseContent(m.id);
      const numPages = content?.numPages || m.totalPages || 0;
      const baseChapters = content?.chapters?.length
        ? content.chapters
        : fallbackChapters(numPages, `${m.title.slice(0, 12)} パート`);
      const chapters = capChapters(baseChapters, perMaterialCap);
      outlines.push({ title: m.title, type: m.type, numPages, chaptersText: chaptersToText(chapters) });
    }

    setP('📋 学習計画を作成中...');
    const alloc = await generateScheduleAllocation(exam, outlines, daysRemaining);
    if (!alloc.allocation || alloc.allocation.length === 0) {
      throw new Error('学習計画の生成結果が空でした');
    }

    setP('📅 日程を割り付け中...');
    const entries = buildScheduleFromAllocation(alloc.allocation, exam);
    if (entries.length === 0) {
      throw new Error('スケジュールの日程を作成できませんでした');
    }

    // 保存（日付はコードで確定済み・問題は学習時に遅延生成）
    await clear('schedule');
    const titleToMaterial = new Map(materials.map(m => [m.title, m]));
    for (const entry of entries) {
      let mat = titleToMaterial.get(entry.materialTitle);
      if (!mat && entry.materialTitle) {
        for (const m of materials) {
          if (entry.materialTitle.includes(m.title) || m.title.includes(entry.materialTitle)) { mat = m; break; }
        }
      }
      await put('schedule', {
        id: generateId(),
        examId: exam.id,
        materialId: mat?.id || null,
        materialTitle: entry.materialTitle || mat?.title || '',
        subjectId: mat?.subjectId || null,
        date: entry.date,
        dayNumber: entry.day,
        pageRange: entry.pageRange || '',
        topic: entry.topic || '',
        isReview: entry.isReview || false,
        questionIds: [],
        questionCount: entry.questionCount || exam.dailyGoal || 10,
        needsQuestions: true,
        status: 'pending',
        version: 1,
      });
    }

    if (modalContainer) modalContainer.setAttribute('hidden', '');
    showToast(`学習スケジュール作成完了！${entries.length}日分（問題は学習時に自動生成）`, 'success');
    window.location.hash = '#/';
  } catch (err) {
    console.error('Schedule creation failed:', err);
    if (modalContainer) modalContainer.setAttribute('hidden', '');
    showToast('スケジュール作成に失敗しました: ' + err.message, 'error');
  }
}

/**
 * 教材一覧を読み込んで表示
 */
async function loadMaterials() {
  const grid = document.getElementById('materials-grid');
  if (!grid) return;

  const materials = await getAll('materials');
  const subjects = await getAll('subjects');
  const pageTrackings = await getAll('pageTracking');
  const testResults = await getAll('testResults');

  // フィルター適用
  const activeType = document.querySelector('#type-tabs .tab-active')?.dataset.type || 'all';
  const selectedSubject = document.getElementById('subject-filter')?.value || '';

  let filtered = materials;
  if (activeType !== 'all') {
    filtered = filtered.filter(m => m.type === activeType);
  }
  if (selectedSubject) {
    filtered = filtered.filter(m => m.subjectId === selectedSubject);
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state large">
        <div class="empty-icon">📚</div>
        <h3>教材がありません</h3>
        <p>「教材を追加」ボタンから教材PDFを取り込みましょう</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(material => {
    const subject = subjects.find(s => s.id === material.subjectId);
    const tracking = pageTrackings.filter(t => t.materialId === material.id);
    
    const readPages = tracking.filter(t => t.status !== 'unread').length;
    const totalPages = material.totalPages || 0;
    const readPercent = totalPages > 0 ? Math.round((readPages / totalPages) * 100) : 0;
    // 定着度: この教材のテスト正答率。一度読んだだけ（読了）では上がらず、
    // テストで正解して初めて上がる＝「読んだ＝完璧」にならないようにする指標。
    const matTests = testResults.filter(t => t.materialId === material.id);
    const testCount = matTests.length;
    const correctCount = matTests.filter(t => t.isCorrect).length;
    const masteryPercent = testCount > 0 ? Math.round((correctCount / testCount) * 100) : 0;
    const masteryColor = testCount === 0
      ? 'rgba(255,255,255,0.15)'
      : (masteryPercent >= 80 ? '#10b981' : masteryPercent >= 60 ? '#f59e0b' : '#ef4444');
    const typeLabel = material.type === 'exercise' ? '演習問題' : '教材';
    const typeClass = material.type === 'exercise' ? 'type-exercise' : 'type-textbook';
    // ローカル解析の状態を表示（テキスト抽出済み / 章検出 / スキャンPDF警告）
    let geminiTag = '';
    if (material.hasText) {
      const chapterInfo = material.chapterCount > 0 ? ` 章${material.chapterCount}` : '';
      geminiTag = `<span class="badge badge-success" style="font-size:0.7em">✅ 解析済み${chapterInfo}</span>`;
    } else if (totalPages > 0) {
      geminiTag = '<span class="badge badge-warning" style="font-size:0.7em" title="文字情報が抽出できませんでした（スキャンPDFの可能性）">⚠️ 画像PDF</span>';
    }

    return `
      <div class="material-card" data-id="${material.id}">
        <div class="material-card-header">
          <span class="material-type ${typeClass}">${typeLabel}</span>
          <button class="material-menu-btn" data-id="${material.id}" aria-label="メニュー">⋮</button>
        </div>
        <div class="material-card-body">
          <h3 class="material-title">${material.title}</h3>
          <div class="material-meta">
            <span class="material-subject" style="color: ${subject?.color || '#888'}">${subject?.icon || ''} ${subject?.name || '未分類'}</span>
            <span class="material-pages">${totalPages}ページ</span>
          </div>
        </div>
        <div class="material-card-footer">
          <div class="dual-progress">
            <div class="dp-row">
              <span class="dp-label">📖 読了</span>
              <div class="progress-bar slim"><div class="progress-fill" style="width:${readPercent}%; background:${subject?.color || '#3b82f6'}"></div></div>
              <span class="dp-val">${readPercent}%</span>
            </div>
            <div class="dp-row" title="テストの正答率による定着度。読んだだけでは上がりません。">
              <span class="dp-label">🎯 定着</span>
              <div class="progress-bar slim"><div class="progress-fill" style="width:${masteryPercent}%; background:${masteryColor}"></div></div>
              <span class="dp-val">${testCount > 0 ? masteryPercent + '%' : '未'}</span>
            </div>
          </div>
          <div class="material-stats">
            <span class="read-detail">${readPages}/${totalPages}p 読了 ・ テスト ${testCount > 0 ? correctCount + '/' + testCount + '問' : '未受験'}</span>
          </div>
          <div class="material-buttons">
            <button class="btn btn-sm btn-primary btn-timer" data-id="${material.id}">▶ 計測</button>
            <button class="btn btn-sm btn-secondary btn-record-session" data-id="${material.id}" data-pages="${totalPages}">📝 記録</button>
            ${geminiTag}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // カードクリックイベント


  grid.querySelectorAll('.btn-record-session').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSessionModal(btn.dataset.id, parseInt(btn.dataset.pages) || 100);
    });
  });

  // 学習タイマー開始
  grid.querySelectorAll('.btn-timer').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { start, isRunning } = await import('../services/study-timer.js');
      if (isRunning()) {
        showToast('すでに計測中です（右下のタイマーで停止できます）', 'warning');
        return;
      }
      const mat = materials.find(m => m.id === btn.dataset.id);
      start(btn.dataset.id, mat?.title || '学習');
      const { mountTimer } = await import('./timer-widget.js');
      mountTimer();
      showToast('⏱ 学習タイマーを開始しました', 'success');
    });
  });

  grid.querySelectorAll('.material-menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showMaterialMenu(btn.dataset.id, e);
    });
  });
}

/**
 * 教材追加ダイアログを表示
 */
async function showAddMaterialDialog(subjects) {
  const modalContainer = document.getElementById('modal-container');
  const modalContent = document.getElementById('modal-content');
  if (!modalContainer || !modalContent) return;

  modalContent.innerHTML = `
    <h3>📚 教材を追加</h3>
    <form id="add-material-form">
      <div class="form-group">
        <label>追加方法</label>
        <div class="tabs" id="add-method-tabs">
          <button type="button" class="tab tab-active" data-method="drive">Google Drive</button>
          <button type="button" class="tab" data-method="local">ローカルファイル</button>
        </div>
      </div>
      
      <div id="drive-section">
        <button type="button" class="btn btn-primary btn-full" id="btn-pick-file">
          📁 Google Driveからファイルを選択
        </button>
        <div id="picked-file-info" class="picked-file-info" hidden>
          <span id="picked-file-name"></span>
          <button type="button" class="btn btn-sm btn-secondary" id="btn-clear-file">✕</button>
        </div>
      </div>

      <div id="local-section" hidden>
        <label class="file-drop-zone" id="file-drop-zone">
          <input type="file" id="local-file-input" accept=".pdf" hidden />
          <span class="drop-icon">📄</span>
          <span>PDFファイルをドロップまたはクリック</span>
        </label>
      </div>

      <div class="form-group">
        <label>タイトル</label>
        <input type="text" id="add-title" class="input" placeholder="教材のタイトル" required />
      </div>
      <div class="form-group">
        <label>種類</label>
        <select id="add-type" class="select">
          <option value="textbook">📚 教材</option>
          <option value="exercise">📝 演習問題</option>
        </select>
      </div>
      <div class="form-group">
        <label>教科</label>
        <select id="add-subject" class="select" required>
          <option value="">選択してください</option>
          ${subjects.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="btn-cancel-add">キャンセル</button>
        <button type="submit" class="btn btn-primary">追加</button>
      </div>
    </form>
  `;

  modalContainer.removeAttribute('hidden');

  // 追加方法の切り替え
  document.getElementById('add-method-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#add-method-tabs .tab').forEach(t => t.classList.remove('tab-active'));
    tab.classList.add('tab-active');
    const method = tab.dataset.method;
    document.getElementById('drive-section').hidden = method !== 'drive';
    document.getElementById('local-section').hidden = method !== 'local';
  });

  // Google Driveファイル選択
  let pickedFile = null;
  document.getElementById('btn-pick-file')?.addEventListener('click', async () => {
    try {
      const { showPicker } = await import('../services/google-drive.js');
      pickedFile = await showPicker();
      if (pickedFile) {
        document.getElementById('picked-file-name').textContent = pickedFile.name;
        document.getElementById('picked-file-info')?.removeAttribute('hidden');
        document.getElementById('add-title').value = pickedFile.name.replace('.pdf', '');
      }
    } catch (err) {
      showToast('Google Driveに接続できません。設定を確認してください。', 'error');
    }
  });

  document.getElementById('btn-clear-file')?.addEventListener('click', () => {
    pickedFile = null;
    document.getElementById('picked-file-info')?.setAttribute('hidden', '');
  });

  // ローカルファイル選択
  let localFile = null;
  const fileInput = document.getElementById('local-file-input');
  const dropZone = document.getElementById('file-drop-zone');

  dropZone?.addEventListener('click', () => fileInput?.click());
  dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) {
      localFile = e.dataTransfer.files[0];
      dropZone.querySelector('span:last-child').textContent = localFile.name;
      document.getElementById('add-title').value = localFile.name.replace('.pdf', '');
    }
  });
  fileInput?.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      localFile = e.target.files[0];
      dropZone.querySelector('span:last-child').textContent = localFile.name;
      document.getElementById('add-title').value = localFile.name.replace('.pdf', '');
    }
  });

  // キャンセル
  document.getElementById('btn-cancel-add')?.addEventListener('click', () => {
    modalContainer.setAttribute('hidden', '');
  });
  modalContainer.querySelector('.modal-backdrop')?.addEventListener('click', () => {
    modalContainer.setAttribute('hidden', '');
  });

  // フォーム送信
  document.getElementById('add-material-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const title = document.getElementById('add-title').value.trim();
    const type = document.getElementById('add-type').value;
    const subjectId = document.getElementById('add-subject').value;
    
    if (!title || !subjectId) {
      showToast('タイトルと教科を入力してください', 'warning');
      return;
    }

    let pdfBlob = null;
    let driveFileId = null;

    if (pickedFile) {
      // Google Driveからダウンロード
      try {
        const { downloadFile } = await import('../services/google-drive.js');
        showToast('ダウンロード中...', 'info');
        pdfBlob = await downloadFile(pickedFile.id);
        driveFileId = pickedFile.id;
      } catch (err) {
        showToast('ファイルのダウンロードに失敗しました', 'error');
        return;
      }
    } else if (localFile) {
      pdfBlob = localFile;
    } else {
      showToast('ファイルを選択してください', 'warning');
      return;
    }

    try {
      const { addMaterial } = await import('../services/material-manager.js');
      await addMaterial(driveFileId, title, subjectId, type, pdfBlob);
      showToast(`「${title}」を追加しました`, 'success');
      modalContainer.setAttribute('hidden', '');
      await loadMaterials();
    } catch (err) {
      showToast('教材の追加に失敗しました: ' + err.message, 'error');
    }
  });
}

/**
 * 手動セッション記録モーダルを開く
 */
function openSessionModal(materialId, totalPages) {
  const modal = document.getElementById('session-modal');
  if (!modal) return;
  
  document.getElementById('session-material-id').value = materialId;
  document.getElementById('session-end-page').max = totalPages;
  document.getElementById('session-start-page').max = totalPages;
  modal.removeAttribute('hidden');
}

/**
 * 手動セッションを保存
 */
async function saveManualSession() {
  const materialId = document.getElementById('session-material-id').value;
  const startPage = parseInt(document.getElementById('session-start-page').value);
  const endPage = parseInt(document.getElementById('session-end-page').value);
  const duration = parseInt(document.getElementById('session-duration').value);
  const notes = document.getElementById('session-notes').value.trim();

  if (!startPage || !endPage || startPage > endPage) {
    showToast('ページ範囲を正しく入力してください', 'warning');
    return;
  }

  try {
    const { ReadingTracker } = await import('../services/reading-tracker.js');
    const tracker = new ReadingTracker(materialId);
    await tracker.recordManualSession(startPage, endPage, duration || 0, notes);
    await logDailyStudy();
    
    showToast(`P.${startPage}〜P.${endPage} を記録しました`, 'success');
    document.getElementById('session-modal')?.setAttribute('hidden', '');
    
    // フォームリセット
    document.getElementById('session-form')?.reset();
    
    // 一覧を更新
    await loadMaterials();
  } catch (err) {
    showToast('セッションの記録に失敗しました', 'error');
  }
}

/**
 * 教材メニューを表示
 */
function showMaterialMenu(materialId, event) {
  // 既存メニューを削除
  document.querySelectorAll('.context-menu').forEach(m => m.remove());
  
  const menu = document.createElement('div');
  menu.className = 'context-menu card-glass';
  menu.innerHTML = `
    <button class="context-menu-item" data-action="record">📝 学習記録</button>
    <button class="context-menu-item" data-action="sync">🔄 再同期</button>
    <hr />
    <button class="context-menu-item danger" data-action="delete">🗑️ 削除</button>
  `;

  const rect = event.target.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  menu.style.zIndex = '1000';

  document.body.appendChild(menu);

  menu.addEventListener('click', async (e) => {
    const action = e.target.closest('.context-menu-item')?.dataset.action;
    menu.remove();
    
    switch (action) {
      case 'view':
        break; // PDFビューア削除済み
      case 'record':
        const material = (await getAll('materials')).find(m => m.id === materialId);
        openSessionModal(materialId, material?.totalPages || 100);
        break;
      case 'sync':
        await syncMaterialFromDrive(materialId);
        break;
      case 'delete':
        if (confirm('この教材を削除しますか？')) {
          await remove('materials', materialId);
          showToast('教材を削除しました', 'success');
          await loadMaterials();
        }
        break;
    }
  });

  // 外部クリックで閉じる
  setTimeout(() => {
    document.addEventListener('click', function handler() {
      menu.remove();
      document.removeEventListener('click', handler);
    }, { once: true });
  }, 0);
}

/**
 * Drive同期（全教材）
 */
async function syncAllFromDrive() {
  const materials = await getAll('materials');
  const driveLinked = materials.filter(m => m.driveFileId);
  
  if (driveLinked.length === 0) {
    showToast('Google Driveに紐づいた教材がありません', 'info');
    return;
  }

  showToast(`${driveLinked.length}件の教材を同期中...`, 'info');
  
  for (const material of driveLinked) {
    await syncMaterialFromDrive(material.id);
  }
  
  showToast('同期が完了しました', 'success');
  await loadMaterials();
}

/**
 * 特定教材のDrive同期
 */
async function syncMaterialFromDrive(materialId) {
  try {
    const { syncFromDrive } = await import('../services/material-manager.js');
    await syncFromDrive(materialId);
  } catch (err) {
    console.error('Sync failed:', err);
  }
}

/**
 * トースト通知を表示
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-message">${message}</span>
    <button class="toast-close">&times;</button>
  `;
  
  container.appendChild(toast);
  
  // アニメーション
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  
  // 自動削除
  const timeout = setTimeout(() => removeToast(toast), 4000);
  
  toast.querySelector('.toast-close')?.addEventListener('click', () => {
    clearTimeout(timeout);
    removeToast(toast);
  });
}

function removeToast(toast) {
  toast.classList.remove('toast-show');
  toast.classList.add('toast-hide');
  setTimeout(() => toast.remove(), 300);
}
