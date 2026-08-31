/**
 * assessment.js - 测评相关接口
 *
 * 接口列表：
 * 1. GET  /api/assessments             获取全部测评列表
 * 2. GET  /api/assessments/:id         获取单个测评详情
 * 3. GET  /api/assessments/:id/questions 获取该测评全部题目
 * 4. POST /api/assessments/:id/start   开始测评：生成授权码，新建答卷 doing
 */
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db/db');

const router = express.Router();

/**
 * 生成 16 位随机授权码（后端专属，禁止前端生成）
 * 使用 crypto 随机字节，去除易混淆字符（0/O、1/l/I），保证可读性
 */
function generateAuthCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let code = '';
  for (let i = 0; i < 16; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * 生成唯一授权码：插入时若撞唯一索引则重试
 * 最多重试 5 次，仍失败则抛错
 */
function createUniqueAuthCode(assessmentId) {
  return new Promise((resolve, reject) => {
    const tryInsert = (attempt) => {
      const authCode = generateAuthCode();
      const now = new Date().toISOString();

      db.run(
        'INSERT INTO user_answers (assessment_id, auth_code, status, create_time, update_time) VALUES (?, ?, ?, ?, ?)',
        [assessmentId, authCode, 'doing', now, now],
        function (err) {
          if (!err) return resolve(authCode); // 插入成功

          // 唯一索引冲突（auth_code 重复），重试
          if (err.code === 'SQLITE_CONSTRAINT' && attempt < 5) {
            return tryInsert(attempt + 1);
          }
          reject(err);
        }
      );
    };
    tryInsert(0);
  });
}

// 1. 获取全部测评列表
router.get('/', (req, res) => {
  db.all(
    'SELECT id, title, desc, question_count, status FROM assessments WHERE status = 1',
    (err, rows) => {
      if (err) return res.status(500).json({ code: 500, msg: '查询测评列表失败', error: err.message });
      res.json({ code: 0, data: rows });
    }
  );
});

// 2. 获取单个测评详情
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ code: 400, msg: '无效的测评 id' });

  db.get(
    'SELECT id, title, desc, question_count, status FROM assessments WHERE id = ? AND status = 1',
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ code: 500, msg: '查询测评详情失败', error: err.message });
      if (!row) return res.status(404).json({ code: 404, msg: '测评不存在' });
      res.json({ code: 0, data: row });
    }
  );
});

// 3. 获取该测评全部题目
router.get('/:id/questions', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ code: 400, msg: '无效的测评 id' });

  // 先确认测评存在
  db.get('SELECT id FROM assessments WHERE id = ? AND status = 1', [id], (err, assessment) => {
    if (err) return res.status(500).json({ code: 500, msg: '查询失败', error: err.message });
    if (!assessment) return res.status(404).json({ code: 404, msg: '测评不存在' });

    // 查询题目，并把 options 从 JSON 字符串解析为数组
    db.all('SELECT id, content, options FROM questions WHERE assessment_id = ? ORDER BY id', [id], (err, rows) => {
      if (err) return res.status(500).json({ code: 500, msg: '查询题目失败', error: err.message });
      const questions = rows.map((q) => ({
        id: q.id,
        content: q.content,
        options: JSON.parse(q.options)
      }));
      res.json({ code: 0, data: questions });
    });
  });
});

// 4. 开始测评：生成授权码，新建答卷记录 status=doing
router.post('/:id/start', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ code: 400, msg: '无效的测评 id' });

  // 确认测评存在
  db.get('SELECT id FROM assessments WHERE id = ? AND status = 1', [id], (err, assessment) => {
    if (err) return res.status(500).json({ code: 500, msg: '查询失败', error: err.message });
    if (!assessment) return res.status(404).json({ code: 404, msg: '测评不存在' });

    // 生成唯一授权码并创建答卷记录
    createUniqueAuthCode(id)
      .then((authCode) => {
        res.json({ code: 0, data: { auth_code: authCode, status: 'doing' } });
      })
      .catch((e) => {
        res.status(500).json({ code: 500, msg: '创建答卷失败', error: e.message });
      });
  });
});

module.exports = router;
