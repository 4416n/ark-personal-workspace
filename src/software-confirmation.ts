export const softwareConfirmation = (
  title: string,
  repairs: number,
  maxTokens = 8192,
) =>
  `交付「${title}」的完整网站工程？\n\n将生成 React 前端、Express 后端、SQLite 数据库代码、测试用例与 Docker 部署文件，并在隔离环境中运行生成的代码，按实际错误自动修复。最多 ${repairs + 1} 次模型调用（首次生成 + ${repairs} 次修复），单次输出上限 ${maxTokens} tokens，需模型支持，消耗已配置模型额度。项目需求、任务成果、上一版源码及检索资料会发送给该模型。\n\n关闭页面仍继续，电脑服务必须运行；可随时停止。不会在宿主机直接运行生成的代码，也不会实际上线、安装项目依赖或连接外部业务服务。沙箱不可用时仅生成未验证源码。\n\n检查通过只表示指定构建与冒烟通过，不代表所有业务与安全要求已验收。`;
