# 显示板创建报错：TSD JSON 定位补丁

适用于 0.9.5-beta.1 中的 `Unexpected token '%', "%TSD-Heade"... is not valid JSON`。

已在创建项目的实际调用中复现：已有 project.json、刚保存的 project.json，或 PDF 提取生成的 extraction.json 被当前进程读取为 TSD-Header 格式时，都会触发该错误。仅凭旧提示不能区分是哪一个文件。

这个补丁让提示包含具体文件路径和实际读取进程路径。它不会解密、跳过保护头、删除项目或把无法读取的数据当作有效输入。内网是否恢复创建，取决于相应进程能否获得该文件的正常可读内容。

## 安装

先正常退出整个 Harness。更新仓库后，在仓库根目录执行：

```powershell
git pull --ff-only origin trial/eda-flow-0.9.5-beta.1
powershell -NoProfile -ExecutionPolicy Bypass -File .\intranet\eda-flow-0.9.5-beta.1\tsd-diagnostic\install.ps1 -Profile desktop
```

如果插件安装在其他 profile，请替换 desktop。补丁只替换已核对哈希的 src/io.js，并自动备份；版本、项目数据、模型与登录配置不变。只需下载本目录的 README.md、install.ps1 和 io.js，也可单独运行安装脚本，无需重新下载完整离线包。

重启整个 Harness，再新建显示板演示。把新错误中的“JSON 文件路径”和“当前读取进程”提供给内网 IT，核对该程序在相应目录的合法读取授权；也可以把这两项发回用于继续定位。不要手动删除文件头或把项目文件改写成空 JSON。

补丁同时区分普通损坏 JSON 和 TSD 格式；普通 JSON 内容中提到 TSD-Header 不会误判。文件内容不会显示在错误提示里。
