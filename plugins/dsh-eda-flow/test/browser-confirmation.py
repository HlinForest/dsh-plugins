"""Confirmation and visible failure regression against test/serve-ui.mjs only."""
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base, folder = sys.argv[1:3]
out = Path(folder); out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', headless=True)
    page = browser.new_page(viewport={'width':1000, 'height':850})
    errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    def api(body):
        value = page.request.post(base+'/api/eda-flow/action', data=body).json()
        assert value['ok'], value
        return value['value']
    def control(**values):
        return page.request.post(base+'/test-control', data=values).json()
    initial = control(selected=False)
    assert initial['realModelCalls'] == 0
    project = api({'action':'create','label':f'Confirmation UI {time.time_ns()}','caseId':'display-board'})
    page.goto(base+'/api/eda-flow/page')
    page.evaluate('(id)=>localStorage.setItem("eda-flow-active-project",id)', project['id'])
    page.reload()
    expect(page.get_by_role('textbox', name='项目需求', exact=True)).not_to_have_value('')
    inject = True
    def action(route):
        body = route.request.post_data_json
        if inject and body.get('action') == 'confirm' and body.get('stage') == 1:
            response = route.fetch(); value = response.json()
            first = value['value']['stages'][0]
            first.update({'status':'stale','confirmed':False,'invalidation':{'message':'确认文件校验未通过：result.json'}})
            route.fulfill(response=response, json=value)
        else:
            route.continue_()
    page.route('**/api/eda-flow/action', action)
    checks = []
    try:
        page.get_by_role('button', name='确认并继续', exact=True).click()
        expect(page.locator('.workspace .notice.error')).to_contain_text('result.json')
        expect(page.get_by_role('heading', name='任务与约束', exact=True)).to_be_visible()
        page.screenshot(path=str(out/'confirmation-stays-on-step.png'))
        assert control(selected=False)['calls'] == initial['calls']
        checks.append('Unconfirmed readback stays on the first page and displays the actual reason')
        inject = False
        page.get_by_role('button', name='确认并继续', exact=True).click()
        page.get_by_role('heading', name='资料与提取', exact=True).wait_for()
        assert api({'action':'open','projectId':project['id']})['stages'][0]['confirmed']
        assert control(selected=False)['calls'] == initial['calls']
        page.get_by_role('button', name='整理输入', exact=True).click()
        expect(page.locator('.workspace .notice.error')).to_contain_text('模型', timeout=60000)
        expect(page.get_by_role('button', name='确认并继续', exact=True)).to_be_disabled()
        page.screenshot(path=str(out/'failure-visible-with-assistant-hidden.png'))
        checks.append('Stage failure is visible in the work area even when the AI column is collapsed')
        control(selected=True)
        page.locator('.footer-actions').get_by_role('button', name='整理输入', exact=True).click()
        expect(page.get_by_role('button', name='重新整理输入', exact=True)).to_be_visible(timeout=60000)
        page.get_by_role('button', name='确认并继续', exact=True).click()
        page.get_by_role('heading', name='器件与规格书', exact=True).wait_for()
        final = api({'action':'open','projectId':project['id']})
        assert all(s['confirmed'] and s['status']=='done' for s in final['stages'][:2])
        page.screenshot(path=str(out/'confirmed-through-step-two.png'))
        checks.append('Retry retains the same project and confirms the first two stages')
        assert not errors, errors
        assert control(selected=True)['realModelCalls'] == 0
        (out/'browser-confirmation.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'paidModelCalls':0},ensure_ascii=False,indent=2),encoding='utf-8')
    finally:
        page.screenshot(path=str(out/'last-state.png'))
        browser.close()
    print(json.dumps(checks,ensure_ascii=True))
