export function parameterChanges(before,after){
 if(!Array.isArray(before?.partParameters)||!Array.isArray(after?.partParameters))return null;
 const a=new Map(before.partParameters.map(c=>[c.ref,c])),b=new Map(after.partParameters.map(c=>[c.ref,c]));
 return [...new Set([...a.keys(),...b.keys()])].flatMap(ref=>{const old=a.get(ref),next=b.get(ref);if(!old||!next)return [{ref,field:'器件',before:old?'存在':'不存在',after:next?'存在':'移除'}];return Object.entries({value:'参数',mpn:'型号',footprint:'封装',dnp:'不装配'}).flatMap(([key,field])=>(old[key]??'')===(next[key]??'')?[]:[{ref,field,before:String(old[key]??''),after:String(next[key]??'')}]);});
}
