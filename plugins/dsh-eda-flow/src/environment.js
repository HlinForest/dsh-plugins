import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
export const setupLinks={kicad:'https://www.kicad.org/download/windows/',libraries:'https://www.kicad.org/libraries/download/'};
export function runProbe(exe,args){return new Promise(resolve=>{
 if(!exe)return resolve({ok:false,detail:'未配置路径'});
 let text='',settled=false;const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1'}});
 const finish=(ok,detail)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({ok,detail:String(detail).slice(-6000)});};
 const timer=setTimeout(()=>{child.kill();finish(false,'检查超时');},20000);
 child.stdout.on('data',d=>{text=(text+d).slice(-12000)});child.stderr.on('data',d=>{text=(text+d).slice(-12000)});
 child.on('error',e=>finish(false,e.code==='ENOENT'?'未安装或配置路径无效':e.message));child.on('close',c=>finish(c===0,text.trim()||'未返回版本信息'));
});}
export async function inspectEnvironment(config,selection=null,probe=runProbe){
 const checks=[],add=(id,name,scope,passed,detail,remedy)=>checks.push({id,name,scope,passed,detail,remedy});
 const exists=async p=>Boolean(p)&&await fs.stat(p).then(s=>s.isDirectory()).catch(()=>false);
 add('workspace','项目文件目录',['review'],await exists(config.workspaceRoot),config.workspaceRoot||'未配置','选择本机可读写的工程目录。');
 const cli=await probe(config.kicadCli,['--version']);
 add('kicad','KiCad 命令行',['schematic','pcb'],cli.ok&&/^10\./m.test(cli.detail),cli.detail,'安装并配置 KiCad 10 稳定版完整程序；本插件目前验证的是10系列，不使用夜间开发版。');
 const python=config.kicadPython;
 const script="import importlib,json; r={}\nfor n in ['pcbnew','wx','sexpdata','pymupdf','jsonschema','ortools.sat.python.cp_model','rapidocr_onnxruntime']:\n try: importlib.import_module(n);r[n]=True\n except Exception as e:r[n]=False\nprint(json.dumps(r))";
 const py=await probe(python,['-c',script]);let modules={};try{modules=JSON.parse(py.detail.split(/\r?\n/).findLast(l=>l.startsWith('{'))||'{}')}catch{}
 add('python','原理图 Python 与约束求解器',['schematic'],py.ok&&modules['ortools.sat.python.cp_model']===true,py.ok?'OR-Tools: '+(modules['ortools.sat.python.cp_model']?'可用':'缺少'):py.detail,'运行交付包 install/install-offline-python.ps1，向已配置的Python补齐离线依赖；推荐统一使用KiCad配套Python。');
 // The native schematic path uses its own parser. Do not require legacy sexpdata here.
 const mcp=config.mcpPython&&config.mcpPython!==python?await probe(config.mcpPython,['-c','import jsonschema;print("MCP dependencies ready")']):{ok:py.ok&&modules.jsonschema===true,detail:modules.jsonschema?'可用':'缺少 jsonschema'};
 add('mcp-python','工具接口 Python 依赖',['schematic'],mcp.ok,mcp.detail,'安装交付包离线依赖；单独配置 mcpPython 时也需在该解释器中安装依赖。');
 add('pdf','PDF 提取',['pdf'],py.ok&&modules.pymupdf===true,modules.pymupdf?'可用':py.detail||'缺少 PyMuPDF','向已配置 Python 安装交付包的离线依赖；已有PDF/SVG预览不需要重新提取。');
 add('pdf-ocr','PDF 图中文字识别（可选）',['pdf-ocr'],modules.rapidocr_onnxruntime===true,modules.rapidocr_onnxruntime?'RapidOCR 可导入；实际图像识别仍以提取记录为准':'未安装；图像区域仍会列为待复核，不影响可复制正文提取','在资料提取 Python 中安装 mcp/requirements-ocr.txt；内网先准备匹配 Python 的离线依赖。识别只在本机运行，结果需对照原图复核。');
 const pcbPython=config.pcbPython||(process.platform==='win32'&&config.kicadCli?path.join(path.dirname(config.kicadCli),'python.exe'):config.kicadPython);
 const pcb=pcbPython===python?{ok:py.ok&&modules.pcbnew===true,detail:modules.pcbnew?'pcbnew 可用':'缺少 pcbnew'}:await probe(pcbPython,['-c','import pcbnew; print(pcbnew.GetBuildVersion())']);
 add('pcb-python','PCB 执行 Python',['pcb'],pcb.ok,pcb.detail,'配置可导入 pcbnew 的 KiCad 10 配套 Python。');
 const library=config.kicadLibraryRoot||(config.kicadCli?path.resolve(path.dirname(config.kicadCli),'../share/kicad'):'');
 add('symbols','原理图符号库',['schematic'],await exists(library&&path.join(library,'symbols')),library||'未配置','在 KiCad 官方安装器中保留符号库；非标准目录需配置 kicadLibraryRoot。');
 const footprints=config.kicadFootprintRoot||(library&&path.join(library,'footprints'));
 add('footprints','PCB 封装库',['pcb'],await exists(footprints),footprints||'未配置','在 KiCad 安装器中保留封装库；非标准目录需配置 kicadFootprintRoot。');
 const java=await probe(config.javaPath||'java',['-version']);const major=Number(java.detail.match(/version\s+"?(\d+)/)?.[1]);
 add('java','Java 21 或以上',['pcb'],java.ok&&major>=21,java.detail,'完整交付包提供 offline/java21；安装时将 JavaPath 指向其中 bin/java.exe。');
 const jar=config.freeroutingJar||path.join(root,'vendor/freerouting-2.1.0.jar');
 add('router','自动布线器',['pcb'],await fs.stat(jar).then(s=>s.isFile()&&s.size>0).catch(()=>false),jar,'Freerouting 已随插件提供；缺失时重新安装完整插件包。');
 add('model','Harness 模型配置',['model'],config.allowModelCalls===true&&Boolean(selection?.model),selection?.model?'已选择 '+selection.model+'；未发送请求验证连通性':'尚未配置模型','在 Harness 中配置可访问的模型服务；本检查不调用模型、不验证额度或连通性。');
 const ready=scope=>checks.filter(c=>c.scope.includes(scope)||c.scope.includes('review')||c.scope.includes('model')).every(c=>c.passed)&&!config.reviewOnly;
 return {checkedAt:new Date().toISOString(),reviewOnly:Boolean(config.reviewOnly),checks,links:setupLinks,schematicReady:ready('schematic'),pcbReady:ready('pcb')&&ready('schematic'),modelRequests:0,
  guidance:'没有KiCad时，可保存文字评审并查看已有图纸；生成原理图、PCB和运行ERC/DRC需要安装并配置本机KiCad。内网可从联网机器取得官方完整安装器后离线安装。当前未提供远程CAD服务器代执行。'};
}
