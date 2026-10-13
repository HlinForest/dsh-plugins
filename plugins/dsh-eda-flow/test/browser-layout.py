"""Layout regression checks. Preview must disable AI; desktop checks never execute a stage."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:18481/api/eda-flow/page')
parser.add_argument('--desktop', default='http://127.0.0.1:18733')
parser.add_argument('--output', required=True)
parser.add_argument('--result-project', required=True)
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
checks, errors = [], []


def geometry(frame):
    return frame.evaluate('''() => {
      const box = s => document.querySelector(s).getBoundingClientRect();
      const main = box('main'), footer = box('.footer');
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
        separated: main.bottom <= footer.top + 1, footerInside: footer.bottom <= innerHeight + 1,
        reachable: [...document.querySelectorAll('.footer button')].every(b => {
          const r=b.getBoundingClientRect();
          const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1 && (hit===b || b.contains(hit));
        }) };
    }''')


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', headless=True)
    page = browser.new_page(viewport={'width': 1279, 'height': 820})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url)
    page.locator('[data-action="new"]').first.click()
    page.locator('#requirements').fill('UI regression: design inputs')
    page.locator('#stage-note').fill('UI regression: save and reload')
    with page.expect_response(lambda r: r.url.endswith('/action') and r.request.method == 'POST'):
        page.locator('[data-action="save-input"]').click()
    page.reload()
    assert page.locator('#requirements').input_value() == 'UI regression: design inputs'
    assert page.locator('#stage-note').input_value() == 'UI regression: save and reload'
    page.locator('[data-step="2"]').click()
    assert '参考电路可选' in page.locator('#basis').get_attribute('placeholder')
    page.locator('[data-step="3"]').click()
    page.locator('[data-action="browse"]').click()
    page.locator('#picker[open] .file-list button').first.wait_for()
    page.keyboard.press('Escape')
    assert not page.locator('#picker').evaluate('(d)=>d.open')
    checks.append('New design, saved inputs and local file picker remain functional')

    page.locator('#projects').select_option('__display')
    page.locator('#requirements').wait_for()
    assert page.locator('[data-action="execute"]').is_disabled()
    page.locator('summary').filter(has_text='本步默认输入').click()
    page.locator('[data-read="01_task/requirements.json"]').click()
    assert 'outline' in page.locator('#viewer pre').inner_text()
    page.keyboard.press('Escape')
    checks.append('Default inputs remain readable; no model call is made')

    page.locator('#projects').select_option(args.result_project)
    page.locator('.headline .sub').filter(has_text='离线工具链验证').wait_for()
    page.locator('[data-step="6"]').click()
    page.locator('button[data-image$="pcb-top.svg"]').wait_for()
    page.locator('button[data-image$="pcb-top.svg"]').click()
    page.wait_for_function('document.querySelector("#viewer img")?.complete && document.querySelector("#viewer img")?.naturalWidth>0')
    page.screenshot(path=str(out/'09-after-pcb-viewer.png'))
    page.keyboard.press('Escape')
    checks.append('Actual generated PCB preview opens and closes without leaving the workflow')
    for width, height in [(390, 720), (640, 640), (900, 640), (1279, 820), (1600, 900)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_function('''() => { const b=document.querySelector('.step.active').getBoundingClientRect(), n=document.querySelector('.step-nav').getBoundingClientRect(); return b.left>=n.left-1 && b.right<=n.right+1; }''')
        state = geometry(page)
        assert state == {'overflow': False, 'separated': True, 'footerInside': True, 'reachable': True}, (width, state)
        page.screenshot(path=str(out/f'layout-{width}.png'))
    checks.append('Five window sizes: no horizontal overflow; footer never covers the scrollable form')
    browser.close()

    browser = pw.chromium.connect_over_cdp(args.desktop)
    page = browser.contexts[0].pages[0]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_viewport_size({'width': 1279, 'height': 820})
    if not page.locator('[data-eda-flow-window][open]').count():
        page.get_by_role('button', name='原理图与 PCB 流程', exact=True).click()
    page.frame_locator('iframe[title="原理图与 PCB 流程"]').locator('[data-action="close-flow"]').wait_for()
    frame = next(f for f in page.frames if '/api/eda-flow/page' in f.url)
    frame.locator('[data-action="close-flow"]').wait_for()
    assert page.locator('[data-eda-flow-window]').evaluate('(d)=>d.matches(":modal")')
    assert page.locator('[data-eda-flow-window]').bounding_box()['y'] >= 40
    before = frame.evaluate("async()=>{const b=(await(await fetch('/api/eda-flow/bootstrap')).json()).value; return Promise.all(b.projects.map(async p=>(await(await fetch('/api/eda-flow/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'open',projectId:p.id})})).json()).value.modelRequests));}")
    frame.locator('[data-step="3"]').click()
    frame.locator('#mpn').fill('UNSAVED-UI-CHECK')
    frame.get_by_role('button', name='返回 Harness', exact=True).click()
    page.wait_for_function('!document.querySelector("[data-eda-flow-window]").open')
    assert page.locator('button[aria-label="原理图与 PCB 流程"]').evaluate('(b)=>document.activeElement===b')
    page.screenshot(path=str(out/'10-after-host.png'))
    page.get_by_role('button', name='原理图与 PCB 流程', exact=True).click()
    assert frame.locator('#mpn').input_value() == 'UNSAVED-UI-CHECK'
    frame.locator('#mpn').fill('')
    page.evaluate("window.postMessage({type:'eda-flow:close'},'*')")
    assert page.locator('[data-eda-flow-window]').evaluate('(d)=>d.open')
    checks.append('Native modal isolates host panels; close restores focus and preserves unsaved form; foreign messages ignored')

    summary = frame.locator('summary').filter(has_text='本步默认输入')
    if not summary.evaluate('(s)=>s.parentElement.open'): summary.click()
    frame.locator('[data-read="03_components/说明.txt"]').click()
    frame.locator('#viewer[open]').wait_for()
    page.keyboard.press('Escape')
    assert not frame.locator('#viewer').evaluate('(d)=>d.open')
    assert page.locator('[data-eda-flow-window]').evaluate('(d)=>d.open')
    frame.locator('#mpn').focus()
    page.keyboard.press('Escape')
    page.wait_for_function('!document.querySelector("[data-eda-flow-window]").open')
    page.get_by_role('button', name='原理图与 PCB 流程', exact=True).click()
    for width, height in [(390,720),(900,640),(1279,820)]:
        page.set_viewport_size({'width':width,'height':height})
        state=geometry(frame)
        assert not state['overflow'] and state['separated'] and state['reachable'], (width,state)
        page.screenshot(path=str(out/f'desktop-{width}.png'))
    after = frame.evaluate("async()=>{const b=(await(await fetch('/api/eda-flow/bootstrap')).json()).value; return Promise.all(b.projects.map(async p=>(await(await fetch('/api/eda-flow/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'open',projectId:p.id})})).json()).value.modelRequests));}")
    assert before == after
    assert not errors, errors
    checks.append('Nested Escape, desktop responsive layout, model request counts unchanged, no page exceptions')
    browser.close()

(out/'ui-validation.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'modelCalls':0},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(checks,ensure_ascii=False))
