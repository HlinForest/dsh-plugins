const fs = require('node:fs');
const ELK = require('elkjs/lib/elk.bundled.js');
(async () => {
  const graph = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const result = await new ELK().layout(graph);
  fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
