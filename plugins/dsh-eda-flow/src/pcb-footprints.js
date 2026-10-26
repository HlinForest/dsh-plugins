// Import physical geometry from current, visible source tables. The model
// selects evidence; it cannot supply pad coordinates or silently round them.
import {hash} from './io.js';
const compact=s=>String(s??'').replace(/\s/g,'');
const number='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const numbers=s=>(String(s).match(new RegExp(number,'g'))||[]).map(Number);
const fail=s=>{throw Error('封装资料：'+s);};
function source(evidence,id){const s=evidence.find(s=>s.id===id);if(!s?.sourceSha256)fail('缺少当前资料来源 '+id);return s;}
function quote(evidence,c){const s=source(evidence,c?.sourceId);if(!c?.quote||!compact(s.content).includes(compact(c.quote)))fail('引用不在当前原文中');return {...c,document:s.document,page:s.page,sourceSha256:s.sourceSha256};}
function tuple(s,n,label){const v=numbers(s);if(v.length!==n||v.some(x=>!Number.isFinite(x)))fail(label+'的数值列不完整');return v;}
const layers={'通孔':['*.Cu','*.Mask'],'F标准贴片':['F.Cu','F.Paste','F.Mask'],'B标准贴片':['B.Cu','B.Paste','B.Mask'],'B铜形':['B.Cu'],'F铜形':['F.Cu']};
export const footprintTool={name:'pcb_import_footprint',description:'从当前 PDF 的焊盘表读取全部行并生成封装；只传来源选择器，不接收自造尺寸或整板坐标。表须有编号、类型/形状、中心(x,y)、宽高/孔径、角度/层五列。返回实际焊盘映射。',inputSchema:{type:'object',properties:{ref:{type:'string'},tableSourceId:{type:'string'},columns:{type:'object',description:'五列的零基索引：number,typeShape,center,sizeDrill,rotationLayer'},conventions:{type:'object',properties:{sourceId:{type:'string'}},required:['sourceId'],additionalProperties:false,description:'单位/坐标/层/圆角约定的完整来源页ID。宿主直接读取原文，不抄写quote。'},envelope:{type:'object',properties:{sourceId:{type:'string'}},required:['sourceId'],additionalProperties:false,description:'含局部边界(x_min,y_min,x_max,y_max)的完整来源页ID；宿主读取，作为占位范围，不是厂家本体尺寸。'},polygons:{type:'array',items:{type:'object'},description:'每个 custom 焊盘提供 {row,sourceId,heading}；row为表的零基行号（表头为0），heading是原文“...；N个顶点”完整标题，宿主读取后续全部点'},sourceKind:{enum:['manufacturer-datasheet','engineering-measurement','user-drawing']}},required:['ref','tableSourceId','columns','conventions','envelope','sourceKind'],additionalProperties:false}};
export function compileFootprint(a,evidence,components){
 const allowed=Object.keys(footprintTool.inputSchema.properties);if(Object.keys(a).some(k=>!allowed.includes(k)))fail('不接受额外几何或布局字段');
 const component=components.find(c=>c.ref===a.ref&&c.on_board!==false);if(!component)fail('未知在板器件 '+a.ref);
 if(component.footprint)fail('已有冻结封装不能在 PCB 步骤替换：'+a.ref);
 if(!['manufacturer-datasheet','engineering-measurement','user-drawing'].includes(a.sourceKind))fail('须声明资料类型');
 const s=source(evidence,a.tableSourceId),rows=s.table?.rows;
 if(!rows||rows.length<2)fail('当前来源不是可读取的完整焊盘表');
 const citation=value=>value?.quote?value:{sourceId:value?.sourceId,quote:source(evidence,value?.sourceId).content};
 const convention=quote(evidence,citation(a.conventions)),envelope=quote(evidence,citation(a.envelope));
 if(convention.sourceSha256!==s.sourceSha256||envelope.sourceSha256!==s.sourceSha256)fail('焊盘表、坐标约定和边界必须来自同一份封装资料');
 if(component.originalFootprint&&!compact(envelope.quote).includes(compact(component.originalFootprint)))fail('边界来源未包含当前器件的原封装标识');
 if(!/单位[:：]\s*mm/.test(convention.quote)||!convention.quote.includes('顶面')||!compact(convention.quote).includes('X向右、Y向下'))fail('需要明确 mm 单位及顶面 X向右、Y向下坐标约定');
 const e=compact(envelope.quote).match(new RegExp('(?:局部边界|envelope)[(（]('+number+','+number+','+number+','+number+')[)）]','i'));
 if(!e)fail('缺少局部占位边界');const bounds=tuple(e[1],4,'局部边界');if(bounds[0]>=bounds[2]||bounds[1]>=bounds[3])fail('局部边界反向');
 const keys=['number','typeShape','center','sizeDrill','rotationLayer'],cols=a.columns||{};
 if(Object.keys(cols).length!==5||keys.some(k=>!Number.isInteger(cols[k])||cols[k]<0)||new Set(Object.values(cols)).size!==5)fail('五列映射必须互不重复');
 const selectors=a.polygons||[],used=new Set(),citations=[convention,envelope];
 const pads=rows.slice(1).map((row,index)=>{
  const rowIndex=index+1;if(keys.some(k=>cols[k]>=row.length))fail('表格列缺失');
  let [type,shape]=String(row[cols.typeShape]).split('/').map(s=>compact(s));
  // PDF text extraction can place the underscore after the words.
  if(type==='thruhole'&&shape?.endsWith('_'))shape=shape.slice(0,-1);
  if(type?.replace(/_/g,'')==='thruhole')type='thru_hole';
  if(!['thru_hole','smd'].includes(type)||!['circle','rect','roundrect','custom','oval'].includes(shape))fail('尚不支持的焊盘类型/形状：'+row[cols.typeShape]);
  const n=compact(row[cols.number]),pin=n==='无编号'?'':n;
  if(pin&&!/^[A-Za-z0-9_+-]+$/.test(pin))fail('焊盘编号非法');
  const at=tuple(row[cols.center],2,'焊盘中心'),sd=tuple(row[cols.sizeDrill],4,'宽高与孔径');
  const rl=String(row[cols.rotationLayer]).split('/').map(s=>compact(s));
  const rotation=tuple(rl[0],1,'焊盘角度')[0],layer=layers[rl[1]];
  if(!layer||!compact(convention.quote).includes(rl[1]))fail('层类型缺少原文定义：'+rl[1]);
  if(sd.slice(0,2).some(x=>x<=0)||sd.slice(2).some(x=>x<0)||(type==='thru_hole'&&sd.slice(2).some(x=>x<=0))||(type==='smd'&&sd.slice(2).some(x=>x!==0)))fail('无效孔径或焊盘尺寸');
  if(type==='thru_hole'&&sd.slice(2).some((x,i)=>x>=sd[i]))fail('孔径不能大于或等于焊盘尺寸');
  if(type==='thru_hole'&&rl[1]!=='通孔'||type==='smd'&&rl[1]==='通孔')fail('孔类型与层定义冲突');
  const pad={number:pin,type,shape,at:[...at,rotation],size:sd.slice(0,2),drill:sd.slice(2),layers:layer,sourceRow:rowIndex};
  if(shape==='roundrect'){
   const match=compact(convention.quote).match(new RegExp('圆角比(?:均为|为|=)('+number+')'));if(!match||+match[1]<=0||+match[1]>.5)fail('圆角比未提供');pad.roundrectRatio=+match[1];
  }
  if(shape==='custom'){
   const matches=selectors.filter(x=>x.row===rowIndex);if(matches.length!==1)fail('自定义铜形需唯一的顶点来源，行 '+rowIndex);
   const sel=matches[0],page=source(evidence,sel.sourceId),heading=compact(sel.heading),body=compact(page.content),start=body.indexOf(heading);
   if(page.sourceSha256!==s.sourceSha256)fail('铜形与焊盘表不是同一份资料');
   const owner=heading.match(/编号([A-Za-z0-9_+-]+)铜形/);if(!owner||owner[1]!==pin)fail('铜形标题的编号与对应焊盘不一致');
   const count=heading.match(/(\d+)个顶点$/);if(start<0||!count||body.indexOf(heading,start+1)>=0)fail('铜形标题须唯一且含顶点数');
   const tail=body.slice(start+heading.length),pointRE=new RegExp('^[(（]('+number+')[,，]('+number+')[)）][;；]?');
   let rest=tail;pad.polygon=[];
   for(let i=0;i<+count[1];i++){const m=rest.match(pointRE);if(!m)fail('铜形顶点缺失：'+sel.heading);pad.polygon.push([+m[1],+m[2]]);rest=rest.slice(m[0].length);}
   if(pad.polygon.length<3||pointRE.test(rest))fail('铜形顶点数量不一致');
   used.add(sel);citations.push({sourceId:page.id,document:page.document,page:page.page,sourceSha256:page.sourceSha256,heading:sel.heading,points:pad.polygon.length});
  }
  return pad;
 });
 if(used.size!==selectors.length)fail('存在未使用或重复的铜形来源');
 const actual=[...new Set(pads.map(p=>p.number).filter(Boolean))].sort(),expected=component.pins.map(p=>String(p.pad)).sort();
 if(JSON.stringify(actual)!==JSON.stringify(expected)||component.pins.some(p=>p.pad!==p.number))fail('全部引脚（含NC）与焊盘编号不一一覆盖；不自动猜测换号映射');
 const geometry={pads,envelope:bounds},id='EvidencePkg:FP_'+hash(geometry).slice(0,16);
 return {ref:a.ref,id,geometry,sourceKind:a.sourceKind,citations:[...citations,{sourceId:s.id,document:s.document,page:s.page,sourceSha256:s.sourceSha256,rows:rows.slice(1)}],
  pinMap:component.pins.map(p=>({pin:p.number,name:p.name,pad:p.pad,physicalPads:pads.filter(q=>q.number===p.pad).length})),
  physicalPads:pads.length,auxiliaryPads:pads.filter(p=>!p.number).length,
  limitations:['按所引资料建立局部焊盘；占位边界不是厂家本体公差。','不证明采购型号、实物装配、热设计或制造可行性。']};
}
