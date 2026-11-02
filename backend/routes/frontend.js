/**
 * frontend.js - 兼容前端 heart-test 项目的接口
 *
 * 前端 heart-test 项目（React + Vite）通过 /api 前缀调用以下接口，
 * 返回结构统一为 { success, data?, msg? }。
 *
 * 接口列表：
 * 1. GET  /api/tests                获取全部测评列表
 * 2. GET  /api/test/:testId         获取单个测评介绍
 * 3. GET  /api/quiz/:testId         获取该测评全部题目（options 含 dims/score）
 * 4. POST /api/verify-code          校验授权码，返回 token
 * 5. GET  /api/check-auth-status    校验授权码状态
 * 6. POST /api/submit-answer        提交答案 -> 结果引擎 -> 落库 -> 返回匹配结果
 * 7. GET  /api/get-report/:testId   回读该 token 最近一次测评结果
 */
const express = require('express');
const crypto = require('crypto');
const { run, get, all } = require('../db/db');
const { computeResult, parseJson } = require('../engine/scoring');

const router = express.Router();

// 内存中保存 token -> auth_code 的映射（重启即失效，demo 够用）
const tokenStore = new Map();

// 万能授权码：仅这两个可通过（方便本地联调测试）
const VALID_AUTH_CODE = 'TEST2024';

/**
 * 从 Authorization: Bearer <token> 中取出 token
 */
function getBearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * 由 token + testId 派生稳定的答卷标识。
 * 同一 token 重复提交同一测评 -> 覆盖写入；不同测评 -> 各自独立记录。
 */
function buildAuthCode(token, testId) {
  return `TK_${token}_${testId}`;
}

/**
 * 取测评主记录（含 result_type / dimensions）
 */
function getAssessment(testId) {
  return get('SELECT * FROM assessments WHERE test_id = ? AND status = 1', [testId]);
}

function getQuestions(assessmentId) {
  return all(
    'SELECT id, content, options FROM questions WHERE assessment_id = ? ORDER BY id',
    [assessmentId]
  );
}

/**
 * 统一报告文本：profile-match 用 top 生成可读摘要，score-band 用区间文本
 */
function buildReportContent(result) {
  if (!result) return '';
  if (result.report_content) return result.report_content;
  if (result.top) {
    return `${result.top.name}｜匹配度 ${result.top.match_percent}%\n\n${result.top.copy || ''}`.trim();
  }
  return '';
}

// 1. GET /api/tests 获取全部测评列表
// 返回 [{ testId, category, name, description, subtitle }]
router.get('/tests', (req, res) => {
  all(
    'SELECT test_id, name, category, subtitle, desc FROM assessments WHERE status = 1 ORDER BY id',
    []
  )
    .then((rows) => {
      const data = rows.map((r) => ({
        testId: r.test_id,
        category: r.category || '其他',
        name: r.name,
        description: r.desc,
        subtitle: r.subtitle,
      }));
      res.json({ success: true, data });
    })
    .catch(() => res.status(500).json({ success: false, msg: '查询测评列表失败' }));
});

// 2. GET /api/test/:testId 获取单个测评介绍
// 返回 { testId, name, subtitle, description }
router.get('/test/:testId', (req, res) => {
  getAssessment(req.params.testId)
    .then((row) => {
      if (!row) return res.status(404).json({ success: false, msg: '未找到该测评' });
      res.json({
        success: true,
        data: {
          testId: row.test_id,
          name: row.name || row.title,
          subtitle: row.subtitle,
          description: row.desc,
        },
      });
    })
    .catch(() => res.status(500).json({ success: false, msg: '查询测评详情失败' }));
});

// 3. GET /api/quiz/:testId 获取题目
// 返回 [{ id, title, options: [{ value, label, dims? , score? }] }]
router.get('/quiz/:testId', (req, res) => {
  getAssessment(req.params.testId)
    .then((assessment) => {
      if (!assessment) return res.status(404).json({ success: false, msg: '测评不存在' });

      return getQuestions(assessment.id).then((rows) => {
        const questions = rows.map((q) => ({
          id: q.id,
          title: q.content,
          options: parseJson(q.options, []),
        }));
        res.json({ success: true, data: questions });
      });
    })
    .catch(() => res.status(500).json({ success: false, msg: '查询题目失败' }));
});

// 4. POST /api/verify-code 校验授权码，返回 token
// body: { authCode }
// 返回: { success: true, token }
router.post('/verify-code', (req, res) => {
  const { authCode } = req.body || {};
  const code = (authCode || '').trim();
  if (!code) {
    return res.status(400).json({ success: false, msg: '请输入授权码' });
  }
  // 万能授权码模式：仅 TEST2024 / MASTER 可通过，方便测试
  if (code !== VALID_AUTH_CODE && code !== 'MASTER') {
    return res.status(200).json({ success: false, msg: '授权码无效' });
  }
  // 生成 token 并保存映射
  const token = 'token-' + crypto.randomBytes(16).toString('hex');
  tokenStore.set(token, code);
  res.json({ success: true, token });
});

// 5. GET /api/check-auth-status 校验授权码状态
// 答题页强限制入口使用；当前 demo 不限制重复测评，便于反复联调
router.get('/check-auth-status', (req, res) => {
  const token = getBearerToken(req);
  if (!token || !tokenStore.has(token)) {
    return res.status(200).json({ success: true, used: false, status: 'unused' });
  }
  res.json({ success: true, used: false, status: 'unused' });
});

// 6. POST /api/submit-answer 提交答案
// body: { testId, answers: [{ questionId, answer }] }
// 返回: { success: true, data: { testId, title, content, match } }
router.post('/submit-answer', async (req, res) => {
  const { testId, answers } = req.body || {};

  if (!testId) {
    return res.status(400).json({ success: false, msg: '缺少 testId' });
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ success: false, msg: 'answers 必须是非空数组' });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res
      .status(401)
      .json({ success: false, msg: '登录状态已失效，请重新输入授权码' });
  }

  try {
    const assessment = await getAssessment(testId);
    if (!assessment) {
      return res.status(404).json({ success: false, msg: '测评不存在' });
    }

    const questions = await getQuestions(assessment.id);
    const result = await computeResult(assessment, answers, questions);
    const content = buildReportContent(result);

    const score =
      result.score !== undefined
        ? result.score
        : result.top
          ? result.top.match_percent
          : null;

    const now = new Date().toISOString();
    const authCode = buildAuthCode(token, testId);
    const answerJson = JSON.stringify(answers);
    const resultJson = JSON.stringify(result);

    // 同一 token + 同一测评：覆盖写入；不同测评各自独立
    const existing = await get('SELECT id FROM user_answers WHERE auth_code = ?', [authCode]);
    if (existing) {
      await run(
        `UPDATE user_answers
            SET assessment_id = ?, status = 'finished', answer_data = ?, score = ?,
                report_content = ?, result_type = ?, result_json = ?, update_time = ?
          WHERE auth_code = ?`,
        [
          assessment.id,
          answerJson,
          score,
          content,
          result.result_type,
          resultJson,
          now,
          authCode,
        ]
      );
    } else {
      await run(
        `INSERT INTO user_answers
           (assessment_id, auth_code, status, answer_data, score,
            report_content, result_type, result_json, create_time, update_time)
         VALUES (?, ?, 'finished', ?, ?, ?, ?, ?, ?, ?)`,
        [
          assessment.id,
          authCode,
          answerJson,
          score,
          content,
          result.result_type,
          resultJson,
          now,
          now,
        ]
      );
    }

    res.json({
      success: true,
      data: {
        testId,
        title: assessment.name || assessment.title,
        content,
        match: result,
      },
    });
  } catch (e) {
    console.error('提交答案失败:', e);
    res.status(500).json({ success: false, msg: '生成测评结果失败', error: e.message });
  }
});

// 7. GET /api/get-report/:testId 获取该 token 最近一次测评结果
// 返回: { success: true, data: { testId, title, content, match } }
router.get('/get-report/:testId', async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res
      .status(401)
      .json({ success: false, msg: '登录状态已失效，请重新输入授权码' });
  }

  try {
    const assessment = await getAssessment(req.params.testId);
    if (!assessment) {
      return res.status(404).json({ success: false, msg: '未找到该测评' });
    }

    const authCode = buildAuthCode(token, assessment.test_id);
    const row = await get(
      `SELECT * FROM user_answers
        WHERE auth_code = ? AND status = 'finished'
        ORDER BY update_time DESC LIMIT 1`,
      [authCode]
    );

    if (!row) {
      return res.status(404).json({ success: false, msg: '暂无测评报告，请先完成答题' });
    }

    const result = parseJson(row.result_json, null);
    const content = row.report_content || buildReportContent(result);

    res.json({
      success: true,
      data: {
        testId: assessment.test_id,
        title: assessment.name || assessment.title,
        content,
        match: result,
      },
    });
  } catch (e) {
    console.error('读取报告失败:', e);
    res.status(500).json({ success: false, msg: '读取报告失败', error: e.message });
  }
});

module.exports = router;
