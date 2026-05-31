/**
 * Study Support - 学習タイマー ウィジェット（右下に常駐）
 * page-container の外（body直下）に置くため、ルート遷移しても消えない。
 * @module components/timer-widget
 */
import { getState, elapsedMs, stop, cancel } from '../services/study-timer.js';

let interval = null;

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h > 0 ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function tick() {
  const el = document.getElementById('study-timer-widget');
  if (!el) return;
  const st = getState();
  if (st && st.running) {
    el.hidden = false;
    el.innerHTML = `
      <span class="tw-dot"></span>
      <div class="tw-info">
        <span class="tw-label">${(st.label || '学習').slice(0, 18)}</span>
        <span class="tw-time">${fmt(elapsedMs())}</span>
      </div>
      <button id="tw-stop" class="btn btn-sm btn-danger">■ 停止</button>
    `;
  } else {
    el.hidden = true;
    el.innerHTML = '';
  }
}

/** ウィジェットを body に設置し、1秒ごとに更新する（多重呼び出しOK） */
export function mountTimer() {
  let el = document.getElementById('study-timer-widget');
  if (!el) {
    el = document.createElement('div');
    el.id = 'study-timer-widget';
    el.className = 'timer-widget';
    el.hidden = true;
    el.addEventListener('click', (e) => {
      if (e.target.closest('#tw-stop')) onStop();
    });
    document.body.appendChild(el);
  }
  if (interval) clearInterval(interval);
  interval = setInterval(tick, 1000);
  tick();
}

/** 停止 → 記録モーダル */
async function onStop() {
  const res = stop();
  tick(); // ウィジェットを隠す
  if (!res) return;

  const { getAll } = await import('../db.js');
  const materials = res.materialId ? await getAll('materials') : [];
  const mat = materials.find(m => m.id === res.materialId);
  const totalPages = mat?.totalPages || 0;

  const mc = document.getElementById('modal-container');
  const md = document.getElementById('modal-content');
  if (!mc || !md) return;

  const mmss = fmt(res.seconds * 1000);
  md.innerHTML = `
    <h3>⏱ 学習を記録</h3>
    <p style="color:#a78bfa;font-size:1.1em;">計測時間: <strong>${res.minutes}分</strong> <span style="color:#888;">(${mmss})</span></p>
    ${mat ? `<p style="color:#aaa;">教材: ${mat.title}</p>` : ''}
    <form id="tw-form">
      <div class="form-group">
        <label>学習時間（分）</label>
        <input type="number" id="tw-min" class="input" value="${res.minutes}" min="1" />
      </div>
      ${mat ? `
      <div class="form-group">
        <label>学習したページ範囲（任意・入力すると読了に反映）</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="number" id="tw-sp" class="input" placeholder="開始" min="1" max="${totalPages || ''}" style="width:90px;" />
          <span>〜</span>
          <input type="number" id="tw-ep" class="input" placeholder="終了" min="1" max="${totalPages || ''}" style="width:90px;" />
        </div>
      </div>` : ''}
      <div class="form-group">
        <label>メモ（任意）</label>
        <textarea id="tw-notes" class="textarea" rows="2" placeholder="学習内容のメモ..."></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="tw-discard">破棄</button>
        <button type="submit" class="btn btn-primary">記録する</button>
      </div>
    </form>
  `;
  mc.removeAttribute('hidden');
  const close = () => mc.setAttribute('hidden', '');

  md.querySelector('#tw-discard')?.addEventListener('click', close);
  mc.querySelector('.modal-backdrop')?.addEventListener('click', close);

  md.querySelector('#tw-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const minutes = Math.max(1, parseInt(document.getElementById('tw-min').value) || res.minutes);
    const notes = document.getElementById('tw-notes')?.value.trim() || '';
    const sp = parseInt(document.getElementById('tw-sp')?.value);
    const ep = parseInt(document.getElementById('tw-ep')?.value);

    try {
      if (res.materialId && sp && ep && sp <= ep) {
        // ページ範囲あり → 読了にも反映
        const { ReadingTracker } = await import('../services/reading-tracker.js');
        await new ReadingTracker(res.materialId).recordManualSession(sp, ep, minutes, notes);
      } else {
        // 時間のみ記録
        const { put, generateId, toDateStr } = await import('../db.js');
        const now = new Date();
        await put('studySessions', {
          id: generateId(),
          materialId: res.materialId || null,
          type: 'timer',
          startPage: null,
          endPage: null,
          durationMinutes: minutes,
          notes,
          date: toDateStr(now),
          createdAt: now.toISOString(),
        });
      }
      const { logDailyStudy } = await import('../db.js');
      await logDailyStudy();
      close();
      // 現在のページを再描画して反映
      const { reloadCurrentRoute } = await import('../router.js');
      reloadCurrentRoute();
    } catch (err) {
      console.error('[Timer] 記録失敗:', err);
      alert('記録に失敗しました: ' + err.message);
    }
  });
}
