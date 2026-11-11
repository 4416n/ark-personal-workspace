export const softwareConfirmation = (
  title: string,
  repairs: number,
  maxTokens = 8192,
  staged = true,
) =>
  `交付「${title}」的完整网站工程？\n\n将生成 React 前端、Express 后端、SQLite 数据库代码、测试用例与 Docker 部署文件，并在隔离环境中运行生成的代码。${staged ? `分阶段执行：契约、后端、前端、集成、隔离验证、需求审查；正常 5 次模型请求，每个模型阶段最多额外尝试 ${repairs} 次，验证修复最多 ${repairs} 次，总计最多 ${5 + 6 * repairs} 次调用。已完成阶段保存检查点，恢复不清零已用次数。` : `最多 ${repairs + 1} 次模型调用（首次生成 + ${repairs} 次修复）。`}单次输出上限 ${maxTokens} tokens，需模型支持，消耗已配置模型额度。项目需求、任务成果、上一版源码及检索资料会发送给该模型。\n\n关闭页面仍继续，电脑服务必须运行；可随时停止。不会在宿主机直接运行生成的代码，也不会实际上线、安装项目依赖或连接外部业务服务。沙箱不可用时仅生成未验证源码。\n\n检查通过不代表所有业务与安全要求已验收；AI 仅提供证据建议，最终需逐条人工确认。`;
