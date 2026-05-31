/**
 * Study Support - 問題生成サービス
 * テンプレートベースの問題自動生成とCRUD管理
 * @module services/question-generator
 */

import { put, get, getAll, getAllByIndex, remove, generateId } from '../db.js';

// ============================================================
// 定数
// ============================================================

/**
 * 問題タイプ
 * @enum {string}
 */
const QUESTION_TYPE = {
  MULTIPLE_CHOICE: 'multiple_choice',
  TRUE_FALSE: 'true_false',
  FILL_BLANK: 'fill_blank',
};

// ============================================================
// 問題生成（テンプレートベース）
// ============================================================

/**
 * @typedef {Object} Question
 * @property {string} id - 問題ID
 * @property {string} materialId - 教材ID
 * @property {string} subjectId - 教科ID
 * @property {number[]} relatedPages - 関連ページ番号
 * @property {string} type - 問題タイプ
 * @property {string} question - 問題文
 * @property {string[]|null} options - 選択肢（選択式の場合）
 * @property {string} correctAnswer - 正解
 * @property {string} explanation - 解説
 * @property {number} difficulty - 難易度 (1-5)
 * @property {string} createdAt - 作成日時
 * @property {number} interval - 復習間隔（日）
 * @property {number} repetition - 復習回数
 * @property {string|null} nextReviewDate - 次回復習日
 */

/**
 * 教材に基づいて問題セットを生成する
 * テンプレートベースの簡易生成（LLM統合は後で追加予定）
 * @param {Object} material - 教材オブジェクト
 * @param {Array<Object>} [existingQuestions=[]] - 既存の問題（重複回避用）
 * @returns {Question[]} 生成された問題の配列
 */
export function generateQuestionsForMaterial(material, existingQuestions = []) {
  const questions = [];
  const existingTexts = new Set(existingQuestions.map(q => q.question));

  // テンプレートベースの基本的な問題を生成
  const templates = _getTemplatesForSubject(material.subjectId);

  for (const template of templates) {
    const questionText = template.question.replace('{title}', material.title);

    // 既存の問題と重複しないかチェック
    if (existingTexts.has(questionText)) {
      continue;
    }

    questions.push({
      id: generateId(),
      materialId: material.id,
      subjectId: material.subjectId,
      relatedPages: template.relatedPages || [],
      type: template.type,
      question: questionText,
      options: template.options || null,
      correctAnswer: template.correctAnswer,
      explanation: template.explanation || '',
      difficulty: template.difficulty || 3,
      createdAt: new Date().toISOString(),
      interval: 1,
      repetition: 0,
      nextReviewDate: new Date().toISOString().split('T')[0],
    });
  }

  return questions;
}

/**
 * ○×問題を生成する
 * @param {string} keyword - キーワード
 * @param {string} context - 文脈・説明文
 * @returns {Question} 生成された問題
 */
export function generateTrueFalse(keyword, context) {
  const templates = [
    {
      question: `「${keyword}」について: ${context}`,
      correctAnswer: '○',
    },
    {
      question: `${context}の説明は「${keyword}」に当てはまる。`,
      correctAnswer: '○',
    },
  ];

  const template = templates[Math.floor(Math.random() * templates.length)];

  return {
    id: generateId(),
    materialId: '',
    subjectId: '',
    relatedPages: [],
    type: QUESTION_TYPE.TRUE_FALSE,
    question: template.question,
    options: ['○', '×'],
    correctAnswer: template.correctAnswer,
    explanation: `${keyword}: ${context}`,
    difficulty: 2,
    createdAt: new Date().toISOString(),
    interval: 1,
    repetition: 0,
    nextReviewDate: new Date().toISOString().split('T')[0],
  };
}

/**
 * 選択式問題を生成する
 * @param {string} keyword - キーワード（正解）
 * @param {string} context - 問題の文脈
 * @param {string[]} distractors - 誤答の選択肢（3つ推奨）
 * @returns {Question} 生成された問題
 */
export function generateMultipleChoice(keyword, context, distractors) {
  // 選択肢をシャッフル
  const options = _shuffleArray([keyword, ...distractors]);

  return {
    id: generateId(),
    materialId: '',
    subjectId: '',
    relatedPages: [],
    type: QUESTION_TYPE.MULTIPLE_CHOICE,
    question: context,
    options,
    correctAnswer: keyword,
    explanation: `正解は「${keyword}」です。`,
    difficulty: 3,
    createdAt: new Date().toISOString(),
    interval: 1,
    repetition: 0,
    nextReviewDate: new Date().toISOString().split('T')[0],
  };
}

/**
 * 穴埋め問題を生成する
 * @param {string} sentence - 元の文（キーワードを含む）
 * @param {string} keyword - 穴にするキーワード
 * @returns {Question} 生成された問題
 */
export function generateFillBlank(sentence, keyword) {
  const blankSentence = sentence.replace(keyword, '（　　　）');

  return {
    id: generateId(),
    materialId: '',
    subjectId: '',
    relatedPages: [],
    type: QUESTION_TYPE.FILL_BLANK,
    question: `次の文の空欄を埋めてください:\n${blankSentence}`,
    options: null,
    correctAnswer: keyword,
    explanation: `正解: ${keyword}\n原文: ${sentence}`,
    difficulty: 3,
    createdAt: new Date().toISOString(),
    interval: 1,
    repetition: 0,
    nextReviewDate: new Date().toISOString().split('T')[0],
  };
}

// ============================================================
// 問題の保存・取得 (CRUD)
// ============================================================

/**
 * 問題をデータベースに保存する（一括）
 * @param {Question[]} questions - 保存する問題の配列
 * @returns {Promise<void>}
 */
export async function saveQuestions(questions) {
  for (const question of questions) {
    if (!question.id) {
      question.id = generateId();
    }
    if (!question.createdAt) {
      question.createdAt = new Date().toISOString();
    }
    await put('questions', question);
  }
  console.log(`[QuestionGenerator] ${questions.length} 問を保存しました`);
}

/**
 * 教材IDに紐づく問題を全て取得する
 * @param {string} materialId - 教材ID
 * @returns {Promise<Question[]>}
 */
export async function getQuestionsForMaterial(materialId) {
  return getAllByIndex('questions', 'materialId', materialId);
}

/**
 * 教科IDに紐づく問題を全て取得する
 * @param {string} subjectId - 教科ID
 * @returns {Promise<Question[]>}
 */
export async function getQuestionsForSubject(subjectId) {
  return getAllByIndex('questions', 'subjectId', subjectId);
}

/**
 * SM-2に基づいて復習が必要な問題を取得する
 * @param {string} subjectId - 教科ID
 * @returns {Promise<Question[]>}
 */
export async function getQuestionsForReview(subjectId) {
  const questions = await getQuestionsForSubject(subjectId);
  const today = new Date().toISOString().split('T')[0];

  return questions.filter(q => {
    if (!q.nextReviewDate) return true;
    return q.nextReviewDate <= today;
  });
}

/**
 * 今日復習すべき全ての問題を取得する（教科横断）
 * @returns {Promise<Question[]>}
 */
export async function getDueQuestions() {
  const allQuestions = await getAll('questions');
  const today = new Date().toISOString().split('T')[0];

  return allQuestions.filter(q => {
    if (!q.nextReviewDate) return true;
    return q.nextReviewDate <= today;
  });
}

/**
 * 問題を1件取得する
 * @param {string} questionId - 問題ID
 * @returns {Promise<Question|undefined>}
 */
export async function getQuestion(questionId) {
  return get('questions', questionId);
}

/**
 * 問題を更新する
 * @param {string} questionId - 問題ID
 * @param {Partial<Question>} updates - 更新フィールド
 * @returns {Promise<Question>}
 */
export async function updateQuestion(questionId, updates) {
  const question = await get('questions', questionId);
  if (!question) {
    throw new Error(`問題が見つかりません: ${questionId}`);
  }

  const updated = {
    ...question,
    ...updates,
    id: questionId,
  };

  await put('questions', updated);
  return updated;
}

/**
 * 問題を削除する
 * @param {string} questionId - 問題ID
 * @returns {Promise<void>}
 */
export async function deleteQuestion(questionId) {
  await remove('questions', questionId);
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * 教科に応じたテンプレートを取得する
 * @param {string} subjectId - 教科ID
 * @returns {Array<Object>} テンプレートの配列
 * @private
 */
function _getTemplatesForSubject(subjectId) {
  const commonTemplates = [
    {
      type: QUESTION_TYPE.TRUE_FALSE,
      question: '「{title}」の内容を理解している。',
      correctAnswer: '○',
      explanation: '教材の内容を復習してください。',
      difficulty: 1,
    },
    {
      type: QUESTION_TYPE.FILL_BLANK,
      question: '「{title}」で学んだ重要なキーワードを1つ答えてください: （　　　）',
      correctAnswer: '（教材を参照）',
      explanation: '教材の重要な用語を確認しましょう。',
      difficulty: 2,
    },
    {
      type: QUESTION_TYPE.TRUE_FALSE,
      question: '「{title}」の内容について、要点を説明できる。',
      correctAnswer: '○',
      explanation: '教材の要点を自分の言葉でまとめてみましょう。',
      difficulty: 2,
    },
    {
      type: QUESTION_TYPE.FILL_BLANK,
      question: '「{title}」で学んだ最も重要な概念は何ですか？ （　　　）',
      correctAnswer: '（教材を参照）',
      explanation: '教材の中心的な概念を確認しましょう。',
      difficulty: 3,
    },
  ];

  const subjectTemplates = {
    math: [
      {
        type: QUESTION_TYPE.FILL_BLANK,
        question: '「{title}」で学んだ公式を答えてください: （　　　）',
        correctAnswer: '（教材を参照）',
        explanation: '教材の重要な公式を確認しましょう。',
        difficulty: 3,
      },
    ],
    english: [
      {
        type: QUESTION_TYPE.FILL_BLANK,
        question: '「{title}」で学んだ重要な英単語/フレーズ: （　　　）',
        correctAnswer: '（教材を参照）',
        explanation: '教材の重要な語彙を確認しましょう。',
        difficulty: 2,
      },
    ],
    science: [
      {
        type: QUESTION_TYPE.TRUE_FALSE,
        question: '「{title}」の実験/観察の結論は正しいか？',
        correctAnswer: '○',
        explanation: '教材の実験結果を確認しましょう。',
        difficulty: 3,
      },
    ],
    social: [
      {
        type: QUESTION_TYPE.FILL_BLANK,
        question: '「{title}」で学んだ重要な用語: （　　　）',
        correctAnswer: '（教材を参照）',
        explanation: '教材の重要な歴史的/地理的用語を確認しましょう。',
        difficulty: 2,
      },
    ],
    japanese: [
      {
        type: QUESTION_TYPE.FILL_BLANK,
        question: '「{title}」で学んだ重要な文法/語句: （　　　）',
        correctAnswer: '（教材を参照）',
        explanation: '教材の重要な語句を確認しましょう。',
        difficulty: 2,
      },
    ],
  };

  return [
    ...commonTemplates,
    ...(subjectTemplates[subjectId] || []),
  ];
}

/**
 * 配列をランダムにシャッフルする（Fisher-Yates）
 * @param {Array} array
 * @returns {Array}
 * @private
 */
function _shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
