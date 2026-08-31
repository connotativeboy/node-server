/**
 * initData.js - 初始化测试测评数据
 *
 * 说明：
 * - 迁移自前端 heart-test 项目的 mock 数据（10 套测评 + 通用题目模板）
 * - 每套测评 5 道题，每道题 4 个选项（value + label）
 * - 仅在 assessments 表为空时插入，避免重复初始化
 */
const { db } = require('./db');

// 通用题目模板（前端 QuizPage 使用 value/label 结构）
const QUESTION_TEMPLATES = [
  {
    content: '面对压力时，你通常会怎么做？',
    options: [
      { value: 'A', label: '冷静分析，寻找解决方案' },
      { value: 'B', label: '先放松一下，转移注意力' },
      { value: 'C', label: '找朋友倾诉，寻求支持' },
      { value: 'D', label: '独自消化，默默承受' },
    ],
  },
  {
    content: '在团队中，你更倾向于扮演什么角色？',
    options: [
      { value: 'A', label: '领导者，带领大家前进' },
      { value: 'B', label: '执行者，高效完成任务' },
      { value: 'C', label: '协调者，调和团队关系' },
      { value: 'D', label: '思考者，提供创意方案' },
    ],
  },
  {
    content: '周末你更愿意如何度过？',
    options: [
      { value: 'A', label: '宅在家里，享受独处时光' },
      { value: 'B', label: '外出旅行，探索新地方' },
      { value: 'C', label: '和朋友聚会，热闹一下' },
      { value: 'D', label: '学习充电，提升自己' },
    ],
  },
  {
    content: '面对未知的新事物，你的第一反应是？',
    options: [
      { value: 'A', label: '充满好奇，跃跃欲试' },
      { value: 'B', label: '谨慎观望，了解清楚再说' },
      { value: 'C', label: '有些担心，但愿意尝试' },
      { value: 'D', label: '直接拒绝，保持现状' },
    ],
  },
  {
    content: '你认为自己最大的优势是什么？',
    options: [
      { value: 'A', label: '理性与逻辑' },
      { value: 'B', label: '创造力与想象力' },
      { value: 'C', label: '同理心与沟通力' },
      { value: 'D', label: '毅力与执行力' },
    ],
  },
];

// 10 套测评数据（迁移自前端 mockData.js）
const ASSESSMENTS = [
  // ===== 性格 =====
  {
    test_id: 'deep-desire',
    name: '你深层欲望是什么？',
    category: '性格',
    subtitle: '揭开你内心深处的秘密',
    desc: '每个人的内心深处都隐藏着不为人知的渴望。\n\n本测评通过一系列情景选择，帮助你探索驱动你行为的最深层欲望，让你更了解真实的自己。\n\n共 5 题，约需 2 分钟。',
  },
  {
    test_id: 'city-development',
    name: '你适合什么城市发展？',
    category: '性格',
    subtitle: '找到属于你的理想之城',
    desc: '不同的城市有不同的气质，而你的性格决定了哪座城市最适合你发展。\n\n本测评从生活方式、价值观、社交偏好等维度，为你推荐最适合发展的城市类型。\n\n共 5 题，约需 2 分钟。',
  },
  {
    test_id: '16-personality',
    name: '16人格·心智阶段',
    category: '性格',
    subtitle: '认识真实的自己',
    desc: '基于经典的人格类型理论，通过你的日常行为偏好，判断你属于 16 种人格类型中的哪一种。\n\n共 5 题，约需 2 分钟。',
  },
  {
    test_id: 'hidden-danger',
    name: '你内心隐藏的危险人格',
    category: '性格',
    subtitle: '直面内心的阴影',
    desc: '每个人心中都住着一个不为人知的"危险"自我。\n\n本测评通过潜意识投射，帮你发现那个隐藏在阳光面背后的另一面。\n\n共 5 题，约需 2 分钟。',
  },
  {
    test_id: 'dark-personality',
    name: '你内心深处的腹黑人格',
    category: '性格',
    subtitle: '你有多腹黑？',
    desc: '腹黑并非贬义，它代表一种深藏不露的智慧。\n\n本测评测测你的腹黑指数，看看你在人际交往中隐藏了多少小心思。\n\n共 5 题，约需 2 分钟。',
  },
  {
    test_id: 'historical-figure',
    name: '你最像哪个历史人物？',
    category: '性格',
    subtitle: '你的历史灵魂',
    desc: '如果穿越回古代，你的性格和处事方式最像哪位历史人物？\n\n本测评通过性格特质分析，为你匹配最相似的历史人物。\n\n共 5 题，约需 2 分钟。',
  },
  {
    test_id: 'seven-sins',
    name: '七宗罪VS七美德',
    category: '性格',
    subtitle: '罪与德的较量',
    desc: '七宗罪与七美德，代表了人性中对立的两面。\n\n本测评测测你的性格更偏向哪一边，看看你内心天平的两端。\n\n共 5 题，约需 2 分钟。',
  },
  // ===== 文学 =====
  {
    test_id: 'literary-archetype',
    name: '文学原型',
    category: '文学',
    subtitle: '你的文学人格',
    desc: '在浩瀚的文学作品中，每个人都能找到自己的原型。\n\n本测评探索你在文学世界中的角色定位，看看你是英雄、智者、还是浪漫主义者。\n\n共 5 题，约需 2 分钟。',
  },
  // ===== 心理 =====
  {
    test_id: 'mental-age',
    name: '心理年龄',
    category: '心理',
    subtitle: '你的心理年龄是几岁？',
    desc: '你的心理年龄可能和实际年龄大不相同。\n\n本测评通过一系列生活态度与行为习惯的选择，测出你的真实心理年龄。\n\n共 5 题，约需 2 分钟。',
  },
  {
    test_id: 'scl90',
    name: 'SCL-90',
    category: '心理',
    subtitle: '关注你的心理健康',
    desc: 'SCL-90 症状自评量表是国际通用的心理健康测评工具。\n\n本测评帮助你了解近期的心理状态，结果仅供娱乐参考。\n\n共 5 题，约需 2 分钟。',
  },
];

/**
 * 初始化测试数据：若 assessments 表为空则插入测评和题目
 * 返回 Promise，供入口服务在启动时调用
 */
function initData() {
  return new Promise((resolve, reject) => {
    // 先检查是否已有测评数据
    db.get('SELECT COUNT(*) AS count FROM assessments', (err, row) => {
      if (err) return reject(err);

      // 已有数据则跳过，避免重复初始化
      if (row.count > 0) {
        console.log('已存在测评数据，跳过初始化');
        return resolve();
      }

      // 逐套插入测评 + 题目
      const insertAssessment = (index) => {
        if (index >= ASSESSMENTS.length) {
          console.log('已初始化测评数量:', ASSESSMENTS.length);
          return resolve();
        }

        const a = ASSESSMENTS[index];
        db.run(
          'INSERT INTO assessments (test_id, title, name, category, subtitle, desc, question_count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [a.test_id, a.name, a.name, a.category, a.subtitle, a.desc, QUESTION_TEMPLATES.length, 1],
          function (err) {
            if (err) return reject(err);

            const assessmentId = this.lastID;
            console.log('已创建测评:', a.name, '(id=' + assessmentId + ')');

            // 插入该测评的题目
            const stmt = db.prepare(
              'INSERT INTO questions (assessment_id, content, options) VALUES (?, ?, ?)'
            );
            QUESTION_TEMPLATES.forEach((q) => {
              stmt.run(assessmentId, q.content, JSON.stringify(q.options));
            });
            stmt.finalize((err) => {
              if (err) return reject(err);
              insertAssessment(index + 1);
            });
          }
        );
      };

      insertAssessment(0);
    });
  });
}

module.exports = { initData };
