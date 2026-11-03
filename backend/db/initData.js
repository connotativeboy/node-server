/**
 * initData.js - 从配置目录初始化测评数据
 *
 * 纯配置驱动：
 * - 只读取 backend/config/tests/*.json，每个文件 = 一个测评
 * - 文件内包含测评信息、独立题库（选项可带 score 或 dims）、结果库（profile-match）
 * - 启动时同步配置：新测试自动插入；已有测试只更新元信息，不动题库/结果/答卷
 */
const fs = require('fs');
const path = require('path');
const { run, get, all } = require('./db');

const CONFIG_DIR = path.join(__dirname, '..', 'config', 'tests');

/**
 * 读取并解析 config/tests 下的全部 JSON 配置
 */
function readConfigs() {
  if (!fs.existsSync(CONFIG_DIR)) {
    console.warn('未找到配置目录:', CONFIG_DIR);
    return [];
  }

  const files = fs
    .readdirSync(CONFIG_DIR)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort();

  return files.map((file) => {
    const fullPath = path.join(CONFIG_DIR, file);
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (e) {
      throw new Error(`配置文件解析失败: ${file} -> ${e.message}`);
    }
    validateConfig(cfg, file);
    cfg.__file = file;
    return cfg;
  });
}

/**
 * 配置校验：尽量在启动阶段暴露问题，避免半套数据入库
 */
function validateConfig(cfg, file) {
  if (!cfg || typeof cfg !== 'object') {
    throw new Error(`配置内容为空或格式错误: ${file}`);
  }
  if (!cfg.test_id) {
    throw new Error(`配置缺少 test_id: ${file}`);
  }
  if (!Array.isArray(cfg.questions) || cfg.questions.length === 0) {
    throw new Error(`配置缺少 questions 或题目为空: ${file}`);
  }

  cfg.result_type = cfg.result_type || 'score-band';
  if (!['score-band', 'profile-match'].includes(cfg.result_type)) {
    throw new Error(`result_type 不合法（应为 score-band / profile-match）: ${file}`);
  }

  cfg.status = cfg.status || 'live';
  if (!['live', 'soon'].includes(cfg.status)) {
    throw new Error(`status 不合法（应为 live / soon）: ${file}`);
  }
  cfg.featured = Boolean(cfg.featured);
  cfg.duration = cfg.duration || '';

  cfg.questions.forEach((q, qi) => {
    if (!q || !q.content) {
      throw new Error(`第 ${qi + 1} 题缺少 content: ${file}`);
    }
    if (!Array.isArray(q.options) || q.options.length === 0) {
      throw new Error(`第 ${qi + 1} 题缺少 options: ${file}`);
    }
    q.options.forEach((opt, oi) => {
      if (!opt || opt.value === undefined || !opt.label) {
        throw new Error(`第 ${qi + 1} 题第 ${oi + 1} 个选项缺少 value/label: ${file}`);
      }
      if (cfg.result_type === 'profile-match' && (!opt.dims || typeof opt.dims !== 'object')) {
        throw new Error(`profile-match 第 ${qi + 1} 题第 ${oi + 1} 个选项缺少 dims: ${file}`);
      }
    });
  });

  if (cfg.result_type === 'profile-match') {
    if (!Array.isArray(cfg.dimensions) || cfg.dimensions.length === 0) {
      throw new Error(`profile-match 缺少 dimensions: ${file}`);
    }
    if (!Array.isArray(cfg.results) || cfg.results.length === 0) {
      throw new Error(`profile-match 缺少 results 结果库: ${file}`);
    }

    const dimSet = new Set(cfg.dimensions);
    cfg.results.forEach((r, ri) => {
      if (!r || !r.name || !r.profile || typeof r.profile !== 'object') {
        throw new Error(`第 ${ri + 1} 个结果缺少 name/profile: ${file}`);
      }
      Object.keys(r.profile).forEach((d) => {
        if (!dimSet.has(d)) {
          throw new Error(`结果「${r.name}」的画像维度「${d}」不在 dimensions 中: ${file}`);
        }
      });
    });
  }
}

/**
 * 同步单个测评：
 * - 不存在则插入 assessments + questions + assessment_results
 * - 已存在则只更新元信息（status/featured/dimensions/duration 等），不覆盖题库与结果，避免破坏已有答卷
 */
async function insertTest(cfg) {
  const name = cfg.name || cfg.title || cfg.test_id;
  const title = cfg.title || name;
  const dimensions = JSON.stringify(cfg.dimensions || []);
  const status = cfg.status === 'soon' ? 0 : 1;
  const featured = cfg.featured ? 1 : 0;
  const duration = cfg.duration || '';

  const existing = await get('SELECT id FROM assessments WHERE test_id = ?', [cfg.test_id]);

  if (existing) {
    await run(
      `UPDATE assessments
          SET title = ?, name = ?, category = ?, subtitle = ?, desc = ?,
              question_count = ?, status = ?, result_type = ?, dimensions = ?,
              featured = ?, duration = ?
        WHERE test_id = ?`,
      [
        title,
        name,
        cfg.category || '其他',
        cfg.subtitle || '',
        cfg.desc || '',
        cfg.questions.length,
        status,
        cfg.result_type,
        dimensions,
        featured,
        duration,
        cfg.test_id,
      ]
    );
    console.log(
      `已同步测评配置: ${name} (test_id=${cfg.test_id}, ${cfg.questions.length} 题, ${cfg.status})`
    );
    return;
  }

  const inserted = await run(
    `INSERT INTO assessments
       (test_id, title, name, category, subtitle, desc, question_count, status,
        result_type, dimensions, featured, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cfg.test_id,
      title,
      name,
      cfg.category || '其他',
      cfg.subtitle || '',
      cfg.desc || '',
      cfg.questions.length,
      status,
      cfg.result_type,
      dimensions,
      featured,
      duration,
    ]
  );

  const assessmentId = inserted.lastID;

  for (const q of cfg.questions) {
    await run('INSERT INTO questions (assessment_id, content, options) VALUES (?, ?, ?)', [
      assessmentId,
      q.content,
      JSON.stringify(q.options),
    ]);
  }

  if (cfg.result_type === 'profile-match') {
    const results = cfg.results || [];
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      await run(
        `INSERT INTO assessment_results
           (assessment_id, result_key, name, tagline, profile, copy, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          assessmentId,
          r.result_key || `result-${i + 1}`,
          r.name,
          r.tagline || '',
          JSON.stringify(r.profile),
          r.copy || '',
          r.sort !== undefined ? r.sort : i,
        ]
      );
    }
  }

  const extra =
    cfg.result_type === 'profile-match' ? `, 结果库 ${cfg.results.length} 项` : '';
  console.log(
    `已初始化测评: ${name} (test_id=${cfg.test_id}, ${cfg.questions.length} 题, ${cfg.result_type}${extra})`
  );
}

/**
 * 初始化 / 同步入口：
 * - 每次启动都读取 config，新测试自动插入，已有测试同步元信息
 * - 最后确保同一时刻只有一个 featured=true
 */
async function initData() {
  const configs = readConfigs();

  if (configs.length === 0) {
    console.warn('config/tests 目录下没有可用的 JSON 配置，未同步任何测评');
    return;
  }

  for (const cfg of configs) {
    await insertTest(cfg);
  }

  // 配置是 featured 的唯一来源：先全部清零，再设置当前主推
  await run('UPDATE assessments SET featured = 0');
  const featured = configs.find((cfg) => cfg.featured && cfg.status !== 'soon');
  if (featured) {
    await run('UPDATE assessments SET featured = 1 WHERE test_id = ?', [featured.test_id]);
  }

  const rows = await all('SELECT test_id, status, featured FROM assessments ORDER BY id');
  const featuredIds = rows.filter((r) => r.featured === 1).map((r) => r.test_id);
  console.log(
    `配置同步完成：配置 ${configs.length} 个，库内 ${rows.length} 个测评` +
      (featuredIds.length ? `，主推 ${featuredIds.join(', ')}` : '，无主推')
  );
}

module.exports = { initData, readConfigs };
