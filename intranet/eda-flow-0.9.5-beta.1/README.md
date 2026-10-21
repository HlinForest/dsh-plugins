# 0.9.5-beta.1：从仓库下载内网安装包

这里存放完整安装包的普通 Git 分卷，不使用 Git LFS，不需要访问 Release。内容与已发布的 0.9.5-beta.1 离线安装包完全一致，包括插件、Python 离线依赖、独立窗口运行时和七步演示回放。

## 首次获取（只取本安装包目录）

在 PowerShell 中执行：

```powershell
git clone --depth 1 --single-branch --branch trial/eda-flow-0.9.5-beta.1 --filter=blob:none --sparse https://github.com/HlinForest/dsh-plugins.git dsh-eda-trial
cd dsh-eda-trial
git sparse-checkout set intranet/eda-flow-0.9.5-beta.1
powershell -NoProfile -ExecutionPolicy Bypass -File .\intranet\eda-flow-0.9.5-beta.1\prepare.ps1
```

合并脚本先校验每个分卷，再校验完整 ZIP，然后解压到 `intranet/eda-flow-0.9.5-beta.1/prepared/install`。生成目录已被 Git 忽略。如该目录已存在，可传 `-Destination "D:\EDA095-Install"` 指定一个新的输出目录。

## 已有本测试分支的仓库

```powershell
git pull --ff-only origin trial/eda-flow-0.9.5-beta.1
# 如果使用了 sparse checkout，再加入安装包目录：
git sparse-checkout add intranet/eda-flow-0.9.5-beta.1
powershell -NoProfile -ExecutionPolicy Bypass -File .\intranet\eda-flow-0.9.5-beta.1\prepare.ps1
```

其他分支的工作目录请使用上面的独立克隆命令，避免混入已有改动。

## 安装

进入解压后的 `install` 目录，按其中的 README.md 执行首次安装或更新。目标机需已安装 Harness、Node 和 KiCad；更新保留已有项目、工作目录和模型设置。排版依赖使用独立 Python 环境。

同事之间也可直接复制整个本目录，再执行 prepare.ps1，无需 GitHub 访问权限或 Release 下载。
