/**
 * Study Support - 学習ログ（活動の集約＋定量的な見える化）
 * - 集約サマリー（学習日数・回答数・正答率・学習時間・完了トピック・平均スコア）
 * - 日別の活動グラフ（回答数 + 学習時間）と累計の推移
 * - 学習活動の時系列ログ
 * @module components/study-log
 */
import { getAll, get, put, remove, clear } from '../db.js';

const dstr = (d) => {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export async function renderStudyLog(container) {
  const testResults = await getAll('testResults');
  const sessions = await getAll('studySessions');
  const schedules = await getAll('schedule');
  const materials = await getAll('materials');
  const subjects = await getAll('subjects');
  const matById = new Map(materials.map(m => [m.id, m]));

  // ---- 集約サマリー ----
  const totalAnswers = testResults.length;
  const totalCorrect = testResults.filter(r => r.isCorrect).length;
  const correctRate = totalAnswers ? Math.round((totalCorrect / totalAnswers) * 100) : 0;
  const totalMinutes = Math.round(sessions.reduce((a, s) => a + (s.durationMinutes || s.totalDuration / 60 || 0), 0));
  const completedTopics = schedules.filter(s => s.status === 'completed').length;
  const scored = schedules.filter(s => s.status === 'completed' && typeof s.score === 'number');
  const avgScore = scored.length ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length) : null;

  // 活動日（回答・セッション・完了・dailyLogの和集合）
  const activeDays = new Set();
  testResults.forEach(r => r.testedAt && activeDays.add(dstr(r.testedAt)));
  sessions.forEach(s => activeDays.add(s.date || (s.createdAt && dstr(s.createdAt))));
  schedules.filter(s => s.completedAt).forEach(s => activeDays.add(dstr(s.completedAt)));
  activeDays.delete(undefined);
  const studyDays = activeDays.size;

  // ---- 日別集計（直近30日） ----
  const days = [];
  const base = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    days.push(dstr(d));
  }
  const qByDay = Object.fromEntries(days.map(d => [d, 0]));
  const minByDay = Object.fromEntries(days.map(d => [d, 0]));
  testResults.forEach(r => {
    const d = r.testedAt && dstr(r.testedAt);
    if (d in qByDay) qByDay[d]++;
  });
  sessions.forEach(s => {
    const d = s.date || (s.createdAt && dstr(s.createdAt));
    if (d in minByDay) minByDay[d] += (s.durationMinutes || 0);
  });

  // ---- 時系列ログ（完了テスト + 手動セッション） ----
  const events = [];
  for (const s of schedules) {
    if (s.status === 'completed' && s.completedAt) {
      events.push({
        ts: s.completedAt,
        icon: '📝',
        title: s.topic || 'テスト',
        detail: (s.pageRange ? s.pageRange + ' / ' : '') + (s.score != null ? `スコア ${s.score}%` : '完了'),
        score: s.score,
        kind: 'quiz',
        refId: s.id,
      });
    }
  }
  for (const s of sessions) {
    const mat = matById.get(s.materialId);
    events.push({
      ts: s.createdAt || (s.date + 'T00:00:00'),
      icon: '📖',
      title: (mat ? mat.title : '教材') + ` P.${s.startPage}-${s.endPage}`,
      detail: `${s.durationMinutes || 0}分${s.notes ? ' / ' + s.notes : ''}`,
      score: null,
      kind: 'session',
      refId: s.id,
    });
  }
  events.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  const recent = events.slice(0, 50);

  container.innerHTML = `
    <div class="study-log-page">
      <header class="page-header" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <h1 class="page-title">📒 学習ログ</h1>
        <button id="btn-reset-log" class="btn btn-sm btn-danger">🗑 記録をリセット</button>
      </header>

      <!-- 集約サマリー -->
      <section class="card card-glass" style="margin-bottom:20px;">
        <h2 class="section-title">📊 これまでの学習（集計）</h2>
        <div class="summary-grid log-summary">
          <div class="summary-card"><span class="summary-icon">📅</span><span class="summary-value">${studyDays}</span><span class="summary-label">学習日数</span></div>
          <div class="summary-card"><span class="summary-icon">📝</span><span class="summary-value">${totalAnswers}</span><span class="summary-label">総回答数</span></div>
          <div class="summary-card"><span class="summary-icon">✅</span><span class="summary-value">${correctRate}%</span><span class="summary-label">総正答率</span></div>
          <div class="summary-card"><span class="summary-icon">⏱️</span><span class="summary-value">${totalMinutes}</span><span class="summary-label">学習時間(分)</span></div>
          <div class="summary-card"><span class="summary-icon">🏁</span><span class="summary-value">${completedTopics}</span><span class="summary-label">完了トピック</span></div>
          <div class="summary-card"><span class="summary-icon">🎯</span><span class="summary-value">${avgScore != null ? avgScore + '%' : '—'}</span><span class="summary-label">平均スコア</span></div>
        </div>
      </section>

      <!-- 日別グラフ -->
      <section class="card card-glass" style="margin-bottom:20px;">
        <h2 class="section-title">📈 日別の学習量（直近30日）</h2>
        <div class="chart-container" style="height:260px;"><canvas id="log-daily-chart"></canvas></div>
      </section>

      <!-- 累計 -->
      <section class="card card-glass" style="margin-bottom:20px;">
        <h2 class="section-title">📉 累計回答数の推移（直近30日）</h2>
        <div class="chart-container" style="height:220px;"><canvas id="log-cumulative-chart"></canvas></div>
      </section>

      <!-- 時系列ログ -->
      <section class="card card-glass">
        <h2 class="section-title">🕑 学習履歴</h2>
        <div class="log-timeline">
          ${recent.length === 0 ? '<div class="empty-state"><p>まだ学習記録がありません</p></div>' :
            recent.map(e => {
              const t = new Date(e.ts);
              const dlabel = isNaN(t) ? '' : `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
              const color = e.score == null ? '#3b82f6' : (e.score >= 80 ? '#10b981' : e.score >= 60 ? '#f59e0b' : '#ef4444');
              return `
                <div class="log-item">
                  <span class="log-icon">${e.icon}</span>
                  <div class="log-body">
                    <div class="log-title">${e.title}</div>
                    <div class="log-detail" style="color:${color};">${e.detail}</div>
                  </div>
                  <span class="log-time">${dlabel}</span>
                  <button class="log-del" title="この記録を削除" data-kind="${e.kind}" data-id="${e.refId}">🗑</button>
                </div>`;
            }).join('')}
        </div>
      </section>
    </div>
  `;

  // ---- 削除・リセット ----
  document.getElementById('btn-reset-log')?.addEventListener('click', async () => {
    if (!confirm('テスト結果・学習セッション・ページ進捗・連続記録をすべて削除します。\n（教材・スケジュール・設定は残ります）\nよろしいですか？')) return;
    if (!confirm('最終確認：これまでの学習記録を削除します。元に戻せません。')) return;
    for (const store of ['testResults', 'studySessions', 'pageTracking', 'dailyLog', 'progress']) {
      try { await clear(store); } catch { /* ignore */ }
    }
    // スケジュールの完了状態を未受験(pending)に戻す（計画自体は残す）
    const all = await getAll('schedule');
    for (const s of all) {
      if (s.status === 'completed' || s.score != null || s.completedAt) {
        await put('schedule', { ...s, status: 'pending', score: null, completedAt: null });
      }
    }
    await renderStudyLog(container);
  });

  container.querySelectorAll('.log-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.kind;
      const id = btn.dataset.id;
      if (!id || !confirm('この記録を削除しますか？')) return;
      if (kind === 'session') {
        await remove('studySessions', id);
      } else if (kind === 'quiz') {
        const sch = await get('schedule', id);
        if (sch) {
          const qids = new Set(sch.questionIds || []);
          const trs = await getAll('testResults');
          for (const tr of trs) {
            if (qids.has(tr.questionId)) await remove('testResults', tr.id);
          }
          // この日のテストを未受験に戻す（再受験可能に）
          await put('schedule', { ...sch, status: 'pending', score: null, completedAt: null });
        }
      }
      await renderStudyLog(container);
    });
  });

  // ---- グラフ描画 ----
  try {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    const labels = days.map(d => { const [, m, dd] = d.split('-'); return `${parseInt(m)}/${parseInt(dd)}`; });

    const daily = document.getElementById('log-daily-chart');
    if (daily) {
      new Chart(daily, {
        data: {
          labels,
          datasets: [
            { type: 'bar', label: '回答数', data: days.map(d => qByDay[d]), backgroundColor: 'rgba(124,58,237,0.6)', borderColor: '#7c3aed', borderWidth: 1, yAxisID: 'y', borderRadius: 4 },
            { type: 'line', label: '学習時間(分)', data: days.map(d => minByDay[d]), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.3, yAxisID: 'y1', pointRadius: 2 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            y: { position: 'left', beginAtZero: true, title: { display: true, text: '回答数', color: '#a78bfa' }, ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y1: { position: 'right', beginAtZero: true, title: { display: true, text: '分', color: '#10b981' }, ticks: { color: '#888' }, grid: { drawOnChartArea: false } },
            x: { ticks: { color: '#888', maxTicksLimit: 15 }, grid: { display: false } },
          },
          plugins: { legend: { labels: { color: '#ccc' } } },
        },
      });
    }

    const cum = document.getElementById('log-cumulative-chart');
    if (cum) {
      let acc = 0;
      const cumData = days.map(d => (acc += qByDay[d]));
      new Chart(cum, {
        type: 'line',
        data: { labels, datasets: [{ label: '累計回答数', data: cumData, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.15)', fill: true, tension: 0.3, pointRadius: 0 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            x: { ticks: { color: '#888', maxTicksLimit: 15 }, grid: { display: false } },
          },
          plugins: { legend: { labels: { color: '#ccc' } } },
        },
      });
    }
  } catch (err) {
    console.error('[StudyLog] チャート描画失敗:', err);
  }
}
