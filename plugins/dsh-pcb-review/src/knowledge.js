import { KINDS, enumeration, string } from './validation.js';

export const sources = {
  adc: { title: 'ST AN2834 Rev 10：ADC accuracy', url: 'https://www.st.com/resource/en/application_note/cd00211314-getting-started-with-adc-values-conversion-stmicroelectronics.pdf', location: '3.2.7–3.2.8、4.2.3、4.2.6、4.2.13–4.2.14' },
  power: { title: 'TI AN-1149：Layout Guidelines for Switching Power Supplies', url: 'https://www.ti.com/lit/an/snva021c/snva021c.pdf', location: 'Layout guidelines' },
  isolation: { title: 'TI SLLA284：Digital Isolator Design Guide', url: 'https://www.ti.com/lit/an/slla284b/slla284b.pdf', location: 'PCB layout / creepage and clearance；按下载版本复核' },
};
// These are review prompts, not part-specific datasheet constraints or certified standards.
const guidance = {
  mcu: [
    ['原理图', '逐个电源域检查去耦、复位、启动脚、调试接口及输入电平容限。', 'VDD/VDDA/VSS、RESET、BOOT、SWD/JTAG；按准确型号与封装核对。'],
    ['走线', '模拟输入按带宽、源阻抗和采样时间评估 RC；数字输入核验边沿，不自动添加并联电容。', '输入引脚及其前级网络。', 'adc'],
    ['布局', '检查去耦到电源脚的连接与回流、晶振回路及模拟区邻近噪声源。', '电源焊盘、地过孔、晶振和 ADC 区域。', 'adc'],
  ],
  adc: [
    ['原理图', '核验输入共模、参考电压、驱动源阻抗、RC 截止频率与采样建立时间。', 'AIN、VREF、模拟电源和驱动放大器。', 'adc'],
    ['布局', '检查参考电压与去耦回路，模拟输入远离开关节点并保持连续回流。', '参考焊盘、输入走线和参考平面。', 'adc'],
  ],
  regulator: [
    ['布局', '核对输入旁路与开关电流回路；具体拓扑决定哪些回路具有高 di/dt。', '输入电容、开关管、整流器件和功率地。', 'power'],
    ['走线', '反馈采样避开 SW 节点，控制 SW 铜皮与敏感信号耦合。', 'FB、SW、电感及反馈分压。', 'power'],
    ['工艺', '根据器件热焊盘建议和装配能力复核散热铜、过孔、钢网与焊接。', '散热焊盘和功率器件封装。'],
  ],
  mosfet: [
    ['走线', '检查栅极驱动回路、栅极电阻与源极回流；按器件与驱动器资料评估 Kelvin 连接。', 'G/S 驱动路径和大电流 D/S 路径。'],
    ['工艺', '核对封装引脚、额定工况、散热焊盘和回流焊要求。', 'G/D/S 焊盘与底部散热区。'],
  ],
  isolator: [
    ['安规', '识别隔离边界及两侧电位；按适用标准、绝缘等级、电压、污染等级、材料与海拔确定间距。', '隔离器两侧焊盘、铜皮、过孔和板槽。', 'isolation'],
    ['走线', '检查隔离边界跨越物，包括各铜层与非隔离器件；两侧分别去耦。', '隔离带所有层、隔离电源和信号回路。', 'isolation'],
  ],
  crystal: [
    ['布局', '按 MCU 与晶体资料确定负载电容；检查寄生、回路长度与附近噪声。', 'OSC 引脚、晶体与负载电容。'],
    ['工艺', '核对晶体封装焊盘、外壳接地要求及禁布区。', '晶体底部和周边。'],
  ],
  connector: [
    ['原理图', '核验针脚观察方向、电源极性、信号电平和连接器/线束版本。', '连接器针号和线束两端。'],
    ['走线', '按端口环境评估 ESD/浪涌防护，检查保护器件位置与泄放路径。', '外部接口到保护器件、地和内部电路的路径。'],
    ['工艺', '核对插拔方向、定位与固定、线束弯曲空间及板边距离。', '板边、连接器本体和结构件。'],
  ],
  capacitor: [
    ['原理图', '区分去耦、滤波、储能与安规用途；复核容值、偏压、额定电压、极性及纹波。', '电容两端网络和器件规格书。'],
    ['布局', '按功能检查与目标引脚的连接和回流路径，不能只看器件中心距离。', '电容焊盘、目标引脚和地连接。'],
  ],
  resistor: [['工艺', '核对功率、工作电压、脉冲负荷、封装与爬电要求；高压串联网络逐段复核。', '电阻焊盘和邻近导体。']],
  diode: [['原理图', '区分整流、续流、TVS 等用途；核对极性、反向电压、电流及瞬态能力。', 'A/K 焊盘、保护或续流回路。']],
  opamp: [['走线', '核对反馈回路、输入共模、输出摆幅和容性负载稳定性；高阻节点避免漏电与噪声耦合。', '输入、反馈、输出及去耦网络。']],
  generic: [['资料', '提供准确料号、封装和用途后核对原厂 datasheet 与 reference layout。', '器件本体、引脚定义与应用电路。']],
};

export function componentGuide(query, kind) {
  string(query, 'query', 500);
  let inferred = false;
  if (kind === undefined) {
    const pairs = [
      ['mcu', /单片机|\bMCU\b|STM32|GD32|ESP32/i], ['adc', /\bADC\b|模数/i],
      ['isolator', /隔离|光耦|ISO77|ADUM/i], ['mosfet', /MOSFET|MOS管/i],
      ['regulator', /DCDC|DC.DC|LDO|稳压|电源芯片/i], ['crystal', /晶振|晶体|crystal/i],
      ['connector', /连接器|接插件|connector/i], ['capacitor', /电容|capacitor/i],
      ['resistor', /电阻|resistor/i], ['diode', /二极管|TVS|diode/i], ['opamp', /运放|op.?amp/i],
    ];
    kind = pairs.find(([, re]) => re.test(query))?.[0] ?? 'generic';
    inferred = kind !== 'generic';
  }
  enumeration(kind, KINDS, 'kind');
  const checks = guidance[kind].map(([category, check, location, source]) => ({ category, check, location,
    status: 'checklist_only', basis: source ? sources[source] : { title: '通用工程检查清单；需补充该型号 datasheet / 企业规范' } }));
  checks.push(
    { category: '安规', status: 'checklist_only', location: '器件所在电压域及相邻导体', check: '先确认是否涉及隔离或危险电压；未提供适用标准和工况时，不给出统一毫米限值。', basis: sources.isolation },
    { category: '工艺', status: 'checklist_only', location: '焊盘、阻焊、钢网、装配面和周边空间', check: '按板厂与贴装厂能力核对封装库、阻焊桥、焊接空间、DNP、返修和测试点。', basis: { title: '待提供供应商工艺能力与封装原件' } },
  );
  return { query, kind, classification: inferred ? '按名称推测类别，需确认' : kind === 'generic' ? '型号未识别' : '调用者指定类别',
    exactPartVerified: false, checks, requiredInputs: ['准确料号与封装', 'datasheet 版本', '实际网络与装配变体', '适用安规与企业检查表', '板厂/装配厂工艺约束'],
    note: '这是需检查的位置与问题清单，不代表已检测 PCB，也没有验证具体型号参数。' };
}
