"""Real browser run: no stored answers, no model. Requires an already running local service."""
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
url, output = sys.argv[1:3]; out = Path(output); out.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1500, 'height': 1040})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url); page.locator('[data-action="r6"]').first.click()
    page.locator('.headline h2').filter(has_text='1.').wait_for()
    page.screenshot(path=str(out / 'step1-inputs.png'), full_page=True)
    for stage in range(1, 8):
        page.locator('[data-action="execute"]').click()
        # Wait for the backend's actual terminal status, not a fixed sleep or fake progress.
        deadline = time.time() + 600
        while time.time() < deadline:
            badge = page.locator('.headline .badge').inner_text()
            if badge == '已生成': break
            if badge in ['执行失败', '上次中断', '已取消']: raise AssertionError(page.locator('main').inner_text())
            page.wait_for_timeout(600)
        else: raise AssertionError('Stage timeout ' + str(stage))
        if stage in [3, 4, 5, 6, 7]:
            page.locator('.section').last.scroll_into_view_if_needed()
            page.screenshot(path=str(out / f'step{stage}-results.png'), full_page=True)
        if stage in [4, 6]:
            page.locator('[data-image]').first.click(); page.locator('#viewer[open] img').wait_for()
            assert page.locator('#viewer img').evaluate('(el)=>el.complete && el.naturalWidth > 0')
            page.screenshot(path=str(out / f'step{stage}-fullscreen.png'))
            page.locator('[data-close="viewer"]').click()
        expect(page.locator('[data-action="next"]')).to_be_enabled(timeout=60000)
        if page.locator('#allow-draft').count(): page.locator('#allow-draft').check()
        page.locator('#review-note').fill('自动界面验收的技术草稿确认；不代替公司签核。')
        page.locator('[data-action="next"]').click()
        if stage < 7: page.locator('.headline h2').filter(has_text=str(stage + 1) + '.').wait_for()
        else: page.get_by_text('已记录工程师确认', exact=False).wait_for(timeout=60000)
    project_id = page.evaluate('localStorage.getItem("eda-flow-project")')
    state = page.request.post(url.split('/api/')[0] + '/api/eda-flow/action', data={'action': 'open', 'projectId': project_id}).json()['value']
    assert state['modelRequests'] == 0 and all(s['status'] == 'done' and s['confirmed'] for s in state['stages'])
    page.locator('[data-action="replay"]').click()
    page.get_by_text('重放工程内容一致，比较', exact=False).wait_for(timeout=1200000)
    page.screenshot(path=str(out / 'replay-success.png'), full_page=True)
    state = page.request.post(url.split('/api/')[0] + '/api/eda-flow/action', data={'action': 'open', 'projectId': project_id}).json()['value']
    assert state['replay']['match'] and state['replay']['modelRequests'] == 0
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(out / 'mobile.png'), full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    # A separate generic project exercises the file picker and draft path without altering verified R6.
    page.set_viewport_size({'width': 1500, 'height': 1040})
    page.locator('[data-action="restore"]').click(); page.locator('[data-step="2"]').click()
    page.locator('[data-action="browse"]').first.click(); page.locator('#picker[open]').wait_for()
    page.locator('[data-close="picker"]').click()
    browser.close()
(out / 'browser-validation.json').write_text(json.dumps({'passed': not errors, 'projectId': project_id, 'stagesExecuted': 7, 'replay': state['replay'], 'modelRequests': state['modelRequests'], 'errors': errors}, ensure_ascii=False, indent=2), encoding='utf-8')
assert not errors, errors
print(json.dumps({'passed': True, 'projectId': project_id, 'replay': state['replay']}))
