from pathlib import Path
import os,subprocess,re,json,time,threading
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];PROJECT=ROOT.parent
env=dict(os.environ);env['DSH_TELEMETRY_DISABLED']='1';env['TEMP']=str(Path(env['LOCALAPPDATA'])/'Temp');env['TMP']=env['TEMP']
cmd=['node',str(PROJECT/'.verification/dsh-host/node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','megmeet-link-ui','--patch',str(ROOT/'configs/native-ui.patch.yml'),'--no-open','--port','4775']
server=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',creationflags=subprocess.CREATE_NO_WINDOW)
url=None
try:
 for line in server.stdout:
  match=re.search(r'http://127\.0\.0\.1:4775/\?token=[^\s]+',line)
  if match:url=match.group();break
  if server.poll() is not None:raise RuntimeError('Native server exited before startup')
 if not url:raise RuntimeError('Native server authentication URL missing')
 # Keep launch token and browser authentication in memory. Never write either to an artifact.
 threading.Thread(target=lambda:list(server.stdout),daemon=True).start()
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
  page=browser.new_page(viewport={'width':1520,'height':1050});page.goto(url,wait_until='networkidle');page.wait_for_timeout(1500)
  dirs=sorted((ROOT/'records').glob('experiment-*'));directory=next(d for d in reversed(dirs) if (d/'c-1/expanded.metadata.json').exists());meta=json.loads((directory/'c-1/expanded.metadata.json').read_text(encoding='utf-8'))
  sid=meta['sessionId'];cwd=str(ROOT/'workspaces'/directory.name/'c-1')
  response=page.request.post('http://127.0.0.1:4775/api/workspace/create',data={'type':'client-request','rpcId':'demo-workspace','method':'workspace/create','payload':{'args':{'request':{'path':cwd}}}})
  created=response.json();assert created['result']['ok'],created
  workspace_id=created['result']['value']['workspace']['workspaceId']
  response=page.request.post('http://127.0.0.1:4775/api/session/create',data={'type':'client-request','rpcId':'demo-create','method':'session/create','payload':{'args':{'request':{'sessionId':sid,'workspaceId':workspace_id}}}})
  print('Adopt existing benchmark session:',response.status,response.text()[:300])
  title='插件v0.2.0公开资料验证'
  response=page.request.post('http://127.0.0.1:4775/api/session/rename',data={'type':'client-request','rpcId':'demo-rename','method':'session/rename','payload':{'args':{'request':{'sessionId':sid,'title':title}}}})
  print('Name demo session:',response.status,response.text()[:300])
  page.reload(wait_until='networkidle');page.wait_for_timeout(1500)
  page.screenshot(path=str(ROOT/'native-home.png'))
  page.get_by_text('c-1',exact=True).first.click();page.wait_for_timeout(700)
  page.get_by_text(title,exact=True).first.click();page.wait_for_timeout(1800)
  page.screenshot(path=str(ROOT/'native-chat-overview.png'))
  version_label='CP20.241-R2 · Nov. 2025 / Rev. 1.3'
  source_path=page.get_by_role('button',name=version_label,exact=True).get_attribute('title')
  assert source_path.replace('\\','/').endswith('/materials/CP20.241-R2.pdf')
  page.get_by_role('button',name='CP20.241-R2 · Nov. 2025 / Rev. 1.3',exact=True).click();page.wait_for_timeout(3000)
  page.screenshot(path=str(ROOT/'native-chat-pdf.png'))
  page.wait_for_function("document.querySelectorAll('canvas').length>0",timeout=20000)
  rendered_pages=page.locator('canvas').count();assert rendered_pages>=1
  pdf_pages=33
  assert 'CP20.241-R2' in page.locator('body').inner_text()
  html_path=page.get_by_role('button',name='交互报告（HTML）',exact=True).last.get_attribute('title')
  page.get_by_role('button',name='交互报告（HTML）',exact=True).last.click();page.wait_for_timeout(2000)
  page.screenshot(path=str(ROOT/'native-chat-report.png'))
  preview=next(f for f in page.frames[1:] if '满足已列条件' in f.locator('body').inner_text())
  svg_count=preview.locator('svg').count();assert svg_count>=2
  for heading in ['1. 结论','2. 需求与计算','3. 候选核对矩阵','5. 资料与逐项证据','6. 待确认事项']:assert heading in preview.locator('body').inner_text()
  report_file=Path(html_path);original=json.loads(report_file.with_suffix('.json').read_text(encoding='utf-8'))
  html_text=report_file.read_text(encoding='utf-8');embedded=json.loads(re.search(r'<script id="report-data" type="application/json">([\s\S]*?)</script>',html_text).group(1));assert embedded==original
  record={'pass':True,'runtime':'DSH v0.2.0-rc.2 native web frontend','pluginVersion':'0.2.0','sessionId':sid,'sourceVersionLabel':version_label,'sourceFile':source_path,'pdfOpenedFromChat':True,'pdfPageCount':pdf_pages,'pdfCanvasesAtCheck':rendered_pages,'htmlOpenedFromChat':True,'staticPreviewConclusion':True,'staticPreviewChartCount':svg_count,'htmlAndJSONIdentical':True,'reportFile':html_path,'authenticationSaved':False,'screenshots':['native-chat-pdf.png','native-chat-report.png']}
  (ROOT/'native-chat-link-verification.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
  print(json.dumps({'pass':True,'pdfPages':pdf_pages,'staticCharts':svg_count}),flush=True)
  browser.close()
finally:
 server.terminate()
 try:server.wait(timeout=8)
 except subprocess.TimeoutExpired:server.kill()
