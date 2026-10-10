# AD 25 / 26 接入与验收记录

状态：**待真实软件验收**。用户于 2026-10-10 确认目前没有可接入的 AD 环境。本机离线测试不能替代此项。

## 已实现的离线路径

固定使用 altium-monkey `aa9e39c3be9aeba8f11eb7cb9773e42dfafd37b9`（2026.9.22）。读取 SchDoc、PrjPcb、PcbDoc，保留文档和原生对象身份，导出原图及候选预览。原理图支持属性、移动、旋转、删除、导线、连接点、网络标注及从明确 SchLib 添加器件。每次编辑后保存、重新读取，并核对修改范围外带身份记录的内容。移动使用引脚外侧电气连接点，而不是符号体端点。

这些是本项目适配器的离线能力，不是 AD 官方验证结果。离线库的 AGPL-3.0-or-later 许可保留在工具安装目录中。工作台自有代码的 MIT 许可不覆盖该依赖。

## 软件内桥接的验收准备

`bridge/WorkbenchBridge.PrjScr` 是待验收的 DelphiScript 工程。保存原理图后运行 `ExportCurrentSchematic`，导出当前页原生器件身份、位号、属性及坐标。它明确写入 `nativeValidation: not_performed`，不把脚本成功运行当成 ERC/DRC 成功。

参考：[官方脚本入口](https://www.altium.com/documentation/altium-designer/scripting)、[对象接口参考](https://www.altium.com/documentation/altium-dxp-developer/schematic-api-design-objects-interfaces-reference)、[原生 DRC 报告](https://www.altium.com/documentation/altium-designer/pcb/drc/setting-up-running)。旧接口参考不证明 AD 25/26 的运行兼容性。

## 必须由真实 AD 补齐的验收

| 项目 | AD 25 | AD 26 |
| --- | --- | --- |
| 桥接脚本加载、逐页原生对象导出 | 未执行 | 未执行 |
| 原生工程打开、库关联和未知记录保持 | 未执行 | 未执行 |
| 候选属性、移动、旋转、增删、导线和标注 | 未执行 | 未执行 |
| 多页、重复层级、装配变体 | 未执行 | 未执行 |
| 修改包在软件内应用、撤销重做 | 未实现 / 待验收 | 未实现 / 待验收 |
| 候选版本绑定的原生编译 / ERC / DRC 回执 | 未接通 | 未接通 |
| 原生结果导入和源工程覆盖 | 禁用 | 禁用 |

取得环境后，需在工程副本上验证脚本 API；补全软件内修改包执行器及原生结果采集，收集每个候选文件的 SHA-256、AD 完整版本、检查选项、规则覆盖范围、报告原件及错误数量。DRC 设置不能因达到最大报告条数而截断却仍宣称全部检查完成。

原生检查成功、候选哈希一致且全部验收通过之前，工作台保持“原生验证未执行”，不允许覆盖 AD 源文件。
