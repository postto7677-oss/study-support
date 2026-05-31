/**
 * Study Support - 学習タイマー（ストップウォッチ）
 * 開始時刻を localStorage に保持するため、ページ遷移・リロードしても計測継続。
 * @module services/study-timer
 */

const KEY = 'studyTimer';

/** @returns {{running:boolean, startedAt:number, materialId:string|null, label:string}|null} */
export function getState() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

export function isRunning() {
  const s = getState();
  return !!(s && s.running);
}

/**
 * 計測開始
 * @param {string|null} materialId
 * @param {string} label
 */
export function start(materialId, label) {
  localStorage.setItem(KEY, JSON.stringify({
    running: true,
    startedAt: Date.now(),
    materialId: materialId || null,
    label: label || '学習',
  }));
}

/** 経過ミリ秒 */
export function elapsedMs() {
  const s = getState();
  return (s && s.running) ? Math.max(0, Date.now() - s.startedAt) : 0;
}

/**
 * 計測停止。経過時間などを返し、状態をクリアする。
 * @returns {{minutes:number, seconds:number, materialId:string|null, label:string}|null}
 */
export function stop() {
  const s = getState();
  localStorage.removeItem(KEY);
  if (!s || !s.running) return null;
  const ms = Math.max(0, Date.now() - s.startedAt);
  return {
    minutes: Math.max(1, Math.round(ms / 60000)),
    seconds: Math.round(ms / 1000),
    materialId: s.materialId,
    label: s.label || '学習',
  };
}

/** 記録せずに破棄 */
export function cancel() {
  localStorage.removeItem(KEY);
}
