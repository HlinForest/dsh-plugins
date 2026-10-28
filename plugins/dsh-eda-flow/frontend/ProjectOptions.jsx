import React from 'react';
import { primaryProjects, advancedProjects } from './projectOptions.js';

export function ProjectOptions({value,onChange}) {
  const choice=([id,title])=><label key={String(id)}><input type="radio" name="template" checked={value===id} onChange={()=>onChange(id)}/><span>{title}</span></label>;
  const advanced=advancedProjects.find(([id])=>id===value);
  return <fieldset className="template-options project-options"><legend>项目类型</legend>
    <div className="primary-projects">{primaryProjects.map(choice)}</div>
    <details className="advanced-projects"><summary>高级选项{advanced ? ` · ${advanced[1]}` : ''}</summary>{advancedProjects.map(choice)}</details>
  </fieldset>;
}
