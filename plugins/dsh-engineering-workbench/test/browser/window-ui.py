"""Exercise the independent UI against serve-ui.mjs; no provider credentials are loaded."""
import json, sys
from urllib.parse import urljoin
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(sys.argv[1])
meta = json.loads((root / 'server.json').read_text())
titles = ['读手册', '产品方案', '原理图评审', 'PCB 评审', '原理图对比', '向目标对齐', '工程复原', '资料管理', '执行记录', '历史同步任务']
report = {'pages': [], 'consoleErrors': [], 'paidModelCalls': 0}
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
    page = browser.new_page(viewport={'width': 1280, 'height': 850})
    page.on('pageerror', lambda e: report['consoleErrors'].append(str(e)))
    page.goto(meta['url'])
    expect(page.get_by_role('button', name='查看工程进度')).to_contain_text('工程进度')
    assert page.locator('.ew-titlebar').count() == 0, 'Web page must not duplicate native caption'
    for width in [1280, 1586, 1000, 640, 390]:
        page.set_viewport_size({'width': width, 'height': 850})
        for title in titles:
            page.get_by_role('navigation', name='工作台功能').get_by_role('button', name=title, exact=True).click()
            page.wait_for_timeout(130)
            metrics = page.locator('.ew-content').evaluate('(e)=>({client:e.clientWidth,scroll:e.scrollWidth})')
            nav = page.locator('.ew-tabs').evaluate('(e)=>({client:e.clientWidth,scroll:e.scrollWidth})')
            report['pages'].append({'width': width, 'page': title, 'content': metrics, 'navigation': nav})
            if width == 1280:
                page.screenshot(path=str(root / ('page-' + str(titles.index(title) + 1) + '.png')))
            assert metrics['scroll'] <= metrics['client'] + 1, (width, title, metrics)
            assert nav['scroll'] <= nav['client'] + 1, (width, title, nav)
        page.screenshot(path=str(root / ('responsive-' + str(width) + '.png')))
    page.set_viewport_size({'width':1280,'height':850})
    nav = page.get_by_role('navigation', name='工作台功能')
    nav.get_by_role('button', name='原理图评审', exact=True).click()
    section = page.locator('.ew-engineering:visible')
    expect(section.get_by_role('button', name='读取文件并继续')).to_be_enabled()
    section.get_by_role('button', name='读取文件并继续').click()
    expect(section.get_by_role('button', name='开始评审')).to_be_visible(timeout=60000)
    # Read actual fixture, pan/zoom/fullscreen and export a fresh report.
    viewer = section.locator('.ew-drawing-viewer')
    viewer.get_by_role('button', name='放大图纸').click()
    expect(viewer.get_by_label('图纸缩放比例')).to_have_text('125%')
    viewer.get_by_role('button', name='全屏查看').click()
    expect(viewer).to_have_class('ew-drawing-viewer ew-drawing-full')
    page.screenshot(path=str(root / 'drawing-fullscreen.png'))
    viewer.get_by_role('button', name='退出全屏').click()
    section.get_by_role('button', name='开始评审').click()
    expect(section.get_by_text('检查结果', exact=True)).to_be_visible(timeout=60000)
    section.get_by_role('button', name='导出报告 / 资料卡', exact=True).click()
    expect(section.locator('.ew-artifacts a').first).to_be_visible(timeout=60000)
    for link in section.locator('.ew-artifacts a').all():
        response = page.request.get(urljoin(meta['url'],link.get_attribute('href')))
        assert response.ok, response.status
    report['nativeReadZoomFullscreenReviewExport'] = True
    page.screenshot(path=str(root / 'schematic-results.png'))
    # Failed requests preserve drafts and a retry uses the same page.
    nav.get_by_role('button', name='向目标对齐', exact=True).click()
    section = page.locator('.ew-engineering:visible')
    section.get_by_label('目标原理图 / 图片 / PDF').fill(str(Path(meta['fixture'])/'changed-value.kicad_sch'))
    page.route('**/engineering', lambda route: route.fulfill(status=500, json={'ok':False,'error':'模拟超时，请重试。'}) if (route.request.post_data_json or {}).get('action') == 'create' else route.continue_())
    section.get_by_role('button', name='读取文件并继续').click()
    expect(section.get_by_role('alert')).to_contain_text('模拟超时')
    page.screenshot(path=str(root/'failure.png'))
    page.unroute('**/engineering')
    section.get_by_role('button', name='读取文件并继续').click()
    expect(section.get_by_text('元件对应关系', exact=True)).to_be_visible(timeout=60000)
    report['retryPreservesInputs'] = True
    assert not report['consoleErrors'], report['consoleErrors']
    report['model'] = page.request.get(meta['url'].split('/api/')[0]+'/__mock').json()
    (root/'browser-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    browser.close()
print('Independent browser pages, responsive layouts and task interactions passed.')
