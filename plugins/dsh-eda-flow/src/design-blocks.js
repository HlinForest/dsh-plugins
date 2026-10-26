import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON } from './io.js';
const root=fileURLToPath(new URL('../libraries/blocks/',import.meta.url));
export const blockTool={name:'design_blocks',description:'读取已打包的原生KiCad子电路、适用条件和验证范围；instantiate按独立前缀生成器件/网络建议，仍须第三步工程师确认。',inputSchema:{type:'object',properties:{action:{enum:['list','read','instantiate']},id:{type:'string'},prefix:{type:'string'},externalNets:{type:'object',additionalProperties:{type:'string'}}},required:['action'],additionalProperties:false}};
export async function designBlocks(args){
  if(!args||Object.keys(args).some(k=>!['action','id','prefix','externalNets'].includes(k)))throw new Error('设计块参数无效。');
  const index=await readJSON(path.join(root,'index.json'));
  if(args.action==='list')return {blocks:index,scope:'工程示例经过静态文件检查，未经厂家或实物认证；不是已批准内部物料。'};
  if(!index.some(x=>x.id===args.id))throw new Error('未知设计块。');
  const block=await readJSON(path.join(root,args.id+'.json'));
  if(args.action==='read')return block;
  if(args.action!=='instantiate'||!/^[A-Za-z][A-Za-z0-9_]{0,20}$/.test(args.prefix||''))throw new Error('实例前缀需为字母开头且不超过21字符。');
  const external=args.externalNets||{};
  if(Object.keys(external).some(k=>!block.interfaces.includes(k))||Object.values(external).some(x=>typeof x!=='string'||!x.trim()))throw new Error('只能绑定已声明接口网络。');
  const bindings=Object.fromEntries(block.design.components.map(c=>[c.ref,args.prefix+'_'+c.ref]));
  const netBindings=Object.fromEntries(block.design.nets.map(n=>[n.name,external[n.name]||args.prefix+'_'+n.name]));
  if(new Set(Object.values(netBindings)).size!==Object.keys(netBindings).length)throw new Error('不能将设计块的不同网络合并。');
  const node=k=>{const at=k.lastIndexOf('.');return bindings[k.slice(0,at)]+k.slice(at);};
  return {components:block.design.components.map(c=>({...c,id:args.prefix+':'+c.id,ref:bindings[c.ref]})),nets:block.design.nets.map(n=>({name:netBindings[n.name],nodes:n.nodes.map(node)})),nc:block.design.nc.map(node),blockInstance:{blockId:block.id,version:block.version,bindings,netBindings},scope:block.validation,limitations:block.limitations};
}
