# EDA Flow 0.9.5-beta.4

原理图页直接展示生成结果：**下载完整工程**、**下载图纸 PDF**和图纸预览。第四步完成即可取得工程，无需等待最后交付。

输入资料、补充调整和待确认项折叠收纳。待确认项去重，只在相应入口查看；助手栏和检查页不再重复长篇摘要。连接、ERC、资料追溯和人工确认仍可使用。上游变更后，失效图纸不会作为当前结果展示或下载。

## 更新

退出 Harness，在原测试分支中执行：

```powershell
git pull --ff-only
# 稀疏检出用户执行
git sparse-checkout add intranet/eda-flow-0.9.5-beta.4
powershell -NoProfile -ExecutionPolicy Bypass -File .\intranet\eda-flow-0.9.5-beta.4\scripts\update-eda-flow.ps1 -Profile desktop
```

替换 desktop 为实际 profile，然后重新启动 Harness。保留原工程目录、模型配置、其他插件和 beta.3 的 DOCX / SQLite 修复。首次安装使用 [完整运行环境](../eda-flow-0.9.5-beta.1/README.md) 后更新。

## 验证

- 17 项界面、下载和存储相关测试通过；前端构建与语法检查通过。
- 用 beta.3 实际 DeepSeek 显示板结果验证第四步下载：27 个文件，含 KiCad 工程、符号库、PDF、BOM，15 份 JSON 可解析；原理图与已验证结果逐字节一致。
- 新下载接口验证了受保护 JSON 导出、失效结果拒绝下载与目录越界拦截；原文件不改变。
- 实际浏览器核对图纸默认页、连接页、折叠补充输入和窄窗口布局。

本次调整界面和下载，不重新调用模型生成电路。[本次结果页截图](result-page.png)
