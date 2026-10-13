"""Live regression: a material source is selectable and has an actionable next step."""
import os, json, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    artifacts = Path('.verification/browser-ux')
    artifacts.mkdir(parents=True, exist_ok=True)
    page.goto(os.environ['DSH_TEST_URL'], wait_until='domcontentloaded')
    try: page.get_by_role('button', name='继续', exact=True).click(timeout=1500)
    except Exception: pass
    page.get_by_role('button', name='打开工程工作台', exact=True).click(timeout=60000)
    panel = page.get_by_role('dialog', name='工程工作台', exact=True)
    panel.get_by_role('button', name='读手册', exact=True).click()
    region = panel.get_by_role('region', name='手册资料源')
    expect(region.get_by_role('button', name='本地 PDF', exact=False)).to_be_visible(timeout=8000)
    region.get_by_role('button', name='本地 PDF', exact=False).click()
    expect(region.get_by_label('PDF 手册', exact=True)).to_be_visible()
    expect(region.get_by_role('button', name='添加数据库资料源', exact=False)).to_be_visible()
    region.get_by_label('PDF 手册', exact=True).fill('D:/VisualBoard/dsh-plugins/plugins/dsh-engineering-workbench/examples/independent/divider.pdf')
    region.get_by_role('button', name='读取手册并继续', exact=True).click()
    expect(panel.get_by_role('region', name='当前任务', exact=True)).to_be_visible(timeout=60000)
    expect(panel.get_by_text('文件已读取', exact=True)).to_be_visible()
    page.screenshot(path=str(artifacts / 'local-manual.png'))
    region.get_by_label('PDF 手册', exact=True).fill('')
    expect(panel.get_by_role('region', name='当前任务', exact=True)).to_have_count(0)

    region.get_by_role('button', name='麦格米特官网', exact=False).click()
    region.get_by_label('型号或手册关键词').press('Enter')
    expect(region.get_by_role('button', name='下一页资料')).to_be_enabled(timeout=10000)
    first = region.locator('tbody tr').first.text_content()
    region.get_by_role('button', name='下一页资料').click()
    expect(region.locator('tbody tr').first).not_to_have_text(first)
    region.get_by_role('button', name='上一页资料').click()
    expect(region.locator('tbody tr').first).to_have_text(first)
    region.get_by_label('型号或手册关键词').fill('no-such-model-' + uuid.uuid4().hex)
    region.get_by_label('型号或手册关键词').press('Enter')
    expect(region.get_by_text('没有找到匹配的资料', exact=True)).to_be_visible()
    region.get_by_role('button', name='清空关键词').click()

    name = '浏览器验证库-' + uuid.uuid4().hex[:8]
    added_id = None
    try:
        region.get_by_role('button', name='添加数据库资料源', exact=False).click()
        settings = region.get_by_role('region', name='资料源接入设置')
        settings.get_by_role('button', name='高级接入（管理员配置）', exact=True).click()
        settings.get_by_label('资料源名称', exact=True).fill(name)
        settings.get_by_label('检索工具', exact=True).fill('mcp__ux_verify__search')
        settings.get_by_label('读取工具', exact=True).fill('mcp__ux_verify__read')
        settings.get_by_label('这两个工具仅用于检索和读取资料', exact=True).check()
        with page.expect_response(lambda r: r.url.endswith('/material-sources') and r.request.method == 'POST') as saved:
            settings.get_by_role('button', name='保存资料源', exact=True).click()
        added_id = saved.value.json()['value']['id']
        expect(region.get_by_text('资料源已保存，等待数据库连接', exact=True)).to_be_visible()
        expect(region.get_by_role('button', name='添加数据库资料源', exact=False)).to_be_focused()
        page.screenshot(path=str(artifacts / 'pending-database.png'))
        page.reload(wait_until='domcontentloaded')
        page.get_by_role('button', name='打开工程工作台', exact=True).click(timeout=60000)
        panel.get_by_role('button', name='读手册', exact=True).click()
        region.get_by_role('button', name=name, exact=False).click()
        expect(region.get_by_text('资料源已保存，等待数据库连接', exact=True)).to_be_visible()
        region.get_by_role('button', name='查看接入设置', exact=True).click()
        settings.get_by_role('button', name='编辑 ' + name, exact=True).click()
        settings.get_by_label('资料源名称', exact=True).fill(name + '-修改')
        settings.get_by_role('button', name='保存修改', exact=True).click()
        expect(region.get_by_role('button', name=name + '-修改', exact=False)).to_be_visible()
        region.get_by_role('button', name='查看接入设置', exact=True).click()
        settings.get_by_role('button', name='移除 ' + name + '-修改', exact=True).click()
        settings.get_by_role('button', name='确认移除', exact=True).click()
        expect(region.get_by_role('button', name=name, exact=False)).to_have_count(0)
        added_id = None
    finally:
        if added_id:
            page.request.post(page.url.split('/?')[0].split('?')[0].rstrip('/') + '/api/engineering-workbench/material-sources', data={'action': 'remove-source', 'id': added_id})

    region.get_by_role('button', name='麦格米特官网', exact=False).click()
    for width in [1440, 1024, 768, 375]:
        page.set_viewport_size({'width': width, 'height': 1000 if width > 400 else 812})
        region.scroll_into_view_if_needed()
        assert panel.evaluate('e => e.scrollWidth <= e.clientWidth + 1'), width
        assert panel.locator('.ew-content').evaluate('e => e.scrollWidth <= e.clientWidth + 1'), width
        page.screenshot(path=str(artifacts / f'sources-{width}.png'))
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.emulate_media(color_scheme='dark', reduced_motion='reduce')
    page.screenshot(path=str(artifacts / 'sources-dark.png'))
    page.emulate_media(color_scheme='light')
    panel.get_by_role('button', name='原理图评审', exact=True).click()
    section = panel.locator('.ew-engineering:visible')
    section.get_by_label('待评审工程', exact=True).fill('D:/VisualBoard/dsh-plugins/plugins/dsh-engineering-workbench/examples/independent/divider.kicad_sch')
    section.get_by_role('button', name='读取文件并继续', exact=True).click()
    expect(section.get_by_role('button', name='开始评审', exact=True)).to_be_visible(timeout=60000)
    expect(section.locator('.ew-workflow [aria-current="step"]')).to_contain_text('预览与评审')
    page.screenshot(path=str(artifacts / 'schematic-next-step.png'))
    section.get_by_label('待评审工程', exact=True).fill('')
    expect(section.get_by_role('button', name='开始评审', exact=True)).to_have_count(0)
    expect(section.get_by_role('button', name='读取文件并继续', exact=True)).to_be_disabled()
    panel.get_by_role('button', name='读手册', exact=True).click()
    panel.get_by_role('button', name='关闭工作台', exact=True).click()
    expect(page.get_by_role('button', name='打开工程工作台', exact=True)).to_be_focused()
    page.get_by_role('button', name='打开工程工作台', exact=True).click()
    page.keyboard.press('Shift+Tab')
    assert panel.evaluate('e => e.contains(document.activeElement)')
    page.keyboard.press('Escape')
    expect(panel).not_to_be_visible()
    assert not errors, errors
    (artifacts / 'result.json').write_text(json.dumps({'passed': True, 'checks': ['local-pdf-to-task', 'enter-search', 'two-way-pagination', 'actionable-empty-state', 'source-create-reload-edit-remove', 'real-disconnected-state', 'four-responsive-widths', 'dark-reduced-motion', 'engineering-next-step', 'input-change-invalidates-task', 'keyboard-focus-return'], 'browserErrors': errors}, indent=2), encoding='utf-8')
    browser.close()
    print('PASS: 11 material-source and workbench UX checks')
