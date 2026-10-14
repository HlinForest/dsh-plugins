from pathlib import Path
import json,time
from playwright.sync_api import sync_playwright

ROOT=Path(r'D:\VisualBoard\output\EDA_Flow_0.3.0_Verification');OUT=ROOT/'qa';OUT.mkdir(exist_ok=True)
BASE='http://127.0.0.1:18515';checks=[];errors=[];external=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
    page=browser.new_page(viewport={'width':1586,'height':992},device_scale_factor=1)
    page.set_default_timeout(15000)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:external.append(r.url) if not r.url.startswith(BASE) else None)
    def api(body=None):
        if body:return page.request.post(BASE+'/api/eda-flow/action',data=body).json()['value']
        return page.request.get(BASE+'/api/eda-flow/bootstrap').json()['value']
    def control(**kwargs):return page.request.post(BASE+'/test-control',data=kwargs).json()
    def stage(n):page.locator('.step').nth(n-1).click()
    def tab(n):page.locator('.main-tabs button').nth(n).click()
    def geometry():
        assert page.evaluate('''()=>{const main=document.querySelector('.workspace').getBoundingClientRect(),foot=document.querySelector('.bottom-bar').getBoundingClientRect(),left=document.querySelector('.sidebar').getBoundingClientRect(),right=document.querySelector('.assistant').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth+1&&main.bottom<=foot.top+1&&(innerWidth<1200||(left.right<=main.left+1&&main.right<=right.left+1))&&[...document.querySelectorAll('.bottom-bar button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})}''')
    page.goto(BASE+'/api/eda-flow/page?step=2');page.get_by_role('tab',name='器件 41',exact=True).wait_for()
    initial=len(api()['projects']);pid=api()['projects'][0]['id']
    page.get_by_role('checkbox',name='选择 U1',exact=True).check();page.screenshot(path=str(OUT/'reference-match.png'))
    for n in range(1,8):
        stage(n)
        for t in range(3):tab(t);geometry()
        tab(0);page.screenshot(path=str(OUT/f'{n:02d}-page.png'))
    for name in ['项目资料','操作记录']:
        page.locator('.nav-secondary').get_by_role('button',name=name).click();geometry()
    checks.append('Seven stages, 21 tabs and both auxiliary pages render using the approved layout')
    control(selected=False);stage(1)
    before=page.request.get(BASE+'/test-control').json()['calls']
    page.get_by_role('button',name='确认并继续',exact=True).click();page.get_by_role('heading',name='资料与提取',exact=True).wait_for()
    assert page.request.get(BASE+'/test-control').json()['calls']==before
    checks.append('Step one saves and confirms without a selected model or any model request')
    control(selected=True)
    for run in range(2):
        page.get_by_role('button',name='整理输入' if run==0 else '重新整理输入',exact=True).click()
        page.get_by_role('button',name='重新整理输入',exact=True).wait_for(timeout=45000)
        page.get_by_role('button',name='确认并继续',exact=True).wait_for(state='visible')
        page.wait_for_function("!document.querySelector('.footer-actions .primary').disabled")
    assert len(api()['projects'])==initial
    page.reload();page.get_by_role('tab',name='器件 41',exact=True).wait_for();assert len(api()['projects'])==initial
    checks.append('Real input preparation with a simulated model succeeds; retry and refresh preserve the project')
    for reason,title in [({'kind':'max-tokens'},'模型输出被截断'),({'kind':'error','failure':{'status':429,'message':'Rate limited'}},'请求受到限流'),({'kind':'error','failure':{'status':401,'message':'Authentication failed'}},'模型鉴权失败')]:
        control(selected=True,failure=reason)
        page.locator('.footer-actions').get_by_role('button',name='整理输入',exact=True).click() if page.locator('.footer-actions').get_by_role('button',name='整理输入',exact=True).count() else page.locator('.footer-actions').get_by_role('button',name='重新整理输入',exact=True).click()
        page.get_by_role('heading',name=title,exact=True).wait_for(timeout=45000)
        assert '额度' not in page.locator('.assistant-error').inner_text()
    page.screenshot(path=str(OUT/'model-failure.png'));control(selected=True)
    checks.append('Real streaming adapter displays truncation, rate-limit and authentication errors without false quota diagnosis')
    page.locator('.footer-actions').get_by_role('button',name='整理输入',exact=True).click();page.get_by_role('button',name='重新整理输入',exact=True).wait_for(timeout=45000)
    stage(1);page.get_by_role('textbox',name='补充本步要求',exact=True).fill('检查输入完整性')
    page.get_by_role('button',name='发送补充要求',exact=True).click();page.get_by_role('button',name='采用到本步输入',exact=True).wait_for(timeout=30000)
    assert api({'action':'open','projectId':pid})['stages'][1]['status']=='done'
    page.get_by_role('button',name='采用到本步输入',exact=True).click();page.get_by_role('button',name='已加入本步输入',exact=True).wait_for()
    assert api({'action':'open','projectId':pid})['stages'][1]['status']=='stale'
    stage(2);assert not page.get_by_text('检查输入完整性',exact=True).count()
    checks.append('Step conversations persist separately; only adopting a suggestion changes inputs and invalidates results')
    page.get_by_role('button',name='新建项目',exact=True).click();page.get_by_role('textbox',name='项目名称',exact=True).fill('显示板');page.get_by_role('button',name='创建项目',exact=True).click();page.get_by_role('alert').wait_for()
    name='空白输入验证-'+str(int(time.time()));page.get_by_role('textbox',name='项目名称',exact=True).fill(name);page.get_by_role('button',name='创建项目',exact=True).click();page.get_by_role('heading',name='任务与约束',exact=True).wait_for()
    page.get_by_role('textbox',name='项目需求',exact=True).fill('3.3V 环境监测板');page.get_by_role('button',name='确认并继续',exact=True).click();page.get_by_role('heading',name='资料与提取',exact=True).wait_for()
    page.get_by_role('button',name='添加资料',exact=True).click();page.locator('input[type=file]').set_input_files({'name':'requirements.txt','mimeType':'text/plain','buffer':'供电3.3V，接口I2C'.encode()});page.wait_for_function('!document.querySelector("dialog")')
    assert page.get_by_role('table',name='补充资料',exact=True).get_by_text('requirements.txt').is_visible()
    checks.append('Explicit creation rejects duplicate names; blank design and real file upload use the same steps')
    for width,height in [(1280,800),(1100,760),(768,800),(390,844)]:
        page.set_viewport_size({'width':width,'height':height});geometry();page.screenshot(path=str(OUT/f'responsive-{width}.png'))
        if width<1200:
            page.get_by_role('button',name='打开 AI 助手',exact=True).click();assert page.locator('.assistant').is_visible();page.get_by_role('button',name='收起 AI 助手',exact=True).click()
    checks.append('Desktop columns and small-window assistant drawer remain usable without overlapping footer controls')
    assert not errors,errors;assert not external,external
    record=page.request.get(BASE+'/test-control').json();assert record['realModelCalls']==0
    browser.close()
(OUT/'browser-report.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'externalRequests':external,'model':record},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(checks,ensure_ascii=False))
