import fs from 'node:fs/promises';
import path from 'node:path';
import {reviewRoutingQuality} from '../src/routing-quality.js';
const project=process.argv[2];
const audit=JSON.parse(await fs.readFile(path.join(project,'audit.json'),'utf8'));
const result=await reviewRoutingQuality({project,audit,layout:audit.effectiveLayout});
console.log(JSON.stringify({status:result.status,findings:result.findings,wire:result.metrics.wire}));
