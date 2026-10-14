# 独立桌面窗口

默认 1280 × 850，40px 标题栏与页面顶栏统一使用 `#f9fafb`。使用原生系统按钮；窗口可拖动，重复打开复用当前实例。独立进程和数据目录不影响 Harness 聊天。

插件包携带 `desktop` 入口和图标，Electron 二进制单独部署在插件工作目录，避免修改宿主依赖。当前固定 Electron 44.7.2、Windows x64。

有网络的电脑，在插件目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop-runtime.ps1 -WorkDirectory 'D:\EDA\eda-flow' -Download
```

内网电脑从获准来源复制完整的 Electron 44.7.2 Windows x64 解压目录（包含 EXE、DLL、resources、locales 及许可文件），执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop-runtime.ps1 -WorkDirectory 'D:\EDA\eda-flow' -RuntimeSource 'E:\electron-44.7.2-win32-x64'
```

工作目录与插件配置的 `workDirectory` 保持一致。运行时下载与复制不调用模型。迁移时关闭旧设计窗口，再点击 Harness 的电路设计图标即可；不需要重启 Harness 后台。

未部署 Electron 时启动器保留 Edge 回退；Edge 自绘标题栏不能仅靠页面底色做到同样外观。要获得本版标题栏，需要部署桌面运行时。

运行配置保存在 `design-window-desktop`，与工程数据分离。`window-state.json` 记录进程、标题栏和启动状态；启动失败可查看 `window-error.log`。`design-window-session.json` 是本机连接凭据，不纳入交付或公开日志。

Electron 和 Chromium 的许可证随完整运行时保留。窗口实现依据 [Electron 自定义标题栏文档](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)，预加载脚本只暴露标题栏尺寸，不向页面开放 Node。
