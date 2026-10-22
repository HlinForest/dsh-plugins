const fs = require('fs');
const ELK = require('elkjs/lib/elk.bundled.js');
const elk = new ELK();
(async () => {
  const input = JSON.parse(fs.readFileSync(process.argv[2] === '--stdio' ? 0 : process.argv[2], 'utf8'));
  const rows = [];
  // Semantic row membership/order is the explicit target-image presentation policy.
  // ELK packs opaque rectangles; internal geometry is never sent back for layout.
  for (const ids of input.rows) {
    rows.push(await elk.layout({id:'row'+rows.length, layoutOptions:{
      'elk.algorithm':'box', 'elk.box.packingMode':'SIMPLE', 'elk.aspectRatio':'100',
      'elk.spacing.nodeNode':String(input.gap), 'elk.padding':'[top=0,left=0,bottom=0,right=0]'},
      children:ids.map((id,i)=>({...input.blocks.find(b=>b.id===id),layoutOptions:{'elk.priority':String(10-i)}}))}));
  }
  const page = await elk.layout({id:'page',layoutOptions:{'elk.algorithm':'box',
    'elk.box.packingMode':'SIMPLE','elk.aspectRatio':'0.1','elk.spacing.nodeNode':String(input.gap),
    'elk.padding':'[top=0,left=0,bottom=0,right=0]'},
    children:rows.map((r,i)=>({id:r.id,width:r.width,height:r.height,layoutOptions:{'elk.priority':String(10-i)}}))});
  const data=JSON.stringify({version:'0.12.0',rows,page},null,2);
  if(process.argv[2]==='--stdio')process.stdout.write(data);else fs.writeFileSync(process.argv[3],data);
})().catch(e=>{console.error(e);process.exit(1)});
