/**
 * Study Support - スケジューラー・通知サービス
 * SM-2 間隔反復学習、ブラウザ通知、EmailJS メール通知
 * @module services/scheduler
 */

import { put, get, getAll, getAllByIndex, getSetting, generateId, todayStr, toDateStr } from '../db.js';
import emailjs from '@emailjs/browser';

// ============================================================
// 定数
// ============================================================

/** @type {number|null} - スケジューラーの setInterval ID */
let schedulerInterval = null;

/** @type {boolean} - 今日の通知が送信済みかどうか */
let dailyNotificationSent = false;

// ============================================================
// スケジュール日付レイアウト（コード側で確定）
// ============================================================

/**
 * 指定オフセット日後の日付文字列を返す（ダッシュボードの today 計算と同一規約）
 * @param {number} offsetDays
 * @returns {string} YYYY-MM-DD
 * @private
 */
function _offsetDateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toDateStr(d);
}

/**
 * スケジュール1日分エントリを作る
 * @private
 */
function _makeEntry(offsetDays, topic, materialTitle, pageRange, isReview, questionCount) {
  return {
    day: offsetDays + 1,
    date: _offsetDateStr(offsetDays),
    topic,
    materialTitle: materialTitle || '',
    pageRange: pageRange || '',
    isReview,
    questionCount,
  };
}

/**
 * 章ごとの学習日数配分（Geminiの出力）から、日付つきの日別スケジュールを生成する。
 *
 * 日付・並び・復習日の挿入はすべてここ（コード側）で確定するため、
 * LLMの日付生成ミスに依存しない。1日目は必ず「今日」になる。
 *
 * @param {Array<{materialTitle: string, topic: string, pageStart: number, pageEnd: number, studyDays: number, importance: string}>} allocation
 * @param {Object} exam - { examDate, dailyGoal }
 * @returns {Array<{day:number, date:string, topic:string, materialTitle:string, pageRange:string, isReview:boolean, questionCount:number}>}
 */
export function buildScheduleFromAllocation(allocation, exam) {
  const dailyGoal = exam?.dailyGoal || 10;

  // 利用可能日数（今日=1日目、試験日まで）
  let totalDays = exam?.examDate
    ? Math.ceil((new Date(exam.examDate) - new Date()) / (1000 * 60 * 60 * 24))
    : 30;
  if (!Number.isFinite(totalDays) || totalDays < 1) totalDays = 30;

  // 末尾の総復習期間（14日以上ある時のみ）
  const reviewWeek = totalDays >= 14 ? Math.min(7, Math.max(3, Math.round(totalDays * 0.15))) : 0;
  const layoutLimit = Math.max(1, totalDays - reviewWeek);

  // topic があるものは残し、studyDays が欠落/0 でも最低1日として扱う（日程ゼロ落ち防止）
  const alloc = (allocation || []).filter(a => a && a.topic);

  // 学習日数を正規化（学習日:復習日 ≈ 4:1 を想定して学習ユニット数の上限を決める）
  const unitCap = Math.max(1, Math.floor(layoutLimit * 4 / 5));
  let rawDays = alloc.map(a => Math.max(1, Math.round(Number(a.studyDays) || 0)));
  const sum = rawDays.reduce((s, d) => s + d, 0) || 1;
  if (sum > unitCap) {
    const scale = unitCap / sum;
    rawDays = rawDays.map(d => Math.max(1, Math.round(d * scale)));
  }

  // 学習ユニット（章をページ単位に分割）を生成
  const units = [];
  alloc.forEach((a, idx) => {
    const days = rawDays[idx];
    const start = Math.max(1, Number(a.pageStart) || 1);
    const end = Math.max(start, Number(a.pageEnd) || start);
    const totalPages = end - start + 1;
    const per = Math.max(1, Math.ceil(totalPages / days));
    for (let d = 0; d < days; d++) {
      const ps = start + d * per;
      if (ps > end && d > 0) break;
      const pe = Math.min(end, ps + per - 1);
      units.push({
        topic: days > 1 ? `${a.topic}（${d + 1}/${days}）` : a.topic,
        materialTitle: a.materialTitle,
        pageRange: `P.${ps}-${pe}`,
      });
    }
  });

  // 日付へ割り付け（学習4ユニットごとに復習日を挿入）
  const entries = [];
  let offset = 0;
  let sinceReview = 0;
  for (const u of units) {
    if (offset >= layoutLimit) break;
    entries.push(_makeEntry(offset, u.topic, u.materialTitle, u.pageRange, false, dailyGoal));
    offset++;
    sinceReview++;
    if (sinceReview >= 4 && offset < layoutLimit) {
      entries.push(_makeEntry(offset, 'これまでの復習', '', '', true, dailyGoal));
      offset++;
      sinceReview = 0;
    }
  }

  // 末尾の総復習期間
  for (let i = 0; i < reviewWeek; i++) {
    const off = totalDays - reviewWeek + i;
    if (off < 0) continue;
    entries.push(_makeEntry(off, `総復習 ${i + 1}日目`, '', '', true, dailyGoal));
  }

  // 日付順に整列し day 番号を振り直す
  entries.sort((a, b) => a.date.localeCompare(b.date));
  entries.forEach((e, i) => { e.day = i + 1; });
  return entries;
}

// ============================================================
// SM-2 間隔反復学習
// ============================================================

/**
 * @typedef {Object} ReviewSchedule
 * @property {number} interval - 次回復習までの間隔（日）
 * @property {number} repetition - 復習回数
 * @property {string} nextReviewDate - 次回復習日 (YYYY-MM-DD)
 */

/**
 * SM-2 アルゴリズムに基づいて次回の復習スケジュールを計算する
 *
 * 正答率に応じた間隔調整:
 *   - 100%: interval × 2.5
 *   - 80-99%: interval × 2.0
 *   - 60-79%: interval × 1.5
 *   - 40-59%: リセット（1日後）
 *   - 0-39%: 即時（0日後）
 *
 * @param {number} correctRate - 正答率（0-100）
 * @param {number} currentInterval - 現在の復習間隔（日）
 * @param {number} repetition - 現在の復習回数
 * @returns {ReviewSchedule} 次回の復習スケジュール
 */
export function calculateNextReview(correctRate, currentInterval, repetition) {
  let newInterval;
  let newRepetition = repetition;

  if (correctRate >= 100) {
    // 完璧: 間隔を2.5倍
    newInterval = Math.max(1, Math.round(currentInterval * 2.5));
    newRepetition++;
  } else if (correctRate >= 80) {
    // 良好: 間隔を2.0倍
    newInterval = Math.max(1, Math.round(currentInterval * 2.0));
    newRepetition++;
  } else if (correctRate >= 60) {
    // まあまあ: 間隔を1.5倍
    newInterval = Math.max(1, Math.round(currentInterval * 1.5));
    newRepetition++;
  } else if (correctRate >= 40) {
    // 不十分: リセット
    newInterval = 1;
    newRepetition = 0;
  } else {
    // 低い: 即時復習
    newInterval = 0;
    newRepetition = 0;
  }

  // 次回復習日を計算
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + newInterval);
  const nextReviewDate = toDateStr(nextDate);

  return {
    interval: newInterval,
    repetition: newRepetition,
    nextReviewDate,
  };
}

/**
 * 教材の復習スケジュールを更新する
 * @param {string} materialId - 教材ID
 * @param {string} subjectId - 教科ID
 * @param {number} correctRate - 正答率（0-100）
 * @returns {Promise<ReviewSchedule>}
 */
export async function updateReviewSchedule(materialId, subjectId, correctRate) {
  const progressId = `progress_${materialId}`;
  let progress = await get('progress', progressId);

  if (!progress) {
    progress = {
      id: progressId,
      materialId,
      subjectId,
      interval: 1,
      repetition: 0,
      nextReviewDate: todayStr(),
      lastReviewedAt: null,
      reviewHistory: [],
    };
  }

  // SM-2 計算
  const schedule = calculateNextReview(correctRate, progress.interval, progress.repetition);

  // 進捗データを更新
  progress.interval = schedule.interval;
  progress.repetition = schedule.repetition;
  progress.nextReviewDate = schedule.nextReviewDate;
  progress.lastReviewedAt = new Date().toISOString();
  progress.reviewHistory.push({
    date: new Date().toISOString(),
    correctRate,
    interval: schedule.interval,
  });

  await put('progress', progress);

  console.log(`[Scheduler] 復習スケジュール更新: 教材=${materialId}, 次回=${schedule.nextReviewDate}, 間隔=${schedule.interval}日`);

  return schedule;
}

/**
 * 今日復習すべき教材リストを取得する
 * @returns {Promise<Array<Object>>} 復習が必要な教材の進捗データ配列
 */
export async function getDueReviews() {
  const allProgress = await getAll('progress');
  const today = todayStr();

  const dueReviews = allProgress.filter(p => {
    if (!p.nextReviewDate) return true;
    return p.nextReviewDate <= today;
  });

  // 教材情報を付加
  const enriched = [];
  for (const progress of dueReviews) {
    const material = await get('materials', progress.materialId);
    enriched.push({
      ...progress,
      materialTitle: material?.title || '不明な教材',
      materialType: material?.type || 'unknown',
    });
  }

  return enriched;
}

// ============================================================
// ブラウザ通知
// ============================================================

/**
 * ブラウザ通知の許可をリクエストする
 * @returns {Promise<NotificationPermission>} 'granted', 'denied', or 'default'
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('[Scheduler] このブラウザは通知をサポートしていません');
    return 'denied';
  }

  const permission = await Notification.requestPermission();
  console.log(`[Scheduler] 通知権限: ${permission}`);
  return permission;
}

/**
 * ブラウザ通知を表示する
 * @param {string} title - 通知タイトル
 * @param {string} body - 通知本文
 * @returns {Notification|null} 作成された通知オブジェクト、または null
 */
export function showBrowserNotification(title, body) {
  if (!('Notification' in window)) {
    console.warn('[Scheduler] このブラウザは通知をサポートしていません');
    return null;
  }

  if (Notification.permission !== 'granted') {
    console.warn('[Scheduler] 通知が許可されていません');
    return null;
  }

  const notification = new Notification(title, {
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'study-support',
    requireInteraction: false,
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  return notification;
}

// ============================================================
// EmailJS メール通知
// ============================================================

/**
 * EmailJS でメール通知を送信する
 * @param {string} subject - メール件名
 * @param {string} body - メール本文
 * @returns {Promise<boolean>} 送信成功時 true
 */
export async function sendEmailNotification(subject, body) {
  try {
    const serviceId = await getSetting('emailjsServiceId');
    const templateId = await getSetting('emailjsTemplateId');
    const publicKey = await getSetting('emailjsPublicKey');
    const toEmail = await getSetting('notificationEmail');

    if (!serviceId || !templateId || !publicKey) {
      console.warn('[Scheduler] EmailJS の設定が不完全です');
      return false;
    }

    await emailjs.send(
      serviceId,
      templateId,
      {
        to_email: toEmail,
        subject: subject,
        message: body,
      },
      publicKey
    );

    console.log(`[Scheduler] メール送信成功: ${subject}`);
    return true;
  } catch (err) {
    console.error('[Scheduler] メール送信エラー:', err);
    return false;
  }
}

/**
 * 毎日のリマインダーを送信する
 * 復習すべき教材がある場合のみ通知する
 * @returns {Promise<void>}
 */
export async function sendDailyReminder() {
  const dueReviews = await getDueReviews();

  if (dueReviews.length === 0) {
    console.log('[Scheduler] 今日復習すべき教材はありません');
    return;
  }

  const materialList = dueReviews
    .map(r => `- ${r.materialTitle}`)
    .join('\n');

  const title = `📚 Study Support: ${dueReviews.length}件の復習があります`;
  const body = `今日復習すべき教材:\n${materialList}\n\nStudy Support を開いて学習を始めましょう！`;

  // ブラウザ通知
  showBrowserNotification(title, body);

  // メール通知（設定されている場合）
  const emailEnabled = await getSetting('emailNotificationEnabled', false);
  if (emailEnabled) {
    await sendEmailNotification(title, body);
  }
}

// ============================================================
// スケジューラー管理
// ============================================================

/**
 * 毎日のスケジューラーを開始する
 * 毎分チェックして、設定された時刻に通知を送信する
 */
export function startDailyScheduler() {
  if (schedulerInterval) {
    console.warn('[Scheduler] スケジューラーは既に動作中です');
    return;
  }

  // 毎分チェック（60秒ごと）
  schedulerInterval = setInterval(async () => {
    await _checkSchedule();
  }, 60 * 1000);

  // 起動時にも1回チェック
  _checkSchedule();

  console.log('[Scheduler] デイリースケジューラーを開始しました');
}

/**
 * スケジューラーを停止する
 */
export function stopDailyScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    dailyNotificationSent = false;
    console.log('[Scheduler] デイリースケジューラーを停止しました');
  }
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * スケジュールをチェックして、通知時刻であれば通知を送信する
 * @private
 */
async function _checkSchedule() {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = toDateStr(now);

  // 日付が変わったら送信済みフラグをリセット
  const lastNotificationDate = await getSetting('lastNotificationDate');
  if (lastNotificationDate !== today) {
    dailyNotificationSent = false;
  }

  // 既に今日の通知を送信済みならスキップ
  if (dailyNotificationSent) {
    return;
  }

  // 通知時刻を取得（デフォルト: 08:00）
  const notificationTime = await getSetting('dailyNotificationTime', '08:00');

  if (currentTime === notificationTime) {
    await sendDailyReminder();
    dailyNotificationSent = true;
    await put('settings', { key: 'lastNotificationDate', value: today });
    console.log(`[Scheduler] デイリーリマインダー送信完了 (${currentTime})`);
  }
}
