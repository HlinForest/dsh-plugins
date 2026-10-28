# 第三方组件与数据

ELK.js 0.12.0：原包 license 声明 EPL-2.0 OR GPL-3.0-or-later，随包保留上游文件。来源 https://github.com/kieler/elkjs 。算法说明 https://eclipse.dev/elk/documentation.html 。未修改算法库。

KiCad 社区原生符号与封装：本机 KiCad10 标准库。设计块示例使用 Device:R、Device:C、Connector_Generic 等数据。许可为 CC-BY-SA 4.0 及 KiCad 的设计文件例外，参见 https://www.kicad.org/libraries/license/ 。资源集合再分发按上游许可保留归属；附 LICENSE-KICAD-LIBRARIES.md。生成电路与使用库资料的许可边界参见官方原文。

PyMuPDF 在外部 Python 环境调用，不包含于本 tgz。部署方需按其上游 AGPL/商业授权选择适合的许可。它不是MIT组件；本插件MIT声明不覆盖任何第三方代码或数据。

既有 Harness 消息辅助代码保留 src/harness-messages.LICENSE.txt；其余依赖保留包内许可证。显示板原工程资料沿用既有来源与内部使用范围。
