import sys,atexit,socket,subprocess,time,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('../ui-check').resolve();out.mkdir(exist_ok=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
server=subprocess.Popen(['node','test/serve-supplement-ui.mjs',str(out/'fixture'),str(port)],stdout=subprocess.DEVNULL);atexit.register(server.terminate)
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True);p=b.new_page(viewport={'width':1440,'height':1100});errors=[];p.on('pageerror',lambda e:errors.append(str(e)));base=f'http://127.0.0.1:{port}'
 for _ in range(60):
  try:p.goto(base+'/api/eda-flow/page?step=2');break
  except:time.sleep(.2)
 rows=p.locator('.supplement-item');expect(rows).to_have_count(2)
 one,two=rows.nth(0),rows.nth(1);one.get_by_role('button',name='补充文字要求').click();one.locator('textarea').fill('接口为3.3V');two.get_by_role('button',name='补充文字要求').click();two.locator('textarea').fill('按已批准物料规格执行')
 one.get_by_role('button',name='补充文字要求').click();expect(one.locator('textarea')).not_to_be_visible();expect(two.locator('textarea')).to_be_visible();one.get_by_role('button',name='补充文字要求').click();expect(one.locator('textarea')).to_have_value('接口为3.3V')
 one.get_by_role('button',name='确认并保存本项').click();expect(one.get_by_text('已确认保存',exact=True)).to_be_visible();two.get_by_role('button',name='确认并保存本项').click();expect(two.get_by_text('已确认保存',exact=True)).to_be_visible();p.reload();expect(rows).to_have_count(2)
 for row,text in [(rows.nth(0),'接口为3.3V'),(rows.nth(1),'按已批准物料规格执行')]:
  expect(row.get_by_text('已确认保存',exact=True)).to_be_visible();row.get_by_role('button',name='补充文字要求').click();expect(row.locator('textarea')).to_have_value(text)
 p.screenshot(path=str(out/'inline-confirmed.png'),full_page=True);assert not errors,errors
 boot=p.request.get(base+'/api/eda-flow/bootstrap').json()['value'];project=p.request.post(base+'/api/eda-flow/action',data={'action':'open','projectId':boot['projects'][0]['id']}).json()['value'];assert project['modelRequests']==0;assert not project['stages'][1]['confirmed'];assert project['inputs']['stageNotes']['2'].count('【补充确认：')==2
 (out/'result.json').write_text(json.dumps({'passed':True,'independentEditors':2,'togglePreservesDraft':True,'refreshPreservesConfirmed':True,'modelRequests':0}),encoding='utf8');b.close()
print('Inline editor regression passed')
