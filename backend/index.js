/**
 * index.js - 心理测评后端服务入口
 *
 * 功能：
 * - Express 应用实例，挂载 cors、express.json 中间件
 * - 挂载测评路由与答卷路由
 * - 启动时自动建表 + 初始化测试测评数据
 * - 监听 127.0.0.1:3000，仅本机访问，供 Nginx 反向代理
 */
const express = require('express');
const cors = require('cors');
const { initTables } = require('./db/db');
const { initData } = require('./db/initData');
const assessmentRoutes = require('./routes/assessment');
const answerRoutes = require('./routes/answer');
const frontendRoutes = require('./routes/frontend');

const app = express();

// 中间件：跨域 + JSON 解析
app.use(cors());
app.use(express.json());

// 健康检查接口（可选，便于 Nginx / 监控探测）
app.get('/api/health', (req, res) => {
  res.json({ code: 0, msg: 'ok' });
});

// 挂载路由
app.use('/api/assessments', assessmentRoutes);
app.use('/api/answers', answerRoutes);
// 前端 heart-test 项目接口（挂载在 /api 根路径，路径与前端 api.js 完全一致）
app.use('/api', frontendRoutes);

// 统一 404 处理（未匹配的接口）
app.use((req, res) => {
  res.status(404).json({ code: 404, msg: '接口不存在' });
});

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('服务异常:', err);
  res.status(500).json({ code: 500, msg: '服务器内部错误', error: err.message });
});

// 服务端口与监听地址（仅本机，供 Nginx 反向代理）
const HOST = '127.0.0.1';
const PORT = 3000;

// 启动流程：建表 -> 初始化数据 -> 监听端口
initTables();
initData()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`心理测评后端服务已启动: http://${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('初始化数据失败:', err);
    process.exit(1);
  });
