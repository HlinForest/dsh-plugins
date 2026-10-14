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
export function InputGuide({ project, stage, onFiles, onUpload }) {
  const files = inputFiles(project, stage);
  return <section className="input-guide" aria-label="本步输入来源">
    <div><strong>{project.template ? '显示板默认输入已载入' : '本步由工程师提供输入'}</strong>
      <p>{project.template
        ? stage === 1 ? '需求与约束已预填，核对后可直接确认；本步不需要模型，也不用上传原工程。'
          : `本步关联 ${files.length} 份默认资料。${stage === 2 ? '点击“整理输入”，完成后确认并继续。无需重新上传 SchDoc/PcbDoc。' : '可查看默认资料，按需添加补充文件。'}`
        : stage === 1 ? '在下方填写需求、约束与验收要求；文件资料可在第二步添加。' : '使用“补充本步资料”添加文件，文字要求填写在本步表单中。'}</p>
    </div>
    <div className="input-guide-actions">{project.template && <button className="text-link" onClick={onFiles}>查看本步默认资料</button>}{stage > 1 && <button className="text-link" onClick={onUpload}>补充本步资料</button>}</div>
  </section>;
}
export function PendingItems({ state, stage, onLocate }) {
  const items = [...(state.gaps || []), ...(state.assumptions || [])];
  if (!items.length) return null;
  return <section className="pending-items" aria-label="本步待确认项">
    <h3>本步待确认项 · {items.length}</h3>
    <p className="page-help">逐项核对或补充；暂不补充时，可在底部选择“带待确认项继续草稿”。</p>
    <ul>{items.map((text, index) => { const target = issueTarget(text, stage); return <li key={index}><span>{text}</span><button className="text-link" onClick={() => onLocate(target)}>{target.label}</button></li>; })}</ul>
  </section>;
}
