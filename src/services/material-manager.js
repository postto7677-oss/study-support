/**
 * Study Support - 教材マネージャーサービス
 * 教材PDFのCRUD管理、キャッシュ、Drive同期
 * @module services/material-manager
 */

import { put, get, getAll, getAllByIndex, remove, generateId } from '../db.js';

// google-drive.js は動的インポートで必要時のみロード

// ============================================================
// 教材 CRUD
// ============================================================

/**
 * @typedef {Object} Material
 * @property {string} id - 教材ID
 * @property {string} driveFileId - Google Drive ファイルID
 * @property {string} title - 教材タイトル
 * @property {string} subjectId - 教科ID
 * @property {string} type - 教材タイプ ('textbook' | 'exercise')
 * @property {number} totalPages - 総ページ数
 * @property {string} driveModifiedTime - Drive上の最終更新日時
 * @property {string} createdAt - 作成日時
 * @property {string} updatedAt - 更新日時
 */

/**
 * 新しい教材を追加する
 * PDFのページ数を自動取得し、PDFバイナリをキャッシュに保存する
 * @param {string} driveFileId - Google Drive ファイルID
 * @param {string} title - 教材タイトル
 * @param {string} subjectId - 教科ID
 * @param {string} type - 教材タイプ ('textbook' | 'exercise')
 * @param {Blob} pdfBlob - PDFファイルのBlob
 * @returns {Promise<Material>} 作成された教材レコード
 */
export async function addMaterial(driveFileId, title, subjectId, type, pdfBlob) {
  // Drive のメタデータを取得（更新チェック用）
  let driveModifiedTime = null;
  if (driveFileId) {
    try {
      const { getFileMetadata } = await import('./google-drive.js');
      const metadata = await getFileMetadata(driveFileId);
      driveModifiedTime = metadata.modifiedTime;
    } catch (err) {
      console.warn('[MaterialManager] Drive メタデータ取得スキップ:', err.message);
    }
  }

  const now = new Date().toISOString();
  const materialId = generateId();

  // PDFをローカル解析（ページ数・目次・本文テキスト）。失敗してもエラーにはしない
  let parsed = { numPages: 0, chapters: [], pages: [], hasText: false };
  try {
    const { parsePdf } = await import('./pdf-parser.js');
    parsed = await parsePdf(pdfBlob);
  } catch (err) {
    console.warn(`[MaterialManager] PDF解析に失敗（メタデータのみ登録）: ${err.message}`);
  }

  /** @type {Material} */
  const material = {
    id: materialId,
    title,
    subjectId,
    type,
    totalPages: parsed.numPages || 0,
    hasText: parsed.hasText,
    chapterCount: parsed.chapters.length,
    createdAt: now,
    updatedAt: now,
  };

  // DriveファイルIDがある場合のみ設定（uniqueインデックス対策）
  if (driveFileId) {
    material.driveFileId = driveFileId;
    material.driveModifiedTime = driveModifiedTime;
  }

  // 教材メタデータを保存
  await put('materials', material);

  // PDFバイナリをキャッシュに保存（再解析・将来用）
  await put('pdfCache', {
    materialId,
    blob: pdfBlob,
    cachedAt: now,
  });

  // ローカル解析結果を保存（スケジュール・問題生成はここから行う）
  await put('materialContent', {
    materialId,
    numPages: parsed.numPages || 0,
    chapters: parsed.chapters,
    pages: parsed.pages,
    hasText: parsed.hasText,
    parsedAt: now,
  });

  console.log(`[MaterialManager] 教材追加: "${title}" (${material.totalPages}ページ, 章${material.chapterCount}件)`);
  return material;
}

/**
 * 教材のローカル解析結果（目次・本文テキスト）を取得する
 * @param {string} materialId
 * @returns {Promise<{materialId: string, numPages: number, chapters: Array, pages: Array, hasText: boolean}|null>}
 */
export async function getMaterialContent(materialId) {
  return (await get('materialContent', materialId)) || null;
}

/**
 * ローカル解析結果を取得し、無ければ（PDFキャッシュがあれば）再解析して返す
 * @param {string} materialId
 * @returns {Promise<{materialId: string, numPages: number, chapters: Array, pages: Array, hasText: boolean}|null>}
 */
export async function getOrParseContent(materialId) {
  let content = await get('materialContent', materialId);
  if (!content) {
    try {
      await reparseMaterial(materialId);
      content = await get('materialContent', materialId);
    } catch (err) {
      console.warn(`[MaterialManager] getOrParseContent 失敗 (${materialId}):`, err.message);
    }
  }
  return content || null;
}

/**
 * 既存教材を再解析して materialContent を生成・更新する（v3以前に登録した教材の移行用）
 * @param {string} materialId
 * @returns {Promise<boolean>} 解析できたら true
 */
export async function reparseMaterial(materialId) {
  const cache = await get('pdfCache', materialId);
  if (!cache?.blob) {
    console.warn(`[MaterialManager] 再解析不可（PDFキャッシュ無し）: ${materialId}`);
    return false;
  }
  const { parsePdf } = await import('./pdf-parser.js');
  const parsed = await parsePdf(cache.blob);
  await put('materialContent', {
    materialId,
    numPages: parsed.numPages || 0,
    chapters: parsed.chapters,
    pages: parsed.pages,
    hasText: parsed.hasText,
    parsedAt: new Date().toISOString(),
  });
  await updateMaterial(materialId, {
    totalPages: parsed.numPages || 0,
    hasText: parsed.hasText,
    chapterCount: parsed.chapters.length,
  });
  console.log(`[MaterialManager] 再解析完了: ${materialId} (${parsed.numPages}ページ)`);
  return true;
}

/**
 * 教材を取得する
 * @param {string} materialId - 教材ID
 * @returns {Promise<Material|undefined>}
 */
export async function getMaterial(materialId) {
  return get('materials', materialId);
}

/**
 * 全教材を取得する（教科フィルタオプション付き）
 * @param {string} [subjectId] - 教科IDでフィルタ（省略時は全件）
 * @returns {Promise<Material[]>}
 */
export async function getAllMaterials(subjectId) {
  if (subjectId) {
    return getAllByIndex('materials', 'subjectId', subjectId);
  }
  return getAll('materials');
}

/**
 * 教材をタイプで取得する
 * @param {string} type - 教材タイプ ('textbook' | 'exercise')
 * @returns {Promise<Material[]>}
 */
export async function getMaterialsByType(type) {
  return getAllByIndex('materials', 'type', type);
}

/**
 * 教材を更新する
 * @param {string} materialId - 教材ID
 * @param {Partial<Material>} updates - 更新フィールド
 * @returns {Promise<Material>}
 * @throws {Error} 教材が見つからない場合
 */
export async function updateMaterial(materialId, updates) {
  const material = await get('materials', materialId);
  if (!material) {
    throw new Error(`教材が見つかりません: ${materialId}`);
  }

  const updated = {
    ...material,
    ...updates,
    id: materialId, // IDの上書き防止
    updatedAt: new Date().toISOString(),
  };

  await put('materials', updated);
  console.log(`[MaterialManager] 教材更新: "${updated.title}"`);
  return updated;
}

/**
 * 教材を削除する（PDFキャッシュも含む）
 * @param {string} materialId - 教材ID
 * @returns {Promise<void>}
 */
export async function deleteMaterial(materialId) {
  const material = await get('materials', materialId);

  // 教材メタデータを削除
  await remove('materials', materialId);

  // PDFキャッシュを削除
  try {
    await remove('pdfCache', materialId);
  } catch {
    // キャッシュがなくてもエラーにしない
  }

  // ローカル解析結果を削除
  try {
    await remove('materialContent', materialId);
  } catch {
    // 無くてもエラーにしない
  }

  console.log(`[MaterialManager] 教材削除: "${material?.title || materialId}"`);
}

// ============================================================
// PDF キャッシュ
// ============================================================

/**
 * 教材のPDFバイナリを取得する（キャッシュから）
 * @param {string} materialId - 教材ID
 * @returns {Promise<Blob|null>} PDFのBlobまたはnull
 */
export async function getMaterialPDF(materialId) {
  const cache = await get('pdfCache', materialId);
  if (!cache) {
    console.warn(`[MaterialManager] PDFキャッシュなし: ${materialId}`);
    return null;
  }
  return cache.blob;
}

// ============================================================
// Drive 同期
// ============================================================

/**
 * Google Drive からPDFを再取得してキャッシュを更新する
 * 更新があった場合のみダウンロードする
 * @param {string} materialId - 教材ID
 * @returns {Promise<{updated: boolean, annotationsChanged: boolean}>}
 */
export async function syncFromDrive(materialId) {
  const material = await get('materials', materialId);
  if (!material) {
    throw new Error(`教材が見つかりません: ${materialId}`);
  }

  const { checkFileModified, downloadFile, getFileMetadata } = await import('./google-drive.js');

  // Drive上で更新されているかチェック
  const isModified = await checkFileModified(material.driveFileId, material.driveModifiedTime);

  if (!isModified) {
    console.log(`[MaterialManager] 更新なし: "${material.title}"`);
    return { updated: false, annotationsChanged: false };
  }

  // 新しいPDFをダウンロード
  const newBlob = await downloadFile(material.driveFileId);

  // ローカル再解析（ページ数・目次・本文テキスト）
  const { parsePdf } = await import('./pdf-parser.js');
  const parsed = await parsePdf(newBlob);

  // メタデータ更新
  const metadata = await getFileMetadata(material.driveFileId);

  await updateMaterial(materialId, {
    totalPages: parsed.numPages || 0,
    hasText: parsed.hasText,
    chapterCount: parsed.chapters.length,
    driveModifiedTime: metadata.modifiedTime,
  });

  // PDFキャッシュ更新
  const now = new Date().toISOString();
  await put('pdfCache', {
    materialId,
    blob: newBlob,
    cachedAt: now,
  });

  // ローカル解析結果を更新
  await put('materialContent', {
    materialId,
    numPages: parsed.numPages || 0,
    chapters: parsed.chapters,
    pages: parsed.pages,
    hasText: parsed.hasText,
    parsedAt: now,
  });

  console.log(`[MaterialManager] Drive同期完了: "${material.title}" (${parsed.numPages}ページ)`);

  return {
    updated: true,
    annotationsChanged: true,
  };
}

// ============================================================
// 統計情報
// ============================================================

/**
 * 教材の統計情報を取得する
 * @param {string} materialId - 教材ID
 * @returns {Promise<{totalPages: number, readPages: number, readPercentage: number, totalStudyTime: number, testCorrectRate: number, sessionCount: number}>}
 */
export async function getMaterialStats(materialId) {
  const material = await get('materials', materialId);
  const totalPages = material ? (material.totalPages || 0) : 0;

  // ページトラッキングデータ
  const pageRecords = await getAllByIndex('pageTracking', 'materialId', materialId);
  const readPages = pageRecords.filter(r => r.status !== 'unread').length;
  const totalStudyTime = pageRecords.reduce((sum, r) => sum + (r.totalViewTime || 0), 0);

  // テスト結果
  const testResults = await getAllByIndex('testResults', 'materialId', materialId);
  let testCorrectRate = 0;
  if (testResults.length > 0) {
    const correctCount = testResults.filter(r => r.isCorrect).length;
    testCorrectRate = Math.round((correctCount / testResults.length) * 100);
  }

  // セッション数
  const sessions = await getAllByIndex('studySessions', 'materialId', materialId);

  return {
    totalPages,
    readPages,
    readPercentage: totalPages > 0 ? Math.round((readPages / totalPages) * 100) : 0,
    totalStudyTime: Math.round(totalStudyTime),
    testCorrectRate,
    sessionCount: sessions.length,
  };
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * 教材のページ数を更新する
 * @param {string} materialId - 教材ID
 * @param {number} totalPages - ページ数
 * @returns {Promise<void>}
 */
export async function updateTotalPages(materialId, totalPages) {
  const material = await get('materials', materialId);
  if (material) {
    material.totalPages = totalPages;
    material.updatedAt = new Date().toISOString();
    await put('materials', material);
  }
}
