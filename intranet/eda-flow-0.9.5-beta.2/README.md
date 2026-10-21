# EDA Flow 0.9.5-beta.2 内网测试

默认显示板输入改为可编辑自然语言任务书和 DOCX 模拟规格书，保留 50 个规格章节。PDF 上传仍可用，七步设计、BOM、ERC、PDF 与归档功能保留。

## 更新已有安装

在本测试分支执行 `git pull --ff-only`。若使用稀疏检出，先加入目录：

```powershell
git sparse-checkout add intranet/eda-flow-0.9.5-beta.2
powershell -NoProfile -ExecutionPolicy Bypass -File .\intranet\eda-flow-0.9.5-beta.2\scripts\update-eda-flow.ps1 -Profile desktop
```

将 desktop 改为实际安装 profile。更新前正常退出 Harness，完成后重新启动。此目录只包含插件更新包，继续使用 beta.1 已安装的运行时、KiCad 和 Python 依赖，无需重新下载完整环境。脚本先检查包 SHA256 并备份配置；保留工程目录、模型配置及其他插件。

## 实际修改

- 默认 DOCX 通过通用正文与表格提取器读取，来源按章节记录，不虚构页码。文档中无预制绘图坐标或隐藏 CAD 答案。
- 项目状态改用 SQLite 事务存储，重新打开不依赖 project.json。可读旧项目首次打开时迁移，原 JSON 保留；不可读历史项目保留错误入口，不阻止新建项目。
- PDF / DOCX 提取请求与结果通过进程标准输入输出传输，不再使用 extract-request.json / extraction.json 文件交换。
- DOCX 走与 PDF 相同的后续事实提取、设计、生成和核验流程。

这次处理的是创建流程中的状态和文档提取交换。CAD 工具、检查及交付记录仍有 JSON 文件；已受保护的历史文件没有被解密或改写。未接入用户内网的 read WPS 技能，也未在内网机器上验证其进程授权。若默认 DOCX 自身在该环境受保护，需要使用内网批准的读取通道。

## 验证

- 全量回归首次 93 通过，1 失败（旧测试断言资料格式必须为 PDF），1 原有跳过；更新该格式断言后相关 7 项全部通过。最终存储调整相关 10 项补测通过，累计 94 项通过、1 项跳过。
- 两套显示板实际 CAD、BOM、PDF 与归档回归通过；模型部分使用现有测试替身，本轮未重跑线上 DeepSeek 模型演示。
- 新建 DOCX 显示板、关闭重开、编辑输入失效、PDF 上传、旧项目迁移和受保护历史项目共存测试通过。
- DOCX 50 个章节完整读取，替代渲染器检查 22 页，未截断；渲染器测试水印仅在本地 QA PDF，不在交付 DOCX。
- 226 个打包源文件与工作源码逐字节核对；更新脚本通过隔离安装测试（包管理器替身），确认配置及其他依赖保留。

优先在内网测试：新建显示板 → 查看 DOCX 摘录 → 重启后打开 → 修改任务 → 继续设计。旧项目仍在原目录。
