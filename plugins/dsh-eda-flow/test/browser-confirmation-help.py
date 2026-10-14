"""Exercise confirmation/readback and input guidance through the real UI.

Only run against test/serve-ui.mjs (mock model, actual first two stage tools).
Transport faults are injected explicitly; they are not claimed as intranet logs.
"""
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base, folder = sys.argv[1:3]
out = Path(folder); out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', headless=True)
    page = browser.new_page(viewport={'width':1280,'height':850})
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    def api(body):
        response = page.request.post(base+'/api/eda-flow/action',data=body).json()
        assert response['ok'], response
        return response['value']
    control = page.request.post(base+'/test-control',data={'selected':True}).json()
    assert control['realModelCalls']==0
    checks=[]
    try:
        # First run the exact reported sequence without altering responses.
        project=api({'action':'create','label':'Default sequence '+str(time.time_ns()),'caseId':'display-board'})
        page.goto(base+'/api/eda-flow/page')
        page.evaluate('(id)=>localStorage.setItem("eda-flow-active-project",id)',project['id']);page.reload()
        page.get_by_role('button',name='确认并继续',exact=True).click()
        expect(page.get_by_role('heading',name='资料与提取',exact=True)).to_be_visible()
        first=api({'action':'open','projectId':project['id']})['stages'][0]
        page.locator('.footer-actions').get_by_role('button',name='整理输入',exact=True).click()
        expect(page.get_by_role('button',name='重新整理输入',exact=True)).to_be_visible(timeout=60000)
        after=api({'action':'open','projectId':project['id']})
        assert after['stages'][0]['confirmed'] and after['stages'][0]['status']=='done'
        assert after['stages'][0]['outputHash']==first['outputHash']
        page.get_by_role('button',name='确认并继续',exact=True).click()
        expect(page.get_by_role('heading',name='器件与规格书',exact=True)).to_be_visible()
        checks.append('Default step two preserves the confirmed first step and advances to step three')
        page.locator('.footer-actions').get_by_role('button',name='读取并核对',exact=True).click()
        expect(page.get_by_role('button',name='重新读取并核对',exact=True)).to_be_visible(timeout=60000)
        pending=page.get_by_role('region',name='本步待确认项')
        expect(pending).to_contain_text('尚无器件规格书')
        pending.get_by_role('button',name='器件与规格书 → 规格书',exact=True).click()
        expect(page.get_by_role('tab',name='规格书',exact=True)).to_have_attribute('aria-selected','true')
        page.locator('.page-title').get_by_role('button',name='添加规格书',exact=True).click()
        expect(page.get_by_role('dialog')).to_contain_text('绑定型号 / 位号')
        page.get_by_role('button',name='关闭对话框',exact=True).click()
        page.get_by_role('checkbox',name='带待确认项继续草稿',exact=True).check()
        page.get_by_role('button',name='确认并继续',exact=True).click()
        expect(page.get_by_role('heading',name='原理图',exact=True)).to_be_visible()
        assert api({'action':'open','projectId':project['id']})['stages'][0]['confirmed']
        checks.append('Actual datasheet gap links to its upload page and explicit draft confirmation can continue')

        # A success acknowledgement without a project must be reconciled with
        # actual stored state, not reported as a missing engineer input.
        project=api({'action':'create','label':'Readback '+str(time.time_ns()),'caseId':'display-board'})
        page.evaluate('(id)=>localStorage.setItem("eda-flow-active-project",id)',project['id']);page.reload()
        def incomplete_ack(route):
            body=route.request.post_data_json
            if body.get('action')=='confirm':
                response=route.fetch()
                assert response.json()['ok']
                route.fulfill(response=response,json={'ok':True,'value':{'confirmed':True}})
            else:route.continue_()
        page.route('**/api/eda-flow/action',incomplete_ack)
        page.get_by_role('button',name='确认并继续',exact=True).click()
        expect(page.get_by_role('heading',name='资料与提取',exact=True)).to_be_visible(timeout=8000)
        page.unroute('**/api/eda-flow/action',incomplete_ack)
        checks.append('Incomplete acknowledgement reads back persisted confirmation instead of claiming missing inputs')

        expect(page.get_by_text('显示板默认输入已载入',exact=True)).to_be_visible()
        page.get_by_role('button',name='查看本步默认资料',exact=True).click()
        expect(page.get_by_role('dialog')).to_contain_text('02_materials')
        page.get_by_role('button',name='关闭对话框',exact=True).click()
        page.screenshot(path=str(out/'default-input-help.png'))
        checks.append('Default inputs have a visible location without uploading the source project again')

        # A stale window/backend pairing must be identified before mutations.
        writes=[]
        def old_boot(route):
            response=route.fetch();value=response.json();value['value']['version']='0.3.1'
            route.fulfill(response=response,json=value)
        def watch(route):
            body=route.request.post_data_json
            if body.get('action') in ['update','confirm','execute']:writes.append(body['action'])
            route.continue_()
        page.route('**/api/eda-flow/bootstrap',old_boot)
        page.route('**/api/eda-flow/action',watch)
        page.reload()
        expect(page.locator('.project-trigger')).to_contain_text('Readback')
        expect(page.get_by_text('插件更新尚未生效',exact=True)).to_be_visible()
        expect(page.get_by_role('button',name='确认并继续',exact=True)).to_be_disabled()
        assert not writes,writes
        page.screenshot(path=str(out/'version-mismatch.png'))
        checks.append('Loaded backend version mismatch is explicit and does not mutate the project')
        page.unroute('**/api/eda-flow/bootstrap',old_boot)
        page.get_by_role('button',name='重新检查版本',exact=True).click()
        expect(page.get_by_text('插件更新尚未生效',exact=True)).not_to_be_visible()
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(out/'input-help-narrow.png'))
        assert not errors,errors
        report={'checks':checks,'pageErrors':errors,'paidModelCalls':0,'intranetCause':'Not inferred from injected responses'}
        (out/'confirmation-help.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    finally:
        page.screenshot(path=str(out/'last-state.png'))
        browser.close()
    print(json.dumps(checks))
