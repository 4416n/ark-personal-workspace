import { recommendedMember } from "../shared/matching.mjs";
export const matchMember = recommendedMember;
export function localPlan(goal, members, tasks = []) {
  const content = /内容|文章|自媒体|文案|公众号|小红书|视频|写作/.test(goal);
  const tech = /开发|网站|应用|系统|工具|知识库|代码|自动化/.test(goal);
  const study = /学习|考试|课程|英语|阅读|读书/.test(goal);
  const title = goal.replace(/\s+/g, " ").slice(0, 35);
  const middle = content
    ? [
        [
          "制定选题与发布计划",
          ["内容策划", "自媒体"],
          "选题清单、受众画像、发布日历",
        ],
        [
          "完成首批内容与视觉方案",
          ["写作", "文案", "设计"],
          "可编辑的内容初稿与封面设计说明",
        ],
      ]
    : tech
      ? [
          [
            "确定工具选型与实现方案",
            ["技术", "知识库", "开发"],
            "工具对比、技术选型、实施步骤",
          ],
          [
            "完成核心流程的首版实现",
            ["开发", "自动化", "代码"],
            "最小可用版本的实现方案、代码或配置指引",
          ],
        ]
      : study
        ? [
            [
              "梳理学习路径与资源",
              ["调研", "项目管理"],
              "分阶段学习清单、资源链接待核实项、时间安排",
            ],
            [
              "完成第一轮学习与练习",
              ["写作", "复盘"],
              "学习提纲、练习题、掌握情况自评表",
            ],
          ]
        : [
            [
              "制定行动路径与资源清单",
              ["目标拆解", "项目管理"],
              "里程碑、行动清单、所需资源与约束",
            ],
            [
              "完成第一阶段核心交付物",
              ["文案", "设计", "技术"],
              "围绕目标的第一版可审阅成果",
            ],
          ];
  const steps = [
    [
      "明确目标边界与验收标准",
      ["需求分析", "调研"],
      "目标说明、范围边界、3 条可衡量的验收标准",
    ],
    ...middle,
    [
      "检查成果并收集改进意见",
      ["用户体验", "需求分析"],
      "验收检查表、问题清单、修改建议",
    ],
    [
      "复盘结果与下一步计划",
      ["复盘", "项目管理"],
      "目标达成情况、经验总结、下一阶段行动",
    ],
  ];
  const assigned = [...tasks];
  return steps.map(([name, skills, output], i) => {
    const match = matchMember(skills, members, assigned, [2, 3, 5, 2, 1][i]);
    const item = {
      title: name,
      description: `项目目标：${goal}\n\n本阶段：${name}\n交付物：${output}\n验收：交付内容应围绕「${title}」，提供具体步骤；信息不足时列出待确认事项。`,
      skills,
      priority: i === 0 || i === 2 ? "high" : "medium",
      estimatedHours: [2, 3, 5, 2, 1][i],
      ...match,
      dependsOn: i > 0 ? [i - 1] : [],
    };
    assigned.push({ ...item, status: "todo" });
    return item;
  });
}
export function parsePlan(content, members, tasks) {
  const raw = JSON.parse(
    content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
  const items = Array.isArray(raw) ? raw : raw.tasks;
  if (!Array.isArray(items) || !items.length || items.length > 12)
    throw new Error("模型没有返回有效的任务列表，请重试。");
  const assigned = [...tasks];
  return items.map((item, index) => {
    if (
      typeof item.title !== "string" ||
      !item.title.trim() ||
      typeof item.description !== "string"
    )
      throw new Error("模型返回的任务缺少标题或交付要求，请重试。");
    const skills = Array.isArray(item.skills)
      ? item.skills
          .filter((s) => typeof s === "string" && s)
          .map((s) => s.slice(0, 50))
          .slice(0, 10)
      : [];
    const match = matchMember(
      skills,
      members,
      assigned,
      Math.min(80, Math.max(0.5, Number(item.estimatedHours) || 2)),
    );
    const planned = {
      title: item.title.trim().slice(0, 200),
      description: item.description.slice(0, 10000),
      skills,
      priority: ["high", "medium", "low"].includes(item.priority)
        ? item.priority
        : "medium",
      estimatedHours: Math.min(
        80,
        Math.max(0.5, Number(item.estimatedHours) || 2),
      ),
      ...match,
      dependsOn: Array.isArray(item.dependsOn)
        ? [
            ...new Set(
              item.dependsOn.filter(
                (v) => Number.isInteger(v) && v >= 0 && v < index,
              ),
            ),
          ]
        : [],
    };
    assigned.push({ ...planned, status: "todo" });
    return planned;
  });
}
