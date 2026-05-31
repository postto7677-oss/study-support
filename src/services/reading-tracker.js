/**
 * Study Support - 閲覧トラッカーサービス
 * ハイブリッド方式: 注釈検出 / Webビューア自動記録 / 手動入力 / クイズ推定
 * @module services/reading-tracker
 */

import { put, get, getAll, getAllByIndex, generateId, toDateStr } from '../db.js';

// ============================================================
// 定数
// ============================================================

/**
 * ページ学習ステータス
 * @enum {string}
 */
const PAGE_STATUS = {
  UNREAD: 'unread',
  MANUAL: 'manual',
  ANNOTATED: 'annotated',
  VIEWED: 'viewed',
  REVIEWED: 'reviewed',
};

/**
 * 学習ソースの種類
 * @enum {string}
 */
const TRACKING_SOURCE = {
  ANNOTATION: 'annotation',
  VIEWER: 'viewer',
  MANUAL: 'manual',
  QUIZ: 'quiz',
};

/**
 * ステータスの優先度マップ（高い数値 = 高い優先度）
 * @type {Object<string, number>}
 */
const STATUS_PRIORITY = {
  [PAGE_STATUS.UNREAD]: 0,
  [PAGE_STATUS.MANUAL]: 1,
  [PAGE_STATUS.ANNOTATED]: 2,
  [PAGE_STATUS.VIEWED]: 3,
  [PAGE_STATUS.REVIEWED]: 4,
};

// ============================================================
// ReadingTracker クラス
// ============================================================

/**
 * @typedef {Object} PageTrackingRecord
 * @property {string} id - レコードID
 * @property {string} materialId - 教材ID
 * @property {number} pageNumber - ページ番号
 * @property {string} status - 学習ステータス
 * @property {string} source - トラッキングソース
 * @property {number} viewCount - 閲覧回数
 * @property {number} totalViewTime - 合計閲覧時間（秒）
 * @property {string} firstStudiedAt - 初回学習日時 (ISO 8601)
 * @property {string} lastStudiedAt - 最終学習日時 (ISO 8601)
 * @property {boolean} hasAnnotation - 注釈があるか
 */

/**
 * @typedef {Object} ReadingProgress
 * @property {number} readPages - 学習済みページ数
 * @property {number} totalPages - 総ページ数
 * @property {number} percentage - 進捗率（0-100）
 */

export class ReadingTracker {
  /**
   * ReadingTracker を構築する
   * @param {string} materialId - 対象教材のID
   */
  constructor(materialId) {
    /** @type {string} */
    this._materialId = materialId;
  }

  // ============================================================
  // ③ 手動セッション記録
  // ============================================================

  /**
   * 手動で学習セッションを記録する
   * @param {number} startPage - 開始ページ
   * @param {number} endPage - 終了ページ
   * @param {number} durationMinutes - 学習時間（分）
   * @param {string} [notes=''] - メモ
   * @returns {Promise<string>} セッションID
   */
  async recordManualSession(startPage, endPage, durationMinutes, notes = '') {
    if (startPage > endPage) {
      throw new Error(`開始ページ(${startPage})は終了ページ(${endPage})以下にしてください`);
    }

    const now = new Date().toISOString();
    const pageCount = endPage - startPage + 1;
    const secondsPerPage = (durationMinutes * 60) / pageCount;

    // 各ページの記録を更新
    for (let page = startPage; page <= endPage; page++) {
      await this._updatePageRecord(page, {
        addViewTime: secondsPerPage,
        source: TRACKING_SOURCE.MANUAL,
        status: PAGE_STATUS.MANUAL,
      });
    }

    // セッションレコードを保存
    const sessionId = generateId();
    await put('studySessions', {
      id: sessionId,
      materialId: this._materialId,
      type: 'manual',
      startPage,
      endPage,
      durationMinutes,
      notes,
      date: toDateStr(now),
      createdAt: now,
    });

    console.log(`[ReadingTracker] 手動セッション記録: ページ ${startPage}-${endPage}, ${durationMinutes}分`);
    return sessionId;
  }

  // ============================================================
  // ④ クイズベース推定
  // ============================================================

  /**
   * クイズの結果からページの学習状態を更新する
   * 正答なら reviewed、不正答なら viewed に更新
   * @param {number[]} pageNumbers - 関連ページ番号の配列
   * @param {boolean} isCorrect - 正答かどうか
   * @returns {Promise<void>}
   */
  async updateFromQuizResult(pageNumbers, isCorrect) {
    const status = isCorrect ? PAGE_STATUS.REVIEWED : PAGE_STATUS.VIEWED;

    for (const pageNumber of pageNumbers) {
      await this._updatePageRecord(pageNumber, {
        source: TRACKING_SOURCE.QUIZ,
        status,
      });
    }

    console.log(`[ReadingTracker] クイズ結果反映: ページ [${pageNumbers.join(', ')}], 正答=${isCorrect}`);
  }

  // ============================================================
  // 集計
  // ============================================================

  /**
   * 全ページの学習状態を取得する
   * @returns {Promise<Map<number, PageTrackingRecord>>}
   */
  async getPageStatuses() {
    const records = await getAllByIndex('pageTracking', 'materialId', this._materialId);

    /** @type {Map<number, PageTrackingRecord>} */
    const statusMap = new Map();

    for (const record of records) {
      statusMap.set(record.pageNumber, record);
    }

    return statusMap;
  }

  /**
   * 全体の学習進捗率を取得する
   * @returns {Promise<ReadingProgress>}
   */
  async getReadingProgress() {
    // 教材のページ数を取得
    const material = await get('materials', this._materialId);
    const totalPages = material ? (material.totalPages || 0) : 0;

    if (totalPages === 0) {
      return { readPages: 0, totalPages: 0, percentage: 0 };
    }

    const records = await getAllByIndex('pageTracking', 'materialId', this._materialId);
    const readPages = records.filter(r => r.status !== PAGE_STATUS.UNREAD).length;
    const percentage = Math.round((readPages / totalPages) * 100);

    return { readPages, totalPages, percentage };
  }

  /**
   * セッション一覧を取得する
   * @returns {Promise<Array<Object>>}
   */
  async getStudySessions() {
    return getAllByIndex('studySessions', 'materialId', this._materialId);
  }

  // ============================================================
  // 内部ヘルパー
  // ============================================================

  /**
   * ページ記録を更新する（存在しなければ新規作成）
   * ステータスの優先度に基づいてアップグレードのみ行う
   * @param {number} pageNumber
   * @param {Object} updates
   * @param {number} [updates.addViewTime] - 追加する閲覧時間（秒）
   * @param {string} [updates.source] - トラッキングソース
   * @param {string} [updates.status] - 新しいステータス
   * @param {boolean} [updates.hasAnnotation] - 注釈フラグ
   * @returns {Promise<void>}
   * @private
   */
  async _updatePageRecord(pageNumber, updates) {
    const compositeKey = `${this._materialId}_${pageNumber}`;
    let record = await get('pageTracking', compositeKey);
    const now = new Date().toISOString();

    if (!record) {
      // 新規レコード作成
      record = {
        id: compositeKey,
        materialId: this._materialId,
        pageNumber,
        status: updates.status || PAGE_STATUS.UNREAD,
        source: updates.source || TRACKING_SOURCE.VIEWER,
        viewCount: 0,
        totalViewTime: 0,
        firstStudiedAt: now,
        lastStudiedAt: now,
        hasAnnotation: false,
      };
    }

    // ステータスの更新（優先度が高い場合のみアップグレード）
    if (updates.status) {
      const currentPriority = STATUS_PRIORITY[record.status] || 0;
      const newPriority = STATUS_PRIORITY[updates.status] || 0;
      if (newPriority > currentPriority) {
        record.status = updates.status;
        record.source = updates.source || record.source;
      }
    }

    // 閲覧時間の追加
    if (updates.addViewTime) {
      record.totalViewTime += updates.addViewTime;
      record.viewCount += 1;
    }

    // 注釈フラグ
    if (updates.hasAnnotation !== undefined) {
      record.hasAnnotation = updates.hasAnnotation;
    }

    record.lastStudiedAt = now;

    await put('pageTracking', record);
  }
}
