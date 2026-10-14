# 0.6.0 独立工作台与更新

DSH 只显示工程工作台图标。点击打开独立窗口，再次点击恢复原窗口；关闭保留本次填写内容，后台任务继续。工程进度在窗口右上角。初始大小 1280×850，标题栏高 40px。

模型仍由 Harness 当前选择和登录提供。安装包没有模拟模型；模拟服务仅存在于未打包的测试目录。没有桌面运行时时使用独立网页，网页不绘制原生标题栏。

## 更新已安装版本

先确认使用的 profile 与原来的 workDirectory。下面的工作目录必须填写原值，不要创建新的工程目录代替。运行时来源目录须包含 electron.exe、LICENSE、LICENSES.chromium.html 和 resources/default_app.asar；可从可信离线包提供，不要求安装电路设计插件。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\upgrade-intranet.ps1 -PackagePath .\plugin\dsh-engineering-workbench-0.6.0.tgz -WorkDirectory "D:\原工作目录" -Profile desktop -RuntimeSource "D:\离线运行时\electron"
```

脚本备份旧包、profile 清单和覆盖配置；将 TGZ 哈希加入安装路径以避开同路径缓存。升级保留原 profile 的模型、登录、工程路径和手工配置。已装独立运行时则可省略 RuntimeSource。离线安装沿用现有 pnpm store；需要内网源时附加 `-Registry https://你的内网源`。

源码包中的 `scripts/install-desktop-runtime.ps1` 也可单独安装运行时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-desktop-runtime.ps1 -WorkDirectory "D:\原工作目录" -RuntimeSource "D:\离线运行时\electron"
```

安装脚本不会终止 Harness。已运行的旧后端须通过 Harness 插件重新加载，或在方便时退出并重新打开 Harness。打开新工作台的“执行记录”，末尾应显示 0.6.0 和构建标识。安装文件版本与正在运行的版本必须分开核对。

需要恢复时，先正常退出 Harness，使用备份中 package.json 指向的旧 TGZ 重新执行 `dsh plugin --profile desktop add <旧包路径> --ignore-scripts`，再恢复备份的 cordis.patch.yml。项目数据无需移动或删除。

## 接口和窗口边界

现有 `/api/engineering-workbench/` 业务接口与 `engineering_task` 保持不变；bootstrap 保持 apiVersion=2，新增 version/build。新增 POST open-window、GET page/app.js/styles.css。窗口运行时使用只监听 127.0.0.1 的专用服务和随机 HttpOnly Cookie，仅转发工作台注册的路由；不暴露 Harness 模型设置或其他 API。

窗口会话记录位于 workDirectory/workbench-window-session.json；窗口自己的用户目录为 workbench-window-desktop。它们属于本地运行状态，不应上传到 GitHub。原生进程只有呈现信息桥接，无 Node、文件系统或模型密钥入口。PDF/SVG/报告在使用相同本地会话的预览窗口打开。

## 本机验证

```powershell
npm ci --ignore-scripts
npm run build
npm run check
npm test
node test/browser/serve-ui.mjs "D:\临时测试目录"
```

另一个终端运行 `python test/browser/window-ui.py "D:\临时测试目录"`。原生窗口验证使用 `python test/browser/native-window.py "D:\临时测试目录" "D:\运行时\electron.exe"`。测试服务的模型响应完全来自内存模拟；不加载用户凭据。
