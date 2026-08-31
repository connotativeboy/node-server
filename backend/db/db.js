/**
 * db.js - sqlite3 数据库连接与初始化建表逻辑
 *
 * 说明：
 * - 使用文件型数据库（psych.db），项目内直接运行，无需 MySQL
 * - 服务启动时自动建表（表不存在则创建）
 * - 导出 db 实例供各路由使用
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

/**
 * 初始化建表：三张表，若不存在则自动创建
 * - assessments   测评主表
 * - questions     题目表
 * - user_answers  用户答卷表（核心，auth_code 唯一索引）
 */
function initTables() {
  db.serialize(() => {
    // 1. 测评主表
    // 为兼容前端 heart-test 项目，新增 test_id(字符串标识)、name、category、subtitle 字段
    db.run(`
      CREATE TABLE IF NOT EXISTS assessments (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        test_id        TEXT UNIQUE,            -- 前端字符串标识，如 deep-desire
        title          TEXT NOT NULL,          -- 测评标题（兼容旧字段）
        name           TEXT,                   -- 前端展示名称
        category       TEXT,                   -- 分类：性格/文学/心理
        subtitle       TEXT,                   -- 副标题
        desc           TEXT,                   -- 测评介绍
        question_count INTEGER DEFAULT 0,      -- 题目数量
        status         INTEGER DEFAULT 1       -- 状态：1=启用 0=停用
      )
    `);

    // 2. 题目表
    db.run(`
      CREATE TABLE IF NOT EXISTS questions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        assessment_id INTEGER NOT NULL,        -- 关联测评 id
        content       TEXT NOT NULL,           -- 题目内容
        options       TEXT NOT NULL            -- 选项 JSON 数组，每项含 value、label
      )
    `);

    // 3. 用户答卷表（核心）
    db.run(`
      CREATE TABLE IF NOT EXISTS user_answers (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        assessment_id  INTEGER NOT NULL,       -- 关联测评 id
        auth_code      TEXT NOT NULL UNIQUE,   -- 授权码（唯一索引，禁止前端生成）
        status         TEXT DEFAULT 'doing',   -- 状态：doing=答题中 finished=已完成
        answer_data    TEXT,                   -- 用户答题记录 JSON
        score          INTEGER,                -- 总分
        report_content TEXT,                   -- 测评报告文本
        create_time    TEXT,                   -- 创建时间
        update_time    TEXT                    -- 更新时间
      )
    `);

    console.log('数据库表初始化完成');
  });
}

module.exports = { db, initTables };
