# 电路设计 0.3.3：更新安装与实际运行版本核对

> 历史版本记录。main 分支的更新脚本现指向 0.3.4，请按[最新更新说明](update-eda-flow-0.3.4.md)安装和核对版本。

适用于已安装电路设计的电脑。默认资料随插件提供，不需要另找原工程或填写工作目录。

## 更新并核对实际运行版本

在原仓库目录执行：

```powershell
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Git pull failed; stop before updating.' }
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-eda-flow.ps1 -Profile desktop
if ($LASTEXITCODE -ne 0) { throw 'Plugin update failed; keep the error output.' }
```

更新脚本备份旧插件，保留原项目、模型、登录与窗口运行时。它不会自动退出 Harness，也不会调用模型。

**安装文件更新后，正在运行的后台可能仍是旧版。** 更新脚本会分别显示 `installedVersion`（已安装）和 `runningVersion`（实际运行）。出现 `restart-required` 时：

1. 等当前聊天或任务结束，正常退出 Harness；如果关闭主窗口后仍在系统托盘运行，从托盘菜单退出。
2. 重新启动 Harness，从侧栏“电路设计”图标打开窗口。不要继续使用旧书签或旧窗口。
3. 页面左下角的“电路设计”和“运行后台”都应显示 **0.3.3**。

仅关闭电路设计窗口可能保留旧后台。无需删除项目、清空配置或重新登录。可再次执行只读检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-eda-flow.ps1 -Profile desktop
```

本次更新的成功条件是下面三项同时匹配。不能只看 `active`，因为两个旧版本相同也可能显示 `active`。

```json
{
  "profile": "desktop",
  "installedVersion": "0.3.3",
  "runningVersion": "0.3.3",
  "activation": "active"
}
```

`window-not-reachable` 或 `not-detected` 表示暂时没有取得运行版本，不等于安装失败。先从 Harness 打开电路设计，再检查。若原来使用的 profile 不是 `desktop`，两个命令使用原 profile 名称；自定义了 DSH 数据目录时，两条脚本命令都加 `-DshHomePath '原来的 DSH 数据目录'`。

备份位置为 `%USERPROFILE%\.dsh\plugin-upgrade-backups\eda-flow-0.3.3-时间-编号`（自定义 DSH 数据目录时在该目录下）。脚本备份旧插件、profile 配置与锁文件，沿用已有项目目录、模型配置和登录。请勿删除 `.dsh`、卸载整个 Harness 或清空项目目录。`git pull` 仅更新仓库文件；必须执行更新脚本，然后核对实际运行版本。

## 这次七步验证对应哪个安装包

2026-10-14 的[七步原生窗口验证](eda-flow-0.3.3-seven-step-validation.md)使用已安装的 **0.3.3**，与仓库及 Release 的以下文件对应。2026-10-15 补充验证证据，插件包未重新构建，版本仍为 0.3.3。

| 文件 | SHA-256 |
| --- | --- |
| `dsh-eda-flow-0.3.3.tgz` | `99e2f57e20dcb1195bb83f618d6a867dcc4230b285e404050cfd196992044562` |
| `EDA_Flow_Update_0.3.3.zip` | `17b56e4d241d784255c528540ab0708218320fc375f745b824da1a6c84b29a5b` |

升级脚本会校验 TGZ 哈希，并使用带哈希的缓存路径安装。模型模拟仅存在于单独运行的验证脚本；正式插件继续使用 Harness 当前选择的模型与登录。

## 显示板应该怎样走

1. 选择“使用显示板输入”。第一步默认需求已填写，可以直接确认，不需要模型。
2. 第二步显示“显示板默认输入已载入”。点“查看本步默认资料”即可查看内置数据；不必再上传 SchDoc/PcbDoc。
3. 点“整理输入”，等待实际模型与工具处理完，再确认并继续。第二步正常执行不应撤销第一步确认。
4. 后续真实缺项会列在“本步待确认项”，每项提供对应页面入口。例如规格书在“器件与规格书 → 规格书 → 添加规格书”上传并绑定器件。默认包没有的规格书不会被标为已提供；可以明确选择“带待确认项继续草稿”。

## 本次变化

- 核对页面与后台版本；版本不一致时明确提示重新加载，不把它说成资料缺项。
- 确认响应缺少项目状态时，重新读取已保存状态；没有确认成功的证据仍不会跳步。
- 确认异常提供重新读取、查看操作记录、下载问题记录入口。
- 默认资料入口和具体补充位置直接显示在当前工作区，三栏布局保持不变。

本机已实际观察到“已安装 0.3.2、运行后台仍为 0.3.1”。这不等于已确认内网每次第一步失效的具体原因。更新并正常重开后如果仍出现，请在当前页下载问题记录，或到“操作记录”导出记录；不需要查找内部工作目录。

升级包：[EDA Flow 0.3.3 Release](https://github.com/HlinForest/dsh-plugins/releases/tag/eda-flow-v0.3.3)。ZIP 包含相同的更新与检查脚本；解压后在包目录执行上述安装命令。首次安装仍可用完整 0.3.1 离线包，再升级。
