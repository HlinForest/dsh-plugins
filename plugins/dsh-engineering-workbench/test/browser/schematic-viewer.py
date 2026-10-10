"""Exercise the native schematic comparison with DSH_TEST_TASK (a candidate task).
Uses the same DSH_TEST_URL / DSH_BROWSER_PATH conventions as pcb-map.py.
Verification generates previews and ERC reports; does not apply the candidate.
"""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def verify(page, task_id, artifacts=None):
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    opener = page.get_by_role('button', name='打开工程工作台', exact=True)
    opener.wait_for(timeout=60000)
    try:
        page.get_by_role('button', name='继续', exact=True).click(timeout=1500)
    except Exception:
        pass
    opener.click()
    panel = page.get_by_role('dialog', name='工程工作台')
    panel.get_by_role('button', name='原理图同步', exact=True).click()
    tasks = panel.get_by_label('已有原理图任务', exact=True)
    expect(tasks).to_be_enabled(timeout=60000)
    expect(tasks.locator('option[value="' + task_id + '"]')).to_have_count(1, timeout=60000)
    tasks.select_option(task_id)
    expect(panel.get_by_role('button', name='验证候选并生成对比', exact=True)).to_have_count(0)
    panel.get_by_role('button', name='验证与写回', exact=True).click()
    run = panel.get_by_role('button', name='验证候选并生成对比', exact=True)
    expect(run).to_be_enabled(timeout=60000)
    run.click()
    changes = panel.get_by_role('region', name='本次实际修改', exact=True)
    changes.wait_for(timeout=120000)
    assert changes.locator('.ew-change-list button').count() > 1
    viewer = changes.locator('.ew-drawing-viewer')
    sheets = viewer.locator('.ew-sheet')
    expect(sheets).to_have_count(2)
    assert sheets.nth(0).locator('image').get_attribute('href') != sheets.nth(1).locator('image').get_attribute('href')

    def boxes():
        return [list(map(float, s.get_attribute('viewBox').split())) for s in sheets.all()]

    first = boxes()
    viewer.get_by_role('button', name='放大图纸', exact=True).click()
    expect(viewer.get_by_label('图纸缩放比例')).to_have_text('125%')
    zoomed = boxes()
    assert all(abs(a[2] / b[2] - 1.25) < .001 for a, b in zip(first, zoomed))
    stage = viewer.locator('.ew-drawing-stage').first
    stage.scroll_into_view_if_needed()
    p = stage.bounding_box()
    page.mouse.move(p['x'] + p['width'] / 2, p['y'] + p['height'] / 2)
    page.mouse.down()
    page.mouse.move(p['x'] + p['width'] / 2 + 70, p['y'] + p['height'] / 2 + 40, steps=5)
    page.mouse.up()
    moved = boxes()
    assert all(a[0] != b[0] and a[1] != b[1] for a, b in zip(zoomed, moved))
    page.mouse.wheel(0, -100)
    expect(viewer.get_by_label('图纸缩放比例')).to_have_text('144%')
    viewer.get_by_role('button', name='适合窗口', exact=True).click()
    expect(viewer.get_by_label('图纸缩放比例')).to_have_text('100%')
    assert boxes() == first
    viewer.get_by_role('button', name='全屏查看', exact=True).click()
    expect(viewer).to_have_attribute('role', 'dialog')
    expect(viewer.get_by_role('button', name='退出全屏', exact=True)).to_be_focused()
    assert viewer.bounding_box()['height'] > page.viewport_size['height'] * .9
    if artifacts:
        Path(artifacts).mkdir(parents=True, exist_ok=True)
        viewer.screenshot(path=str(Path(artifacts) / 'schematic-fullscreen.png'))
    page.keyboard.press('Escape')
    expect(viewer).to_have_attribute('role', 'region')
    expect(panel).to_be_visible()
    # Changing an actual edit updates marks and resets the common camera.
    buttons = changes.locator('.ew-change-list button')
    buttons.nth(2).click()
    assert boxes() != first
    expect(viewer.get_by_label('图纸缩放比例')).to_have_text('100%')
    assert sheets.nth(0).locator('.ew-change-mark').count() > 0
    changes.get_by_text('同时对照目标原图', exact=True).click()
    expect(sheets).to_have_count(3)
    viewer.get_by_role('button', name='全屏查看', exact=True).click()
    if artifacts:
        viewer.screenshot(path=str(Path(artifacts) / 'schematic-target-compare.png'))
    viewer.get_by_role('button', name='退出全屏', exact=True).click()
    assert not errors, errors
    return {'passed': True, 'checks': ['actual-changes', 'separate-images', 'linked-zoom', 'pan', 'wheel', 'reset', 'fullscreen-escape', 'change-focus', 'target-reference']}


if __name__ == '__main__':
    with sync_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('DSH_BROWSER_PATH'):
            options['executable_path'] = os.environ['DSH_BROWSER_PATH']
        browser = pw.chromium.launch(**options)
        page = browser.new_page(viewport={'width': 1600, 'height': 1080})
        page.goto(os.environ['DSH_TEST_URL'], wait_until='domcontentloaded')
        print(verify(page, os.environ['DSH_TEST_TASK'], os.environ.get('DSH_TEST_ARTIFACTS')))
        browser.close()
