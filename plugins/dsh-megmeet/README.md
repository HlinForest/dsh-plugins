# dsh-megmeet

麦格米特客户需求解析与产品方案辅助插件，目标运行时 **DeepSeek Harness v0.2.0-rc.2**。

插件v0.2.0提供六个原生工具，在已有 DSH 对话中完成“读取需求 → 提取条件 → 查找产品 → 校验参数 → 生成报告”。复用 DSH 的模型、会话、文档工具和现有登录入口，无需另建云端业务服务，也不需要额外模型 API Key。

默认产品库为**虚构演示数据**，所有型号、参数、认证和来源均不代表麦格米特真实产品。使用真实资料时，管理员配置自己的产品库 JSON。

## 快速安装

将随附的 `dsh-megmeet-0.2.0.tgz` 安装到你们内部系统实际使用的 profile。以下以 `web` 为例：

```powershell
dsh plugin --profile web add 'D:\VisualBoard\dsh-megmeet\dsh-megmeet-0.2.0.tgz'
```

重新加载对应 profile，或按内部系统的部署流程重启 DSH。插件包已包含编译结果，不执行安装脚本，也不修改 DSH 核心。继续使用你们已有的内部启动入口和鉴权。

独立原版 DSH 可以这样启动：

```powershell
dsh web
```

在对话里输入：

> 先调用 megmeet_get_catalog_info。用演示产品库分析这份需求：输入类型 AC，输入电压 180–264V，输出电压 48V，输出功率不低于 3kW，效率至少 96%，工作温度 -20–60℃，通信协议 CAN、RS485，认证 CE、UL，散热方式风冷。生成带来源和待确认项的 Markdown 报告。

预期：`DEMO-PS-A` 通过已列条件，`DEMO-PS-C` 缺少效率资料而待确认，另外三个产品存在硬性不匹配。报告始终提示工程确认，不将匹配结果称为已完成选型。

文件需求先交给 DSH 已有文件读取或 Office 文档工具，转换为文本后传给插件。插件自身不提供 PDF/OCR/DOCX 文件解析器，不绕过 DSH 的文件权限读取附件。

## 工具

| 工具 | 用途 |
| --- | --- |
| `megmeet_get_catalog_info` | 查看数据集、演示标记、产品类型、字段、限制和推荐流程 |
| `megmeet_parse_requirements` | 保守提取明确参数，保留原文依据和未解析条件 |
| `megmeet_search_products` | 查询产品库并逐项校验，默认排除硬性不匹配 |
| `megmeet_validate_candidate` | 针对精确产品 ID 重新校验，返回资料来源和版本 |
| `megmeet_generate_solution_report` | 一次完成解析、检索和报告生成；也可指定候选 ID |
| `megmeet_export_report` | 按查询快照重新校验，导出不可覆盖的JSON、Markdown和HTML |

工具接收 `text` 原文；检索和报告支持 `family`、`limit`、`includeIncompatible`。报告支持 `title` 和 `productIds`。使用指定 ID 时会重新校验，不信任模型构造的产品参数或先前结果。

工具返回结构化JSON与Markdown摘要。schemaVersion 2报告固定为结论、需求表、候选表、计算依据、资料来源和待确认事项。新增 `megmeet_export_report` 在管理员配置的 `reportDirectory` 内生成不可覆盖的JSON、Markdown和HTML；模型不能指定输出路径。导出时必须传回查询返回的 `catalogRevision`。schemaVersion 1继续使用原有报告格式。

## 接入真实产品库

复制 `examples/catalog.demo.json`，以真实且获授权的资料替换产品和来源，设置 `demo: false`。保存为绝对路径，如 `D:/MegmeetData/catalog.json`。

在内部系统使用的 profile 的 `cordis.patch.yml` 中追加覆盖配置：

```yaml
- id: megmeet-product-assistant
  config:
    catalogPath: 'D:/MegmeetData/catalog.json'
    maxCandidates: 10
    maxInputChars: 60000
```

修改profile配置需重新加载插件。每次业务调用重新读取JSON并校验来源哈希。资料库更新无需重启。无效JSON或哈希异常会使调用失败，不会回退到演示库。资料变化后，旧 `expectedCatalogRevision` 会被拒绝。

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `catalogPath` | 空字符串 | 留空使用演示库；真实数据必须是管理员配置的绝对路径 |
| `maxCandidates` | 10 | 单次候选上限，整数 1–50 |
| `maxInputChars` | 60000 | 文本长度上限，整数 100–500000 |
| `reportDirectory` | 空字符串 | 管理员配置的绝对路径；空值禁用报告导出 |

产品库为 JSON 对象，最多 5MB、10000 个产品，结构如下：

```json
{
  "schemaVersion": 1,
  "dataset": "业务部门授权产品库",
  "version": "2026-10-09",
  "demo": false,
  "sources": [
    {
      "id": "DATASHEET-001",
      "title": "已授权的产品资料",
      "version": "V1.0",
      "location": "PDF第1页，型号对应行",
      "url": "https://example.com/official-document-page",
      "file": "documents/authorized-datasheet.pdf"
    }
  ],
  "products": [
    {
      "id": "替换为真实型号",
      "name": "替换为真实产品名称",
      "family": "power-supply",
      "description": "填写产品用途与适用范围",
      "parameters": {
        "input_type": "AC",
        "input_voltage_v": { "min": 180, "max": 264 },
        "output_voltage_v": 48,
        "output_power_w": 3000
      },
      "evidence": {
        "output_power_w": {
          "sourceId": "DATASHEET-001",
          "quote": "逐字引用真实资料中证明该参数的原文"
        }
      }
    }
  ]
}
```

上面的数字也只是结构说明，需要全部替换。每个产品参数都应有对应 `evidence`。缺少参数或来源时结果为 `unknown`，不会判为满足。引用不存在的来源会在加载时拒绝。

### 可点击资料版本（0.1.3）

`source.url` 是管理员核对的 HTTP/HTTPS 原文或官网下载入口；`source.file` 是本地原件，相对路径按产品库 JSON 所在目录解析。文本原件可设置正整数 `source.line`。`location` 继续保存页码、表格和工况说明，不再把描述文字猜成网址。旧schemaVersion 1且未配置哈希的来源沿用原有行为。新资料库已配置原件SHA256；文件缺失或哈希异常会阻止业务调用。

工具输出的 `source.links` 含已生成的 Markdown 链接。最终聊天答案应保留这些链接：版本文字直接链接本地原件，官网入口作为另一条链接。DSH rc.2 原生聊天识别 `[资料版本](D:/资料库/规格书.pdf)` 和文本文件的 `#L5`，在右侧打开 PDF/文本；不要改成 `file://`。本地 PDF 的页码保留在 `location` 中，不使用文本行号片段。

本次已在独立 rc.2 原生网页聊天界面实际点击验证 PDF 和文本链接；截图及结果位于 `real-demo/native-chat-pdf.png`、`real-demo/native-chat-link-verification.json`。没有改动 DSH 核心，也不保存浏览器登录状态。

`real-demo/` 是新采集的公开真实资料演示：8份工业原件、28个型号和4个公开需求出处。目录内的医疗画册为附加下载资料，不计入28个工业型号。`catalog.real.json` 可用作管理员配置；典型效率、含降额温度和仅凭图标的认证不作为保证参数。历史 `demo-comparison/` 仍保留原始虚构数据实验。

### 支持的标准字段

| 字段 | 类型 / 标准单位 |
| --- | --- |
| `input_voltage_v` / `output_voltage_v` | 数字或 `{min,max}`，V |
| `output_power_w` | 数字或区间，W |
| `output_channels` | 正整数，路；明确单/双/三/四路输出可自动提取 |
| `efficiency_pct` | 数字或区间，0–100 的百分数 |
| `temperature_c` | 数字或区间，摄氏度 |
| `protocols` / `certifications` | 字符串数组，精确匹配 |
| `cooling` | 字符串，支持 `fan` / `natural` / `liquid` 与常见中文同义词 |
| `input_type` / `output_type` | 字符串，如 `AC` / `DC` |

单位换算支持明确的 W、kW、MW、V、kV、mV、% 和 ℃/°C。VAC/VDC 会额外生成对应输入或输出类型约束。缺少单位、严格不等式、任选条件、复合工况和无法完整识别的内容会保留为待确认。

### 补充复杂需求

DSH 模型或业务用户可将明确的复杂表达整理为 `constraints`。这些约束只能补充，不会移除自动提取的条件；`sourceQuote` 必须逐字出现在 `text` 中。

```json
{
  "text": "客户要求功率至少三千瓦",
  "constraints": [
    {
      "field": "output_power_w",
      "operator": "gte",
      "value": 3000,
      "hard": true,
      "sourceQuote": "客户要求功率至少三千瓦"
    }
  ]
}
```

数字比较支持 `gte`、`lte`、`eq` 和 `range`（使用 `min/max`）；列表使用 `includes` 与 `textValue`；普通文本使用 `eq` 与 `textValue`。语义提取仍需人工复核，逐字引用不能证明模型的解读一定正确。

### 结果含义

- `matches_listed_constraints`：通过已经列出且有依据的条件，仍需工程确认。
- `needs_confirmation`：存在缺失资料、缺失来源、未解析需求或无法判断的参数。
- `incompatible`：至少一项硬性条件明确不匹配。

匹配得分是已列条件的加权通过比例（硬性权重 2、偏好权重 1），不是置信度。未解析条件会阻止确定匹配。区间覆盖按包含关系判断，不将区间相交当作覆盖。

效率工况、温度降额、机械安装、认证适用范围、价格、库存和交期没有完整建模，需由工程师确认或在后续版本补充。JSON 来源元数据不自动验证原始文档的真实性；产品库维护者应核对资料。

## 内部鉴权与数据边界

插件不添加登录页面，不接收模型提供的租户或用户身份，也不连接外网。业务文本不另行保存；DSH 原有会话日志仍按你们的配置处理输入和工具结果。

**当前产品库是插件实例共享的授权数据集。** 现有登录鉴权不会自动变成按产品或项目过滤的授权。若不同用户可以看到不同产品资料，应先为对应权限分离实例/产品库，或将数据访问替换为你们的可信服务端提供者；不要将所有机密资料放入一个共享目录后仅在展示时隐藏。

目录路径由管理员配置，模型不能选择任意文件。客户文件读写交给已有 DSH 工具及其权限管线处理。

## 开发与验证

```powershell
npm ci --ignore-scripts
npm run check
npm test
npm run demo
npm pack
```

`npm run demo` 在本目录 `.verification/demo-report.md` 生成演示报告。开发依赖锁定 `@deepseek-ai/dsh-tools@0.2.0-rc.2`、Cordis 4.0.4 和相应 system-prompt 包。生产包使用 DSH 的 peer 工具注册表。

测试使用真实的 rc.2 `SystemPrompt` 和 `ToolRuntime`，覆盖工具加载/卸载、执行管线、取消、参数验证、端到端报告、区间比较、单位转换、来源缺失、并发请求隔离和报告转义。无需模型账户即可运行。

插件源代码为 `src/index.ts`（DSH 注册）和 `src/domain.ts`（产品库、需求与校验逻辑）。`lib/` 为编译结果，安装包包含该目录。

官方接口依据：[工具包](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/tools)、[插件打包文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。官方 master 持续变化，本插件以实际安装的 rc.2 包为兼容依据。


## v0.2.0 真实资料库与工况复核

`success-demo/index.html`提供工业控制柜电源的三步真实资料演示。V1有30个MEAN WELL真实型号，V2加入PULS后有39个。保存11份官方PDF、检索文本、逐项引文、页码与原件哈希。旧 `real-demo` 与 `demo-comparison`保留。

schemaVersion 2在旧参数模型上增加电流、频率、本体宽度、公差、安装方式、DC OK继电器、额定连续曲线、限时峰值和持续时间。需求支持持续负载、设计裕量、安装姿态、海拔和上下/侧面间距。负载与裕量形成连续需求，额定曲线在完整工况与安装条件下做分段线性校验。PowerBoost与峰值单独记录。条件缺失保持待确认；本期保守限制于已核对海拔与曲线范围，不做外推。

`src/service.ts`为共同业务入口，插件和 `lib/cli.js`调用同一校验引擎。管理员配置例：

```yaml
- id: megmeet-product-assistant
  config:
    catalogPath: 'D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.active.json'
    maxCandidates: 10
    maxInputChars: 60000
    reportDirectory: 'D:/VisualBoard/dsh-megmeet/success-demo/desktop-reports'
```

```powershell
node lib/cli.js --catalog D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.active.json --command info
node lib/cli.js --catalog D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.active.json --command search --text-file requirements.txt
```

导出命令增加 `--command export --report-dir <管理员目录> --expected-revision <本轮SHA256>`。每份JSON含原资料库快照。可用 `node success-demo/scripts/replay-report.mjs <report.json>`核对原件哈希并复核历史结果。结构样例见 `success-demo/snapshots/catalog.v2.json`。

中文报告借鉴STE的清晰表达原则，不声明ASD-STE100正式合规。参数证据与结果均须由工程师复核。报价、库存、交期、云端API及分用户数据权限未接入。实际四组对比和选择边界见 `success-demo/README.md`。
