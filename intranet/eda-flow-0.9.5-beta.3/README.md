# EDA Flow 0.9.5-beta.3 内网测试

默认显示板输入为自然语言任务书与 DOCX 模拟规格书。此次继续解决后续 CAD、BOM、ERC、页面查看和交付归档中的 JSON 读写，保留七步流程与已有功能。

## 更新已有安装

在本测试分支执行：

```powershell
git pull --ff-only
# 仅稀疏检出用户需要执行下一行
git sparse-checkout add intranet/eda-flow-0.9.5-beta.3
powershell -NoProfile -ExecutionPolicy Bypass -File .\intranet\eda-flow-0.9.5-beta.3\scripts\update-eda-flow.ps1 -Profile desktop
```

将 desktop 替换为实际安装 profile。更新前退出 Harness，完成后重新启动。脚本检查包 SHA256、备份并保留配置，继续使用已有运行时、KiCad、Python、项目目录及其他插件。此目录只有约 4.8 MB 的插件更新包，不需要再次下载完整环境。首次安装请使用 [beta.1 完整环境](../eda-flow-0.9.5-beta.1/README.md)，然后执行本次更新。

## 本次修改

- 默认 DOCX 保留 50 个规格章节；PDF 上传继续可用，后续共用事实提取、设计、生成与核验流程。
- 项目状态与 CAD 结构化记录使用 SQLite 事务存储。Node、Python、检查器和页面从数据库读取内部记录；JSON / JSONL 保留为导出文件。
- ELK / libavoid 通过标准输入输出交换数据。ERC 读取 KiCad 原生报告，校验错误、警告和总数后生成检查记录。
- 交付归档从数据库导出 JSON，附 record-export-manifest.json，记录导出内容与工作目录文件各自的 SHA256。
- 新位号器件按选用的唯一规格符号继承物料信息，核验覆盖这些器件。本次显示器 DS1 已保留 UV、THT 和 electrical 信息。

## 完整显示板实测

实际使用 DeepSeek Harness 的 deepseek-account / deepseek-flash，从新建显示板、默认 DOCX 提取开始，完成需求、器件、原理图、BOM 与核验归档。PCB 按本轮范围跳过。修复资料继承后，重新执行第三步及后续步骤，重启后确认各步骤和交付结果仍可读取。

- 41 个对象、85 个引脚、24 个网络；BOM 41 项，物料字段与规格记录一致。
- 实际 KiCad ERC：0 错误、0 警告；PDF 已打开检查。
- 交付 ZIP 中 140 份 JSON 可解析，139 项记录导出的校验值逐项通过；项目中 44 个数据库及 277 项记录校验通过。
- 完整 CAD、BOM、PDF 和归档故障回归通过。另用本次真实模型生成的设计重跑通用生成器：17 份 JSON 导出替换为 `%TSD-Header` 内容，并禁止直接读取运行时 JSON，仍通过生成与实际检查。
- 回归累计 99 项通过、1 项原有跳过。新增归档清单对应的旧文件列表断言已更新并补测通过。
- 包内 229 个源文件与工作源码逐字节一致。更新脚本的隔离包管理器替身测试通过，原配置与其他依赖保留。

[本次实际 PDF](demo/Circuit.pdf) · [BOM](demo/bom.csv) · [可编辑原理图及符号库](demo/) · [验证记录](verification.json)

内网测试顺序：新建显示板 → 确认 DOCX 摘录 → 器件与连接 → 原理图 → BOM → 核验与交付 → 重启后查看结果。也可修改任务书，检查下游失效并重新生成。
