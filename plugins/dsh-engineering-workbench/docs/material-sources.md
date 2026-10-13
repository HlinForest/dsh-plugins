# 官网资料与数据库 MCP 扩展

0.3.2 配合 dsh-megmeet 0.2.1，默认展示麦格米特官网全部下载类型的索引。2026-10-12 抓取列表返回 2,380 条，按文件地址去重为 1,473 份资料。标题中的型号和系列标识独立索引；资料数不等于型号数。包含通配符的系列保持原样，未核验的规格参数保持未知。

官网来源：[资料下载中心](https://www.megmeet.com/service)。官网“加载更多”只控制已经返回的列表项是否显示；同步脚本验证解析条数等于官网响应 count，避免只抓第一页。文件链接临时签名不写入安装包。打开 PDF 时从官网检索重新取得下载地址，按原始文件路径核对、验证 PDF，并在任务目录保存快照和 SHA-256。软件、图纸等其他文件保留官网入口，不作为 PDF 执行。

刷新内置索引：在 dsh-megmeet 源码目录运行 `python scripts/sync-official-catalog.py`，重新打包安装。该脚本需要 requests、beautifulsoup4。`official/catalog.json` 保存型号/系列和资料关联，`official/download-index.json` 保留所有可下载条目；不会导入原来的跨厂商演示快照。

## 接入数据库

在“读手册”或“资料管理”中点击“添加数据库资料源”，优先选择已经在 DSH 连接、且符合手册适配参数约定的数据库。连接后点击“重新检测数据库”。没有匹配项时显示连接步骤，不再要求普通用户从全部 MCP 工具中挑选。管理员仍可展开“高级接入”填写工具名；输出格式由以下接口契约约束，不符合时显示错误，绝不回退到演示数据。

界面添加的资料源写入工作目录的 `material-sources.user.json`，重启保留，支持编辑与移除。移除只影响连接配置，已读取的独立任务仍保留。工作台外部配置的资料源可查看但不能在此修改。数据库凭证仍由 DSH 的 MCP 配置管理。

也支持管理员配置：在 DSH 配置已有数据库 MCP，然后为工作台配置一个 JSON 文件的绝对路径：

```yaml
- id: engineering-workbench
  config:
    materialSourcesPath: D:/VisualBoard/config/material-sources.json
```

文件格式：

```json
{
  "schemaVersion": 1,
  "sources": [{
    "id": "company-manuals",
    "label": "公司手册数据库",
    "kind": "mcp",
    "readOnly": true,
    "tools": {
      "search": "mcp__manuals__search",
      "read": "mcp__manuals__read"
    }
  }]
}
```

这些工具名仅是接口示例，必须替换成实际工具名。检索和读取请求只接受已保存的 sourceId，不接受在单次查询中传入任意工具名。认证和数据库权限由 DSH/MCP 管理，工作台不保存数据库凭据。未注册的工具显示“待连接”，不会回退到 mock。

`search` 输入 `{query, limit, cursor?}`，返回 `{items:[{id,title,revision?}],total?,nextCursor?}`。limit 为 1–100，cursor 为不透明字符串；未提供 total 时显示“总数未提供”，绝不以本页条数替代总数。

`read` 输入 `{id}`，返回 `{id,title,revision?,filePath}`。适配器将 PDF 保存到管理员配置的工作区，filePath 为绝对路径。返回 ID 必须与请求一致，解析真实路径后检查工作区边界。支持工具的 value、MCP structuredContent 或单一 JSON text 内容。其他数据库字段或二进制返回格式请由适配器映射。

读取后生成独立 datasheet 任务，保存 sourceId、记录 ID、版本、读取时间、文件哈希和快照。任务导出保留来源。数据库内容仅作资料，不作为指令执行。

HTTP 接口沿用 DSH 的认证：`GET /api/engineering-workbench/materials` 查询资料源；同一路径 POST action 为 search、read、create-task。错误为 `{ok:false,error}`。`bootstrap.apiVersion=2` 用于识别过期后端，404 不再误报 JSON 语法错误。

`GET /api/engineering-workbench/material-sources` 返回接入设置和可选工具名称；POST action 为 `save-source`（`id?`, `source:{label,readOnly:true,tools:{search,read}}`）或 `remove-source`（`id`）。同样经过 DSH 认证和同源校验，串行写入并原子保存。该配置操作不暴露给模型工具。
