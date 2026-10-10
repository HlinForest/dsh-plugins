import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadCatalog, parseRequirements, searchProducts, generateReport } from '../../lib/domain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const facts = await readJSON('materials/mpt-product-facts.json');
const manifest = await readJSON('materials/download-manifest.json');
const originals = (await readJSON('requirements/cases.json')).cases;
const sources = [], products = [];
for (const series of facts.products) {
  const item = manifest.find(s => s.documentPath === series.manual);
  const bytes = await fs.readFile(path.join(root, 'materials', series.manual));
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || createHash('sha256').update(bytes).digest('hex') !== item.sha256.toLowerCase()) throw new Error('PDF integrity mismatch');
  const id = `${series.series}-${series.generation}`;
  sources.push({ id, title: item.title, version: `${series.generation === 'II' ? 'Ⅱ代' : 'Ⅰ代'} / 快照2026-10-09 / SHA ${item.sha256.slice(0,12)}`, location: 'PDF第1页：选型表及主要特点。原文未标独立修订号；官网列示日期2026-08-12。完整SHA-256见下载清单。', url: item.officialPage, file: `materials/${series.manual}` });
  for (const model of series.models) {
    // The MPT35-12V row reads 36.0W, independently checked on the actual scanned page.
    const power = model.model === 'MPT35-12V' ? 36 : model.rated_power_w;
    const highOnly = ['MPT210', 'MPT350'].includes(series.series);
    const inputMin = highOnly || series.series === 'MPT600' ? 180 : 85;
    const inputQuote = highOnly ? '90~132Vac/180~264Vac' : series.series === 'MPT600' ? '180~264Vac' : '85~264Vac（120~370Vdc）';
    const parameters = { input_type: 'AC', input_voltage_v: { min: inputMin, max:264 }, output_type:'DC', output_voltage_v:model.output_voltage_v, output_power_w:power, output_channels:1 };
    const evidence = Object.fromEntries(Object.keys(parameters).map(field => [field, { sourceId:id, quote: field === 'input_type' || field === 'input_voltage_v' ? inputQuote : field === 'output_type' ? 'AC/DC 单组输出' : field === 'output_voltage_v' ? `${model.output_voltage_v}V` : series.series === 'MPT600' ? `${power}W` : `${power.toFixed(1)}W` }]));
    evidence.output_channels = {sourceId:id,quote:'单组输出'};
    if (series.series !== 'MPT600') {
      parameters.cooling = series.series === 'MPT350' ? 'fan' : 'natural';
      evidence.cooling = { sourceId:id, quote:series.series === 'MPT350' ? '风扇散热' : '自然风冷' };
    }
    products.push({ id:model.model, name:model.model, family:'industrial-ac-dc', description:`官方型号，${series.generation}代。此数据视图限定交流输入工况，不用于直流输入判断。${highOnly ? '原文为90–132/180–264Vac两个区间；当前结构仅记录高压档180–264V，不能连成90–264V。' : ''}选型表效率为Typ.${model.efficiency_typical_pct}%，仅典型值，未填入效率保证下限。工作温度含降额条件，未填入无条件满功率温度范围。认证标志不等于已核验证书。${series.series==='MPT600' ? '散热描述与图片需核查，未强行归入自然或风扇冷却。' : ''}第1页选型表${model.model}行。`, parameters, evidence });
  }
}
const catalog = { schemaVersion:1, dataset:'麦格米特官网工业电源：8份原件、28个型号（交流工况）', version:'PUBLIC-SNAPSHOT-2026-10-09', demo:false, sources, products };
await fs.writeFile(path.join(root,'catalog.real.json'), JSON.stringify(catalog,null,2)+'\n');
const loaded = await loadCatalog(path.join(root,'catalog.real.json'));
const yr = originals.find(c=>c.case_id.startsWith('yrcti'));
const bu = originals.find(c=>c.case_id.startsWith('buaa'));
const cr = originals.find(c=>c.case_id.startsWith('crsc'));
const gz = originals.find(c=>c.case_id.startsWith('ccgp'));
const basic = (v,w) => `输入电压：176–264VAC\n输出电压：${v}VDC\n额定功率：不低于${w}W`;
const tests = [
  { id:'YR-24-120', title:'实训系统：24V、至少120W', source:yr.source, scope:'采购文件组件条款', basicRequest:basic(24,120), fullRequest:basic(24,120)+'\n输入频率：50–60Hz\n支持1+1并联冗余；开机软启动；输入输出隔离；短路/过载/过压/超温保护；电源输出状态报警。' },
  { id:'YR-24-240', title:'实训系统：24V、至少240W', source:yr.source, scope:'采购文件组件条款', basicRequest:basic(24,240), fullRequest:basic(24,240)+'\n输入频率：50–60Hz\n开机软启动；输入输出隔离；短路/过载/过压/超温保护；电源输出状态报警。' },
  { id:'YR-48-120', title:'实训系统：48V、至少120W', source:yr.source, scope:'采购文件组件条款', basicRequest:basic(48,120), fullRequest:basic(48,120)+'\n输入频率：50–60Hz\n开机软启动；输入输出隔离；短路/过载/过压/超温保护；电源输出状态报警。' },
  { id:'BUAA-MULTI', title:'北航：12/24/28V多路射频供电', source:bu.source, scope:'整套电源系统，不能用单路产品代替', basicRequest:'输入电压：198–242VAC\n额定功率：不低于3000W', fullRequest:'输入电压：198–242VAC\n输出电压：12V、24V、28V，多路同时输出\n额定功率：不低于3000W\n各路输出功率：12V至少1000W，24V至少500W，28V至少1500W\n效率：>88%\n散热方式：液冷或等效高效散热\n通信协议：RS422或同等工业通信接口\n工作温度：-40–55℃\n纹波、保护、外场连接器、盐雾96小时及环境适应性按公告原文进一步复核。' },
  { id:'CRSC-DUAL', title:'中国通号：24V/20A与12V/6A双路', source:cr.source, scope:'双路电源组件，单路不能宣称满足', basicRequest:'输入电压：176–264VAC\n效率：≥85%', fullRequest:'输入电压：176–264VAC\n输出电压：24V和12V，双路同时输出\n输出电流：24V输出满载20A，12V输出满载6A\n效率：≥85%\n输入频率：47–53Hz\n自然冷却；功率因数≥0.9；输入THD、纹波、续流时间、均流冗余与保护阈值按公告原文复核。' },
  { id:'GZ-24-120', title:'广州实训成交标的：24V/5A/120W', source:gz.source, scope:'成交结果，仅证明成交电气规格，不能等同完整招标条件', basicRequest:'输出电压：24VDC\n额定功率：120W', fullRequest:'输出电压：24VDC\n额定功率：120W\n输出电流：5A\n原成交标的是Mwish NDR-120-24；安装接口、输入范围、保护及替换兼容性待采购方确认。' },
];
const clarification = '上述basicRequest/fullRequest是从实际条款整理的测试输入，不是采购方新发布的需求；CRSC输入范围176–264V由220×(1±20%)计算。GZ保留120W等值，仅作成交规格筛查，不擅改为最低功率。来源频率排版或笔误按原件复核。basic只筛查列出字段，full保留尚未建模条件。';
await fs.writeFile(path.join(root,'test-cases.json'), JSON.stringify({ clarification, cases:tests },null,2)+'\n');
await fs.mkdir(path.join(root,'reports'), {recursive:true});
const results=[];
for (const t of tests) {
  const result={ id:t.id, title:t.title, source:t.source, basic:searchProducts(loaded,parseRequirements(t.basicRequest),{limit:50,includeIncompatible:true}), full:searchProducts(loaded,parseRequirements(t.fullRequest),{limit:50,includeIncompatible:true}) };
  results.push(result);
  await fs.writeFile(path.join(root,'reports',t.id+'.md'), `> 整理后的测试条件，原采购来源：[${t.source.publisher}](${t.source.url})。${t.scope}。\n\n`+generateReport(result.full,t.title).markdown+'\n');
}
await fs.writeFile(path.join(root,'deterministic-results.json'), JSON.stringify({ clarification, products:products.length, cases:results },null,2)+'\n');
const selected=tests.filter(t=>['YR-24-120','YR-24-240','CRSC-DUAL'].includes(t.id));
const prompt=`请作为麦格米特产品选型辅助助手，用相同下列官方产品资料评估三条来自实际公开采购的测试请求。资料是真实官网原件的人工核对数据，原需求出处均提供；测试文本是整理后的派生输入，不代表采购方新增条款。

这是公平对比：两组获得完全相同的产品参数、原文数值、版本、资料路径和链接。只依据以下资料，不联网补齐参数，不把典型效率当保证值，不把两个输入区间合成连续区间。不宣称可替换或已经中标。无需写文件或使用其他工具。
有megmeet工具时，先查看产品库，对每条fullRequest实际调用检索或报告工具（不得移除未解析条件），并保留原始来源Markdown链接；无这些工具时直接依据同一份资料分析。报告最多列每条2个初筛候选和3个排除示例，其余给数量；充分区分初筛字段通过与完整条件待确认。

请输出约1500–2500字中文Markdown，包含每条需求的结论、关键差异、缺失证据，以及可直接点击的资料版本链接（绝对本地路径，不改成file://）和采购原文链接。说明全部结论须工程复核。不要为了演示声称安装插件必然提高准确率。

三个测试请求：
${JSON.stringify(selected,null,2)}

同一份产品库及来源：
${JSON.stringify(loaded,null,2)}
`;
await fs.writeFile(path.join(root,'prompt.txt'),prompt);
await fs.copyFile(path.join(root,'../demo-comparison/shared.patch.yml'),path.join(root,'shared.patch.yml'));
await fs.writeFile(path.join(root,'plugin.patch.yml'), `- id: megmeet-product-assistant\n  config:\n    catalogPath: '${path.join(root,'catalog.real.json').replace(/\\/g,'/')}'\n    maxCandidates: 10\n    maxInputChars: 60000\n`);
await fs.mkdir(path.join(root,'workspace'),{recursive:true});
await fs.mkdir(path.join(root,'runs'),{recursive:true});
await fs.writeFile(path.join(root,'experiment.json'),JSON.stringify({ runtime:'DSH v0.2.0-rc.2', plugin:'dsh-megmeet@0.1.3', provider:'deepseek-account', model:'deepseek-flash', reasoningEffort:'high', promptSHA256:createHash('sha256').update(prompt).digest('hex'), catalogSHA256:createHash('sha256').update(await fs.readFile(path.join(root,'catalog.real.json'))).digest('hex'), realProductCount:products.length, officialIndustrialDocuments:8, procurementSources:4, deterministicCases:tests.length, pairedCases:selected.map(t=>t.id), controls:['Same prompt bytes, model, data, workspace and shared patch','Fresh sessions; only treatment profile has the plugin','No generic filesystem, shell, web or delegation tools enabled'], limitations:['One paired model run, not a statistical benchmark','Catalog is a conservative manual transcription of scanned official PDF page1','Efficiency guarantee, temperature derating and certification evidence intentionally remain unknown','Full engineering and procurement suitability is not established'] },null,2)+'\n');
console.log(JSON.stringify({ products:products.length, sources:sources.length, cases:tests.length, promptBytes:Buffer.byteLength(prompt), basicMatches:results.map(r=>({id:r.id,matches:r.basic.candidates.filter(c=>c.status==='matches_listed_constraints').map(c=>c.productId)})) }));
