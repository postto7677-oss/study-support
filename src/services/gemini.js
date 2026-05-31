/**
 * Study Support - Gemini API サービス（テキストベース）
 *
 * 方針: PDF を Gemini File API にアップロードしない。
 * 教材はブラウザ内（pdf-parser.js）で解析し、抽出した「目次テキスト」「本文テキスト」だけを
 * Gemini に送る。これにより高速・安価・安定し、File API のアップロード/期限切れ問題が無くなる。
 *
 * - スケジュール: 目次テキスト → 章ごとの学習日数配分（小さなJSON）。日付・並びはコード側で確定。
 * - 問題生成: 該当ページ範囲の本文テキスト → 問題。
 * - 分析: テスト結果テキスト → 弱点/アドバイス。
 *
 * @module services/gemini
 */

import { getSetting } from '../db.js';

// ============================================================
// 定数
// ============================================================

const API_BASE = 'https://generativelanguage.googleapis.com';
const GENERATE_URL = (model) => `${API_BASE}/v1beta/models/${model}:generateContent`;

const PRIMARY_MODEL = 'gemini-3.1-pro-preview';
const FALLBACK_MODEL = 'gemini-2.5-flash';
/** テキストタスクの既定モデル（高速・安定優先で flash） */
const DEFAULT_MODEL = FALLBACK_MODEL;

// ============================================================
// API Key 管理
// ============================================================

export async function getGeminiApiKey() {
  return getSetting('geminiApiKey', null);
}

/**
 * Gemini API Key の接続テスト
 */
export async function testApiKey(apiKey) {
  try {
    const res = await fetch(`${GENERATE_URL(FALLBACK_MODEL)}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'テスト。"ok"とだけ返して。' }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 256 },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.error?.message || `HTTP ${res.status}` };
    }

    // 3.1 Pro が使えるかチェック（任意）
    let proAvailable = false;
    try {
      const proRes = await fetch(`${GENERATE_URL(PRIMARY_MODEL)}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'テスト。"ok"とだけ返して。' }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 256 },
        }),
      });
      proAvailable = proRes.ok;
    } catch { /* ignore */ }

    const modelInfo = proAvailable ? '✅ 3.1 Pro利用可' : '⚠️ 2.5 Flashで動作';
    return { success: true, message: `接続成功 | ${modelInfo}`, proAvailable };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ============================================================
// 共通 API 呼び出し（テキストのみ・responseSchema対応）
// ============================================================

/**
 * Gemini API でJSON生成（テキストプロンプトのみ）
 * @param {Object} options
 * @param {string} options.prompt - テキストプロンプト
 * @param {Object} [options.responseSchema] - JSON Schema
 * @param {number} [options.temperature=0.5]
 * @param {string} [options.model]
 * @param {number} [options.maxOutputTokens=8192]
 * @returns {Promise<Object>}
 */
async function callGemini({ prompt, responseSchema, temperature = 0.5, model, maxOutputTokens = 8192 }) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('Gemini API Key が設定されていません');

  const useModel = model || DEFAULT_MODEL;

  const generationConfig = {
    responseMimeType: 'application/json',
    temperature,
    maxOutputTokens,
  };
  if (responseSchema) generationConfig.responseSchema = responseSchema;

  // Gemini 2.5 flash は既定で「思考」が有効で出力トークンを消費し、空応答(MAX_TOKENS)を招く。
  // 構造化出力タスクでは思考を無効化して出力枠を本文に回す。
  if (/2\.5-flash/.test(useModel)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig };

  console.log('[Gemini] リクエスト送信...', {
    model: useModel,
    promptLength: prompt.length,
    hasSchema: !!responseSchema,
  });

  const res = await fetch(`${GENERATE_URL(useModel)}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error('[Gemini] APIエラー詳細:', JSON.stringify(errBody, null, 2));
    const msg = errBody.error?.message || res.statusText;
    const code = errBody.error?.code || res.status;
    throw new Error(`Gemini API エラー (${code}): ${msg}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';

  if (!text) {
    const reason = candidate?.finishReason || 'unknown';
    const usage = data.usageMetadata ? JSON.stringify(data.usageMetadata) : 'n/a';
    console.error('[Gemini] 空応答:', { finishReason: reason, usageMetadata: data.usageMetadata, promptFeedback: data.promptFeedback });
    if (reason === 'MAX_TOKENS') {
      throw new Error(`Geminiの応答がトークン上限で打ち切られました（出力が長すぎ）。usage=${usage}`);
    }
    if (reason === 'SAFETY' || reason === 'RECITATION') {
      throw new Error(`Geminiが安全性フィルタで応答を拒否しました (finishReason: ${reason})`);
    }
    throw new Error(`Geminiの応答が空です (finishReason: ${reason})`);
  }

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[1] || match[0]); } catch { /* fallthrough */ }
    }
    // 途中で切れた（トークン上限）場合はその旨を明示する
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error('Geminiの応答がトークン上限で途中まで（出力が長すぎ）。教材数・章数が多い場合は分割してください。');
    }
    throw new Error('Geminiの応答をJSONとしてパースできません:\n' + text.substring(0, 300));
  }
}

// ============================================================
// スケジュール: 章ごとの学習日数配分（テキストのみ）
// ============================================================

const ALLOCATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    allocation: {
      type: 'ARRAY',
      description: '章・単元ごとの学習計画',
      items: {
        type: 'OBJECT',
        properties: {
          materialTitle: { type: 'STRING', description: '使用する教材名（入力の教材名と一致させる）' },
          topic: { type: 'STRING', description: '学習テーマ（章・単元名ベース）' },
          pageStart: { type: 'INTEGER', description: '開始ページ' },
          pageEnd: { type: 'INTEGER', description: '終了ページ' },
          studyDays: { type: 'INTEGER', description: 'この単元に割り当てる学習日数（1以上）' },
          importance: { type: 'STRING', description: 'high / medium / low' },
        },
        required: ['materialTitle', 'topic', 'pageStart', 'pageEnd', 'studyDays', 'importance'],
      },
    },
    summary: { type: 'STRING', description: '学習計画の概要（100字程度）' },
  },
  required: ['allocation', 'summary'],
};

/**
 * 目次情報から「章ごとの学習日数配分」を生成する（PDFは送らない）
 * @param {Object} exam - { name, examDate, dailyGoal }
 * @param {Array<{title: string, type: string, numPages: number, chaptersText: string}>} outlines
 * @param {number} studyDayBudget - 復習バッファを除いた、章学習に充てられる日数
 * @returns {Promise<{allocation: Array, summary: string}>}
 */
export async function generateScheduleAllocation(exam, outlines, studyDayBudget) {
  const materialDetails = outlines.map((o, i) =>
    `【教材${i + 1}】${o.title}（${o.type === 'exercise' ? '問題集' : 'テキスト'} / ${o.numPages || '?'}ページ）\n${o.chaptersText}`
  ).join('\n\n');

  const prompt = `あなたは試験対策の学習計画専門家です。
以下の教材の目次・章構成をもとに、各章・単元へ「学習日数」を配分してください。
日付の割り当ては不要です（システム側で行います）。章ごとの配分だけを返してください。

■ 試験情報
- 試験名: ${exam.name}
- 試験日: ${exam.examDate}
- 1日の目標問題数: ${exam.dailyGoal || 10}問

■ 配分のルール
- 章学習に充てられる合計日数の目安は約${studyDayBudget}日です。各章の studyDays の合計がこの目安に近くなるように配分してください（多少の前後は可）。
- importance=high の重要単元には多めの studyDays を割り当ててください。
- ページ数が多い単元・難しい単元にも多めに割り当ててください。
- pageStart / pageEnd は目次のページ範囲に従ってください。
- materialTitle は入力の教材名と正確に一致させてください。
- 章の並びは学習順（基礎→応用）に並べてください。

■ 教材の目次・章構成
${materialDetails}`;

  return callGemini({
    prompt,
    responseSchema: ALLOCATION_SCHEMA,
    temperature: 0.4,
    model: DEFAULT_MODEL,
    maxOutputTokens: 32768, // 教材・章が多いと配分配列が長くなるため大きめに
  });
}

// ============================================================
// 問題生成（本文テキストから）
// ============================================================

const QUESTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING', description: 'multiple_choice / true_false / fill_blank' },
    question: { type: 'STRING', description: '問題文' },
    options: { type: 'ARRAY', items: { type: 'STRING' }, description: '選択肢（multiple_choiceは4つ）' },
    correctAnswer: { type: 'STRING', description: '正解' },
    explanation: { type: 'STRING', description: '解説（テキストP.XX参照を含む）' },
    difficulty: { type: 'STRING', description: 'easy / medium / hard' },
  },
  required: ['type', 'question', 'correctAnswer', 'explanation', 'difficulty'],
};

const QUESTIONS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: { type: 'ARRAY', items: QUESTION_SCHEMA, description: '問題リスト' },
  },
  required: ['questions'],
};

/**
 * 抽出済み本文テキストからテスト問題を生成する
 * @param {string} contentText - 該当ページ範囲の本文テキスト
 * @param {Object} options
 * @param {string} [options.topic] - 学習テーマ
 * @param {string} [options.pageRange] - ページ範囲表記（例: P.10-25）
 * @param {number} [options.count=10] - 問題数
 * @returns {Promise<Array>} 問題配列
 */
export async function generateQuestionsFromText(contentText, { topic = '', pageRange = '', count = 10 } = {}) {
  const text = (contentText || '').trim();
  if (text.length < 50) {
    throw new Error('この範囲から十分な本文テキストを抽出できませんでした（スキャン画像PDF、または図表中心の可能性があります）。');
  }

  const prompt = `以下は教材の本文テキスト${pageRange ? `（${pageRange}${topic ? ' / ' + topic : ''}）` : ''}です。
この本文の内容に基づいて、理解度を測るテスト問題を${count}問作成してください。

■ 問題作成ルール
- 必ず本文に書かれている具体的な内容に基づくこと（本文に無い知識を作らない）
- 暗記だけでなく理解を問う問題を中心にすること
- 解説には可能な限り「P.XX参照」のように参照ページを明記すること（本文の【P.XX】表記を参考に）
- type は multiple_choice（選択式）/ true_false（○×）/ fill_blank（穴埋め）のいずれか
- multiple_choice は options に4つの選択肢を入れ、correctAnswer はその中の1つにすること
- true_false は correctAnswer を「○」か「×」にすること
- difficulty は easy / medium / hard のいずれか

■ 本文テキスト
${text}`;

  const result = await callGemini({
    prompt,
    responseSchema: QUESTIONS_RESPONSE_SCHEMA,
    temperature: 0.7,
    model: DEFAULT_MODEL,
    maxOutputTokens: 8192,
  });
  return result.questions || [];
}

// ============================================================
// AI 分析（テスト結果テキストのみ）
// ============================================================

const ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    weaknesses: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          area: { type: 'STRING' },
          detail: { type: 'STRING' },
          severity: { type: 'STRING', description: 'high/medium/low' },
        },
        required: ['area', 'detail', 'severity'],
      },
    },
    strengths: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { area: { type: 'STRING' }, detail: { type: 'STRING' } },
        required: ['area', 'detail'],
      },
    },
    advice: { type: 'STRING', description: '学習アドバイス（200字以内）' },
    estimatedReadiness: { type: 'INTEGER', description: '準備度 0-100' },
  },
  required: ['weaknesses', 'strengths', 'advice', 'estimatedReadiness'],
};

/**
 * 学習状況を分析する（テスト結果・スケジュール進捗のテキストのみ）
 * @param {Array} testDetails - [{ topic, materialTitle, correct }] など集計済みテキスト向けデータ
 * @param {Array} schedule
 * @param {Object} exam
 * @returns {Promise<Object>}
 */
export async function analyzeProgress(testDetails, schedule, exam) {
  const today = new Date().toISOString().split('T')[0];
  const daysRemaining = exam?.examDate
    ? Math.ceil((new Date(exam.examDate) - new Date(today)) / (1000 * 60 * 60 * 24))
    : null;

  const completed = schedule.filter(s => s.status === 'completed');
  const pending = schedule.filter(s => s.status === 'pending');

  // トピック別の正答状況を集計（テキスト化）
  const topicStats = {};
  for (const r of testDetails.slice(-200)) {
    const key = r.topic || r.materialTitle || '不明';
    if (!topicStats[key]) topicStats[key] = { correct: 0, total: 0 };
    topicStats[key].total++;
    if (r.correct) topicStats[key].correct++;
  }
  const statsText = Object.entries(topicStats)
    .map(([k, v]) => `- ${k}: ${v.correct}/${v.total}正答（${Math.round((v.correct / v.total) * 100)}%）`)
    .join('\n') || '（テスト結果なし）';

  const prompt = `試験「${exam?.name || '未設定'}」${daysRemaining != null ? `（${exam.examDate}、残り${daysRemaining}日）` : ''}の学習状況を分析してください。

■ トピック別 正答状況
${statsText}

■ スケジュール進捗
- 完了: ${completed.length}日分
- 未完了: ${pending.length}日分

上記のデータのみから、弱点(weaknesses)・得意分野(strengths)・具体的なアドバイス(advice)・準備度(estimatedReadiness 0-100)を返してください。`;

  return callGemini({
    prompt,
    responseSchema: ANALYSIS_SCHEMA,
    temperature: 0.5,
    model: DEFAULT_MODEL,
  });
}
