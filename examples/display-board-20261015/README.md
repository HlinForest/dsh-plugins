# 显示板：已生成的 KiCad 工程

这是 2026-10-15 在电路设计插件 0.3.4 的独立窗口中，逐步执行显示板默认输入得到的工程。可以直接用 KiCad 打开，无需安装或运行 Harness 插件。工程、库、模型和预览均在本目录中，Git 拉取会一起取得。

## 打开工程

在已有仓库目录执行：

```powershell
git pull --ff-only origin main
```

随后用 KiCad 打开 `examples/display-board-20261015/DisplayBoard/DisplayBoard.kicad_pro`。生成和检查使用的 KiCad 版本为 **10.0.6**；若旧版提示文件格式过新，需使用支持该格式的版本。

- 原理图：`DisplayBoard/DisplayBoard.kicad_sch`
- PCB：`DisplayBoard/DisplayBoard.kicad_pcb`
- BOM：`DisplayBoard/BOM_逐位号.csv`
- 符号库、封装库：`DisplayBoard_Native.kicad_sym`、`DisplayBoard_Placed.pretty/`，以及两份库表。
- 三维模型：`DisplayBoard/models/`，通过工程相对路径关联。
- 原理图 PDF：`DisplayBoard/previews/schematic.pdf`
- 正反面及三维预览：`DisplayBoard/previews/`

请完整保留 `DisplayBoard` 目录，不要只移动原理图或 PCB 单个文件。只看图纸可以直接打开 PDF 或 SVG。

## 是否由 KiCad 直接导入 AD 得到

**本轮生成阶段没有调用 AD 导入器，也没有读取 SchDoc/PcbDoc。**

原理图由 `generate_schematic.py` 读取原始提取记录、器件、引脚、符号图形、连接和页面坐标，创建新的 KiCad 原理图及符号库。PCB 由 `generate_pcb.py` 从空的 KiCad 文件结构开始，按默认输入逐个创建封装、焊盘、走线、铜区和其他对象，再应用已确认的调整。

需要区分输入的历史来源：**PCB 默认输入中部分图元曾借助 KiCad 官方 AD 导入器作为辅助提取通道，并与已确认原工程的导入结果核对。** 所以不能把本工程描述为“资料准备全过程没有使用导入器”，也不能当作“仅凭需求让 AI 从零设计出了同一块板”。

本次模型环节使用 12 次模拟响应，真实模型请求为零；实际生成由已编写的 Python/KiCad 工具完成。它验证默认输入与工具链可生成工程，不代表真实 DeepSeek 独立设计能力已通过验证。

## 结果与来源记录

七步均已确认，第一步确认及结果哈希保留；显示板基准的 28 类内容比较一致。交付仍为带待确认项的草稿：厂家规格书、原 AD 编译网表及页面 PDF、数码管原始三维模型尚缺，制造铜层数和孔金属化待确认；最终 ERC 1 条警告、DRC 40 条警告。详见工程 `checks/` 和 `evidence/seven-step-validation.json`。

- `evidence/generation-method.json`：生成路径、模型方式、历史输入来源与待办。
- `evidence/commands.json`：本轮实际生成、导出、检查命令；本机绝对路径已替换为占位符。
- `evidence/published-files.json`：交付文件哈希。
- `DisplayBoard/checks/file-access-*.json`：Python 文件读取记录。记录范围不含原生 C++ 内部文件读写。

工程主体、BOM、库、模型及预览与本轮生成结果字节一致。公开副本只整理检查记录中的本机路径，并省略个人视图文件 `.kicad_prl`；原始运行记录在本机保留。

[生成器源码（本轮固定版本）](https://github.com/HlinForest/dsh-plugins/tree/9a19d1c2167fdb66da5ab6dcd0f87bf79fbcf714/plugins/dsh-eda-flow/python/structured) · [独立工程下载包](https://github.com/HlinForest/dsh-plugins/releases/tag/display-board-20261015)
