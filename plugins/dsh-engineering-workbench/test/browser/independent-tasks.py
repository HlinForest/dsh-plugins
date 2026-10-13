"""Real DSH browser regression; source hardware is never overwritten."""
import json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

def verify(page, artifacts):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try: page.get_by_role('button', name='继续', exact=True).click(timeout=2000)
    except Exception: pass
    page.get_by_role('button', name='打开工程工作台', exact=True).click(timeout=60000)
    panel = page.get_by_role('dialog', name='工程工作台', exact=True)
    for title in ['读手册', '产品方案', '原理图评审', 'PCB 评审', '原理图对比', '向目标对齐']:
        expect(panel.get_by_role('button', name=title, exact=True)).to_have_count(1)
    # No product catalog, schematic-sync provider or PCB-review provider installed.
    panel.get_by_role('button', name='读取文件并继续', exact=True).click()
    expect(panel.get_by_role('button', name='开始评审', exact=True)).to_be_visible(timeout=60000)
    panel.get_by_role('button', name='器件定位与实际焊盘网络', exact=True).click()
    canvas = panel.locator('.ew-map:visible')
    marker = canvas.locator('.ew-map-node').first
    for scale in ['1', '2']:
        page.locator('body').evaluate('(e,z) => e.style.zoom=z', scale)
        marker.scroll_into_view_if_needed()
        width = marker.bounding_box()['width']
        marker.click()
        expect(panel.locator('.ew-refbox')).to_be_visible()
        assert marker.bounding_box()['width'] <= width * 1.6
        assert marker.evaluate('e => getComputedStyle(e).outlineStyle') == 'none'
        canvas.click(position={'x': 12, 'y': 12})
        expect(canvas.locator('.selected')).to_have_count(0)
        expect(panel.locator('.ew-refbox')).to_have_count(0)
    page.locator('body').evaluate("e => e.style.zoom='1'")
    marker.focus(); marker.press('Enter')
    expect(panel.locator('.ew-refbox')).to_be_visible()
    marker.press('Escape')
    expect(canvas.locator('.selected')).to_have_count(0)
    panel.get_by_role('button', name='开始评审', exact=True).click()
    expect(panel.get_by_text('检查结果', exact=True)).to_be_visible(timeout=120000)
    assert panel.get_by_text('检查失败', exact=True).count() == 0
    panel.get_by_role('button', name='原理图对比', exact=True).click()
    section = panel.locator('.ew-engineering:visible')
    section.get_by_label('目标原理图 / 图片 / PDF').fill('D:/VisualBoard/DisplayBoard.kicad_sch')
    section.get_by_role('button', name='读取文件并继续', exact=True).click()
    expect(section.get_by_text('元件对应关系', exact=True)).to_be_visible(timeout=60000)
    viewer = section.locator('.ew-drawing-viewer')
    viewer.get_by_role('button', name='放大图纸', exact=True).click()
    expect(viewer.get_by_label('图纸缩放比例')).to_have_text('125%')
    viewer.get_by_role('button', name='全屏查看', exact=True).click()
    expect(viewer).to_have_class(re.compile('ew-drawing-full'))
    viewer.get_by_role('button', name='退出全屏', exact=True).click()
    section.get_by_role('button', name='比较元件、连接和功能指标', exact=True).click()
    expect(section.locator('.ew-conclusions')).to_be_visible(timeout=60000)
    assert '待确认' in section.locator('.ew-conclusions').inner_text()
    artifacts.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(artifacts / 'independent-compare.png'), full_page=False)
    panel.get_by_role('button', name='向目标对齐', exact=True).click()
    section = panel.locator('.ew-engineering:visible')
    fixture = 'D:/VisualBoard/dsh-plugins/plugins/dsh-engineering-workbench/examples/independent/'
    section.get_by_label('源原理图', exact=True).fill(fixture + 'divider.kicad_sch')
    section.get_by_label('目标原理图 / 图片 / PDF').fill(fixture + 'changed-value.kicad_sch')
    section.get_by_role('button', name='读取文件并继续', exact=True).click()
    expect(section.get_by_role('button', name='保存对应关系', exact=True)).to_be_visible(timeout=60000)
    for check in section.get_by_label('已核对', exact=True).all(): check.check()
    section.get_by_role('button', name='保存对应关系', exact=True).click()
    row = section.get_by_role('row').filter(has_text='components · 数值')
    expect(row).to_be_visible(timeout=60000)
    row.get_by_role('checkbox').check()
    section.get_by_role('button', name='将所选差异对齐到目标', exact=True).click()
    expect(section.get_by_text('实际修改记录', exact=True)).to_be_visible(timeout=60000)
    editor = section.locator('.ew-graphic-editor')
    expect(editor.get_by_text('R1 22k', exact=True)).to_be_visible()
    editor.get_by_role('button', name='撤销', exact=True).click()
    expect(editor.get_by_text('R1 10k', exact=True)).to_be_visible(timeout=60000)
    editor.get_by_role('button', name='重做', exact=True).click()
    expect(editor.get_by_text('R1 22k', exact=True)).to_be_visible(timeout=60000)
    editor.get_by_placeholder('搜索位号').fill('R1')
    editor.get_by_role('button', name='定位', exact=True).click()
    edit_requests = []
    def edits(request):
        if request.url.endswith('/engineering') and request.method == 'POST':
            body = request.post_data_json or {}
            if body.get('action') == 'edit': edit_requests.append(body)
    page.on('request', edits)
    part = editor.locator('g[data-object]').filter(has_text='R1 22k').locator('rect')
    part.click()
    page.wait_for_timeout(200)
    assert not edit_requests, 'Selecting a component must not move it when viewBox changes'
    part.scroll_into_view_if_needed()
    rectangle = part.bounding_box()
    dx = editor.locator('svg').evaluate('e => 2.54 * e.getScreenCTM().a')
    x, y = rectangle['x'] + rectangle['width']/2, rectangle['y'] + rectangle['height']/2
    with page.expect_response(lambda r: r.url.endswith('/engineering') and r.request.method == 'POST' and (r.request.post_data_json or {}).get('action') == 'edit', timeout=60000) as changed:
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + dx, y, steps=5); page.mouse.up()
    result = changed.value.json()
    assert result['ok'], result.get('error')
    moved = next(c for c in result['value']['candidate']['design']['components'] if c['ref'] == 'R1')
    assert abs(moved['at'][0] - 78.74) < .001, moved['at']
    assert page.evaluate('window.getSelection().toString()') == '', 'Drag must not leave a browser text-selection highlight'
    assert edit_requests, 'Dragging must issue an edit'
    # Wait on the operation response through the task status, then inspect the final UI.
    expect(section.locator('.ew-error')).to_have_count(0, timeout=60000)
    expect(section.get_by_role('button', name='比较元件、连接和功能指标', exact=True)).to_be_enabled(timeout=60000)
    editor.get_by_role('button', name='全屏编辑', exact=True).click()
    expect(editor).to_have_class(re.compile('ew-drawing-full'))
    editor.get_by_role('button', name='取消选择', exact=True).click()
    expect(editor.get_by_text('未选择', exact=True)).to_be_visible()
    editor.get_by_role('button', name='退出全屏', exact=True).click()
    editor.scroll_into_view_if_needed()
    editor.screenshot(path=str(artifacts / 'independent-align.png'))
    panel.get_by_role('button', name='资料管理', exact=True).click()
    expect(panel.get_by_role('button', name='打开此记录', exact=True).first).to_be_visible(timeout=60000)
    panel.get_by_role('button', name='打开此记录', exact=True).first.click()
    expect(panel.locator('.ew-engineering:visible').get_by_label('源原理图', exact=True)).to_have_value(fixture + 'divider.kicad_sch', timeout=60000)
    assert not errors, errors
    return {'passed': True, 'checks': ['six-entries', 'board-only-native-drc', 'optional-provider-isolation', 'pcb-marker-100%', 'pcb-marker-200%', 'pcb-clear', 'pcb-keyboard', 'two-native-inputs', 'unknown-mapping-no-pass', 'zoom', 'fullscreen', 'candidate-real-value-change', 'undo-redo', 'click-does-not-move', 'drag-native-coordinates', 'editor-fullscreen-clear', 'materials-reopen'], 'browserErrors': errors}

if __name__ == '__main__':
    url = os.environ.get('DSH_TEST_URL')
    if not url:
        log = Path(os.environ['DSH_TEST_SERVER_LOG']).read_text(encoding='utf-8')
        url = re.search(r'https?://[^\s]+', log).group(0)
    artifacts = Path(os.environ.get('DSH_TEST_ARTIFACTS', '.verification/browser'))
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=os.environ.get('DSH_BROWSER_PATH', 'C:/Program Files/Google/Chrome/Application/chrome.exe'))
        page = browser.new_page(viewport={'width': 1600, 'height': 1050})
        page.goto(url, wait_until='domcontentloaded')
        result = verify(page, artifacts)
        (artifacts / 'independent-tasks.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result))
        browser.close()
