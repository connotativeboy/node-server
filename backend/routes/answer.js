/**
 * answer.js - 答卷、授权码接口
 *
 * 接口列表：
 * 1. POST /api/answers/submit  提交答卷：校验 auth_code，计算总分，生成报告，状态改 finished
 * 2. GET  /api/answers         查询答卷：参数 auth_code，区分 doing / finished，不存在返回 404
 */
const express = require('express');
const { db } = require('../db/db');

const router = express.Router();

/**
 * 根据总分区间生成测评报告文本
 * 本测试量表共 5 题，每题 1~4 分，总分范围 5~20
 * 区间划分：
 *   - 5~8    ：状态良好
 *   - 9~13   ：轻度压力
 *   - 14~17  ：中度困扰
 *   - 18~20  ：重度困扰（建议寻求专业帮助）
 */
function generateReport(score) {
  if (score <= 8) {
    return '您的心理状态整体良好，情绪平稳，睡眠与精力状况正常。请继续保持健康的生活作息与积极心态。';
  }
  if (score <= 13) {
    return '您近期存在轻度心理压力，偶尔会出现情绪低落或精力不足。建议适当放松、规律作息，多与亲友交流。';
  }
  if (score <= 17) {
    return '您近期存在中度心理困扰，情绪波动与睡眠问题较为明显。建议重视自身状态，尝试减压，必要时咨询专业人士。';
  }
  return '您近期心理困扰程度较高，情绪、睡眠及精力状况需引起重视。强烈建议尽快寻求专业心理咨询或医疗帮助。';
}

/**
 * 计算总分：遍历用户答案，累加对应选项的 score
 * answer_data 格式：[{ question_id: 1, option_index: 0 }, ...]
 * 需要从 questions 表读取该测评的题目选项分值进行匹配
 */
function calcScore(assessmentId, answerData) {
  return new Promise((resolve, reject) => {
    // 读取该测评全部题目及其选项分值
    db.all('SELECT id, options FROM questions WHERE assessment_id = ?', [assessmentId], (err, rows) => {
      if (err) return reject(err);

      // 建立 question_id -> options 的映射
      const questionMap = {};
      rows.forEach((q) => {
        questionMap[q.id] = JSON.parse(q.options);
      });

      let total = 0;
      answerData.forEach((item) => {
        const options = questionMap[item.question_id];
        if (options && options[item.option_index] !== undefined) {
          total += options[item.option_index].score;
        }
      });
      resolve(total);
    });
  });
}

// 1. 提交答卷
router.post('/submit', (req, res) => {
  const { auth_code, answer_data } = req.body;

  // 参数校验
  if (!auth_code) return res.status(400).json({ code: 400, msg: '缺少 auth_code' });
  if (!Array.isArray(answer_data) || answer_data.length === 0) {
    return res.status(400).json({ code: 400, msg: 'answer_data 必须是非空数组' });
  }

  // 校验 auth_code 是否存在，防止非法提交
  db.get('SELECT * FROM user_answers WHERE auth_code = ?', [auth_code], (err, row) => {
    if (err) return res.status(500).json({ code: 500, msg: '查询答卷失败', error: err.message });
    if (!row) return res.status(404).json({ code: 404, msg: '授权码不存在，无法提交' });

    // 已完成的答卷不允许重复提交
    if (row.status === 'finished') {
      return res.status(400).json({ code: 400, msg: '该答卷已完成，不能重复提交' });
    }

    // 计算总分
    calcScore(row.assessment_id, answer_data)
      .then((score) => {
        // 根据总分生成报告文本
        const reportContent = generateReport(score);
        const now = new Date().toISOString();

        // 更新答卷：状态改 finished，保存 score、report_content、answer_data、update_time
        db.run(
          `UPDATE user_answers
           SET status = 'finished', answer_data = ?, score = ?, report_content = ?, update_time = ?
           WHERE auth_code = ?`,
          [JSON.stringify(answer_data), score, reportContent, now, auth_code],
          function (err) {
            if (err) return res.status(500).json({ code: 500, msg: '保存答卷失败', error: err.message });

            // 返回报告数据
            res.json({
              code: 0,
              data: {
                auth_code,
                status: 'finished',
                score,
                report_content: reportContent
              }
            });
          }
        );
      })
      .catch((e) => {
        res.status(500).json({ code: 500, msg: '计算得分失败', error: e.message });
      });
  });
});

// 2. 查询答卷（凭授权码）
router.get('/', (req, res) => {
  const authCode = req.query.auth_code;

  if (!authCode) return res.status(400).json({ code: 400, msg: '缺少 auth_code 参数' });

  db.get('SELECT * FROM user_answers WHERE auth_code = ?', [authCode], (err, row) => {
    if (err) return res.status(500).json({ code: 500, msg: '查询答卷失败', error: err.message });
    if (!row) return res.status(404).json({ code: 404, msg: '授权码不存在' });

    // 解析 answer_data JSON
    const answerData = row.answer_data ? JSON.parse(row.answer_data) : [];

    // 区分 doing / finished 返回不同数据
    if (row.status === 'finished') {
      // 已完成：直接返回报告结果
      res.json({
        code: 0,
        data: {
          auth_code: row.auth_code,
          status: 'finished',
          assessment_id: row.assessment_id,
          score: row.score,
          report_content: row.report_content,
          create_time: row.create_time,
          update_time: row.update_time
        }
      });
    } else {
      // 答题中：返回继续答题数据（题目 + 已答内容）
      db.all('SELECT id, content, options FROM questions WHERE assessment_id = ? ORDER BY id', [row.assessment_id], (err, questions) => {
        if (err) return res.status(500).json({ code: 500, msg: '查询题目失败', error: err.message });

        res.json({
          code: 0,
          data: {
            auth_code: row.auth_code,
            status: 'doing',
            assessment_id: row.assessment_id,
            answer_data: answerData,
            questions: questions.map((q) => ({
              id: q.id,
              content: q.content,
              options: JSON.parse(q.options)
            })),
            create_time: row.create_time,
            update_time: row.update_time
          }
        });
      });
    }
  });
});

module.exports = router;
