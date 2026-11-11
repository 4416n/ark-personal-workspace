import { z } from "zod";
import { dependencyError } from "../shared/task-policy.mjs";
import { uuid } from "../shared/id.mjs";

const id = z.string().min(1).max(100);
const text = z.string().max(100000);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "日期无效",
  );
const stamp = z.string().datetime();
export const prioritySchema = z.enum(["high", "medium", "low"]);
export const passageSchema = z.object({
  noteId: id.optional(),
  title: z.string().max(200),
  projectId: id.optional(),
  content: z.string().max(1000),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  score: z.number(),
  citation: z.string().max(20),
});
const resultMetaSchema = z.object({
  id,
  number: z.number().int().min(1),
  at: stamp,
  reason: z.enum(["baseline", "manual", "ai", "restore"]),
  restoredFrom: z.number().int().min(1).optional(),
});
export const resultVersionSchema = resultMetaSchema.extend({
  content: text,
  source: z.enum(["local", "ai", "manual"]),
  sources: z.array(passageSchema).max(6).optional(),
});
const reviewSchema = z.object({
  id,
  at: stamp,
  action: z.enum(["approved", "returned"]),
  note: z.string().max(10000),
  versionId: id.optional(),
  versionNumber: z.number().int().min(1).optional(),
  actor: z.enum(["human", "ai"]).optional(),
  runId: id.optional(),
});
const contractFields = {
  deliverable: z.string().max(300).optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(1000)).max(12).optional(),
  executionMode: z.enum(["ai", "human"]).optional(),
};
const aiReviewSchema = z.object({
  versionId: id,
  runId: id,
  at: stamp,
  model: z.string().max(150),
  passed: z.boolean(),
  requiresHuman: z.boolean(),
  summary: z.string().max(3000),
  checks: z
    .array(
      z.object({
        criterion: z.string().max(1000),
        passed: z.boolean(),
        evidence: z.string().max(1500),
      }),
    )
    .max(12),
});
export const retrospectiveSchema = z.object({
  outcome: z.string().max(5000),
  lessons: z.string().max(5000),
  nextSteps: z.string().max(5000),
  updatedAt: stamp,
  knowledgeId: id.optional(),
});
export const memberSchema = z.object({
  id,
  name: z.string().min(1).max(50),
  role: z.string().min(1).max(100),
  department: z.string().min(1).max(50),
  skills: z.array(z.string().min(1).max(50)).max(30),
  capacity: z.number().min(1).max(80),
  prompt: text,
  color: z.enum(["purple", "blue", "orange", "green", "pink"]),
  type: z.enum(["ai", "human"]),
  skillLevels: z.record(z.string(), z.number().min(1).max(5)).optional(),
  availability: z.enum(["available", "paused"]).optional(),
  traits: z.array(z.string().max(30)).max(12).optional(),
});
export const projectSchema = z.object({
  id,
  deliveryType: z.enum(["software", "document"]).optional(),
  title: z.string().min(1).max(100),
  goal: z.string().min(1).max(10000),
  deadline: day,
  priority: prioritySchema,
  status: z.enum(["active", "paused", "done"]),
  createdAt: stamp,
  color: z.enum(["purple", "blue", "orange", "green", "pink"]),
  demo: z.boolean(),
  successCriteria: z.string().max(3000).optional(),
  budget: z.number().min(0).max(100000000).optional(),
  retrospective: retrospectiveSchema.optional(),
});
export const taskSchema = z.object({
  ...contractFields,
  id,
  projectId: id,
  title: z.string().min(1).max(200),
  description: text,
  ownerId: z.string().max(100),
  status: z.enum(["todo", "doing", "review", "done"]),
  priority: prioritySchema,
  deadline: day,
  estimatedHours: z.number().min(0.5).max(500),
  result: text,
  source: z.enum(["local", "ai", "manual"]),
  createdAt: stamp,
  demo: z.boolean(),
  skills: z.array(z.string().max(50)).max(30).optional(),
  dependsOn: z.array(id).max(100).optional(),
  reviewNote: z.string().max(10000).optional(),
  resultMeta: resultMetaSchema.optional(),
  resultHistory: z.array(resultVersionSchema).max(12).optional(),
  reviews: z.array(reviewSchema).max(50).optional(),
  legacyReviewNote: z.string().max(10000).optional(),
  resultSources: z.array(passageSchema).max(6).optional(),
  aiReview: aiReviewSchema.optional(),
});
export const knowledgeSchema = z.object({
  id,
  title: z.string().min(1).max(200),
  content: text,
  category: z.enum(["资料", "灵感", "规范", "复盘"]),
  updatedAt: stamp,
  projectId: id.optional(),
  sourceTaskId: id.optional(),
  sourceFile: z.object({
    name: z.string().min(1).max(255),
    modifiedAt: stamp,
    importedAt: stamp,
  }).optional(),
});
export const templateSchema = z
  .object({
    id,
    deliveryType: z.enum(["software", "document"]).optional(),
    name: z.string().min(1).max(100),
    goal: z.string().max(10000),
    successCriteria: z.string().max(3000),
    createdAt: stamp,
    tasks: z
      .array(
        z.object({
          ...contractFields,
          title: z.string().min(1).max(200),
          description: text,
          skills: z.array(z.string().max(50)).max(30),
          ownerId: z.string().max(100),
          priority: prioritySchema,
          estimatedHours: z.number().min(0.5).max(500),
          dayOffset: z.number().int().min(-3650).max(3650),
          dependsOn: z.array(z.number().int().min(0)).max(100),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((template, ctx) => {
    template.tasks.forEach((task, index) => {
      if (
        new Set(task.dependsOn).size !== task.dependsOn.length ||
        task.dependsOn.some((n) => n >= index)
      )
        ctx.addIssue({
          code: "custom",
          message: "模板前置任务只能引用先前的任务且不能重复",
        });
    });
  });
export const departmentSchema = z.object({
  name: z.string().min(1).max(50),
  mission: z.string().max(2000),
  leadId: z.string().max(100),
  budget: z.number().min(0).max(100000000),
});
export const stateSchema = z
  .object({
    version: z.literal(1),
    profile: z.object({
      name: z.string().min(1).max(40),
      role: z.string().max(60),
      focus: z.string().max(200),
    }),
    members: z.array(memberSchema).max(500),
    projects: z.array(projectSchema).max(2000),
    tasks: z.array(taskSchema).max(10000),
    knowledge: z.array(knowledgeSchema).max(2000),
    departments: z.array(departmentSchema).max(100).default([]),
    templates: z.array(templateSchema).max(100).optional(),
    activity: z
      .array(z.object({ id, text: z.string().max(500), at: stamp }))
      .max(100),
    messages: z
      .array(
        z.object({
          id,
          role: z.enum(["user", "assistant"]),
          content: text,
          createdAt: stamp,
          sources: z.array(passageSchema).max(6).optional(),
        }),
      )
      .max(200),
  })
  .superRefine((s, ctx) => {
    for (const group of [
      s.members,
      s.projects,
      s.tasks,
      s.knowledge,
      s.templates || [],
    ])
      if (new Set(group.map((x) => x.id)).size !== group.length)
        ctx.addIssue({ code: "custom", message: "存在重复 ID" });
    const projects = new Set(s.projects.map((x) => x.id));
    const members = new Set(s.members.map((x) => x.id));
    if (
      s.tasks.some(
        (t) =>
          !projects.has(t.projectId) || (t.ownerId && !members.has(t.ownerId)),
      )
    )
      ctx.addIssue({ code: "custom", message: "任务关联的项目或员工不存在" });
    const error = dependencyError(s.tasks);
    if (error) ctx.addIssue({ code: "custom", message: error });
    if (new Set(s.departments.map((d) => d.name)).size !== s.departments.length)
      ctx.addIssue({ code: "custom", message: "存在重名部门" });
    if (
      s.departments.some(
        (d) =>
          d.leadId &&
          !s.members.some((m) => m.id === d.leadId && m.department === d.name),
      )
    )
      ctx.addIssue({ code: "custom", message: "部门负责人必须是该部门的成员" });
  });
export type Workspace = z.infer<typeof stateSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type ResultVersion = z.infer<typeof resultVersionSchema>;
export type Retrospective = z.infer<typeof retrospectiveSchema>;
export type Knowledge = z.infer<typeof knowledgeSchema>;
export type ProjectTemplate = z.infer<typeof templateSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type Page =
  | "dashboard"
  | "projects"
  | "tasks"
  | "team"
  | "knowledge"
  | "assistant"
  | "decisions"
  | "analytics"
  | "runs"
  | "settings";
export type AiConfig = {
  baseUrl: string;
  model: string;
  provider: string;
  configured: boolean;
};
export type PlanItem = {
  deliverable?: string;
  acceptanceCriteria?: string[];
  executionMode?: "ai" | "human";
  title: string;
  description: string;
  ownerId: string;
  priority: Priority;
  estimatedHours: number;
  reason: string;
  skills: string[];
  dependsOn?: number[];
};
export const uid = uuid;
export const now = () => new Date().toISOString();
export function dateIn(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const dateLabel = (v: string) =>
  new Date(v + "T00:00:00").toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
export const priorityText = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};
export const statusText = {
  todo: "待开始",
  doing: "进行中",
  review: "待验收",
  done: "已完成",
};
export function projectProgress(p: Project, tasks: Task[]) {
  const items = tasks.filter((t) => t.projectId === p.id);
  return items.length
    ? Math.round(
        (items.filter((t) => t.status === "done").length / items.length) * 100,
      )
    : 0;
}
export const defaultMembers: Member[] = [
  {
    id: "member-strategy",
    name: "小策",
    role: "项目策略师",
    department: "策略部",
    skills: ["需求分析", "目标拆解", "项目管理", "调研", "复盘"],
    capacity: 40,
    prompt:
      "你是一位务实的项目策略师。将模糊目标转化为明确、可衡量的行动，指出约束和风险，提供具体交付物。",
    color: "purple",
    type: "ai",
  },
  {
    id: "member-content",
    name: "小文",
    role: "内容创作师",
    department: "内容部",
    skills: ["文案", "内容策划", "写作", "自媒体", "营销"],
    capacity: 40,
    prompt:
      "你是一位优秀的中文内容创作者。面向具体受众，使用清晰自然的语言，输出可以直接编辑使用的内容，避免空话。",
    color: "orange",
    type: "ai",
  },
  {
    id: "member-tech",
    name: "小码",
    role: "技术工程师",
    department: "研发部",
    skills: ["开发", "代码", "自动化", "知识库", "技术"],
    capacity: 40,
    prompt:
      "你是一位注重可靠性的工程师。分析技术方案、给出可执行代码和验证步骤。清楚说明哪些建议需要用户在本地执行。",
    color: "blue",
    type: "ai",
  },
  {
    id: "member-design",
    name: "小艺",
    role: "视觉设计师",
    department: "设计部",
    skills: ["设计", "品牌", "视觉", "排版", "用户体验"],
    capacity: 32,
    prompt:
      "你是一位视觉与产品设计师。围绕用户目标给出具体视觉规范、布局建议、配色和交互方案。使用文字或 SVG 描述设计，不声称生成了未生成的图片。",
    color: "green",
    type: "ai",
  },
];
export function emptyWorkspace(): Workspace {
  return {
    version: 1,
    profile: {
      name: "小舟",
      role: "独立创造者",
      focus: "把想法变成作品，做自己的决策者。",
    },
    members: structuredClone(defaultMembers),
    projects: [],
    tasks: [],
    knowledge: [],
    departments: [],
    activity: [],
    messages: [],
  };
}
export function seedWorkspace(): Workspace {
  const s = emptyWorkspace();
  const createdAt = now();
  s.projects = [
    {
      id: "demo-knowledge",
      title: "搭建我的个人知识库",
      goal: "整理零散笔记，建立可检索、可持续更新的个人知识管理体系。",
      deadline: dateIn(7),
      priority: "high",
      status: "active",
      createdAt,
      color: "purple",
      demo: true,
    },
    {
      id: "demo-content",
      title: "启动个人内容计划",
      goal: "围绕 AI 与效率工具，每周产出两篇有价值的原创内容，建立稳定的创作节奏。",
      deadline: dateIn(14),
      priority: "medium",
      status: "active",
      createdAt,
      color: "orange",
      demo: true,
    },
    {
      id: "demo-brand",
      title: "个人品牌焕新",
      goal: "梳理个人定位，设计统一的视觉语言，更新个人主页与社交媒体简介。",
      deadline: dateIn(21),
      priority: "low",
      status: "active",
      createdAt,
      color: "blue",
      demo: true,
    },
  ];
  const rows: [string, string, string, Task["status"], number][] = [
    ["demo-knowledge", "梳理知识分类与使用场景", "member-strategy", "done", -2],
    ["demo-knowledge", "完成知识库工具选型", "member-tech", "done", -1],
    ["demo-knowledge", "搭建知识库目录与索引", "member-tech", "doing", 0],
    ["demo-knowledge", "设计每周知识整理流程", "member-strategy", "todo", 3],
    ["demo-content", "确定内容定位与读者画像", "member-strategy", "done", -1],
    ["demo-content", "制定第一周内容选题", "member-content", "review", 0],
    [
      "demo-content",
      "撰写第一篇 AI 工具体验文章",
      "member-content",
      "doing",
      1,
    ],
    ["demo-content", "设计内容封面视觉模板", "member-design", "todo", 4],
    ["demo-brand", "梳理个人品牌关键词", "member-strategy", "doing", 2],
    ["demo-brand", "设计主页视觉方案", "member-design", "todo", 6],
    ["demo-brand", "更新社交媒体个人简介", "member-content", "todo", 7],
  ];
  s.tasks = rows.map(([projectId, title, ownerId, status, days], i) => ({
    id: `demo-task-${i}`,
    projectId,
    title,
    description: `围绕「${s.projects.find((p) => p.id === projectId)!.title}」完成${title}。\n交付要求：形成可执行的方案，列出具体步骤和验收标准。`,
    ownerId,
    status,
    priority: i % 3 === 0 ? "high" : "medium",
    deadline: dateIn(days),
    estimatedHours: 2 + (i % 4),
    result:
      status === "review"
        ? "## 第一周选题计划（示例）\n\n1. **周二：用 AI 整理零散笔记**\n   - 从一个真实的使用场景切入\n   - 展示整理前后的变化\n2. **周五：我的一人工作流**\n   - 记录目标拆解与执行过程\n   - 分享遇到的问题与改进\n\n**验收标准：** 每个选题明确受众、核心观点和可操作的收获。"
        : "",
    source: "local",
    createdAt,
    demo: true,
  }));
  s.knowledge = [
    {
      id: "welcome-note",
      title: "欢迎来到你的个人工作台",
      content:
        "# 让想法开始生长\n\n1. 新建一个项目，写下你想实现的目标。\n2. 使用离线规划，或配置 API 后让 AI 拆解。\n3. 调整每个任务的负责人并加入工作台。\n4. 在任务详情中生成 AI 交付物，审核后标记完成。\n\n这里也可以保存你的背景资料、内容风格和项目规范。调用 AI 时会附带相关资料。\n\n初始项目和任务都是示例，可在设置中清除。",
      category: "资料",
      updatedAt: createdAt,
    },
  ];
  s.activity = [
    {
      id: uid(),
      text: "工作台已就绪，开始你的第一个真实项目吧",
      at: createdAt,
    },
  ];
  return s;
}
