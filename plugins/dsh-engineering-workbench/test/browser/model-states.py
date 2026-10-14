"""Verify real UI model dispatch against the isolated in-memory mock adapter."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);meta=json.loads((root/'server.json').read_text());base=meta['url'].split('/api/')[0]
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
    page=browser.new_page(viewport={'width':1280,'height':850});page.goto(meta['url'])
    page.get_by_role('navigation',name='工作台功能').get_by_role('button',name='读手册',exact=True).click()
    page.locator('.ew-source-choice').filter(has_text='本地 PDF').click()
    page.get_by_label('PDF 手册',exact=True).fill(str(root/'fixtures/manual-ui.pdf'))
    page.get_by_role('button',name='读取手册并继续',exact=True).click()
    reader=page.get_by_role('region',name='整本手册阅读',exact=True)
    expect(reader.get_by_role('button',name='自动通读整本',exact=True)).to_be_enabled(timeout=60000)
    page.request.post(base+'/__mock',data={'failure':True})
    reader.get_by_role('button',name='自动通读整本',exact=True).click()
    expect(reader.get_by_role('button',name='继续本次阅读',exact=True)).to_be_visible(timeout=20000)
    expect(reader.locator('.ew-reading-progress')).to_contain_text('TEST_TIMEOUT')
    page.screenshot(path=str(root/'model-failure.png'))
    page.request.post(base+'/__mock',data={'failure':False})
    reader.get_by_role('button',name='继续本次阅读',exact=True).click()
    expect(reader.get_by_role('button',name='暂停阅读',exact=True)).to_be_visible()
    page.screenshot(path=str(root/'model-processing.png'))
    expect(reader.get_by_role('button',name='整本已通读',exact=True)).to_be_visible(timeout=20000)
    page.screenshot(path=str(root/'model-complete.png'))
    result=page.request.get(base+'/__mock').json();assert result['mockCalls']>=2 and result['paidModelCalls']==0
    (root/'model-checks.json').write_text(json.dumps({'failedThenRetried':True,'completed':True,'mockCalls':result['mockCalls'],'paidModelCalls':0},indent=2),encoding='utf-8')
    browser.close()
print('Model processing, failure, retry and completion passed with simulated responses only.')
