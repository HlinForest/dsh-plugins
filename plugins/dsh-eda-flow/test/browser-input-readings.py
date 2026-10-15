"""Run only against serve-ui.mjs. Uses mock responses and real Python reads."""
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base, folder = sys.argv[1:3]
out = Path(folder); out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', headless=True)
    page = browser.new_page(viewport={'width':1280, 'height':850}, accept_downloads=True)
    def api(body):
        value=page.request.post(base+'/api/eda-flow/action',data=body).json()
        assert value['ok'], value
        return value['value']
    assert page.request.post(base+'/test-control',data={}).json()['realModelCalls']==0
    page.goto(base+'/api/eda-flow/page')
    errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.locator('.top-actions').get_by_role('button',name='新建项目',exact=True).click()
    name='显示板 · 读取诊断 '+str(time.time_ns())
    page.get_by_role('textbox',name='项目名称',exact=True).fill(name)
    page.get_by_role('radio',name='使用显示板输入',exact=False).check()
    with page.expect_response(lambda r:r.url.endswith('/action') and r.request.post_data_json.get('action')=='create') as response:
        page.get_by_role('button',name='创建项目',exact=True).click()
    project=response.value.json()['value']
    expect(page.locator('.project-trigger')).to_contain_text('显示板 · 读取诊断')
    titles=['任务与约束','资料与提取','器件与规格书','原理图','BOM 与封装','PCB','核验与交付']
    for i,title in enumerate(titles,1):
        page.locator('.step-list button').nth(i-1).click()
        expect(page.get_by_role('heading',name=title,exact=True)).to_be_visible()
        guide=page.get_by_role('region',name='本步输入来源')
        expect(guide).to_contain_text('本步操作')
        if guide.locator('details').get_attribute('open') is None: guide.locator('summary').click()
        expect(guide.locator('details')).to_have_attribute('open','')
        assert page.locator('table input[type=checkbox]').count()==0
        page.screenshot(path=str(out/f'guide-{i}.png'))
    page.locator('.step-list button').nth(0).click()
    page.locator('.footer-actions').get_by_role('button',name='确认并继续',exact=True).click()
    expect(page.get_by_role('heading',name='资料与提取',exact=True)).to_be_visible()
    before=api({'action':'open','projectId':project['id']})
    page.get_by_role('button',name='检查资料读取',exact=True).click()
    expect(page.get_by_role('dialog')).to_contain_text('内容与发布包一致',timeout=30000)
    page.screenshot(path=str(out/'readers-verified.png'))
    page.get_by_role('button',name='返回并刷新状态',exact=True).click()

    originals={}
    for file in Path(before['inputsBundle']).rglob('*.csv'):
        originals[file]=file.read_bytes(); file.write_bytes(b'%TSD-Header\0test-only-ciphertext')
    assert len(originals)==7
    try:
        page.reload()
        page.locator('.step-list button').nth(1).click()
        expect(page.get_by_role('region',name='资料读取检查入口')).to_contain_text('TSD-Header',timeout=20000)
        assert api({'action':'open','projectId':project['id']})['stages'][0]['confirmed']
        page.locator('.footer-actions').get_by_role('button',name='整理输入',exact=True).click()
        expect(page.locator('.workspace')).to_contain_text('TSD-Header')
        assert api({'action':'open','projectId':project['id']})['modelRequests']==0
        page.screenshot(path=str(out/'tsd-blocked-first-preserved.png'))
        page.get_by_role('button',name='检查资料读取',exact=True).click()
        expect(page.get_by_role('dialog')).to_contain_text('7 个文件读取到 TSD-Header',timeout=30000)
        page.screenshot(path=str(out/'tsd-reader-report.png'))
        with page.expect_download() as downloaded:
            page.get_by_role('button',name='下载诊断记录',exact=True).click()
        destination=out/'diagnostics.json'; downloaded.value.save_as(str(destination))
        report=json.loads(destination.read_text(encoding='utf-8'))
        assert len([f for f in report['files'] if f['status']=='tsd-protected'])==7
        assert report['realModelCalls']==0 and report['contentIncluded'] is False
        assert 'test-only-ciphertext' not in destination.read_text(encoding='utf-8')
        page.get_by_role('button',name='返回并刷新状态',exact=True).click()
    finally:
        for file,data in originals.items(): file.write_bytes(data)
    page.reload(); page.locator('.step-list button').nth(1).click()
    page.locator('.footer-actions').get_by_role('button',name='整理输入',exact=True).click()
    expect(page.get_by_role('button',name='重新整理输入',exact=True)).to_be_visible(timeout=60000)
    after=api({'action':'open','projectId':project['id']})
    assert after['stages'][0]['confirmed'] and after['stages'][0]['outputHash']==before['stages'][0]['outputHash']
    page.get_by_role('button',name='确认并继续',exact=True).click()
    expect(page.get_by_role('heading',name='器件与规格书',exact=True)).to_be_visible()
    page.screenshot(path=str(out/'step-two-recovered.png'))
    guide=page.get_by_role('region',name='本步输入来源')
    if guide.locator('details').get_attribute('open') is None: guide.locator('summary').click()
    page.get_by_role('button',name='添加并绑定规格书',exact=True).click()
    expect(page.get_by_role('dialog')).to_contain_text('绑定型号 / 位号')
    page.get_by_role('button',name='关闭对话框',exact=True).click()
    for width in [1280,640,390]:
        page.set_viewport_size({'width':width,'height':850})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),width
        page.screenshot(path=str(out/f'guidance-{width}.png'))
    assert not errors,errors
    (out/'ui-validation.json').write_text(json.dumps({'passed':True,'guides':7,'tableCheckboxes':0,'tsdFiles':7,
        'firstConfirmationPreserved':True,'recoveryConfirmedStepTwo':True,'realModelCalls':0,
        'widths':[1280,640,390],'pageErrors':errors},indent=2),encoding='utf-8')
    browser.close()
    print('PASS: seven guides, no inert checkboxes, real dual-reader diagnostics, TSD block before AI, restore and retry; no model calls.')
