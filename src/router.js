/**
 * Study Support - ハッシュベースSPAルーター
 * @module router
 */

/** @type {Map<string, Function>} */
const routes = new Map();

/** @type {string} */
let currentPath = '';

/** @type {HTMLElement|null} */
let containerEl = null;

/**
 * ルートを登録する
 * @param {string} path - ルートパス（例: '/', '/materials'）
 * @param {Function} handler - ページレンダリング関数 (container) => void
 */
export function addRoute(path, handler) {
  routes.set(path, handler);
}

/**
 * ルーターを初期化する
 * @param {string} containerId - ページコンテナのDOM ID
 */
export function initRouter(containerId) {
  containerEl = document.getElementById(containerId);
  
  window.addEventListener('hashchange', () => {
    handleRoute();
  });
  
  // 初期ルーティング
  handleRoute();
}

/**
 * 現在のハッシュからルートを解決してレンダリング
 */
function handleRoute() {
  const hash = window.location.hash || '#/';
  const fullPath = hash.slice(1) || '/'; // '#/materials' → '/materials'
  
  // クエリパラメータを分離: '/viewer?id=xxx' → '/viewer'
  const path = fullPath.split('?')[0];
  
  if (fullPath === currentPath) return;
  
  const previousPath = currentPath;
  currentPath = fullPath;
  
  // ナビゲーションリンクのアクティブ状態を更新
  updateNavLinks(path);
  
  // パス部分のみでルートマッチング
  const handler = routes.get(path) || routes.get('/404');
  
  if (handler && containerEl) {
    // ページ遷移アニメーション
    containerEl.classList.add('page-exit');
    
    setTimeout(() => {
      containerEl.innerHTML = '';
      containerEl.classList.remove('page-exit');
      containerEl.classList.add('page-enter');
      
      try {
        handler(containerEl);
      } catch (err) {
        console.error(`Route error for ${path}:`, err);
        containerEl.innerHTML = `
          <div class="error-page">
            <h2>エラーが発生しました</h2>
            <p>${err.message}</p>
          </div>
        `;
      }
      
      // アニメーション完了後クラスを除去
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          containerEl.classList.remove('page-enter');
        });
      });
    }, 200);
  }

  // モバイルサイドバーを閉じる
  closeMobileSidebar();
}

/**
 * プログラムで画面遷移する
 * @param {string} path - 遷移先パス
 */
export function navigateTo(path) {
  window.location.hash = path;
}

/**
 * ナビゲーションリンクのアクティブ状態を更新
 * @param {string} path - 現在のパス
 */
function updateNavLinks(path) {
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    const linkPath = href ? href.slice(1).split('?')[0] : '/';
    link.classList.toggle('active', linkPath === path);
  });
}

/**
 * モバイルサイドバーを閉じる
 */
function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('visible');
}

/**
 * 現在のルートパスを取得
 * @returns {string}
 */
export function getCurrentPath() {
  return currentPath;
}
