# 心理测评后端服务

Node.js + Express + sqlite3 实现的最小可用心理测评后端，**不包含任何前端代码**。

> 技术栈：Express + cors + express-json + sqlite3（文件型数据库，项目内直接运行，无需 MySQL）

## 一、完整目录结构

```
backend/
├─ index.js          # 入口服务：Express 实例、中间件、路由挂载、监听 127.0.0.1:3000
├─ db/
│  ├─ db.js          # sqlite3 连接、自动建表（三张表 + auth_code 唯一索引）
│  └─ initData.js    # 初始化测试测评数据（1套测评 + 5道题目带选项分值）
├─ routes/
│  ├─ assessment.js  # 测评相关接口（列表/详情/题目/开始测评）
│  └─ answer.js      # 答卷、授权码接口（提交/查询）
├─ package.json
└─ README.md
```

## 二、接口一览

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/assessments` | 获取全部测评列表 |
| GET | `/api/assessments/:id` | 获取单个测评详情 |
| GET | `/api/assessments/:id/questions` | 获取该测评全部题目 |
| POST | `/api/assessments/:id/start` | 开始测评：生成16位授权码，新建答卷 doing |
| POST | `/api/answers/submit` | 提交答卷：计算总分，生成报告，状态改 finished |
| GET | `/api/answers?auth_code=xxx` | 查询答卷：区分 doing/finished，不存在返回404 |

## 三、本地运行步骤

```bash
# 1. 进入 backend 目录
cd backend

# 2. 安装依赖
npm install

# 3. 启动服务（监听 127.0.0.1:3000）
npm start
```

启动成功后控制台输出：
```
数据库连接成功: ...\backend\psych.db
数据库表初始化完成
已创建测评: 心理健康自评量表 (id=1)
已初始化题目数量: 5
心理测评后端服务已启动: http://127.0.0.1:3000
```

> 说明：首次启动会自动创建 `backend/psych.db` 数据库文件并初始化测试数据。若需重置数据，删除 `psych.db` 后重启即可。

### 快速测试

```bash
# 获取测评列表
curl http://127.0.0.1:3000/api/assessments

# 开始测评（返回 auth_code）
curl -X POST http://127.0.0.1:3000/api/assessments/1/start

# 提交答卷（替换为实际 auth_code）
curl -X POST http://127.0.0.1:3000/api/answers/submit \
  -H "Content-Type: application/json" \
  -d '{"auth_code":"你的授权码","answer_data":[{"question_id":1,"option_index":0},{"question_id":2,"option_index":1},{"question_id":3,"option_index":0},{"question_id":4,"option_index":2},{"question_id":5,"option_index":1}]}'

# 查询答卷
curl "http://127.0.0.1:3000/api/answers?auth_code=你的授权码"
```

## 四、CI/CD 自动部署（GitHub Actions）

与前端一致，后端也通过 GitHub Actions 自动部署。工作流文件位于 [`node-server/.github/workflows/deploy-backend.yml`](../.github/workflows/deploy-backend.yml)。

### 1. 触发方式

推送以 `v` 开头的 tag（如 `v1.0.0`）即触发部署：

```bash
git add .
git commit -m "release backend v1.0.0"
git tag v1.0.0
git push origin v1.0.0
```

### 2. 所需 GitHub Secrets

与前端部署共用同一组 Secrets（在仓库 Settings → Secrets and variables → Actions 中配置）：

| Secret | 说明 |
|--------|------|
| `SERVER_HOST` | 服务器 IP 或域名 |
| `SERVER_USER` | SSH 登录用户名 |
| `SERVER_SSH_PRIVATE_KEY` | SSH 私钥（对应服务器上的公钥） |

### 3. 部署流程

工作流自动执行以下步骤：

1. **Checkout** 拉取代码
2. **Setup Node.js 20** + 安装依赖（本地校验构建）
3. **清理服务器目录**：`rm -rf /var/www/backend/*`
4. **上传代码**：将 `backend/` 目录 SCP 到 `/var/www/backend/`
5. **安装依赖并重启**：
   - `npm install --production`（首次自动全局安装 pm2）
   - `pm2 restart psych-assessment`（已存在则重启）或 `pm2 start index.js --name psych-assessment`（首次启动）
   - `pm2 save` 保存进程列表

> 说明：`.gitignore` 排除了 `*.db`，数据库文件不会上传。首次启动时后端会自动创建 `psych.db` 并初始化 10 套测评数据。

### 4. 首次部署前需在服务器手动准备

```bash
# 1. 安装 Node.js 20（如未安装）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 创建部署目录并授权
sudo mkdir -p /var/www/backend
sudo chown -R $USER:$USER /var/www/backend

# 3. 配置 Nginx 反向代理（见下一节）
```

## 五、服务器部署（pm2 手动方式）

> 若不想用 CI/CD，也可手动部署，流程如下：

```bash
# 1. 全局安装 pm2
npm install -g pm2

# 2. 进入项目目录安装依赖
cd /path/to/backend
npm install --production

# 3. 启动服务
pm2 start index.js --name psych-assessment

# 4. 常用命令
pm2 restart psych-assessment   # 重启
pm2 stop psych-assessment      # 停止
pm2 delete psych-assessment    # 删除进程
pm2 logs psych-assessment      # 查看实时日志
pm2 list                       # 查看进程列表
pm2 save                       # 保存进程列表（开机自启需配合 pm2 startup）

# 5. 设置开机自启（可选）
pm2 startup
```

## 六、Nginx 反向代理配置

将 `/api/*` 转发到 `127.0.0.1:3000`：

```nginx
server {
    listen 80;
    server_name your-domain.com;   # 替换为你的域名

    # 前端静态资源（如有）
    location / {
        root /path/to/frontend;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

配置完成后重载 Nginx：

```bash
nginx -t          # 检查配置语法
nginx -s reload   # 重载配置
```

## 七、重要业务注意事项

### 1. 授权码安全说明
- **授权码由后端生成**：使用 Node.js `crypto.randomBytes` 生成 16 位随机码，前端禁止生成、禁止传入。
- **唯一性保障**：`user_answers.auth_code` 字段设置了 `UNIQUE` 唯一索引，插入时若冲突（`SQLITE_CONSTRAINT`）会自动重试生成，从数据库层面杜绝重复。
- **授权码即凭证**：系统无注册登录，授权码是答卷的唯一凭证，一份授权码对应一份答卷。用户需妥善保管授权码，丢失后无法找回。
- **防非法提交**：提交接口会先校验 `auth_code` 是否存在，不存在返回 404；已完成（finished）的答卷禁止重复提交。

### 2. 数据存储说明
- **文件型数据库**：数据保存在 `backend/psych.db` 单文件中，无需 MySQL，项目内直接运行。
- **JSON 字段**：`questions.options` 和 `user_answers.answer_data` 以 JSON 字符串存储，读写时需 `JSON.stringify` / `JSON.parse`。
- **自动建表**：服务启动时自动创建三张表（表不存在则创建），无需手动建表。
- **自动初始化**：`assessments` 表为空时自动插入测试测评数据，已有数据则跳过，避免重复初始化。
- **备份**：直接备份 `psych.db` 文件即可完成数据备份。

### 3. 踩坑提示
- **sqlite3 版本与 Node 版本兼容**：本项目使用 `sqlite3@6.0.1`（支持较新的 Node.js，如 Node 24）。若使用旧版 `sqlite3@5.x` 在 Node 24 上安装，可能因缺少对应预编译二进制而触发本地编译，进而报错 `Could not find any Python installation`。**建议保持 `sqlite3@6.x`**。
- **sqlite3 编译问题**：`sqlite3` 是原生模块，安装时可能需要编译。若 `npm install` 报错，可尝试安装 `node-gyp` 和 `windows-build-tools`，或使用预编译二进制（`npm install sqlite3 --build-from-source`）。国内网络建议使用镜像源：`npm install --registry=https://registry.npmmirror.com`。
- **并发写锁**：sqlite3 对并发写入有限制，高并发场景可能出现 `SQLITE_BUSY`。本项目为最小 demo，若需高并发建议后续迁移到 MySQL/PostgreSQL。
- **端口占用**：若 3000 端口被占用，启动会报 `EADDRINUSE`，可先释放端口或修改 `index.js` 中的 `PORT`。
- **仅本机访问**：服务监听 `127.0.0.1`，外部无法直接访问，必须通过 Nginx 反向代理暴露，这是安全设计。
- **JSON 解析**：提交接口依赖 `express.json()` 中间件，请求头必须带 `Content-Type: application/json`，否则 `req.body` 为空。
- **answer_data 格式**：提交的 `answer_data` 必须是数组，元素格式 `{ question_id, option_index }`，`option_index` 对应题目 options 数组的下标。
