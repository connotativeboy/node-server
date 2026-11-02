/**
 * engine/scoring.js - 统一结果引擎
 *
 * 支持两种 result_type：
 * - score-band    ：选项累加 score -> 总分区间文本（保留旧量表能力）
 * - profile-match ：选项累加 dims -> 用户维度向量 -> 与结果库画像做余弦相似度 -> 匹配度%
 *
 * 输入约定：
 * - assessment ：assessments 表行（含 id / result_type / dimensions）
 * - answers    ：[{ questionId, answer }]（前端格式）
 *                或 [{ question_id, option_index }]（answer.js 格式）
 * - questions  ：题目行数组 [{ id, options }]，或 { [id]: options[] }
 */
const { db } = require('../db/db');

// score-band 默认区间（5 题 × 1~4 分，总分 5~20）。如需自定义，可在 assessment.bands 传入。
const DEFAULT_SCORE_BANDS = [
  {
    max: 8,
    text: '您的心理状态整体良好，情绪平稳，睡眠与精力状况正常。请继续保持健康的生活作息与积极心态。',
  },
  {
    max: 13,
    text: '您近期存在轻度心理压力，偶尔会出现情绪低落或精力不足。建议适当放松、规律作息，多与亲友交流。',
  },
  {
    max: 17,
    text: '您近期存在中度心理困扰，情绪波动与睡眠问题较为明显。建议重视自身状态，尝试减压，必要时咨询专业人士。',
  },
  {
    max: Infinity,
    text: '您近期心理困扰程度较高，情绪、睡眠及精力状况需引起重视。强烈建议尽快寻求专业心理咨询或医疗帮助。',
  },
];

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

/** 把题目数组/映射统一成 { [questionId]: options[] } */
function normalizeQuestions(questions) {
  const map = {};
  if (Array.isArray(questions)) {
    questions.forEach((q) => {
      if (q && q.id !== undefined) map[String(q.id)] = parseJson(q.options, []);
    });
    return map;
  }
  if (questions && typeof questions === 'object') {
    Object.keys(questions).forEach((key) => {
      map[String(key)] = parseJson(questions[key], []);
    });
  }
  return map;
}

/** 取出某道题用户选中的选项对象 */
function pickOption(options, answerItem) {
  if (!Array.isArray(options) || options.length === 0 || !answerItem) return null;

  // 前端格式：answer 为选项 value（如 'A'）
  if (answerItem.answer !== undefined && answerItem.answer !== null) {
    const byValue = options.find((o) => String(o.value) === String(answerItem.answer));
    if (byValue) return byValue;
    const idx = Number(answerItem.answer);
    if (Number.isInteger(idx) && options[idx]) return options[idx];
  }

  // answer.js 格式：option_index 为选项下标
  const rawIndex =
    answerItem.option_index !== undefined ? answerItem.option_index : answerItem.optionIndex;
  if (rawIndex !== undefined && rawIndex !== null) {
    const idx = Number(rawIndex);
    if (Number.isInteger(idx) && options[idx]) return options[idx];
  }

  return null;
}

/** 累加用户维度向量（原始分值） */
function buildUserVector(dimensions, answers, questionsMap) {
  const u = {};
  dimensions.forEach((d) => {
    u[d] = 0;
  });

  (answers || []).forEach((item) => {
    const qid = item.questionId !== undefined ? item.questionId : item.question_id;
    const options = questionsMap[String(qid)] || [];
    const opt = pickOption(options, item);
    if (!opt || !opt.dims) return;
    dimensions.forEach((d) => {
      u[d] += Number(opt.dims[d]) || 0;
    });
  });

  return u;
}

/** 每个维度的理论最大值（每题该维度最高分之和），用于归一化 */
function buildTheoreticalMax(dimensions, questionsMap) {
  const max = {};
  dimensions.forEach((d) => {
    max[d] = 0;
  });

  Object.keys(questionsMap).forEach((qid) => {
    const options = questionsMap[qid] || [];
    dimensions.forEach((d) => {
      const best = options.reduce(
        (m, o) => Math.max(m, (o && o.dims && Number(o.dims[d])) || 0),
        0
      );
      max[d] += best;
    });
  });

  return max;
}

/** 归一化到 0-100，保证与结果库画像同量纲 */
function normalizeVector(vector, max) {
  const out = {};
  Object.keys(vector).forEach((d) => {
    const m = max[d] || 0;
    out[d] = m > 0 ? Math.round((vector[d] / m) * 100) : 0;
  });
  return out;
}

/** 余弦相似度（对向量长度不敏感，0~1） */
function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;

  Object.keys(a).forEach((k) => {
    const av = Number(a[k]) || 0;
    const bv = Number(b[k]) || 0;
    dot += av * bv;
    na += av * av;
  });

  Object.keys(b).forEach((k) => {
    const bv = Number(b[k]) || 0;
    nb += bv * bv;
  });

  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function pickScoreBandText(score, bands) {
  const list = Array.isArray(bands) && bands.length ? bands : DEFAULT_SCORE_BANDS;
  const hit = list.find((b) => score <= Number(b.max));
  return (hit || list[list.length - 1]).text;
}

/** score-band：累加选项 score -> 区间文本 */
function scoreBand(assessment, answers, questionsMap) {
  let score = 0;

  (answers || []).forEach((item) => {
    const qid = item.questionId !== undefined ? item.questionId : item.question_id;
    const options = questionsMap[String(qid)] || [];
    const opt = pickOption(options, item);
    if (opt) score += Number(opt.score) || 0;
  });

  const bands = parseJson(assessment.bands, null);

  return {
    result_type: 'score-band',
    score,
    report_content: pickScoreBandText(score, bands),
  };
}

/** profile-match：用户维度向量 -> 结果库余弦相似度 -> 匹配度% + ranking */
async function profileMatch(assessment, answers, questionsMap) {
  const dimensions = parseJson(assessment.dimensions, []);
  const userVector = buildUserVector(dimensions, answers, questionsMap);
  const maxVector = buildTheoreticalMax(dimensions, questionsMap);
  const userProfile = normalizeVector(userVector, maxVector);

  const rows = await all(
    'SELECT * FROM assessment_results WHERE assessment_id = ? ORDER BY sort ASC, id ASC',
    [assessment.id]
  );

  const ranking = rows
    .map((r) => {
      const profile = parseJson(r.profile, {});
      return {
        result_key: r.result_key,
        name: r.name,
        tagline: r.tagline,
        match_percent: Math.round(cosine(userProfile, profile) * 100),
        profile,
        copy: r.copy,
      };
    })
    .sort((a, b) => b.match_percent - a.match_percent || a.name.localeCompare(b.name, 'zh'));

  return {
    result_type: 'profile-match',
    dimensions,
    user_profile: userProfile,
    top: ranking[0] || null,
    ranking,
  };
}

/** 统一入口：按 result_type 分发 */
async function computeResult(assessment, answers, questions) {
  if (!assessment) throw new Error('测评不存在');
  const questionsMap = normalizeQuestions(questions);

  if (assessment.result_type === 'score-band') {
    return scoreBand(assessment, answers, questionsMap);
  }
  return profileMatch(assessment, answers, questionsMap);
}

module.exports = {
  computeResult,
  scoreBand,
  profileMatch,
  buildUserVector,
  buildTheoreticalMax,
  normalizeVector,
  normalizeQuestions,
  pickOption,
  parseJson,
  cosine,
  DEFAULT_SCORE_BANDS,
};
