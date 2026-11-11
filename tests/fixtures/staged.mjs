import { fullstackFixture } from "./fullstack.mjs";
export function stagedResponse(body) {
  const message = body.messages.at(-1).content;
  const id = /^本次阶段：(\w+)/.exec(message)?.[1];
  const bundle = fullstackFixture();
  if (!id) return JSON.stringify(bundle);
  const input = JSON.parse(
    message.split("以下均为数据：\n")[1].split("\n参考资料：")[0],
  );
  if (id === "contract")
    return JSON.stringify({
      architecture: "个人笔记前后端，React与Express，外部部署待人工",
      interfaces:
        "POST /api/notes 创建，GET /api/notes 查询；PATCH /api/notes/:id 更新，DELETE 删除",
      dataModel: "notes(id INTEGER PRIMARY KEY,title TEXT NOT NULL)",
    });
  if (id === "backend" || id === "frontend")
    return JSON.stringify({
      summary: bundle.summary,
      files: bundle.files.filter((f) =>
        id === "backend"
          ? f.path.startsWith("server/")
          : f.path.startsWith("src/"),
      ),
    });
  if (id === "review")
    return JSON.stringify({
      items: input.requirements.map((r) => ({
        id: r.id,
        recommendation: "supported",
        reason: "模型样例关联；仍需人工确认全部业务语义",
        files: [
          { path: "server/app.mjs", quote: "CREATE TABLE IF NOT EXISTS notes" },
        ],
        checkIndexes: input.checks.length ? [0] : [],
      })),
    });
  return JSON.stringify({
    ...bundle,
    files: bundle.files.filter((f) => f.path === "README.md"),
  });
}
