// Model-authored presentation intent travels with the reviewed design. It may
// associate an existing passive with a load, but cannot add pins, nets or XY.
export const layoutIntentInstructions = `在步骤3形成电路时一并确定去耦器件服务的负载，在对应functions项增加layout数组：[{kind:"decoupling",anchor:{ref:"<负载位号>",pinName:"<供电脚精确名称>"},return:{ref:"<同一负载位号>",pinName:"<返回脚精确名称>"},members:["<去耦器件位号>"]}]。anchor和return也可使用已核对的数字端点字符串。它表达设计归属，不是坐标，也不新增或改写连接。每个member必须是连接在这两个不同网络之间的两端无源器件，只能声明一次；负载和返回端必须属于同一器件。请根据本次应用依据和自己提出的电路选择声明，不从共用电源网臆测唯一归属，不要求用户填写这些字段。声明为 decoupling 的电容必须有明确负载归属；若只是全局储能而非局部去耦，应选择 other 并说明用途，不要乱归属。步骤4根据这些归属、真实引脚方向和信号流组织局部短线；远端功能模块可以独立成组，用同名标签互连。`;

export function validateLayoutIntent(design) {
  const errors=[],components=new Map((design.components||[]).filter(Boolean).map(c=>[c.ref,c]));
  const pinRef=new Map(),netOf=new Map(),claimed=new Set();
  for(const c of components.values())for(const pin of c.pins||[])if(pin)pinRef.set(`${c.ref}.${pin.number}`,c.ref);
  for(const n of design.nets||[])for(const p of n?.nodes||[])netOf.set(p,n.name);
  const allowed=new Set(['kind','anchor','return','members']);
  for(const fn of design.functions||[]) {
    if(!fn||fn.layout===undefined)continue;
    if(!Array.isArray(fn.layout)){errors.push('布局归属 layout 必须是数组。');continue;}
    for(const relation of fn.layout) {
      if(!relation||Array.isArray(relation)||typeof relation!=='object'||Object.keys(relation).some(k=>!allowed.has(k))||relation.kind!=='decoupling'||!Array.isArray(relation.members)||!relation.members.length) {
        errors.push('布局归属仅接受 decoupling、anchor、return 和非空 members；不接受坐标。');continue;
      }
      const owner=pinRef.get(relation.anchor),returnOwner=pinRef.get(relation.return);
      const supply=netOf.get(relation.anchor),ground=netOf.get(relation.return);
      if(!owner||owner!==returnOwner||!supply||!ground||supply===ground) {
        errors.push('布局归属 anchor 与 return 必须是同一负载的有效引脚，并位于两个不同的已连接网络。');continue;
      }
      for(const ref of relation.members) {
        const member=components.get(ref),pins=member?.pins||[];
        if(typeof ref!=='string'||!member||ref===owner||pins.length!==2||pins.some(p=>p?.type!=='passive')) {
          errors.push(`布局归属 ${String(ref)} 必须是已有的两端无源器件，不能是负载自身。`);continue;
        }
        if(claimed.has(ref))errors.push(`布局归属 ${ref} 重复；一个器件只能声明一个归属。`);
        claimed.add(ref);
        const nets=new Set(pins.map(p=>netOf.get(`${ref}.${p.number}`)));
        if(nets.size!==2||!nets.has(supply)||!nets.has(ground))errors.push(`布局归属 ${ref} 的两端必须跨接 anchor 和 return 的实际网络。`);
      }
    }
  }
  return errors;
}
