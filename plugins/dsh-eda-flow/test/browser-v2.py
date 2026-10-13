import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(r'D:\VisualBoard\output\EDA_Flow_0.2.0_Verification')
record=json.loads((root/'verification.json').read_text());checks=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:18479/api/eda-flow/page');page.wait_for_selector('[data-action="display-board"]')
    assert 'R6' not in page.locator('body').inner_text();checks.append('Display board labels; no old preset execution')
    page.locator('[data-action="new"]').first.click();page.wait_for_selector('#requirements');page.locator('#requirements').fill('Temperature monitor');page.locator('#stage-note').fill('3.3V interface')
    page.locator('[data-action="save-input"]').click();page.wait_for_timeout(800);assert page.locator('#requirements').input_value()=='Temperature monitor'
    page.locator('[data-step="2"]').click();assert page.locator('#basis').count()==1;assert '参考电路可选' in page.locator('#basis').get_attribute('placeholder');checks.append('New design basis without reference schematic')
    page.locator('[data-step="3"]').click();page.locator('#stage-note').fill('Read specified part');page.locator('[data-action="save-input"]').click();page.wait_for_timeout(800);page.reload();page.wait_for_selector('[data-step="3"]');page.locator('[data-step="3"]').click();assert page.locator('#stage-note').input_value()=='Read specified part';checks.append('Stage notes persist independently')
    page.locator('[data-action="display-board"]').first.click();page.wait_for_selector('[data-read="01_task/requirements.json"]');assert page.locator('[data-action="execute"]').is_disabled()
    page.locator('[data-read="01_task/requirements.json"]').click();page.wait_for_selector('#viewer[open]');assert 'outline' in page.locator('#viewer pre').inner_text();page.locator('[data-close="viewer"]').click();checks.append('Full default input viewer; offline execution disabled')
    page.screenshot(path=str(root/'ui-inputs.png'),full_page=True)
    page.locator('#projects').select_option(record['projectId']);page.locator('.headline .sub').filter(has_text='离线工具链验证').wait_for();page.wait_for_timeout(2000);page.locator('[data-step="6"]').click();page.wait_for_function('Array.from(document.images).filter(i=>i.src.includes("pcb-top.svg")).some(i=>i.complete && i.naturalWidth>0)')
    page.screenshot(path=str(root/'ui-pcb.png'),full_page=True)
    page.locator('button[data-image$="pcb-top.svg"]').click();page.wait_for_selector('#viewer[open] img');assert page.locator('#viewer img').evaluate('(i)=>i.complete&&i.naturalWidth>0');page.locator('[data-close="viewer"]').click();checks.append('Actual generated PCB preview and fullscreen viewer')
    for width in [390,768,1440]:
        page.set_viewport_size({'width':width,'height':950});page.wait_for_timeout(150)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
    assert not errors,errors;checks.append('No page exceptions; 3 viewport sizes without overflow')
    browser.close()
(root/'browser-validation.json').write_text(json.dumps({'passed':checks,'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(checks,ensure_ascii=False))
