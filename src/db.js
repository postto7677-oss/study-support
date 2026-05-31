/**
 * Study Support - IndexedDB データベースモジュール
 * @module db
 */
import { openDB } from 'idb';

const DB_NAME = 'study-support';
const DB_VERSION = 4;

/** @type {import('idb').IDBPDatabase|null} */
let dbInstance = null;

/**
 * データベースを初期化して開く
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
export async function getDB() {
  if (dbInstance) return dbInstance;
  
  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      // 教科ストア
      if (!db.objectStoreNames.contains('subjects')) {
        const subjectStore = db.createObjectStore('subjects', { keyPath: 'id' });
        subjectStore.createIndex('name', 'name', { unique: true });
      }
      
      // 教材PDFストア
      if (!db.objectStoreNames.contains('materials')) {
        const materialStore = db.createObjectStore('materials', { keyPath: 'id' });
        materialStore.createIndex('subjectId', 'subjectId');
        materialStore.createIndex('type', 'type');
        materialStore.createIndex('driveFileId', 'driveFileId', { unique: false });
      }
      
      // PDFバイナリキャッシュ（再アップロード用に保持）
      if (!db.objectStoreNames.contains('pdfCache')) {
        db.createObjectStore('pdfCache', { keyPath: 'materialId' });
      }
      
      // ページ学習記録
      if (!db.objectStoreNames.contains('pageTracking')) {
        const pageStore = db.createObjectStore('pageTracking', { keyPath: 'id' });
        pageStore.createIndex('materialId', 'materialId');
        pageStore.createIndex('materialPage', ['materialId', 'pageNumber']);
      }
      
      // 学習セッション
      if (!db.objectStoreNames.contains('studySessions')) {
        const sessionStore = db.createObjectStore('studySessions', { keyPath: 'id' });
        sessionStore.createIndex('materialId', 'materialId');
        sessionStore.createIndex('date', 'date');
      }
      
      // 問題データ
      if (!db.objectStoreNames.contains('questions')) {
        const questionStore = db.createObjectStore('questions', { keyPath: 'id' });
        questionStore.createIndex('materialId', 'materialId');
        questionStore.createIndex('subjectId', 'subjectId');
        questionStore.createIndex('difficulty', 'difficulty');
        questionStore.createIndex('scheduleId', 'scheduleId');
      }
      
      // テスト結果
      if (!db.objectStoreNames.contains('testResults')) {
        const resultStore = db.createObjectStore('testResults', { keyPath: 'id' });
        resultStore.createIndex('questionId', 'questionId');
        resultStore.createIndex('subjectId', 'subjectId');
        resultStore.createIndex('materialId', 'materialId');
        resultStore.createIndex('testedAt', 'testedAt');
      }
      
      // 進捗データ
      if (!db.objectStoreNames.contains('progress')) {
        const progressStore = db.createObjectStore('progress', { keyPath: 'id' });
        progressStore.createIndex('materialId', 'materialId');
        progressStore.createIndex('subjectId', 'subjectId');
      }
      
      // 設定
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      
      // 日次学習ログ（ストリーク計算用）
      if (!db.objectStoreNames.contains('dailyLog')) {
        db.createObjectStore('dailyLog', { keyPath: 'date' });
      }

      // === v2 追加 ===
      
      // 試験情報
      if (!db.objectStoreNames.contains('exams')) {
        db.createObjectStore('exams', { keyPath: 'id' });
      }
      
      // 日別学習スケジュール
      if (!db.objectStoreNames.contains('schedule')) {
        const scheduleStore = db.createObjectStore('schedule', { keyPath: 'id' });
        scheduleStore.createIndex('examId', 'examId');
        scheduleStore.createIndex('date', 'date');
        scheduleStore.createIndex('status', 'status');
        scheduleStore.createIndex('materialId', 'materialId');
      }

      // v1→v2 マイグレーション: questionsにscheduleIdインデックス追加
      if (oldVersion < 2) {
        if (db.objectStoreNames.contains('questions')) {
          const qStore = transaction.objectStore('questions');
          if (!qStore.indexNames.contains('scheduleId')) {
            qStore.createIndex('scheduleId', 'scheduleId');
          }
        }
      }

      // v2→v3 マイグレーション: driveFileIdをnon-uniqueに変更
      if (oldVersion < 3) {
        if (db.objectStoreNames.contains('materials')) {
          const matStore = transaction.objectStore('materials');
          if (matStore.indexNames.contains('driveFileId')) {
            matStore.deleteIndex('driveFileId');
          }
          matStore.createIndex('driveFileId', 'driveFileId', { unique: false });
        }
      }

      // === v4 追加 ===
      // 教材のローカル解析結果（ページ数・目次・ページ別本文テキスト）
      // PDFをGeminiに送らず、ここに保存したテキストからスケジュール/問題を生成する
      if (!db.objectStoreNames.contains('materialContent')) {
        db.createObjectStore('materialContent', { keyPath: 'materialId' });
      }
    },
  });
  
  return dbInstance;
}

// ============================================================
// 汎用 CRUD ヘルパー
// ============================================================

/**
 * レコードを保存（追加or更新）
 * @param {string} storeName
 * @param {object} data
 */
export async function put(storeName, data) {
  const db = await getDB();
  return db.put(storeName, data);
}

/**
 * IDでレコードを取得
 * @param {string} storeName
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function get(storeName, id) {
  const db = await getDB();
  return db.get(storeName, id);
}

/**
 * ストア内の全レコードを取得
 * @param {string} storeName
 * @returns {Promise<object[]>}
 */
export async function getAll(storeName) {
  const db = await getDB();
  return db.getAll(storeName);
}

/**
 * インデックスを使ってレコードを取得
 * @param {string} storeName
 * @param {string} indexName
 * @param {any} query
 * @returns {Promise<object[]>}
 */
export async function getAllByIndex(storeName, indexName, query) {
  const db = await getDB();
  return db.getAllFromIndex(storeName, indexName, query);
}

/**
 * レコードを削除
 * @param {string} storeName
 * @param {string} id
 */
export async function remove(storeName, id) {
  const db = await getDB();
  return db.delete(storeName, id);
}

/**
 * ストア内の全レコードをクリア
 * @param {string} storeName
 */
export async function clear(storeName) {
  const db = await getDB();
  return db.clear(storeName);
}

// ============================================================
// 設定ヘルパー
// ============================================================

/**
 * 設定値を保存
 * @param {string} key
 * @param {any} value
 */
export async function setSetting(key, value) {
  return put('settings', { key, value });
}

/**
 * 設定値を取得
 * @param {string} key
 * @param {any} defaultValue
 * @returns {Promise<any>}
 */
export async function getSetting(key, defaultValue = null) {
  const record = await get('settings', key);
  return record ? record.value : defaultValue;
}

// ============================================================
// 教科ヘルパー
// ============================================================

const DEFAULT_SUBJECTS = [
  { id: 'math', name: '数学', color: '#3b82f6', icon: '📐' },
  { id: 'english', name: '英語', color: '#10b981', icon: '🌍' },
  { id: 'science', name: '理科', color: '#f59e0b', icon: '🔬' },
  { id: 'social', name: '社会', color: '#ef4444', icon: '🏛️' },
  { id: 'japanese', name: '国語', color: '#8b5cf6', icon: '📝' },
];

/**
 * デフォルト教科を初期化（初回起動時のみ）
 */
export async function initDefaultSubjects() {
  const existing = await getAll('subjects');
  if (existing.length === 0) {
    for (const subject of DEFAULT_SUBJECTS) {
      await put('subjects', { ...subject, createdAt: new Date().toISOString() });
    }
  }
}

// ============================================================
// 日次ログ / ストリーク
// ============================================================

/**
 * 今日の学習を記録する
 */
export async function logDailyStudy() {
  const today = new Date().toISOString().split('T')[0];
  const existing = await get('dailyLog', today);
  if (!existing) {
    await put('dailyLog', {
      date: today,
      studyCount: 1,
      totalMinutes: 0,
    });
  } else {
    existing.studyCount += 1;
    await put('dailyLog', existing);
  }
}

/**
 * 学習ストリーク（連続日数）を計算
 * @returns {Promise<number>}
 */
export async function calculateStreak() {
  const logs = await getAll('dailyLog');
  if (logs.length === 0) return 0;
  
  // 日付でソート（降順）
  logs.sort((a, b) => b.date.localeCompare(a.date));
  
  const today = new Date().toISOString().split('T')[0];
  let streak = 0;
  let checkDate = new Date(today);
  
  for (const log of logs) {
    const logDate = log.date;
    const expected = checkDate.toISOString().split('T')[0];
    
    if (logDate === expected) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else if (logDate < expected) {
      break;
    }
  }
  
  return streak;
}

/**
 * UUID を生成
 * @returns {string}
 */
export function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : 
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// ============================================================
// データエクスポート / インポート
// ============================================================

/**
 * 全データをJSON形式でエクスポート
 * @returns {Promise<object>}
 */
export async function exportAllData() {
  const stores = ['subjects', 'materials', 'pageTracking', 'studySessions',
                  'questions', 'testResults', 'progress', 'settings', 'dailyLog'];
  const data = {};
  for (const store of stores) {
    data[store] = await getAll(store);
  }
  data.exportedAt = new Date().toISOString();
  data.version = DB_VERSION;
  return data;
}

/**
 * JSONデータからインポート
 * @param {object} data
 */
export async function importAllData(data) {
  const stores = ['subjects', 'materials', 'pageTracking', 'studySessions',
                  'questions', 'testResults', 'progress', 'settings', 'dailyLog'];
  for (const store of stores) {
    if (data[store]) {
      await clear(store);
      for (const item of data[store]) {
        await put(store, item);
      }
    }
  }
}
