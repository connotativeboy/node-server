/**
 * answer.js - 答卷、授权码接口（原生 auth_code 体系）
 *
 * 接口列表：
 * 1. POST /api/answers/submit  提交答卷：校验 auth_code -> 统一结果引擎 -> 落库 -> 状态改 finished
 * 2. GET  /api/answers         查询答卷：参数 auth_code，区分 doing / finished，不存在返回 404
 */
const express = require('express');
const { run, get, all } = require('../db/db');
const { computeResult, parseJson } = require('../engine/scoring');

const router = express.Router();

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

// 1. 提交答卷
router.post('/submit', async (req, res) => {
  const { auth_code, answer_data } = req.body || {};

  // 参数校验
  if (!auth_code) return res.status(400).json({ code: 400, msg: '缺少 auth_code' });
  if (!Array.isArray(answer_data) || answer_data.length === 0) {
    return res.status(400).json({ code: 400, msg: 'answer_data 必须是非空数组' });
  }

  try {
    // 校验 auth_code 是否存在，防止非法提交
    const row = await get('SELECT * FROM user_answers WHERE auth_code = ?', [auth_code]);
    if (!row) return res.status(404).json({ code: 404, msg: '授权码不存在，无法提交' });

    // 已完成的答卷不允许重复提交
    if (row.status === 'finished') {
      return res.status(400).json({ code: 400, msg: '该答卷已完成，不能重复提交' });
    }

    const assessment = await get('SELECT * FROM assessments WHERE id = ?', [row.assessment_id]);
    if (!assessment) return res.status(404).json({ code: 404, msg: '测评不存在' });

    const questions = await all(
      'SELECT id, content, options FROM questions WHERE assessment_id = ? ORDER BY id',
      [assessment.id]
    );

    // 统一结果引擎：score-band / profile-match
    const result = await computeResult(assessment, answer_data, questions);
    const content = buildReportContent(result);
    const score =
      result.score !== undefined
        ? result.score
        : result.top
          ? result.top.match_percent
          : null;

    const now = new Date().toISOString();

    await run(
      `UPDATE user_answers
          SET status = 'finished', answer_data = ?, score = ?, report_content = ?,
              result_type = ?, result_json = ?, update_time = ?
        WHERE auth_code = ?`,
      [
        JSON.stringify(answer_data),
        score,
        content,
        result.result_type,
        JSON.stringify(result),
        now,
        auth_code,
      ]
    );

    res.json({
      code: 0,
      data: {
        auth_code,
        status: 'finished',
        score,
        report_content: content,
        result,
      },
    });
  } catch (e) {
    console.error('提交答卷失败:', e);
    res.status(500).json({ code: 500, msg: '生成测评结果失败', error: e.message });
  }
});

// 2. 查询答卷（凭授权码）
router.get('/', async (req, res) => {
  const authCode = req.query.auth_code;

  if (!authCode) return res.status(400).json({ code: 400, msg: '缺少 auth_code 参数' });

  try {
    const row = await get('SELECT * FROM user_answers WHERE auth_code = ?', [authCode]);
    if (!row) return res.status(404).json({ code: 404, msg: '授权码不存在' });

    const answerData = parseJson(row.answer_data, []);

    if (row.status === 'finished') {
      return res.json({
        code: 0,
        data: {
          auth_code: row.auth_code,
          status: 'finished',
          assessment_id: row.assessment_id,
          score: row.score,
          report_content: row.report_content,
          result_type: row.result_type,
          result: parseJson(row.result_json, null),
          create_time: row.create_time,
          update_time: row.update_time,
        },
      });
    }

    // 答题中：返回继续答题数据（题目 + 已答内容）
    const questions = await all(
      'SELECT id, content, options FROM questions WHERE assessment_id = ? ORDER BY id',
      [row.assessment_id]
    );

    return res.json({
      code: 0,
      data: {
        auth_code: row.auth_code,
        status: 'doing',
        assessment_id: row.assessment_id,
        answer_data: answerData,
        questions: questions.map((q) => ({
          id: q.id,
          content: q.content,
          options: parseJson(q.options, []),
        })),
        create_time: row.create_time,
        update_time: row.update_time,
      },
    });
  } catch (e) {
    console.error('查询答卷失败:', e);
    res.status(500).json({ code: 500, msg: '查询答卷失败', error: e.message });
  }
});

module.exports = router;
