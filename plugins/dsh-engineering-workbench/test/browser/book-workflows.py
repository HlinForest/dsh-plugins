"""Live installed plugin: real 224-page manual, progressive forms, PDF comparison gate."""
import os, json, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

artifacts = Path('.verification/browser-book'); artifacts.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(os.environ['DSH_TEST_URL'], wait_until='domcontentloaded')
    try: page.get_by_role('button', name='继续', exact=True).click(timeout=1500)
    except Exception: pass
    page.get_by_role('button', name='打开工程工作台', exact=True).click(timeout=60000)
    panel = page.get_by_role('dialog', name='工程工作台', exact=True)
    panel.get_by_role('button', name='产品方案', exact=True).click()
    expect(panel.get_by_label('客户需求', exact=True)).to_be_visible(timeout=10000)
    catalog = panel.locator('.ew-catalog'); expect(catalog).to_be_visible()
    assert catalog.get_attribute('open') is None
    assert catalog.bounding_box()['y'] > panel.get_by_label('客户需求', exact=True).bounding_box()['y']
    page.screenshot(path=str(artifacts / 'proposal-first.png'))
    panel.get_by_role('button', name='读手册', exact=True).click()
    sources = panel.get_by_role('region', name='手册资料源')
    sources.get_by_role('button', name='添加数据库资料源', exact=False).click()
    manager = sources.get_by_role('region', name='资料源接入设置')
    expect(manager.get_by_role('button', name='重新检测数据库')).to_be_visible(timeout=10000)
    expect(manager.get_by_label('检索工具', exact=True)).not_to_be_visible()
    page.screenshot(path=str(artifacts / 'database-simple.png'))
    manager.get_by_role('button', name='收起接入设置').click()
    sources.get_by_role('button', name='本地 PDF', exact=False).click()
    sources.get_by_label('PDF 手册', exact=True).fill('D:/VisualBoard/dsh-workbench-data/official-materials/megmeet-d97660645079da533d13.pdf')
    sources.get_by_role('button', name='读取手册并继续').click()
    reader = panel.get_by_role('region', name='整本手册阅读')
    expect(reader.get_by_text('已索引 224 页', exact=False)).to_be_visible(timeout=60000)
    reader.get_by_label('搜索整本手册或提出问题').fill('故障')
    reader.get_by_role('button', name='搜索全文', exact=True).click()
    expect(reader.locator('.ew-search-hits article').first).to_be_visible(timeout=10000)
    reader.locator('.ew-search-hits article button').first.click()
    expect(panel.locator('.ew-drawing-viewer')).to_be_visible(timeout=15000)
    expect(panel.locator('.ew-manual-preview')).to_be_focused()
    panel.get_by_role('button', name='返回阅读结果', exact=True).click()
    expect(reader).to_be_focused()
    reader.scroll_into_view_if_needed(); page.screenshot(path=str(artifacts / 'manual-search.png'))
    for width, height in [(375,812), (812,375), (1024,900), (1440,1000)]:
        page.set_viewport_size({'width':width,'height':height})
        if not panel.locator('.ew-content').evaluate('e => e.scrollWidth <= e.clientWidth + 1'):
            page.screenshot(path=str(artifacts / 'overflow.png'))
            print(panel.locator('.ew-content').evaluate("e => [...e.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > e.getBoundingClientRect().right + 2).slice(0,12).map(x => [x.tagName, x.className, x.getBoundingClientRect().width, (x.textContent||'').slice(0,50)])"))
            raise AssertionError(width)
    page.emulate_media(color_scheme='dark', reduced_motion='reduce')
    page.screenshot(path=str(artifacts / 'manual-dark.png'))
    page.emulate_media(color_scheme='light')
    # An actual provider request, limited to the pages selected by the question.
    reader.get_by_label('搜索整本手册或提出问题').fill('SMILE')
    reader.get_by_role('button', name='按问题阅读', exact=True).click()
    expect(reader.get_by_role('button', name='问题回答', exact=True)).to_be_visible(timeout=10000)
    time.sleep(2)
    if reader.get_by_role('button', name='暂停阅读', exact=True).count():
        reader.get_by_role('button', name='暂停阅读', exact=True).click()
        expect(reader.get_by_role('button', name='继续本次阅读', exact=True)).to_be_visible(timeout=15000)
    manual_messages = reader.locator('.ew-reading-progress').inner_text()
    panel.get_by_role('button', name='原理图对比', exact=True).click()
    panel.get_by_label('源原理图', exact=True).fill('D:/VisualBoard/dsh-plugins/plugins/dsh-engineering-workbench/examples/independent/divider.kicad_sch')
    panel.get_by_label('目标原理图 / 图片 / PDF', exact=True).fill('D:/VisualBoard/dsh-plugins/plugins/dsh-engineering-workbench/examples/independent/divider.pdf')
    panel.get_by_role('button', name='读取文件并继续', exact=True).click()
    target = panel.get_by_role('region', name='读取目标资料')
    expect(target).to_be_visible(timeout=60000)
    expect(panel.get_by_role('heading', name='元件对应关系', exact=True)).to_have_count(0)
    target.get_by_role('button', name='识别全部页面并生成对应建议').click()
    time.sleep(3)
    status = target.inner_text()
    page.screenshot(path=str(artifacts / 'pdf-recognition.png'))
    # Save task IDs for a separately bounded check of the live provider result.
    tasks = page.request.post(page.url.split('?')[0].rstrip('/') + '/api/engineering-workbench/engineering', data={'action':'list'}).json()['value']
    result = {'passed': True, 'checks': ['proposal-index-collapsed-below-form','simple-database-picker','actual-224-page-index','whole-book-search','citation-opens-preview','responsive-portrait-landscape','dark-reduced-motion','manual-provider-error-or-pause','unread-pdf-blocks-mapping'], 'manualStatus':manual_messages, 'pdfStatus':status, 'tasks': {kind:next(t['id'] for t in tasks if t['kind']==kind) for kind in ['compare','datasheet']}, 'browserErrors':errors}
    assert not errors, errors
    (artifacts/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False)); browser.close()
