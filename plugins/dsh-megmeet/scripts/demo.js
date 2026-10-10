import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { generateReport, loadCatalog, parseRequirements, searchProducts } from '../lib/domain.js';

const text = await readFile(new URL('../examples/requirements.demo.txt', import.meta.url), 'utf8');
const catalog = await loadCatalog('');
const result = searchProducts(catalog, parseRequirements(text));
const report = generateReport(result, '虚构演示：电源需求与产品候选方案');
await mkdir(new URL('../.verification/', import.meta.url), { recursive: true });
await writeFile(new URL('../.verification/demo-report.md', import.meta.url), report.markdown, 'utf8');
console.log(JSON.stringify({ demo: result.demo, evaluated: result.totalEvaluated, candidates: result.candidates.map(c => ({ id: c.productId, status: c.status })), report: '.verification/demo-report.md' }, null, 2));
