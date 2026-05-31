/**
 * Study Support - Google Drive 連携サービス
 * Google Drive API v3 + Google Identity Services (GIS) + Google Picker API
 * @module services/google-drive
 */

import { getSetting, setSetting } from '../db.js';

// ============================================================
// 定数
// ============================================================

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

// ============================================================
// モジュール内部状態
// ============================================================

/** @type {boolean} */
let gapiLoaded = false;

/** @type {boolean} */
let gisLoaded = false;

/** @type {google.accounts.oauth2.TokenClient|null} */
let tokenClient = null;

/** @type {string|null} */
let currentAccessToken = null;

/** @type {number|null} */
let tokenExpiresAt = null;

/** @type {Function|null} - 認証完了時のコールバック */
let authResolve = null;

/** @type {Function|null} - 認証失敗時のコールバック */
let authReject = null;

// ============================================================
// 初期化
// ============================================================

/**
 * Google API (gapi) と GIS を初期化する
 * index.html で gapi と GIS のスクリプトをロード後に呼び出す
 * @returns {Promise<void>}
 */
export async function initGoogleAPI() {
  const clientId = await getSetting('googleClientId');
  const apiKey = await getSetting('googleApiKey');

  if (!clientId || !apiKey) {
    console.warn('[GoogleDrive] Client ID または API Key が未設定です。設定画面から入力してください。');
    return;
  }

  // gapi の初期化
  await _initGapi(apiKey);

  // GIS の初期化
  _initGIS(clientId);

  console.log('[GoogleDrive] Google API 初期化完了');
}

/**
 * gapi クライアントを初期化
 * @param {string} apiKey
 * @returns {Promise<void>}
 * @private
 */
function _initGapi(apiKey) {
  return new Promise((resolve, reject) => {
    if (typeof gapi === 'undefined') {
      reject(new Error('gapi が読み込まれていません。index.html に <script src="https://apis.google.com/js/api.js"> を追加してください。'));
      return;
    }

    gapi.load('client:picker', async () => {
      try {
        await gapi.client.init({
          apiKey: apiKey,
          discoveryDocs: [DISCOVERY_DOC],
        });
        gapiLoaded = true;
        console.log('[GoogleDrive] gapi client 初期化完了');
        resolve();
      } catch (err) {
        reject(new Error(`gapi client 初期化エラー: ${err.message}`));
      }
    });
  });
}

/**
 * Google Identity Services (GIS) を初期化
 * @param {string} clientId
 * @private
 */
function _initGIS(clientId) {
  if (typeof google === 'undefined' || !google.accounts) {
    console.error('[GoogleDrive] GIS が読み込まれていません。index.html に <script src="https://accounts.google.com/gsi/client"> を追加してください。');
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: _handleTokenResponse,
  });

  gisLoaded = true;
  console.log('[GoogleDrive] GIS 初期化完了');
}

/**
 * トークンレスポンスのハンドラ
 * @param {google.accounts.oauth2.TokenResponse} response
 * @private
 */
function _handleTokenResponse(response) {
  if (response.error) {
    console.error('[GoogleDrive] 認証エラー:', response.error);
    if (authReject) {
      authReject(new Error(`認証エラー: ${response.error}`));
      authReject = null;
      authResolve = null;
    }
    return;
  }

  currentAccessToken = response.access_token;
  // トークンの有効期限を記録（余裕を持って60秒早く期限切れとする）
  const expiresIn = parseInt(response.expires_in, 10) || 3600;
  tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;

  console.log('[GoogleDrive] 認証成功、トークン取得完了');

  if (authResolve) {
    authResolve();
    authResolve = null;
    authReject = null;
  }
}

// ============================================================
// 認証
// ============================================================

/**
 * 現在認証済みかどうかを確認する
 * @returns {boolean}
 */
export function isAuthenticated() {
  if (!currentAccessToken) return false;
  if (tokenExpiresAt && Date.now() >= tokenExpiresAt) {
    currentAccessToken = null;
    tokenExpiresAt = null;
    return false;
  }
  return true;
}

/**
 * OAuth 2.0 認証フローを開始する
 * ユーザーにGoogleアカウントへのアクセスを許可させる
 * @returns {Promise<void>}
 * @throws {Error} GIS未初期化時
 */
export async function authenticate() {
  if (!gisLoaded || !tokenClient) {
    throw new Error('Google Identity Services が初期化されていません。initGoogleAPI() を先に呼び出してください。');
  }

  // 既に有効なトークンがある場合はスキップ
  if (isAuthenticated()) {
    return;
  }

  return new Promise((resolve, reject) => {
    authResolve = resolve;
    authReject = reject;

    // トークンが期限切れの場合、サイレントに再取得を試行
    if (currentAccessToken) {
      tokenClient.requestAccessToken({ prompt: '' });
    } else {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    }
  });
}

/**
 * サインアウトしてトークンを無効化する
 */
export function signOut() {
  if (currentAccessToken) {
    google.accounts.oauth2.revoke(currentAccessToken, () => {
      console.log('[GoogleDrive] トークンを無効化しました');
    });
  }
  currentAccessToken = null;
  tokenExpiresAt = null;
}

/**
 * 有効なアクセストークンを確保する（必要なら再取得）
 * @returns {Promise<string>}
 * @private
 */
async function _ensureToken() {
  if (!isAuthenticated()) {
    await authenticate();
  }
  return currentAccessToken;
}

// ============================================================
// Google Picker
// ============================================================

/**
 * Google Picker を表示してユーザーにPDFファイルを選択させる
 * @returns {Promise<{id: string, name: string, mimeType: string}>}
 * @throws {Error} ユーザーがキャンセルした場合
 */
export async function showPicker() {
  if (!gapiLoaded) {
    throw new Error('gapi が初期化されていません。initGoogleAPI() を先に呼び出してください。');
  }

  const token = await _ensureToken();
  const apiKey = await getSetting('googleApiKey');

  return new Promise((resolve, reject) => {
    const view = new google.picker.View(google.picker.ViewId.DOCS);
    view.setMimeTypes('application/pdf');

    const picker = new google.picker.PickerBuilder()
      .setDeveloperKey(apiKey)
      .setOAuthToken(token)
      .addView(view)
      .addView(new google.picker.DocsUploadView())
      .setTitle('PDFファイルを選択')
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs[0];
          resolve({
            id: doc.id,
            name: doc.name,
            mimeType: doc.mimeType,
          });
        } else if (data.action === google.picker.Action.CANCEL) {
          reject(new Error('ファイル選択がキャンセルされました'));
        }
      })
      .build();

    picker.setVisible(true);
  });
}

// ============================================================
// Drive API 操作
// ============================================================

/**
 * Google Drive からファイルをダウンロードする
 * @param {string} fileId - Google Drive のファイルID
 * @returns {Promise<Blob>} ダウンロードしたファイルのBlob
 */
export async function downloadFile(fileId) {
  const token = await _ensureToken();

  console.log(`[GoogleDrive] ファイルダウンロード開始: ${fileId}`);

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error(`[GoogleDrive] ダウンロードエラー: ${response.status}`, errorText);
    throw new Error(`ファイルダウンロードエラー: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  console.log(`[GoogleDrive] ダウンロード完了: ${blob.size} bytes`);
  return blob;
}

/**
 * ファイルのメタデータを取得する
 * @param {string} fileId - Google Drive のファイルID
 * @returns {Promise<{id: string, name: string, mimeType: string, modifiedTime: string, size: string}>}
 */
export async function getFileMetadata(fileId) {
  const token = await _ensureToken();

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,modifiedTime,size`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`メタデータ取得エラー: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * ファイルが前回確認時から更新されているかチェックする
 * @param {string} fileId - Google Drive のファイルID
 * @param {string} lastKnownModifiedTime - 前回取得時の modifiedTime (ISO 8601)
 * @returns {Promise<boolean>} 更新されていれば true
 */
export async function checkFileModified(fileId, lastKnownModifiedTime) {
  try {
    const metadata = await getFileMetadata(fileId);
    return metadata.modifiedTime !== lastKnownModifiedTime;
  } catch (err) {
    console.error('[GoogleDrive] ファイル更新チェックエラー:', err);
    return false;
  }
}
