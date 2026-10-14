# 工程工作台独立窗口运行时

Electron 44.7.2，Windows x64。四个 `runtime.zip.partNN` 为同一 ZIP 按字节切分的普通 Git 文件；逐卷及完整文件校验值在 `manifest.json`。无需 Git LFS。

从仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\assemble-workbench-runtime.ps1
```

脚本在 `downloads/` 合并完整 ZIP，校验每一卷及结果。已有文件的校验值不符时拒绝覆盖。日常更新直接使用 `scripts/update-workbench.ps1` 即可自动完成此步骤。

ZIP 内含独立运行所需的 Electron 文件、LICENSE 和 LICENSES.chromium.html，保留第三方许可证；不包含 Harness 配置、用户 profile 或登录资料。
