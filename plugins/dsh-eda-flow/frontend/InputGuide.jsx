import React from 'react';
import { inputGroups } from '../src/contracts.js';

export function inputFiles(project, stage) {
  return (project.inputCatalog || []).filter(file => inputGroups[stage]?.some(group => file.path.startsWith(group + '/')));
}
export function issueTarget(text, stage) {
  if (/规格书|datasheet|PDF.*器件/i.test(text)) return { stage: 3, tab: 1, label: '器件与规格书 → 规格书' };
  if (/铜层|金属化|板层|板框|制造规则/.test(text)) return { stage: 6, tab: 0, label: 'PCB → 板框与层叠' };
  if (/ERC/.test(text)) return { stage: 4, tab: 2, label: '原理图 → 检查' };
  if (/DRC/.test(text)) return { stage: 6, tab: 2, label: 'PCB → 预览与检查' };
  if (/原 Altium|原始页面|原始资料|TSD|编译网表/.test(text)) return { stage: 2, tab: 0, upload: true, label: '资料与提取 → 添加资料' };
  return { stage, tab: 0, upload: true, label: '补充本步资料' };
}
const guides = {
  1: { defaults: '需求、原工程约束与显示板验收目标已预填。', blank: '填写功能、供电、接口、尺寸、铜层、封装与验收目标。',
    action: '核对三个页签 → 点击底部“确认并继续”。本步不用模型。', supplement: '修改“需求目标 / 工程约束 / 验收要求”中的对应字段；未定制造事项留待 PCB 阶段确认。' },
  2: { defaults: '已载入器件、连接、PCB 和依赖的提取数据。下方 AD 名称仅为来源记录，无需勾选或重新上传。', blank: '添加需求文档、接口表或已有资料；没有 AD 工程和参考电路也可以开始。',
    action: '点击底部“整理输入” → 等待处理完成 → 核对“提取数据 / 资料关联” → “确认并继续”。', supplement: '文字依据填在“资料关联”；新文件点“添加资料”。若资料校验失败，先点“检查资料读取”。', target: { stage: 2, tab: 0, upload: true, label: '添加资料' } },
  3: { defaults: '器件、引脚与原始属性已载入；厂家规格书 PDF 尚未提供。', blank: '提供准确型号、位号、封装与装配状态，并上传对应厂家的规格书 PDF。',
    action: '点击“读取并核对” → 检查“参数复核”中的来源与缺项 → 确认继续。', supplement: '在“规格书 → 添加规格书”上传 PDF，绑定型号或位号。演示暂不补齐时，可选择“带待确认项继续草稿”。', target: { stage: 3, tab: 1, upload: true, label: '添加并绑定规格书' } },
  4: { defaults: '完整连接、符号、参数和页面坐标已载入。', blank: '提供功能分块、电源和接口、逐引脚连接、NC 与布局要求；可先向 AI 助手咨询并复核建议。',
    action: '点击“生成原理图” → 查看“图纸”和“检查” → 确认继续。', supplement: '连接与调整写入“连接与参数”的补充栏；连接表等文件点“补充本步资料”。ERC 问题在“检查”页复核。', target: { stage: 4, tab: 0, label: '填写连接与参数' } },
  5: { defaults: '已有物料属性、封装几何与引脚映射。', blank: '提供型号、企业料号、DNP、封装尺寸及焊盘与引脚对应关系。',
    action: '点击“生成并核对” → 查看“物料表 / 封装映射 / 检查” → 确认继续。', supplement: '采购和装配要求填在“物料表”的补充栏；料号表和封装图纸可通过“补充本步资料”上传。缺采购属性时 BOM 保留草稿。', target: { stage: 5, tab: 0, label: '补充物料要求' } },
  6: { defaults: '板框、布局、走线、铜区和可用模型已载入。制造铜层数、孔金属化仍需工程师确认。', blank: '提供板框、孔位、禁布区、铜层、线宽间距、布局约束与模型。',
    action: '点击“生成 PCB” → 查看正反面、3D 和检查结果 → 确认继续。', supplement: '在“板框与层叠”填写制造铜层与孔金属化；修改布局要求用“布局布线”，机械图和模型可上传。', target: { stage: 6, tab: 0, label: '确认板层与制造要求' } },
  7: { defaults: '按显示板基准比较本次生成结果，汇总前面各步的缺项。', blank: '核对验收标准，填写工程师评审意见，处理各步骤遗留问题。',
    action: '点击“运行核验” → 查看“差异与待办” → “确认交付” → 在“交付文件”下载工程。需要复现验证时再点“空目录重放”。', supplement: '在“差异与待办”逐项定位原步骤补充，并重新执行受影响步骤。带缺项交付会记录为草稿。', target: { stage: 7, tab: 1, label: '查看差异与待办' } },
};
export function InputGuide({ project, stage, onFiles, onUpload, onLocate }) {
  const files = inputFiles(project, stage);
  const guide = guides[stage];
  return <section className="input-guide" aria-label="本步输入来源">
    <div><strong>{project.template ? '显示板默认输入已载入' : '本步由工程师提供输入'}</strong>
      <p>{project.template ? guide.defaults : guide.blank}</p>
      <p><b>本步操作</b> {guide.action}</p>
      <details><summary>需要补什么、在哪里补</summary><p>{guide.supplement}</p>{guide.target && <button className="text-link" onClick={() => onLocate(guide.target)}>{guide.target.label}</button>}</details>
    </div>
    <div className="input-guide-actions">{project.template && <><button className="text-link" onClick={onFiles}>查看本步默认资料</button><span className="muted">{files.length} 份关联资料</span></>}{stage > 1 && <button className="text-link" onClick={onUpload}>补充本步资料</button>}</div>
  </section>;
}
export function PendingItems({ state, stage, onLocate, textMode = false }) {
  const items = [...(state.gaps || []), ...(state.assumptions || [])];
  if (!items.length) return null;
  return <section className="pending-items" aria-label="本步待确认项">
    <h3>本步待确认项 · {items.length}</h3>
    <p className="page-help">{state.status === 'done' ? '逐项核对或补充；暂不补充时，可在底部选择“带待确认项继续草稿”。' : '点击对应入口补充文字，保存后再执行本步；待补问题不会自动记为完成。'}</p>
    <ul>{items.map((text, index) => { const legacyTarget = issueTarget(text, stage); const target = textMode ? (/规格书|datasheet|PDF.*器件/i.test(text) ? { stage: 3, tab: 1, field: 'datasheetText', label: '补充规格书正文' } : /ERC/.test(text) ? { stage: 4, tab: 2, label: '查看实际 ERC' } : { stage, tab: 0, field: 'stageNotes', label: '补充文字要求' }) : legacyTarget; return <li key={index}><span>{text}</span><button className="text-link" onClick={() => onLocate(target)}>{target.label}</button></li>; })}</ul>
  </section>;
}
