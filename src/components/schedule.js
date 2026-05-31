/**
 * Study Support - 学習計画（全スケジュール）ページ
 * 全体進捗 + 全日程を月別に一覧表示
 * @module components/schedule
 */
import { getAll, todayStr } from '../db.js';

/** 1エントリのステータス表示を返す */
function statusOf(s, today) {
  if (s.status === 'completed') {
    return { icon: '✅', label: s.score != null ? `${s.score}%` : '完了', cls: 'done' };
  }
  if (s.date === today) return { icon: '🔵', label: '今日', cls: 'today' };
  if (s.date < today) return { icon: '⚠️', label: '未完了', cls: 'overdue' };
  return { icon: '⏳', label: '予定', cls: 'pending' };
}

export async function renderSchedule(container) {
  const schedules = (await getAll('schedule')).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const exams = await getAll('exams');
  const exam = exams.length > 0 ? exams[0] : null;
  const today = todayStr();

  if (schedules.length === 0) {
    container.innerHTML = `
      <div class="schedule-page">
        <header class="page-header"><h1 class="page-title">📅 学習計画</h1></header>
        <div class="empty-state large">
          <div class="empty-icon">📅</div>
          <h3>スケジュールがありません</h3>
          <p>教材を登録してスケジュールを作成しましょう → <a href="#/materials">教材管理</a></p>
        </div>
      </div>`;
    return;
  }

  const total = schedules.length;
  const completed = schedules.filter(s => s.status === 'completed').length;
  const overdue = schedules.filter(s => s.status !== 'completed' && s.date < today).length;
  const pending = schedules.filter(s => s.status !== 'completed' && s.date >= today).length;
  const pct = Math.round((completed / total) * 100);
  const scored = schedules.filter(s => s.status === 'completed' && typeof s.score === 'number');
  const avgScore = scored.length ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length) : null;

  let daysToExam = null;
  if (exam?.examDate) {
    daysToExam = Math.ceil((new Date(exam.examDate) - new Date(today)) / (1000 * 60 * 60 * 24));
  }

  // 月別グルーピング
  const byMonth = {};
  for (const s of schedules) {
    const m = (s.date || '----').slice(0, 7);
    (byMonth[m] = byMonth[m] || []).push(s);
  }
  const months = Object.keys(byMonth).sort();

  const monthLabel = (m) => {
    const [y, mo] = m.split('-');
    return `${y}年${parseInt(mo, 10)}月`;
  };

  container.innerHTML = `
    <div class="schedule-page">
      <header class="page-header">
        <h1 class="page-title">📅 学習計画</h1>
      </header>

      <!-- 全体進捗 -->
      <section class="card card-glass" style="margin-bottom: 20px;">
        <h2 class="section-title">📈 全体の進捗</h2>
        <div class="overall-progress">
          <div class="progress-bar" style="height: 14px;">
            <div class="progress-fill" style="width:${pct}%; background: linear-gradient(90deg,#7c3aed,#3b82f6);"></div>
          </div>
          <div style="display:flex; justify-content:space-between; margin-top:8px;">
            <span style="font-size:1.4em; font-weight:700; color:#a78bfa;">${pct}%</span>
            <span style="color:#888;">完了 ${completed} / 全 ${total} 日</span>
          </div>
        </div>
        <div class="summary-grid" style="margin-top:16px;">
          <div class="summary-card"><span class="summary-icon">✅</span><span class="summary-value">${completed}</span><span class="summary-label">完了</span></div>
          <div class="summary-card"><span class="summary-icon">⏳</span><span class="summary-value">${pending}</span><span class="summary-label">残り</span></div>
          <div class="summary-card"><span class="summary-icon">⚠️</span><span class="summary-value">${overdue}</span><span class="summary-label">未完了(遅延)</span></div>
          <div class="summary-card"><span class="summary-icon">🎯</span><span class="summary-value">${avgScore != null ? avgScore + '%' : '—'}</span><span class="summary-label">平均スコア</span></div>
        </div>
        ${daysToExam != null && daysToExam > 0 ? `<p style="text-align:center;margin-top:12px;color:#888;">${exam.name} まで あと ${daysToExam} 日</p>` : ''}
      </section>

      ${months.map(m => {
        const list = byMonth[m];
        const mCompleted = list.filter(s => s.status === 'completed').length;
        return `
        <section class="card card-glass" style="margin-bottom: 16px;">
          <h2 class="section-title" style="display:flex;justify-content:space-between;align-items:center;">
            <span>${monthLabel(m)}</span>
            <span style="font-size:0.7em;color:#888;font-weight:400;">${mCompleted}/${list.length} 完了</span>
          </h2>
          <div class="schedule-list">
            ${list.map(s => {
              const st = statusOf(s, today);
              const d = new Date((s.date || today) + 'T00:00:00');
              const dayName = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
              const isToday = s.date === today;
              return `
                <div class="schedule-row ${st.cls} ${isToday ? 'is-today' : ''}">
                  <span class="sr-date">${d.getMonth() + 1}/${d.getDate()}(${dayName})</span>
                  <span class="sr-icon">${st.icon}</span>
                  <span class="sr-topic">${s.topic || (s.isReview ? '復習' : 'テスト')}${s.pageRange ? `<span class="sr-range"> ${s.pageRange}</span>` : ''}</span>
                  <span class="sr-status">${st.label}</span>
                  ${s.status !== 'completed' ? `<a href="#/quiz?scheduleId=${s.id}" class="btn btn-sm btn-secondary">開始</a>` : ''}
                </div>`;
            }).join('')}
          </div>
        </section>`;
      }).join('')}
    </div>
  `;
}
