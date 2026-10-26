import path from 'node:path';
import {hash, readJSON, within} from './io.js';

// Recover this project's last model proposal, including a failed-review draft.
// It is never a finish token and must pass today's complete review again.
export function designContext(request) {
  return hash(Object.fromEntries(['inputs','requirements','attachments','applicationGuidance','fixedParts','resolvedAnswers']
    .map(key=>[key,request[key]??null])));
}

export async function recoverReviewedCandidate(projectDirectory, previousOutput, request) {
  if (!previousOutput) return null;
  const parent=path.resolve(projectDirectory,'steps','3'), previous=path.resolve(previousOutput);
  if (path.dirname(previous)!==parent) return null;
  try {
    await within(parent,previous);
    const before=await readJSON(path.join(previous,'text-input.json'));
    if (designContext(before)!==designContext(request)) return null;
    const draft=await readJSON(path.join(previous,'last-candidate-draft.json')).catch(()=>null);
    if(draft){
      if(draft.context!==designContext(request)||draft.sha256!==hash(draft.design))return null;
      return {design:draft.design,sourceOutput:previous,previouslyReviewed:draft.reviewed===true};
    }
    const saved=await readJSON(path.join(previous,'last-reviewed-candidate.json')).catch(()=>null);
    if (saved) {
      if (saved.context!==designContext(request)||saved.sha256!==hash(saved.design)) return null;
      return {design:saved.design,sourceOutput:previous};
    }
    // Backward compatible recovery of an unchanged pre-checkpoint execution.
    // The actual tool arguments contain the model proposal, not an AD reference.
    const records=await readJSON(path.join(previous,'tool-log.json'));
    const last=records.filter(row=>row.name==='design_review'&&row.ok&&row.result?.valid===true&&row.arguments?.design).at(-1);
    if(last)return {design:last.arguments.design,sourceOutput:previous};
    const resumed=records.filter(row=>row.name==='design_resume'&&row.ok&&row.result?.valid===false&&row.result?.design).at(-1);
    return resumed?{design:resumed.result.design,sourceOutput:previous,previouslyReviewed:false}:null;
  } catch { return null; }
}

export const designResumeTool={name:'design_resume',description:'重新审查本项目上次模型候选，包含未通过检查的草稿。只在当前输入、PDF和已确认提取结果未变化时提供。重新执行全部资料、网络和本机库检查，成功返回reviewedDesignId；失败返回候选和错误，使用本次candidateId经design_amend局部修改或design_review完整重提。不会自动确认或冻结。',
  inputSchema:{type:'object',properties:{},additionalProperties:false}};
