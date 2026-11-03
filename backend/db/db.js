/**
 * db.js - sqlite3 数据库连接与初始化建表逻辑
 *
 * 说明：
 * - 使用文件型数据库（psych.db），项目内直接运行，无需 MySQL
 * - 服务启动时自动建表（表不存在则创建），并对旧库做增量字段迁移
 * - 导出 db 实例及 Promise 化查询方法，供路由与初始化脚本使用
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// 数据库文件路径（backend/psych.db）
const DB_PATH = path.join(__dirname, '..', 'psych.db');

// 创建数据库连接（文件不存在会自动创建）
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('数据库连接失败:', err.message);
    process.exit(1);
  }
  console.log('数据库连接成功:', DB_PATH);
});

// 将 db.run / db.get / db.all 包装为 Promise，便于按顺序串行初始化
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * 旧库兼容：字段不存在时才 ALTER TABLE 添加，重复执行安全
 */
async function addColumnIfMissing(table, column, definition) {
  const columns = await all(`PRAGMA table_info(${table})`);
  if (columns.some((c) => c.name === column)) return;
  await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`已为 ${table} 添加字段: ${column}`);
}

/**
 * 初始化建表（4 张表）
 * - assessments        测评主表（含 result_type / dimensions）
 * - questions          题目表（options 每项可含 score 或 dims）
 * - user_answers       用户答卷表（result_json 存标准化结果）
 * - assessment_results 结果库表（profile-match 的目标物画像与文案）
 */
async function initTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS assessments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id        TEXT UNIQUE,
      title          TEXT NOT NULL,
      name           TEXT,
      category       TEXT,
      subtitle       TEXT,
      desc           TEXT,
      question_count INTEGER DEFAULT 0,
      status         INTEGER DEFAULT 1,
      result_type    TEXT DEFAULT 'score-band',
      dimensions     TEXT,
      featured       INTEGER DEFAULT 0,
      duration       TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS questions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id INTEGER NOT NULL,
      content       TEXT NOT NULL,
      options       TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_answers (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id  INTEGER NOT NULL,
      auth_code      TEXT NOT NULL UNIQUE,
      status         TEXT DEFAULT 'doing',
      answer_data    TEXT,
      score          INTEGER,
      report_content TEXT,
      result_type    TEXT,
      result_json    TEXT,
      create_time    TEXT,
      update_time    TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS assessment_results (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id INTEGER NOT NULL,
      result_key    TEXT NOT NULL,
      name          TEXT NOT NULL,
      tagline       TEXT,
      profile       TEXT NOT NULL,
      copy          TEXT,
      sort          INTEGER DEFAULT 0
    )
  `);

  await run(
    'CREATE INDEX IF NOT EXISTS idx_questions_assessment ON questions(assessment_id)'
  );
  await run(
    'CREATE INDEX IF NOT EXISTS idx_results_assessment ON assessment_results(assessment_id)'
  );
  await run(
    'CREATE INDEX IF NOT EXISTS idx_user_answers_assessment ON user_answers(assessment_id)'
  );

  // 旧库增量迁移（新库建表时已含这些列，直接跳过）
  await addColumnIfMissing('assessments', 'result_type', "TEXT DEFAULT 'score-band'");
  await addColumnIfMissing('assessments', 'dimensions', 'TEXT');
  await addColumnIfMissing('assessments', 'featured', 'INTEGER DEFAULT 0');
  await addColumnIfMissing('assessments', 'duration', 'TEXT');
  await addColumnIfMissing('user_answers', 'result_type', 'TEXT');
  await addColumnIfMissing('user_answers', 'result_json', 'TEXT');

  console.log('数据库表初始化完成');
}

module.exports = { db, initTables, run, get, all };
