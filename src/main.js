/**
 * Study Support - メインエントリポイント
 * @module main
 */
import { addRoute, initRouter } from './router.js';
import { getDB, initDefaultSubjects, calculateStreak } from './db.js';
import './styles/index.css';
import './styles/components.css';


/**
 * アプリケーション初期化
 */
async function initApp() {
  try {
    // IndexedDBを初期化
    await getDB();
    await initDefaultSubjects();

    // ルートを登録
    addRoute('/', async (container) => {
      const { renderDashboard } = await import('./components/dashboard.js');
      await renderDashboard(container);
    });

    addRoute('/materials', async (container) => {
      const { renderMaterials } = await import('./components/materials.js');
      await renderMaterials(container);
    });

    addRoute('/quiz', async (container) => {
      const { renderQuiz } = await import('./components/quiz.js');
      await renderQuiz(container);
    });

    addRoute('/analytics', async (container) => {
      const { renderAnalytics } = await import('./components/analytics.js');
      await renderAnalytics(container);
    });

    addRoute('/settings', async (container) => {
      const { renderSettings } = await import('./components/settings.js');
      await renderSettings(container);
    });



    addRoute('/404', (container) => {
      container.innerHTML = `
        <div class="error-page">
          <h2>404</h2>
          <p>ページが見つかりません</p>
          <a href="#/" class="btn btn-primary">ダッシュボードに戻る</a>
        </div>
      `;
    });

    // ルーターを初期化
    initRouter('page-container');

    // モバイルサイドバートグル
    setupMobileNav();

    // ストリーク表示を更新
    updateStreakDisplay();

    // スケジューラーを起動
    initScheduler();

    // ローディング非表示
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.hidden = true;

    console.log('✅ Study Support initialized');
  } catch (err) {
    console.error('❌ App initialization failed:', err);
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.innerHTML = `
        <div class="error-page">
          <h2>初期化エラー</h2>
          <p>${err.message}</p>
          <button class="btn btn-primary" onclick="location.reload()">再読み込み</button>
        </div>
      `;
    }
  }
}

/**
 * モバイルナビゲーション設定
 */
function setupMobileNav() {
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  menuToggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('visible');
  });

  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('visible');
  });
}

/**
 * ストリーク表示を更新
 */
async function updateStreakDisplay() {
  const streak = await calculateStreak();
  const streakCount = document.getElementById('streak-count');
  const mobileStreak = document.getElementById('mobile-streak-count');
  if (streakCount) streakCount.textContent = streak;
  if (mobileStreak) mobileStreak.textContent = streak;
}

/**
 * スケジューラーの初期化
 */
async function initScheduler() {
  try {
    const { startDailyScheduler } = await import('./services/scheduler.js');
    startDailyScheduler();
  } catch (err) {
    console.warn('Scheduler initialization skipped:', err.message);
  }
}

// アプリ起動
document.addEventListener('DOMContentLoaded', initApp);
