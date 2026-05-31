/**
 * Study Support - テスト画面（スケジュールベース + AI問題生成）
 * @module components/quiz
 */
import { getAll, getAllByIndex, get, put, generateId, logDailyStudy, todayStr } from '../db.js';

/** @type {'setup'|'active'|'results'} */
let currentPhase = 'setup';
/** @type {Array} */
let currentQuestions = [];
/** @type {number} */
let currentIndex = 0;
/** @type {Array} */
let answers = [];
/** @type {number} */
let startTime = 0;
/** @type {string|null} */
let currentScheduleId = null;

/**
 * テスト画面をレンダリング
 * @param {HTMLElement} container
 */
export async function renderQuiz(container) {
  currentPhase = 'setup';
  currentQuestions = [];
  currentIndex = 0;
  answers = [];
  currentScheduleId = null;

  // URLパラメータからscheduleIdを取得
  const hash = window.location.hash;
  const params = new URLSearchParams(hash.split('?')[1] || '');
  const scheduleId = params.get('scheduleId');

  if (scheduleId) {
    // スケジュールベースのテスト
    currentScheduleId = scheduleId;
    const schedule = await get('schedule', scheduleId);

    if (schedule) {
      let questions = [];

      // 既存の問題を取得
      if (schedule.questionIds?.length > 0) {
        for (const qId of schedule.questionIds) {
          const q = await get('questions', qId);
          if (q) questions.push(q);
        }
      }

      // 問題が無い場合はon-demand生成
      if (questions.length === 0 && schedule.needsQuestions !== false) {
        container.innerHTML = `
          <div class="quiz-page" style="text-align: center; padding: 64px 24px;">
            <div class="loading-spinner"></div>
            <p style="margin-top: 16px; color: #a78bfa;">
              📝 「${schedule.topic}」の問題を生成中...
            </p>
          </div>
        `;

        try {
          const { generateQuestionsFromText } = await import('../services/gemini.js');
          const { text, materialId, subjectId } = await resolveScheduleText(schedule);

          const qArray = await generateQuestionsFromText(text, {
            topic: schedule.topic,
            pageRange: schedule.pageRange,
            count: schedule.questionCount || 10,
          });

          // DBに保存
          const newQuestionIds = [];
          for (const q of (qArray || [])) {
            const qId = generateId();
            newQuestionIds.push(qId);
            const questionData = {
              id: qId,
              scheduleId,
              materialId,
              subjectId,
              type: q.type || 'multiple_choice',
              question: q.question,
              options: q.options || [],
              correctAnswer: q.correctAnswer,
              explanation: q.explanation || '',
              difficulty: q.difficulty || 'medium',
              createdAt: new Date().toISOString(),
            };
            await put('questions', questionData);
            questions.push(questionData);
          }

          // scheduleを更新
          await put('schedule', {
            ...schedule,
            questionIds: newQuestionIds,
            needsQuestions: false,
          });
        } catch (err) {
          console.error('On-demand question generation failed:', err);
          container.innerHTML = `
            <div class="quiz-page" style="text-align: center; padding: 64px 24px;">
              <p style="color: var(--color-danger);">問題生成に失敗しました: ${err.message}</p>
              <button class="btn btn-secondary" onclick="window.location.hash='#/quiz'">戻る</button>
            </div>
          `;
          return;
        }
      }

      if (questions.length > 0) {
        currentQuestions = questions;
        startTime = Date.now();
        currentPhase = 'active';
        renderActivePhase(container, schedule.topic);
        return;
      }
    }
  }

  // セットアップ画面を表示
  await renderSetupPhase(container);
}

/**
 * スケジュールエントリに対応する本文テキストを解決する（PDFアップロード不要）
 * @param {Object} schedule
 * @returns {Promise<{text: string, materialId: string|null, subjectId: string|null}>}
 */
async function resolveScheduleText(schedule) {
  const { getOrParseContent } = await import('../services/material-manager.js');
  const { getTextForRange, parsePageRange } = await import('../services/pdf-parser.js');
  const materials = await getAll('materials');

  // 対象教材を解決（materialId → materialTitle の順）
  let material = null;
  if (schedule.materialId) material = materials.find(m => m.id === schedule.materialId);
  if (!material && schedule.materialTitle) material = materials.find(m => m.title === schedule.materialTitle);

  if (material) {
    const content = await getOrParseContent(material.id);
    if (content?.pages?.length) {
      if (schedule.pageRange) {
        const r = parsePageRange(schedule.pageRange, content.numPages);
        if (r) {
          return {
            text: getTextForRange(content.pages, r.start, r.end),
            materialId: material.id,
            subjectId: material.subjectId,
          };
        }
      }
      // ページ範囲なし（復習日など）→ 教材全体から
      return {
        text: getTextForRange(content.pages, 1, content.numPages),
        materialId: material.id,
        subjectId: material.subjectId,
      };
    }
  }

  // 教材未解決（総復習日など）→ 本文テキストを持つ最初の教材から
  for (const m of materials) {
    const content = await getOrParseContent(m.id);
    if (content?.hasText && content.pages?.length) {
      return {
        text: getTextForRange(content.pages, 1, content.numPages),
        materialId: m.id,
        subjectId: m.subjectId,
      };
    }
  }

  throw new Error('問題生成に使える本文テキストが見つかりません。教材を再登録してください。');
}

/**
 * セットアップ画面
 */
async function renderSetupPhase(container) {
  const today = todayStr();
  const schedules = await getAll('schedule');
  const todayPending = schedules.filter(s => s.date === today && s.status === 'pending');
  const materials = await getAll('materials');
  const subjects = await getAll('subjects');

  container.innerHTML = `
    <div class="quiz-page">
      <header class="page-header">
        <h1 class="page-title">📝 テスト</h1>
      </header>

      ${todayPending.length > 0 ? `
        <section class="card card-glass" style="margin-bottom: 20px;">
          <h2 class="section-title">📅 今日のスケジュール</h2>
          ${todayPending.map(s => `
            <div class="today-task-item" data-id="${s.id}">
              <div class="task-info">
                <span class="task-status">📝</span>
                <span class="task-topic">${s.topic || 'テスト'}</span>
                <span class="task-detail">${s.pageRange || ''} × ${s.questionIds?.length || 0}問</span>
              </div>
              <button class="btn btn-primary btn-sm btn-start-schedule" data-schedule-id="${s.id}">開始 →</button>
            </div>
          `).join('')}
        </section>
      ` : ''}

      <section class="card card-glass">
        <h2 class="section-title">🤖 フリーテスト（AI問題生成）</h2>
        <form id="free-test-form">
          <div class="form-group">
            <label>教材</label>
            <select id="quiz-material" class="select">
              <option value="">教材を選択...</option>
              ${materials.map(m => {
                const subj = subjects.find(s => s.id === m.subjectId);
                return `<option value="${m.id}">${subj?.icon || '📄'} ${m.title}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>ページ範囲（任意）</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="number" id="quiz-page-start" class="input" placeholder="開始" min="1" style="width: 80px;" />
              <span>〜</span>
              <input type="number" id="quiz-page-end" class="input" placeholder="終了" min="1" style="width: 80px;" />
            </div>
          </div>
          <div class="form-group">
            <label>問題数</label>
            <select id="quiz-count" class="select">
              <option value="5">5問</option>
              <option value="10" selected>10問</option>
              <option value="15">15問</option>
              <option value="20">20問</option>
            </select>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" id="btn-generate-quiz">
              <span>🤖</span> AI問題生成
            </button>
          </div>
        </form>
        <div id="quiz-loading" style="display: none; text-align: center; padding: 40px;">
          <div class="loading-spinner"></div>
          <p style="margin-top: 16px; color: #a78bfa;">Geminiが問題を生成中...</p>
        </div>
      </section>

      <!-- テスト履歴 -->
      <section class="card card-glass" style="margin-top: 20px;" id="test-history-section">
        <h2 class="section-title">📋 テスト履歴</h2>
        <div id="test-history"></div>
      </section>
    </div>
  `;

  // イベント設定
  document.querySelectorAll('.btn-start-schedule').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.hash = `#/quiz?scheduleId=${btn.dataset.scheduleId}`;
    });
  });

  document.getElementById('free-test-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const materialId = document.getElementById('quiz-material').value;
    if (!materialId) {
      alert('教材を選択してください');
      return;
    }
    const pageStart = document.getElementById('quiz-page-start').value;
    const pageEnd = document.getElementById('quiz-page-end').value;
    const count = parseInt(document.getElementById('quiz-count').value);
    const pageRange = pageStart && pageEnd ? `P.${pageStart}-${pageEnd}` : '';

    document.getElementById('free-test-form').style.display = 'none';
    document.getElementById('quiz-loading').style.display = 'block';

    try {
      const { generateQuestionsFromText } = await import('../services/gemini.js');
      const { getOrParseContent } = await import('../services/material-manager.js');
      const { getTextForRange, parsePageRange } = await import('../services/pdf-parser.js');

      const content = await getOrParseContent(materialId);
      if (!content || !content.pages?.length) {
        throw new Error('教材の解析データがありません。教材を再登録してください。');
      }
      let text;
      if (pageStart && pageEnd) {
        const r = parsePageRange(pageRange, content.numPages);
        text = r ? getTextForRange(content.pages, r.start, r.end) : '';
      } else {
        text = getTextForRange(content.pages, 1, content.numPages);
      }

      const questions = await generateQuestionsFromText(text, { pageRange, count });
      const qArray = Array.isArray(questions) ? questions : [];
      if (qArray.length === 0) throw new Error('問題を生成できませんでした');

      // DBに保存
      for (const q of qArray) {
        q.id = generateId();
        q.materialId = materialId;
        q.createdAt = new Date().toISOString();
        await put('questions', q);
      }

      currentQuestions = qArray;
      startTime = Date.now();
      currentPhase = 'active';
      renderActivePhase(container, pageRange || 'フリーテスト');
    } catch (err) {
      console.error('Question generation failed:', err);
      document.getElementById('quiz-loading').style.display = 'none';
      document.getElementById('free-test-form').style.display = 'block';
      alert('問題生成に失敗しました: ' + err.message);
    }
  });

  // テスト履歴を読み込み
  await loadTestHistory();
}

/**
 * テスト実施画面
 */
function renderActivePhase(container, topic = '') {
  const q = currentQuestions[currentIndex];
  if (!q) return;

  const progress = Math.round(((currentIndex) / currentQuestions.length) * 100);

  container.innerHTML = `
    <div class="quiz-page quiz-active">
      <div class="quiz-header">
        <span class="quiz-topic">${topic}</span>
        <span class="quiz-progress">${currentIndex + 1} / ${currentQuestions.length}</span>
      </div>
      <div class="progress-bar" style="margin-bottom: 24px;">
        <div class="progress-fill" style="width: ${progress}%"></div>
      </div>

      <div class="card card-glass question-card">
        <div class="question-badge">
          <span class="badge">${q.type === 'multiple_choice' ? '選択式' : q.type === 'true_false' ? '○×' : '穴埋め'}</span>
          <span class="badge badge-${q.difficulty || 'medium'}">${q.difficulty === 'easy' ? '易' : q.difficulty === 'hard' ? '難' : '中'}</span>
        </div>
        <h3 class="question-text">${q.question}</h3>
        
        <div class="options-container" id="options-container">
          ${renderOptions(q)}
        </div>
      </div>

      <div id="feedback-area" style="display: none;"></div>
    </div>
  `;

  setupAnswerEvents(container, topic);
}

/**
 * 選択肢をレンダリング
 */
function renderOptions(q) {
  if (q.type === 'true_false') {
    return `
      <button class="option-btn" data-answer="○">○</button>
      <button class="option-btn" data-answer="×">×</button>
    `;
  }
  if (q.type === 'fill_blank') {
    return `
      <div class="fill-blank-input">
        <input type="text" id="fill-answer" class="input" placeholder="答えを入力..." autocomplete="off" />
        <button class="btn btn-primary" id="btn-submit-fill">回答</button>
      </div>
    `;
  }
  // multiple_choice
  const options = q.options || [];
  return options.map((opt, i) => `
    <button class="option-btn" data-answer="${opt}">
      <span class="option-label">${String.fromCharCode(65 + i)}</span>
      <span class="option-text">${opt}</span>
    </button>
  `).join('');
}

/**
 * 回答イベント設定
 */
function setupAnswerEvents(container, topic) {
  const q = currentQuestions[currentIndex];

  // 選択式/○×
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => processAnswer(btn.dataset.answer, container, topic));
  });

  // 穴埋め
  document.getElementById('btn-submit-fill')?.addEventListener('click', () => {
    const answer = document.getElementById('fill-answer')?.value.trim();
    if (answer) processAnswer(answer, container, topic);
  });
  document.getElementById('fill-answer')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const answer = e.target.value.trim();
      if (answer) processAnswer(answer, container, topic);
    }
  });
}

/**
 * 回答を処理
 */
async function processAnswer(userAnswer, container, topic) {
  const q = currentQuestions[currentIndex];
  const isCorrect = userAnswer === q.correctAnswer;

  answers.push({ questionId: q.id, userAnswer, isCorrect, question: q });

  // 視覚フィードバック
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.answer === q.correctAnswer) {
      btn.classList.add('correct');
    } else if (btn.dataset.answer === userAnswer && !isCorrect) {
      btn.classList.add('incorrect');
    }
  });

  const feedbackArea = document.getElementById('feedback-area');
  if (feedbackArea) {
    feedbackArea.style.display = 'block';
    feedbackArea.innerHTML = `
      <div class="feedback-card ${isCorrect ? 'feedback-correct' : 'feedback-incorrect'}">
        <div class="feedback-header">
          <span class="feedback-icon">${isCorrect ? '✅' : '❌'}</span>
          <span class="feedback-label">${isCorrect ? '正解！' : '不正解'}</span>
        </div>
        ${!isCorrect ? `<p class="feedback-answer">正解: ${q.correctAnswer}</p>` : ''}
        ${q.explanation ? `<p class="feedback-explanation">${q.explanation}</p>` : ''}
      </div>
    `;
  }

  // テスト結果をDBに保存
  await put('testResults', {
    id: generateId(),
    questionId: q.id,
    materialId: q.materialId,
    subjectId: q.subjectId,
    userAnswer,
    isCorrect,
    testedAt: new Date().toISOString(),
  });

  // 次の問題へ
  setTimeout(() => {
    currentIndex++;
    if (currentIndex < currentQuestions.length) {
      renderActivePhase(container, topic);
    } else {
      renderResultsPhase(container);
    }
  }, 1500);
}

/**
 * テスト結果画面
 */
async function renderResultsPhase(container) {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const correctCount = answers.filter(a => a.isCorrect).length;
  const totalCount = answers.length;
  const scorePercent = Math.round((correctCount / totalCount) * 100);

  // スケジュール更新
  if (currentScheduleId) {
    const schedule = await get('schedule', currentScheduleId);
    if (schedule) {
      schedule.status = 'completed';
      schedule.score = scorePercent;
      schedule.completedAt = new Date().toISOString();
      await put('schedule', schedule);
    }
  }

  // 日次ログ
  await logDailyStudy();

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  // スコアサークル
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (scorePercent / 100) * circumference;

  container.innerHTML = `
    <div class="quiz-page quiz-results">
      <header class="page-header">
        <h1 class="page-title">📊 テスト結果</h1>
      </header>

      <div class="card card-glass results-summary" style="text-align: center; padding: 32px;">
        <svg class="score-circle" width="140" height="140" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="8" />
          <circle cx="60" cy="60" r="54" fill="none" 
            stroke="${scorePercent >= 80 ? '#10b981' : scorePercent >= 60 ? '#f59e0b' : '#ef4444'}" 
            stroke-width="8" stroke-linecap="round"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
            transform="rotate(-90 60 60)" style="transition: stroke-dashoffset 1s ease;" />
          <text x="60" y="55" text-anchor="middle" fill="white" font-size="28" font-weight="bold">${scorePercent}%</text>
          <text x="60" y="75" text-anchor="middle" fill="#888" font-size="12">${correctCount}/${totalCount}</text>
        </svg>

        <div class="results-stats" style="display: flex; justify-content: center; gap: 32px; margin-top: 20px;">
          <div><span style="font-size: 1.5em; font-weight: 700; color: #10b981;">${correctCount}</span><br/><span style="color: #888;">正解</span></div>
          <div><span style="font-size: 1.5em; font-weight: 700; color: #ef4444;">${totalCount - correctCount}</span><br/><span style="color: #888;">不正解</span></div>
          <div><span style="font-size: 1.5em; font-weight: 700; color: #3b82f6;">${minutes}:${String(seconds).padStart(2, '0')}</span><br/><span style="color: #888;">所要時間</span></div>
        </div>
      </div>

      <!-- 問題別結果 -->
      <section class="card card-glass" style="margin-top: 20px;">
        <h2 class="section-title">問題別結果</h2>
        ${answers.map((a, i) => `
          <div class="result-item ${a.isCorrect ? 'result-correct' : 'result-incorrect'}">
            <span class="result-icon">${a.isCorrect ? '✅' : '❌'}</span>
            <div class="result-detail">
              <span class="result-number">Q${i + 1}</span>
              <span class="result-question">${a.question.question.substring(0, 60)}${a.question.question.length > 60 ? '...' : ''}</span>
            </div>
          </div>
        `).join('')}
      </section>

      <div class="form-actions" style="margin-top: 20px;">
        <a href="#/" class="btn btn-primary">ダッシュボードに戻る</a>
        <a href="#/quiz" class="btn btn-secondary">もう一度テスト</a>
      </div>
    </div>
  `;
}

/**
 * テスト履歴を読み込み
 */
async function loadTestHistory() {
  const container = document.getElementById('test-history');
  if (!container) return;

  const schedules = await getAll('schedule');
  const completed = schedules
    .filter(s => s.status === 'completed')
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    .slice(0, 10);

  if (completed.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>テスト履歴はまだありません</p></div>';
    return;
  }

  container.innerHTML = completed.map(s => {
    const date = s.completedAt ? new Date(s.completedAt).toLocaleDateString('ja-JP') : '';
    return `
      <div class="history-item">
        <span class="history-date">${date}</span>
        <span class="history-topic">${s.topic || 'テスト'}</span>
        <span class="history-score" style="color: ${(s.score || 0) >= 80 ? '#10b981' : (s.score || 0) >= 60 ? '#f59e0b' : '#ef4444'}">
          ${s.score != null ? s.score + '%' : '-'}
        </span>
      </div>
    `;
  }).join('');
}
