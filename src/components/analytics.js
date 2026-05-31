/**
 * Study Support - 分析・弱点可視化コンポーネント
 * @module components/analytics
 */
import { getAll, toDateStr } from '../db.js';

/**
 * 分析画面をレンダリング
 * @param {HTMLElement} container
 */
export async function renderAnalytics(container) {
  container.innerHTML = `
    <div class="analytics-page">
      <header class="page-header">
        <h1 class="page-title">📊 分析・弱点</h1>
      </header>

      <!-- AI分析 -->
      <section class="card card-glass analytics-card wide" style="margin-bottom: 20px;">
        <h2 class="section-title">🤖 AI分析</h2>
        <div id="ai-analysis-content">
          <p class="text-muted">全教材とテスト結果をGeminiに送信して、弱点分析・学習アドバイスを取得します。</p>
        </div>
        <div class="form-actions" style="margin-top: 12px;">
          <button class="btn btn-primary" id="btn-ai-analyze">🤖 AIに分析してもらう</button>
          <button class="btn btn-secondary" id="btn-readjust-schedule">📅 スケジュール再調整</button>
        </div>
        <div id="ai-loading" style="display: none; text-align: center; padding: 24px;">
          <div class="loading-spinner"></div>
          <p style="margin-top: 12px; color: #a78bfa;">Geminiが分析中...</p>
        </div>
      </section>

      <div class="analytics-grid">
        <!-- 教科別理解度レーダー -->
        <section class="card card-glass analytics-card">
          <h2 class="section-title">🎯 教科別理解度</h2>
          <div class="chart-container">
            <canvas id="radar-chart"></canvas>
          </div>
        </section>

        <!-- 成績推移 -->
        <section class="card card-glass analytics-card">
          <h2 class="section-title">📈 成績推移</h2>
          <div class="chart-container">
            <canvas id="trend-chart"></canvas>
          </div>
        </section>

        <!-- 教科別学習時間 -->
        <section class="card card-glass analytics-card">
          <h2 class="section-title">⏱️ 学習時間</h2>
          <div class="chart-container">
            <canvas id="time-chart"></canvas>
          </div>
        </section>

        <!-- 弱点ヒートマップ -->
        <section class="card card-glass analytics-card wide">
          <h2 class="section-title">🔥 弱点ヒートマップ</h2>
          <div id="heatmap-container" class="heatmap-container">
            <div class="empty-state"><p>テスト結果があると弱点が表示されます</p></div>
          </div>
        </section>

        <!-- 学習統計 -->
        <section class="card card-glass analytics-card">
          <h2 class="section-title">📋 学習統計</h2>
          <div id="stats-container" class="stats-grid"></div>
        </section>
      </div>
    </div>
  `;

  await loadAnalyticsData();
  setupAnalyticsEvents();
}

/**
 * 分析データの読み込みとグラフ描画
 */
async function loadAnalyticsData() {
  const subjects = await getAll('subjects');
  const materials = await getAll('materials');
  const testResults = await getAll('testResults');
  const sessions = await getAll('studySessions');
  const dailyLogs = await getAll('dailyLog');

  // Chart.jsを動的ロード
  const { Chart, registerables } = await import('chart.js');
  Chart.register(...registerables);

  // レーダーチャート
  renderRadarChart(Chart, subjects, testResults);
  
  // 成績推移
  renderTrendChart(Chart, testResults);
  
  // 学習時間
  renderTimeChart(Chart, subjects, sessions);

  // 弱点ヒートマップ
  renderHeatmap(subjects, materials, testResults);

  // 学習統計
  renderStats(testResults, sessions, dailyLogs, materials);
}

/**
 * AI分析イベント設定
 */
function setupAnalyticsEvents() {
  // AI分析ボタン
  document.getElementById('btn-ai-analyze')?.addEventListener('click', async () => {
    const loading = document.getElementById('ai-loading');
    const content = document.getElementById('ai-analysis-content');
    if (loading) loading.style.display = 'block';
    
    try {
      const { analyzeProgress } = await import('../services/gemini.js');
      const { setSetting } = await import('../db.js');
      const materials = await getAll('materials');
      const testResults = await getAll('testResults');
      const schedules = await getAll('schedule');
      const exams = await getAll('exams');
      const exam = exams[0] || { name: '未設定', examDate: '' };

      // テスト結果を教材名つきに変換（PDFは送らずテキストのみ送信）
      const materialsById = new Map(materials.map(m => [m.id, m]));
      const testDetails = testResults.map(r => {
        const title = materialsById.get(r.materialId)?.title || '不明';
        return { materialTitle: title, topic: title, correct: r.isCorrect };
      });

      const analysis = await analyzeProgress(testDetails, schedules, exam);

      // 結果を表示
      if (content) {
        let html = '';
        if (analysis.weaknesses?.length > 0) {
          html += '<h3 style="margin-top:12px;">⚠️ 弱点</h3><ul>';
          analysis.weaknesses.forEach(w => {
            html += `<li><strong>${w.area}</strong>: ${w.detail} (${w.severity})</li>`;
          });
          html += '</ul>';
        }
        if (analysis.strengths?.length > 0) {
          html += '<h3>💪 得意分野</h3><ul>';
          analysis.strengths.forEach(s => {
            html += `<li><strong>${s.area}</strong>: ${s.detail}</li>`;
          });
          html += '</ul>';
        }
        if (analysis.advice) {
          html += `<h3>💡 アドバイス</h3><p>${analysis.advice}</p>`;
          await setSetting('lastAiAdvice', analysis.advice);
        }
        if (analysis.estimatedReadiness != null) {
          html += `<p style="font-size:1.2em;margin-top:12px;">📊 推定準備度: <strong style="color:${analysis.estimatedReadiness >= 70 ? '#10b981' : '#f59e0b'}">${analysis.estimatedReadiness}%</strong></p>`;
        }
        content.innerHTML = html || '<p>分析結果を取得できませんでした</p>';
      }
    } catch (err) {
      console.error('AI analysis failed:', err);
      if (content) content.innerHTML = `<p style="color:#ef4444;">分析に失敗しました: ${err.message}</p>`;
    }
    if (loading) loading.style.display = 'none';
  });

  // スケジュール再調整ボタン
  document.getElementById('btn-readjust-schedule')?.addEventListener('click', () => {
    window.location.hash = '#/';
    // ダッシュボードの再調整ボタンを使用
  });
}

/**
 * 教科別理解度レーダーチャート
 */
function renderRadarChart(Chart, subjects, testResults) {
  const canvas = document.getElementById('radar-chart');
  if (!canvas || subjects.length === 0) return;

  const labels = [];
  const data = [];

  for (const subject of subjects) {
    const results = testResults.filter(r => r.subjectId === subject.id);
    if (results.length === 0) {
      labels.push(subject.name);
      data.push(0);
    } else {
      labels.push(subject.name);
      const correctRate = Math.round((results.filter(r => r.isCorrect).length / results.length) * 100);
      data.push(correctRate);
    }
  }

  new Chart(canvas, {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: '理解度 (%)',
        data,
        backgroundColor: 'rgba(124, 58, 237, 0.2)',
        borderColor: '#7c3aed',
        borderWidth: 2,
        pointBackgroundColor: '#7c3aed',
        pointBorderColor: '#fff',
        pointRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: { 
            color: '#888',
            backdropColor: 'transparent',
            stepSize: 20 
          },
          grid: { color: 'rgba(255,255,255,0.1)' },
          pointLabels: { color: '#ccc', font: { size: 13, family: "'Noto Sans JP'" } },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

/**
 * 成績推移折れ線グラフ
 */
function renderTrendChart(Chart, testResults) {
  const canvas = document.getElementById('trend-chart');
  if (!canvas || testResults.length === 0) return;

  // 日別の正答率を計算
  const dailyStats = {};
  for (const result of testResults) {
    const date = result.testedAt ? toDateStr(result.testedAt) : null;
    if (!date) continue;
    if (!dailyStats[date]) dailyStats[date] = { correct: 0, total: 0 };
    dailyStats[date].total++;
    if (result.isCorrect) dailyStats[date].correct++;
  }

  const sortedDates = Object.keys(dailyStats).sort();
  const labels = sortedDates.map(d => {
    const [,m,day] = d.split('-');
    return `${parseInt(m)}/${parseInt(day)}`;
  });
  const data = sortedDates.map(d => Math.round((dailyStats[d].correct / dailyStats[d].total) * 100));

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '正答率 (%)',
        data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#3b82f6',
        pointRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { 
          beginAtZero: true, 
          max: 100,
          ticks: { color: '#888' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        x: { 
          ticks: { color: '#888' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
      plugins: {
        legend: { labels: { color: '#ccc' } },
      },
    },
  });
}

/**
 * 学習時間棒グラフ
 */
function renderTimeChart(Chart, subjects, sessions) {
  const canvas = document.getElementById('time-chart');
  if (!canvas) return;

  const subjectTime = {};
  for (const subject of subjects) {
    subjectTime[subject.id] = { name: subject.name, color: subject.color, minutes: 0 };
  }

  for (const session of sessions) {
    if (session.subjectId && subjectTime[session.subjectId]) {
      subjectTime[session.subjectId].minutes += Math.round((session.totalDuration || 0) / 60);
    }
  }

  const entries = Object.values(subjectTime).filter(e => e.minutes > 0);
  
  if (entries.length === 0) {
    // ダミーデータ
    return;
  }

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: entries.map(e => e.name),
      datasets: [{
        label: '学習時間（分）',
        data: entries.map(e => e.minutes),
        backgroundColor: entries.map(e => e.color + '80'),
        borderColor: entries.map(e => e.color),
        borderWidth: 1,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: '#888' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        x: {
          ticks: { color: '#888' },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

/**
 * 弱点ヒートマップ
 */
function renderHeatmap(subjects, materials, testResults) {
  const container = document.getElementById('heatmap-container');
  if (!container || testResults.length === 0) return;

  let html = '';
  
  for (const subject of subjects) {
    const subjectResults = testResults.filter(r => r.subjectId === subject.id);
    if (subjectResults.length === 0) continue;

    const subjectMaterials = materials.filter(m => m.subjectId === subject.id);

    html += `<div class="heatmap-subject">
      <h3 class="heatmap-subject-title">${subject.icon} ${subject.name}</h3>
      <div class="heatmap-grid">`;

    for (const material of subjectMaterials) {
      const matResults = subjectResults.filter(r => r.materialId === material.id);
      if (matResults.length === 0) continue;

      const correctRate = Math.round((matResults.filter(r => r.isCorrect).length / matResults.length) * 100);
      const hue = correctRate * 1.2; // 0=赤, 120=緑
      const color = `hsl(${hue}, 70%, 45%)`;

      html += `
        <div class="heatmap-cell" style="background: ${color}" title="${material.title}: ${correctRate}%">
          <span class="heatmap-cell-label">${material.title.substring(0, 10)}</span>
          <span class="heatmap-cell-value">${correctRate}%</span>
        </div>`;
    }

    html += `</div></div>`;
  }

  container.innerHTML = html || '<div class="empty-state"><p>テスト結果があると弱点が表示されます</p></div>';
}

/**
 * 閲覧進捗マップ（ミニマップ）
 */
function renderProgressMap(materials, pageTrackings, subjects) {
  const container = document.getElementById('progress-map-container');
  if (!container || materials.length === 0) return;

  let html = '';

  for (const material of materials) {
    if (!material.totalPages || material.totalPages === 0) continue;
    
    const subject = subjects.find(s => s.id === material.subjectId);
    const trackings = pageTrackings.filter(t => t.materialId === material.id);
    const trackingMap = new Map(trackings.map(t => [t.pageNumber, t]));

    html += `
      <div class="progress-map-item">
        <div class="progress-map-header">
          <span class="progress-map-icon">${subject?.icon || '📄'}</span>
          <span class="progress-map-title">${material.title}</span>
          <span class="progress-map-stats">${trackings.filter(t => t.status !== 'unread').length}/${material.totalPages}p</span>
        </div>
        <div class="minimap-grid" data-pages="${material.totalPages}">`;

    for (let page = 1; page <= material.totalPages; page++) {
      const tracking = trackingMap.get(page);
      let cellClass = 'cell-unread';
      let title = `P.${page}: 未学習`;

      if (tracking) {
        switch (tracking.status) {
          case 'reviewed':
            cellClass = 'cell-reviewed';
            title = `P.${page}: 複数ソース確認済み`;
            break;
          case 'viewed':
            cellClass = 'cell-viewed';
            title = `P.${page}: ビューア閲覧済み`;
            break;
          case 'annotated':
            cellClass = 'cell-annotated';
            title = `P.${page}: 注釈あり`;
            break;
          case 'manual':
            cellClass = 'cell-manual';
            title = `P.${page}: 手動記録`;
            break;
        }
      }

      html += `<div class="minimap-cell ${cellClass}" title="${title}"></div>`;
    }

    html += `</div>
        <div class="minimap-legend">
          <span class="legend-item"><span class="legend-dot cell-unread"></span>未学習</span>
          <span class="legend-item"><span class="legend-dot cell-manual"></span>手動記録</span>
          <span class="legend-item"><span class="legend-dot cell-annotated"></span>注釈あり</span>
          <span class="legend-item"><span class="legend-dot cell-viewed"></span>閲覧済み</span>
          <span class="legend-item"><span class="legend-dot cell-reviewed"></span>確認済み</span>
        </div>
      </div>`;
  }

  container.innerHTML = html || '<div class="empty-state"><p>教材を追加すると閲覧状況が表示されます</p></div>';
}

/**
 * 学習統計を表示
 */
function renderStats(testResults, sessions, dailyLogs, materials) {
  const container = document.getElementById('stats-container');
  if (!container) return;

  const totalQuestions = testResults.length;
  const correctQuestions = testResults.filter(r => r.isCorrect).length;
  const totalSessions = sessions.length;
  const totalStudyMinutes = Math.round(sessions.reduce((sum, s) => sum + (s.totalDuration || s.durationMinutes || 0), 0));
  const studyDays = dailyLogs.length;
  const totalMaterials = materials.length;

  container.innerHTML = `
    <div class="stat-card">
      <span class="stat-emoji">📝</span>
      <span class="stat-value">${totalQuestions}</span>
      <span class="stat-label">回答数</span>
    </div>
    <div class="stat-card">
      <span class="stat-emoji">✅</span>
      <span class="stat-value">${totalQuestions > 0 ? Math.round((correctQuestions / totalQuestions) * 100) : 0}%</span>
      <span class="stat-label">総合正答率</span>
    </div>
    <div class="stat-card">
      <span class="stat-emoji">📖</span>
      <span class="stat-value">${totalSessions}</span>
      <span class="stat-label">学習セッション</span>
    </div>
    <div class="stat-card">
      <span class="stat-emoji">⏱️</span>
      <span class="stat-value">${totalStudyMinutes}</span>
      <span class="stat-label">学習時間(分)</span>
    </div>
    <div class="stat-card">
      <span class="stat-emoji">📅</span>
      <span class="stat-value">${studyDays}</span>
      <span class="stat-label">学習日数</span>
    </div>
    <div class="stat-card">
      <span class="stat-emoji">📚</span>
      <span class="stat-value">${totalMaterials}</span>
      <span class="stat-label">教材数</span>
    </div>
  `;
}
