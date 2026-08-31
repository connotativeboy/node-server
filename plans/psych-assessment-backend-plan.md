# 心理测评网站 - Node.js + Express 后端实现计划

## 一、项目概述

构建一套最小可用的心理测评后端服务，**不包含任何前端代码**。核心业务：用户无需注册登录，通过后端生成的唯一授权码（auth_code）作为答卷唯一凭证，完成「开始测评 → 答题 → 提交 → 生成报告 → 凭码查询」的完整闭环。

## 二、目录结构

```
backend/
├─ index.js          # 入口服务：Express 实例、中间件、路由挂载、监听 127.0.0.1:3000
├─ db/
│  ├─ db.js          # sqlite3 连接、自动建表（三张表 + 唯一索引）
│  └─ initData.js    # 初始化测试测评数据（1套测评 + 若干题目带选项分值）
├─ routes/
│  ├─ assessment.js  # 测评相关接口（列表/详情/题目/开始测评）
│  └─ answer.js      # 答卷、授权码接口（提交/查询）
└─ package.json
```

## 三、数据库设计（三张表）

### 1. assessments 测评主表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK AUTOINCREMENT | 主键 |
| title | TEXT | 测评标题 |
| desc | TEXT | 测评介绍 |
| question_count | INTEGER | 题目数量 |
| status | TEXT | 状态（1=启用） |

### 2. questions 题目表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK AUTOINCREMENT | 主键 |
| assessment_id | INTEGER | 关联测评 |
| content | TEXT | 题目内容 |
| options | TEXT(JSON) | 选项数组，每项含 label、score |

### 3. user_answers 用户答卷表（核心）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK AUTOINCREMENT | 主键 |
| assessment_id | INTEGER | 关联测评 |
| auth_code | TEXT UNIQUE | 授权码（唯一索引，禁止前端生成） |
| status | TEXT | doing / finished |
| answer_data | TEXT(JSON) | 用户答题记录 |
| score | INTEGER | 总分 |
| report_content | TEXT | 测评报告文本 |
| create_time | TEXT | 创建时间 |
| update_time | TEXT | 更新时间 |

## 四、接口设计（6个接口全部实现）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/assessments | 获取全部测评列表 |
| GET | /api/assessments/:id | 获取单个测评详情 |
| GET | /api/assessments/:id/questions | 获取该测评全部题目 |
| POST | /api/assessments/:id/start | 开始测评：生成16位授权码，新建答卷 doing，返回 auth_code |
| POST | /api/answers/submit | 提交答卷：校验 auth_code，计算总分，生成报告，状态改 finished |
| GET | /api/answers?auth_code=xxx | 查询答卷：区分 doing/finished，不存在返回 404 |

## 五、核心业务逻辑

### 1. 授权码生成（后端专属）
- 使用 Node.js `crypto.randomBytes` 生成 16 位随机码（字母+数字，避免易混淆字符）
- 数据库 auth_code 字段设置 UNIQUE 唯一索引
- 插入时若冲突（SQLITE_CONSTRAINT）则重新生成重试，保证唯一

### 2. 得分计算
- 遍历用户 answer_data，逐题累加所选选项的 score
- 根据总分区间映射生成 report_content 报告文本（如：低分/中分/高分区间对应不同结论）

### 3. 提交校验
- 必须校验 auth_code 是否存在，防止非法提交
- 校验通过后更新 status=finished、score、report_content、update_time

### 4. 查询区分
- doing：返回继续答题数据（题目 + 已答内容）
- finished：直接返回报告结果
- 不存在：返回 404 错误

## 六、技术要点

- **依赖**：express、cors、sqlite3（文件型数据库，项目内直接运行，无需 MySQL）
- **中间件**：cors()、express.json()
- **监听**：127.0.0.1:3000，只允许本机访问，供 Nginx 反向代理
- **自动建表**：服务启动时若表不存在自动 CREATE TABLE
- **初始化数据**：启动时若 assessments 为空则插入测试测评数据

## 七、交付文档内容

1. 完整目录结构
2. package.json 完整代码
3. index.js 完整代码
4. db/db.js 数据库连接、建表代码
5. db/initData.js 初始化测试测评数据
6. routes/assessment.js 全部测评接口
7. routes/answer.js 答卷授权码接口
8. 本地运行步骤
9. 服务器部署：pm2 启动、重启、日志命令
10. Nginx 反向代理配置片段（/api/* 转发到 127.0.0.1:3000）
11. 重要业务注意事项：授权码安全说明、数据存储说明、踩坑提示

## 八、实现顺序

1. 创建 `backend/package.json`
2. 创建 `backend/db/db.js`（连接 + 建表）
3. 创建 `backend/db/initData.js`（初始化数据）
4. 创建 `backend/routes/assessment.js`
5. 创建 `backend/routes/answer.js`
6. 创建 `backend/index.js`（入口）
7. 编写部署与注意事项文档
8. 验证结构与逻辑
