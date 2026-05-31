/**
 * Study Support - PDFローカル解析サービス
 * pdfjs-dist を使い、ブラウザ内でPDFのページ数・目次（しおり）・本文テキストを抽出する。
 * これにより Gemini File API への PDF アップロードが不要になる。
 * @module services/pdf-parser
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Vite 経由で worker をロード（バンドル時に URL 化される）
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * @typedef {Object} Chapter
 * @property {string} name - 章・単元名
 * @property {number} startPage - 開始ページ（1始まり）
 * @property {number} endPage - 終了ページ（1始まり）
 */

/**
 * @typedef {Object} ParsedPdf
 * @property {number} numPages - 総ページ数
 * @property {Chapter[]} chapters - 目次（しおり）から復元した章構成。無ければ空配列
 * @property {Array<{page: number, text: string}>} pages - ページ別テキスト
 * @property {boolean} hasText - 本文テキストが少しでも取得できたか（スキャンPDF判定用）
 */

/**
 * しおりの dest をページ番号（1始まり）に解決する
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @param {*} dest
 * @returns {Promise<number|null>}
 * @private
 */
async function _destToPageNumber(pdf, dest) {
  try {
    let explicit = dest;
    if (typeof explicit === 'string') {
      explicit = await pdf.getDestination(explicit);
    }
    if (!Array.isArray(explicit) || !explicit[0]) return null;
    const ref = explicit[0];
    if (ref && typeof ref === 'object' && 'num' in ref) {
      const pageIndex = await pdf.getPageIndex(ref); // 0始まり
      return pageIndex + 1;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * しおりツリーを「名前＋開始ページ」のフラットな配列に変換する（第2階層まで）
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @param {Array} outline
 * @returns {Promise<Array<{name: string, startPage: number}>>}
 * @private
 */
async function _flattenOutline(pdf, outline, depth = 0) {
  const result = [];
  if (!Array.isArray(outline)) return result;

  for (const item of outline) {
    const startPage = await _destToPageNumber(pdf, item.dest);
    if (item.title && startPage != null) {
      result.push({ name: item.title.trim(), startPage });
    }
    // 第2階層までは展開（細かすぎるネストは無視してスケジュールを荒くする）
    if (depth < 1 && Array.isArray(item.items) && item.items.length > 0) {
      const children = await _flattenOutline(pdf, item.items, depth + 1);
      result.push(...children);
    }
  }
  return result;
}

/**
 * PDF(Blob) をローカル解析する
 * @param {Blob} blob - PDFのBlob
 * @param {Object} [options]
 * @param {number} [options.maxTextPages=2000] - テキスト抽出する最大ページ数（安全弁）
 * @returns {Promise<ParsedPdf>}
 */
export async function parsePdf(blob, { maxTextPages = 2000 } = {}) {
  const buffer = await blob.arrayBuffer();
  // pdfjs は内部でバッファを transfer する場合があるためコピーを渡す
  const data = new Uint8Array(buffer.slice(0));

  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  try {
    const numPages = pdf.numPages;

    // --- 目次（しおり）の抽出 ---
    let chapters = [];
    try {
      const outline = await pdf.getOutline();
      const flat = await _flattenOutline(pdf, outline);
      // 開始ページ順にソートし、終了ページを次の章の開始-1で確定
      flat.sort((a, b) => a.startPage - b.startPage);
      chapters = flat.map((ch, i) => ({
        name: ch.name,
        startPage: ch.startPage,
        endPage: (i < flat.length - 1 ? flat[i + 1].startPage - 1 : numPages) || ch.startPage,
      })).filter(ch => ch.endPage >= ch.startPage);
    } catch (err) {
      console.warn('[PdfParser] 目次の抽出に失敗（しおり無しPDFの可能性）:', err.message);
    }

    // --- ページ別テキストの抽出 ---
    const pages = [];
    let hasText = false;
    const limit = Math.min(numPages, maxTextPages);
    for (let i = 1; i <= limit; i++) {
      let text = '';
      try {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text = content.items
          .map(it => (typeof it.str === 'string' ? it.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (text.length > 0) hasText = true;
        // メモリ解放
        page.cleanup();
      } catch (err) {
        console.warn(`[PdfParser] P.${i} のテキスト抽出に失敗:`, err.message);
      }
      pages.push({ page: i, text });
    }

    console.log(`[PdfParser] 解析完了: ${numPages}ページ / 章${chapters.length}件 / テキスト${hasText ? 'あり' : 'なし(スキャンPDF?)'}`);

    return { numPages, chapters, pages, hasText };
  } finally {
    // ドキュメントを破棄してworkerメモリを解放
    try { await pdf.destroy(); } catch { /* ignore */ }
  }
}

/**
 * ページ範囲文字列（"P.10-25" / "10-25" / "P.10"）を {start, end} に正規化する
 * @param {string} pageRange
 * @param {number} numPages
 * @returns {{start: number, end: number}|null}
 */
export function parsePageRange(pageRange, numPages = Infinity) {
  if (!pageRange) return null;
  const nums = String(pageRange).match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  let start = parseInt(nums[0], 10);
  let end = nums.length > 1 ? parseInt(nums[1], 10) : start;
  if (start > end) [start, end] = [end, start];
  start = Math.max(1, start);
  end = Math.min(numPages, end);
  if (end < start) return null;
  return { start, end };
}

/**
 * 抽出済みページ配列から指定ページ範囲の本文を連結して返す
 * @param {Array<{page: number, text: string}>} pages
 * @param {number} start - 開始ページ（1始まり, inclusive）
 * @param {number} end - 終了ページ（1始まり, inclusive）
 * @param {Object} [options]
 * @param {number} [options.maxChars=60000] - 返す最大文字数（トークン節約）
 * @returns {string}
 */
export function getTextForRange(pages, start, end, { maxChars = 60000 } = {}) {
  if (!Array.isArray(pages)) return '';
  const parts = [];
  for (const p of pages) {
    if (p.page >= start && p.page <= end && p.text) {
      parts.push(`【P.${p.page}】${p.text}`);
    }
  }
  let text = parts.join('\n');
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + '\n…（以下省略）';
  }
  return text;
}

/**
 * 章構成を Gemini に渡すためのテキスト要約に変換する
 * @param {Chapter[]} chapters
 * @returns {string}
 */
export function chaptersToText(chapters) {
  if (!Array.isArray(chapters) || chapters.length === 0) return '（目次情報なし）';
  return chapters
    .map(ch => `  - ${ch.name}（P.${ch.startPage}-${ch.endPage}）`)
    .join('\n');
}

/**
 * しおりが無いPDF用に、ページ数を等分した擬似的な章構成を作る
 * @param {number} numPages
 * @param {string} [titlePrefix='パート']
 * @param {number} [maxChunks=8] - 最大分割数
 * @param {number} [chunkPages=30] - 1チャンクあたりの目安ページ数
 * @returns {Chapter[]}
 */
export function fallbackChapters(numPages, titlePrefix = 'パート', maxChunks = 8, chunkPages = 30) {
  if (!numPages || numPages < 1) return [];
  const chunks = Math.max(1, Math.min(maxChunks, Math.ceil(numPages / chunkPages)));
  const per = Math.ceil(numPages / chunks);
  const chapters = [];
  for (let i = 0; i < chunks; i++) {
    const startPage = i * per + 1;
    const endPage = Math.min(numPages, startPage + per - 1);
    if (startPage > numPages) break;
    chapters.push({ name: `${titlePrefix}${i + 1}`, startPage, endPage });
  }
  return chapters;
}
