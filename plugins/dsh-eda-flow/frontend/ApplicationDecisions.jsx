import React from 'react';
import {Table} from './ui.jsx';

const labels={adopt:'采用',adapt:'调整后采用','not-applicable':'不适用',unresolved:'尚未确定'};
export function ApplicationDecisions({review,detail}){
  if(!review?.applicationDecisions?.length)return null;
  const rows=review.applicationDecisions.map(r=>({...r,id:r.guidanceId,
    subject:r.source?.subject,choice:labels[r.action]||r.action,
    selected:r.actualComponents.map(c=>`${c.ref} ${c.value}`).join('；')}));
  return <><h3>资料建议与选型决策</h3>
    <p className="page-help">查看规格书建议如何落实到本次方案，以及调整依据和仍未确定的条件。</p>
    <Table label="资料建议与选型决策" columns={[{key:'subject',title:'资料对象'},{key:'choice',title:'处理方式'},{key:'selected',title:'本次器件'}]} rows={rows}
      onView={r=>detail('资料建议与选型决策',{'资料说明':r.source?.statement,'处理方式':r.choice,'本次器件':r.selected||'尚未选择','依据':r.reason,
        '关联计算':r.operatingPoints.join('、')||'无','未确定项':r.unresolved.join('\n')||'无新增记录','核对范围':'核对资料与方案的对应关系、明确阻容值及数量；额定条件、连接功能与实物性能仍需分别验证。'})}/>
  </>;
}
