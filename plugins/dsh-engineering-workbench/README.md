# DSH 工程工作台

为已有工程插件增加原生 DSH 界面，适配桌面版和 Web `0.2.0-rc.2`。安装后侧栏出现 **工程工作台**，右下角出现可拖动的 **工程进度** 面板。

- **选型演示**：调整负载、温度、宽度，调用 `dsh-megmeet` 真实引擎重新核对候选。三步预设展示初选、需求变化、资料扩充。可查看厂家 PDF 证据并导出报告。
- **电路检查**：调用 KiCad CLI 导出当前保存工程，使用 `dsh-pcb-review` 的项目规则，显示封装位置、真实 PCB 与原理图。点击检查项定位对应器件。
- **原理图对比**：指定器件和新值，由 `dsh-schematic-sync` 创建独立候选，比较前后、运行 ERC 并导出 PDF。界面不写回原工程。
- **悬浮进度**：显示真实步骤、耗时、成功或失败；同时监听该 profile 的工程工具调用。拖动标题移动，键盘方向键也可移动；支持收起。

## 安装

需要先安装 `dsh-megmeet@0.2.0`、`dsh-pcb-review@0.1.0`、`dsh-schematic-sync@0.1.0`。KiCad 工作流可一并安装，其工具调用会显示在执行记录中。

```powershell
dsh plugin --profile desktop add ./dist/dsh-engineering-workbench-0.1.1.tgz --ignore-scripts
```

在实际 profile 的 `cordis.patch.yml` 添加管理员路径配置，例如本机：

```yaml
- id: engineering-workbench
  config:
    catalogPath: D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.v2.json
    catalogV1Path: D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.v1.json
    projectFile: D:/VisualBoard/dsh-pcb-review/projects/displayboard/project.json
    currentSchematic: D:/VisualBoard/DisplayBoard.kicad_sch
    pcbPath: D:/VisualBoard/DisplayBoard.kicad_pcb
    workspaceRoot: D:/VisualBoard
    workDirectory: D:/VisualBoard/dsh-workbench-data
    kicadCli: D:/Kicad/bin/kicad-cli.exe
```

重新加载或重新打开 DSH，点击侧栏 **工程工作台**。界面不另设登录或模型账号，所有数据请求走 DSH 自带认证连接。

## 演示顺序

1. 点击“初次选型”：180 W 负载、25℃、V1 资料库，观察 SDR-240-24。
2. 点击“工况变化”：300 W、55℃，原库没有满足项。
3. 点击“资料扩充”：增加 PULS 资料，观察 CP20.241-R1 / R2 等满足项；再拖动温度滑块查看连续能力变化。
4. 切换“电路检查”，点击检查项定位；切换到 PCB 原图或原理图。
5. 选择 R1，输入新元件值，点击“修改副本并校验”。比较原生图纸前后，查看所列目标差异与 ERC 结果。
6. 收起工作台，观察悬浮面板；工程工具在聊天中运行时，也会留下真实执行记录。

## 数据含义

位置图只显示封装参考点，不表示铜皮、走线或焊盘边界。完整 PCB 预览来自 KiCad。原理图多页项目当前展示首张导出图，图上给出页数。对比只校验明确指定的元件值；原有 ERC 问题原样显示，不据此宣称整板通过。

工作目录保存快照、候选和报告，原始工程不修改。进度在内存中保存最近记录，重启清空；面板位置保存在本机浏览器存储。接口不接受任意文件路径或任意工具名，文件通过已登记的随机 ID 读取并复核哈希。

## 开发

从合集仓库运行 `npm ci --ignore-scripts`、`npm run check`、`npm test`。选型测试使用旁边 `dsh-megmeet/success-demo` 的原件与快照。浏览器客户端直接使用 DSH 提供的 React 和 Slot 服务，不依赖外部 CDN。
