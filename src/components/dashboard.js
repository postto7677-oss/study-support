/**
 * Study Support - ダッシュボード（問題ドリブン型）
 * @module components/dashboard
 */
import { getAll, getAllByIndex, get, getSetting, calculateStreak } from '../db.js';

/**
 * ダッシュボード画面をレンダリング
 * @param {HTMLElement} container
 */
export async function renderDashboard(container) {
  const exams = await getAll('exams');
  const exam = exams.length > 0 ? exams[0] : null;
  const schedules = await getAll('schedule');
  const testResults = await getAll('testResults');
  const streak = await calculateStreak();
  const lastAdvice = await getSetting('lastAiAdvice', '');

  const today = new Date().toISOString().split('T')[0];

  // 試験カウントダウン
  let countdownHtml = '';
  let daysRemaining = null;
  if (exam?.examDate) {
    daysRemaining = Math.ceil((new Date(exam.examDate) - new Date(today)) / (1000 * 60 * 60 * 24));
    const examDateFormatted = new Date(exam.examDate).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
    if (daysRemaining > 0) {
      countdownHtml = `<div class="exam-countdown-banner">
        <span class="countdown-icon">⏰</span>
        <span class="countdown-text">${exam.name} まで <strong>あと${daysRemaining}日</strong>（${examDateFormatted}）</span>
      </div>`;
    } else if (daysRemaining === 0) {
      countdownHtml = `<div class="exam-countdown-banner urgent">
        <span class="countdown-icon">🔥</span>
        <span class="countdown-text">${exam.name} は<strong>今日</strong>です！</span>
      </div>`;
    }
  }

  // サマリー計算
  const completedSchedules = schedules.filter(s => s.status === 'completed');
  const progressPercent = schedules.length > 0 ? Math.round((completedSchedules.length / schedules.length) * 100) : 0;
  const correctResults = testResults.filter(r => r.isCorrect);
  const correctPercent = testResults.length > 0 ? Math.round((correctResults.length / testResults.length) * 100) : 0;

  // 遅延チェック
  const overdueSchedules = schedules.filter(s => s.date < today && s.status === 'pending');
  const overdueCount = overdueSchedules.length;

  // 今日のスケジュール
  const todaySchedules = schedules.filter(s => s.date === today);

  // 全体進捗の集計
  const sessions = await getAll('studySessions');
  const totalMinutes = Math.round(sessions.reduce((a, s) => a + (s.durationMinutes || 0), 0));
  const totalDays = schedules.length;
  const pendingCount = schedules.filter(s => s.status !== 'completed' && s.date >= today).length;

  // 週間スケジュール（今日から7日分）
  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    weekDates.push(d.toISOString().split('T')[0]);
  }
  const weekSchedules = weekDates.map(date => ({
    date,
    schedules: schedules.filter(s => s.date === date),
  }));

  container.innerHTML = `
    <div class="dashboard-page">
      <header class="page-header">
        <h1 class="page-title">📊 ダッシュボード</h1>
      </header>

      ${countdownHtml}

      ${totalDays > 0 ? `
      <!-- 全体の学習進捗 -->
      <section class="card card-glass" style="margin-bottom: 20px;">
        <h2 class="section-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>📈 全体の学習進捗</span>
          <a href="#/schedule" class="btn btn-sm btn-secondary">全体を見る →</a>
        </h2>
        <div class="progress-bar" style="height: 14px;">
          <div class="progress-fill" style="width:${progressPercent}%; background: linear-gradient(90deg,#7c3aed,#3b82f6);"></div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:8px; flex-wrap:wrap; gap:8px;">
          <span style="font-size:1.4em; font-weight:700; color:#a78bfa;">${progressPercent}%</span>
          <span style="color:#888;">完了 ${completedSchedules.length} / 全 ${totalDays} 日 ・ 残り ${pendingCount} 日${overdueCount > 0 ? ` ・ <span style="color:#f59e0b;">遅延 ${overdueCount} 日</span>` : ''}</span>
        </div>
        <div style="display:flex; gap:20px; margin-top:14px; flex-wrap:wrap; color:#aaa; font-size:0.9em;">
          <span>📝 総回答 <strong style="color:#fff;">${testResults.length}</strong></span>
          <span>⏱️ 学習時間 <strong style="color:#fff;">${totalMinutes}</strong> 分</span>
          <span>📒 <a href="#/log">学習ログを見る →</a></span>
        </div>
      </section>` : ''}

      <!-- サマリーカード -->
      <div class="summary-grid">
        <div class="summary-card">
          <span class="summary-icon">📈</span>
          <span class="summary-value">${progressPercent}%</span>
          <span class="summary-label">スケジュール進捗</span>
        </div>
        <div class="summary-card">
          <span class="summary-icon">✅</span>
          <span class="summary-value">${correctPercent}%</span>
          <span class="summary-label">正答率</span>
        </div>
        <div class="summary-card">
          <span class="summary-icon">🔥</span>
          <span class="summary-value">${streak}</span>
          <span class="summary-label">連続学習日</span>
        </div>
      </div>

      ${overdueCount > 0 ? `
        <div class="alert-card alert-warning" style="margin-bottom: 20px;">
          <span class="alert-icon">⚠️</span>
          <span class="alert-text">${overdueCount}日分の学習が未完了です</span>
          <button class="btn btn-primary btn-sm" id="btn-adjust-schedule">スケジュール再調整</button>
        </div>
      ` : ''}

      <!-- 今日の問題 -->
      <section class="card card-glass" style="margin-bottom: 20px;">
        <h2 class="section-title">📝 今日の問題</h2>
        ${todaySchedules.length > 0 ? todaySchedules.map(s => `
          <div class="today-task-item ${s.status === 'completed' ? 'completed' : ''}" data-id="${s.id}">
            <div class="task-info">
              <span class="task-status">${s.status === 'completed' ? '✅' : '📝'}</span>
              <span class="task-topic">${s.topic || 'テスト'}</span>
              <span class="task-detail">${s.pageRange || ''} × ${s.questionIds?.length || 0}問</span>
            </div>
            ${s.status === 'completed' 
              ? `<span class="task-score">${s.score != null ? s.score + '%' : '完了'}</span>`
              : `<a href="#/quiz?scheduleId=${s.id}" class="btn btn-primary btn-sm">開始 →</a>`}
          </div>
        `).join('') : `
          <div class="empty-state">
            <p>${schedules.length === 0 
              ? '📚 教材を登録してスケジュールを作成しましょう → <a href="#/materials">教材管理</a>'
              : '今日のスケジュールはありません'}</p>
          </div>
        `}
      </section>

      <!-- 週間スケジュール -->
      <section class="card card-glass" style="margin-bottom: 20px;">
        <h2 class="section-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>📅 今週のスケジュール</span>
          <a href="#/schedule" class="btn btn-sm btn-secondary">全日程 →</a>
        </h2>
        <div class="week-schedule">
          ${weekSchedules.map(({ date, schedules: daySchedules }) => {
            const d = new Date(date + 'T00:00:00');
            const dayName = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
            const isToday = date === today;
            const dayLabel = `${d.getMonth() + 1}/${d.getDate()}(${dayName})`;
            
            let status = '';
            let statusIcon = '⏳';
            if (daySchedules.length === 0) {
              status = '─';
              statusIcon = '';
            } else if (daySchedules.every(s => s.status === 'completed')) {
              statusIcon = '✅';
            } else if (daySchedules.some(s => s.status === 'completed')) {
              statusIcon = '🔄';
            } else if (date < today) {
              statusIcon = '❌';
            }

            const topics = daySchedules.map(s => s.topic).filter(Boolean).join(', ');

            return `<div class="week-day ${isToday ? 'is-today' : ''} ${date < today ? 'is-past' : ''}">
              <span class="week-day-label">${dayLabel}</span>
              <span class="week-day-topic">${topics || '─'}</span>
              <span class="week-day-status">${statusIcon}</span>
            </div>`;
          }).join('')}
        </div>
      </section>

      <!-- AIアドバイス -->
      <section class="card card-glass">
        <h2 class="section-title">💡 AIアドバイス</h2>
        <div class="ai-advice-content">
          ${lastAdvice 
            ? `<p>${lastAdvice}</p>`
            : '<p class="text-muted">分析画面からAI分析を実行すると、学習アドバイスが表示されます</p>'}
        </div>
      </section>
    </div>
  `;

  // スケジュール再調整ボタン（API不要・コードで日付を詰め直す）
  document.getElementById('btn-adjust-schedule')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-adjust-schedule');
    btn.textContent = '調整中...';
    btn.disabled = true;
    try {
      const { put, generateId } = await import('../db.js');
      const offsetDate = (o) => {
        const d = new Date();
        d.setDate(d.getDate() + o);
        return d.toISOString().split('T')[0];
      };

      // 未完了（遅延含む）を今日から順に詰め直す
      const pending = schedules
        .filter(s => s.status === 'pending')
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      let offset = 0;
      for (const s of pending) {
        s.date = offsetDate(offset);
        s.dayNumber = offset + 1;
        await put('schedule', s);
        offset++;
      }

      // 正答率70%未満で完了したトピックに復習日を追加
      const weakCompleted = schedules.filter(
        s => s.status === 'completed' && typeof s.score === 'number' && s.score < 70 && !s.isReview
      );
      for (const s of weakCompleted) {
        await put('schedule', {
          id: generateId(),
          examId: s.examId || exam?.id || null,
          materialId: s.materialId || null,
          materialTitle: s.materialTitle || '',
          subjectId: s.subjectId || null,
          date: offsetDate(offset),
          dayNumber: offset + 1,
          pageRange: s.pageRange || '',
          topic: `復習: ${s.topic || ''}`,
          isReview: true,
          questionIds: [],
          questionCount: s.questionCount || 10,
          needsQuestions: true,
          status: 'pending',
          version: (s.version || 1) + 1,
        });
        offset++;
      }

      location.reload();
    } catch (err) {
      console.error('Schedule adjustment failed:', err);
      alert('スケジュール調整に失敗しました: ' + err.message);
      btn.textContent = 'スケジュール再調整';
      btn.disabled = false;
    }
  });
}
