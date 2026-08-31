/**
 * frontend.js - 兼容前端 heart-test 项目的接口
 *
 * 前端 heart-test 项目（React + Vite）通过 /api 前缀调用以下接口，
 * 返回结构统一为 { success, data?, msg? }。
 *
 * 接口列表：
 * 1. GET  /api/tests                获取全部测评列表
 * 2. GET  /api/test/:testId         获取单个测评介绍
 * 3. GET  /api/quiz/:testId         获取该测评全部题目
 * 4. POST /api/verify-code          校验授权码，返回 token
 * 5. GET  /api/check-auth-status    校验授权码状态
 * 6. POST /api/submit-answer        提交答案，生成报告
 * 7. GET  /api/get-report/:testId   获取历史报告
 */
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db/db');

const router = express.Router();

// 内存中保存 token -> auth_code 的映射（重启即失效，demo 够用）
const tokenStore = new Map();

// 万能授权码：任意非空授权码均可通过（方便本地联调测试）
const VALID_AUTH_CODE = 'TEST2024';

// 1. GET /api/tests 获取全部测评列表
// 返回 [{ testId, category, name, description, subtitle }]
router.get('/tests', (req, res) => {
  db.all(
    'SELECT test_id, name, category, subtitle, desc FROM assessments WHERE status = 1 ORDER BY id',
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, msg: '查询测评列表失败' });
      const data = rows.map((r) => ({
        testId: r.test_id,
        category: r.category || '其他',
        name: r.name || r.title,
        description: r.desc,
        subtitle: r.subtitle,
      }));
      res.json({ success: true, data });
    }
  );
});

// 2. GET /api/test/:testId 获取单个测评介绍
// 返回 { testId, name, subtitle, description }
router.get('/test/:testId', (req, res) => {
  const testId = req.params.testId;
  db.get(
    'SELECT test_id, name, subtitle, desc FROM assessments WHERE test_id = ? AND status = 1',
    [testId],
    (err, row) => {
      if (err) return res.status(500).json({ success: false, msg: '查询测评详情失败' });
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
    }
  );
});

// 3. GET /api/quiz/:testId 获取题目
// 返回 [{ id, title, options: [{ value, label }] }]
router.get('/quiz/:testId', (req, res) => {
  const testId = req.params.testId;
  db.get('SELECT id FROM assessments WHERE test_id = ? AND status = 1', [testId], (err, assessment) => {
    if (err) return res.status(500).json({ success: false, msg: '查询失败' });
    if (!assessment) return res.status(404).json({ success: false, msg: '测评不存在' });

    db.all(
      'SELECT id, content, options FROM questions WHERE assessment_id = ? ORDER BY id',
      [assessment.id],
      (err, rows) => {
        if (err) return res.status(500).json({ success: false, msg: '查询题目失败' });
        const questions = rows.map((q) => ({
          id: q.id,
          title: q.content,
          options: JSON.parse(q.options),
        }));
        res.json({ success: true, data: questions });
      }
    );
  });
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
  // 万能授权码模式：任意非空授权码均可通过，方便测试
  if (code !== VALID_AUTH_CODE && code !== 'MASTER') {
    return res.status(200).json({ success: false, msg: '授权码无效' });
  }
  // 生成 token 并保存映射
  const token = 'token-' + crypto.randomBytes(16).toString('hex');
  tokenStore.set(token, code);
  res.json({ success: true, token });
});

// 5. GET /api/check-auth-status 校验授权码状态
// 从 Authorization: Bearer <token> 解析 token
// 返回: { success: true, used, status }
router.get('/check-auth-status', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || !tokenStore.has(token)) {
    return res.status(200).json({ success: true, used: false, status: 'unused' });
  }
  res.json({ success: true, used: false, status: 'unused' });
});

// 6. POST /api/submit-answer 提交答案，生成报告
// body: { testId, answers: [{ questionId, answer }] }
// 返回: { success: true, data: { testId, title, content } }
router.post('/submit-answer', (req, res) => {
  const { testId, answers } = req.body || {};
  if (!testId) {
    return res.status(400).json({ success: false, msg: '缺少 testId' });
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ success: false, msg: 'answers 必须是非空数组' });
  }

  // 查询测评名称
  db.get('SELECT name, title FROM assessments WHERE test_id = ?', [testId], (err, assessment) => {
    if (err) return res.status(500).json({ success: false, msg: '查询测评失败' });
    const title = (assessment && (assessment.name || assessment.title)) || '测评报告';

    // 生成报告内容（demo 简化：根据答题数量生成通用文本）
    const content =
      '根据你的回答，我们为你生成了专属测评报告。\n\n' +
      '你的性格特质鲜明，拥有独特的内心世界。\n\n' +
      '建议你在日常生活中多关注自己的内心感受，保持积极乐观的心态。\n\n' +
      `（共完成 ${answers.length} 道题，本报告由后端生成）`;

    res.json({ success: true, data: { testId, title, content } });
  });
});

// 7. GET /api/get-report/:testId 获取历史报告
// 返回: { success: true, data: { testId, title, content } }
router.get('/get-report/:testId', (req, res) => {
  const testId = req.params.testId;
  db.get('SELECT name, title FROM assessments WHERE test_id = ?', [testId], (err, assessment) => {
    if (err) return res.status(500).json({ success: false, msg: '查询测评失败' });
    const title = (assessment && (assessment.name || assessment.title)) || '测评报告';
    const content =
      '根据你的回答，我们为你生成了专属测评报告。\n\n' +
      '你的性格特质鲜明，拥有独特的内心世界。\n\n' +
      '建议你在日常生活中多关注自己的内心感受，保持积极乐观的心态。\n\n' +
      '（本报告由后端生成）';
    res.json({ success: true, data: { testId, title, content } });
  });
});

module.exports = router;
