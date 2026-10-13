# 内网安装与试用

本插件独立运行，无需工程工作台。本机默认模式不调用模型；内网启用 AI 后才使用 Harness 已配置的当前模型。

## 完整 ZIP

解压 `EDA_Flow_Intranet_0.1.0.zip` 到一个长期保留的目录。内容：

- `plugin/dsh-eda-flow-0.1.0.tgz`：插件与 Node 运行依赖。
- `r6-case/`：已确认的原始 SchDoc、PcbDoc、PrjPcb 和来源哈希，不含旧 R5/R6 可编辑成品。
- `offline/wheels/`：Windows x64 的 sexpdata、PyMuPDF 依赖。
- `scripts/`：环境检查、离线依赖安装、Harness 安装器。
- `validation/`：本机实际生成、独立比较、重放和页面检查记录。真实模型未调用。
- `FILES.json`：分发文件哈希。安装器在更改配置前核对。

Harness 0.2.0-rc.2 和 KiCad 10.0.6 需预先安装。首版默认方案在该 KiCad 版本验证，换版本需要重新验收。内网工程工作目录需允许本机账户读写；浏览器里填写的是 **运行 Harness 的电脑** 上的路径。

## 安装

下面路径是示例，请替换工作目录与 KiCad `bin` 目录。先创建工作目录，例如 `D:/EDA-Projects`。

```powershell
# 在完整 ZIP 解压目录运行
powershell -ExecutionPolicy Bypass -File ./scripts/check-environment.ps1 -WorkspaceRoot D:/EDA-Projects -KicadDirectory 'C:/Program Files/KiCad/10.0/bin'

# 若环境检查提示缺 Python 包
powershell -ExecutionPolicy Bypass -File ./scripts/install-offline-python.ps1 -PythonExe 'C:/Program Files/KiCad/10.0/bin/python.exe'

# 安装到现有 desktop profile，保留原有登录与其他插件
powershell -ExecutionPolicy Bypass -File ./scripts/install-intranet.ps1 -WorkspaceRoot D:/EDA-Projects -KicadDirectory 'C:/Program Files/KiCad/10.0/bin'
```

安装器会备份该 profile 的包清单与配置，添加独立 `eda-flow` 条目，设置 `allowModelCalls: false`，非 desktop profile 会通过 CLI 检查完整配置；desktop 由 Harness 桌面应用管理，需要重启后完成宿主配置检查。完成后重启 Harness，打开侧边栏 **原理图与 PCB 流程**。

如果 Harness 安装位置不同，使用 `-DshCommand '实际路径/dsh.cmd'`。如使用其他 profile，增加 `-Profile 名称`。现有其他插件的缓存仍需完整；离线缓存报错时使用企业允许的 `-Registry`，或者使用独立干净 profile，不能把登录文件打包传播。

## 手动配置

安装 tgz 后，在目标 profile 的 `cordis.patch.yml` 末尾配置：

```yaml
- id: eda-flow
  config:
    workspaceRoot: 'D:/EDA-Projects'
    workDirectory: 'D:/EDA-Projects/eda-flow'
    kicadCli: 'C:/Program Files/KiCad/10.0/bin/kicad-cli.exe'
    kicadPython: 'C:/Program Files/KiCad/10.0/bin/python.exe'
    caseInputDirectory: 'D:/EDA_Flow_Intranet_0.1.0/r6-case'
    allowModelCalls: false
```

安装后的插件不读取旧工作台任务目录。保留案例资料包路径，源文件会在创建 R6 项目时按哈希核对并复制到本次项目目录。

## 第一次演示

1. 点击“加载 R6 默认方案”，核对七步都显示未执行。
2. 每步点击执行；有缺项时查看清单并明确允许草稿，再确认下一步。
3. 原理图、BOM、PCB 和 3D 都应在本次执行后出现，图纸可点击全屏。
4. 第七步下载 `R6-generated.zip` 和 `frozen-evidence.zip`。确认后执行空目录重放。
5. 检查重放内容一致及模型请求数为 0。记录保留告警、规则/字体/板框例外，不能写成“原生 1:1 全部通过”。

要试真实 AI，先在内网 Harness 中配置允许使用的模型，再将此插件的 `allowModelCalls` 改为 `true` 并重启。页面选择“由 AI 生成输出”。默认方案生成成功不能用来证明 AI 能从未知工程独立生成；这部分需内网另测。

## 常见问题

| 情况 | 处理 |
|---|---|
| 选中文件后提取失败 | 看当前阶段的错误与 `import-N.command.json` / `extraction.json`；确认 SchDoc/PcbDoc 来自同一有效版本。无完整解析支持时从原 Altium 导出编译网表、页面 PDF、BOM、层叠/规则，保留缺项，不制造通过结论。 |
| 路径不能读取 | 将资料放进 `workspaceRoot`；文件选择器访问的是服务运行电脑，不是另一个浏览器客户端。检查共享盘权限与实际文件名。 |
| KiCad 旧板导入偶发崩溃 | Windows 官方导入器访问异常时最多重试三次，每次独立日志。仅接受退出成功的输出；三次失败仍报告失败。 |
| PDF 提取不到参数 | 首版先提取页码文本。扫描图应补文本规格书或人工录入；AI 解析值仍需复核。 |
| R6 默认输出拒绝执行 | 源文件哈希、设计约束或处理方案已改变。另建默认项目，或切换 AI/自定义方案；新结果不能承诺匹配原版 R6。 |
| 修改后旧结果消失 | 下游结果已经失效，原文件仍保存在历史执行子目录。重新执行和确认。 |
| 重放失败 | 检查错误、源依赖是否保留、脚本是否硬编码旧目录。不要把失败改成通过；回到出错阶段修改后重新执行。 |

## 独立本机网页（可选）

将 tgz 解压，进入其中 `package` 目录，用 Node ≥22.19.0 运行：

```powershell
node scripts/serve.mjs local-config.json
```

`local-config.json` 使用上述相同配置项，另加 `"port":18476`，是标准 JSON 对象。浏览器打开 `http://127.0.0.1:18476`。此入口强制关闭 AI，适合默认流程演示，不需要工作台。

源码验证命令和接口见上级 README。完整包包含原始案例工程，请按照企业工程资料权限管理。
