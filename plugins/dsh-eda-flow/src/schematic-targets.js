import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {within,hash,tree,readJSON} from './io.js';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function schematicTargets(flow,p,stage,imagePath,signal){
 if(![4,5].includes(Number(stage)))throw Error('只有已生成的原理图支持器件点选。');
 const s=flow.stage(p,stage);
 if(s.status!=='done'||!s.output||!s.outputHash)throw Error('图纸已更新或尚未生成，请刷新后选择器件。');
 const files=s.files||[];
 const image=files.find(f=>f.path===imagePath&&f.path.endsWith('.svg'));
 const imageDirectory=image&&path.posix.dirname(image.path);
 const schematicDirectory=path.posix.basename(imageDirectory||'')==='svg'?path.posix.dirname(imageDirectory):imageDirectory;
 const nativePath=image&&path.posix.join(schematicDirectory,path.posix.basename(image.path,'.svg')+'.kicad_sch');
 const sch=files.find(f=>f.path===nativePath);
 if(!sch||!image||path.basename(sch.path,'.kicad_sch')!==path.basename(image.path,'.svg'))throw Error('这张图纸暂不支持器件点选，请使用文字评审。');
 if(hash(await tree(s.output))!==s.outputHash)throw Error('图纸文件已变化，请重新生成或刷新后再评审。');
 const temporaryRoot=flow.config?.workDirectory?path.join(flow.config.workDirectory,'.selection-tmp'):os.tmpdir();
 await fs.mkdir(temporaryRoot,{recursive:true});
 const directory=await fs.mkdtemp(path.join(temporaryRoot,'eda-selection-'));
 try{
  const result=path.join(directory,'targets.json');
  await flow.runProcess([path.join(root,'python/schematic_targets.py'),await within(s.output,sch.path),await within(s.output,image.path),result],directory,signal);
  if(hash(await tree(s.output))!==s.outputHash)throw Error('读取期间图纸已变化，请刷新后重试。');
  const map=await readJSON(result);
  return {...map,sourceStage:s.id,sourceOutputHash:s.outputHash,imagePath:image.path,schematicFile:sch.path};
 }finally{if(path.dirname(path.resolve(directory))!==path.resolve(temporaryRoot)||!path.basename(directory).startsWith('eda-selection-'))throw Error('Temporary selection directory mismatch');await fs.rm(directory,{recursive:true,force:true});}
}
export async function reviewSelection(flow,p,selection){
 if(!selection)return null;
 if(!Array.isArray(selection.refs)||!selection.refs.length||selection.refs.length>100||selection.refs.some(r=>typeof r!=='string'))throw Error('请选择有效器件。');
 const s=flow.stage(p,Number(selection.sourceStage));
 if(s.outputHash!==selection.sourceOutputHash)throw Error('所选器件对应的图纸已变化，请重新选择。');
 const map=await schematicTargets(flow,p,s.id,selection.imagePath);
 const refs=[...new Set(selection.refs)];
 if(refs.some(ref=>!map.targets.some(t=>t.ref===ref)))throw Error('所选器件不在当前图纸中，请重新选择。');
 return {sourceStage:map.sourceStage,sourceOutputHash:map.sourceOutputHash,imagePath:map.imagePath,schematicFile:map.schematicFile,refs,
  components:map.targets.filter(t=>refs.includes(t.ref)).map(({id,ref,value,symbol,unit})=>({id,ref,value,symbol,unit}))};
}
