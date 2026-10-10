"""Native DSH browser regression. Requires Python Playwright and a configured PCB profile.

Set DSH_TEST_URL to the authenticated local DSH URL (kept out of logs).
Optionally set DSH_BROWSER_PATH and DSH_TEST_ARTIFACTS. Uses read-only PCB queries.
"""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def verify(page, artifacts=None):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    opener = page.get_by_role('button', name='打开工程工作台', exact=True)
    opener.wait_for(timeout=60000)
    try:
        page.get_by_role('button', name='继续', exact=True).click(timeout=1500)
    except Exception:
        pass
    opener.click()
    panel = page.get_by_role('dialog', name='工程工作台')
    panel.get_by_role('button', name='PCB 评审', exact=True).click()
    nodes = panel.locator('.ew-map:visible .ew-map-node')
    nodes.first.wait_for(timeout=60000)
    assert nodes.count() >= 2, 'Fixture needs at least two positioned components'
    canvas = panel.locator('.ew-map:visible')
    first, second = nodes.nth(0), nodes.nth(1)
    refs = [node.get_attribute('aria-label').split()[1] for node in (first, second)]

    def shot(name):
        if artifacts:
            Path(artifacts).mkdir(parents=True, exist_ok=True)
            canvas.screenshot(path=str(Path(artifacts) / (name + '.png')))

    def clear():
        canvas.click(position={'x': 12, 'y': 12})
        expect(canvas.locator('.selected')).to_have_count(0)
        expect(canvas.locator('text')).to_have_count(0)
        expect(panel.locator('.ew-refbox')).to_have_count(0)

    def detail(ref):
        expect(panel.locator('.ew-refbox h3')).to_have_text(re.compile(r'^' + re.escape(ref) + r' · '))

    for zoom in ('1', '2'):
        page.locator('body').evaluate('(el, zoom) => el.style.zoom = zoom', zoom)
        first.scroll_into_view_if_needed()
        baseline = first.bounding_box()['width']
        first.click()
        detail(refs[0])
        assert first.evaluate('el => getComputedStyle(el).outlineStyle') == 'none', 'SVG focus outline expands with viewBox'
        assert first.bounding_box()['width'] <= baseline * 1.6, 'Selection excessively enlarges marker'
        shot('selected-zoom-' + zoom)
        clear()
        shot('cleared-zoom-' + zoom)
    page.locator('body').evaluate("el => el.style.zoom = '1'")

    # Real keyboard traversal must retain a visible, bounded focus indicator.
    first.focus()
    first.press('Tab')
    expect(second).to_be_focused()
    ring = second.locator('xpath=following-sibling::*[1]')
    assert ring.evaluate('el => getComputedStyle(el).visibility') == 'visible'
    assert ring.bounding_box()['width'] < second.bounding_box()['width'] * 3
    assert second.evaluate('el => getComputedStyle(el).outlineStyle') == 'none'
    second.press('Enter')
    detail(refs[1])
    shot('keyboard-focus')
    second.press('Escape')
    expect(canvas.locator('.selected')).to_have_count(0)
    second.press('Space')
    detail(refs[1])
    clear()

    # Hold real responses, then release them after clear / in reverse order.
    pending = []

    def hold(route):
        body = route.request.post_data_json or {}
        if body.get('group') == 'pcb' and body.get('action') == 'inspect' and body.get('args', {}).get('ref'):
            pending.append((route, route.fetch()))
        else:
            route.continue_()

    def wait_pending(count):
        for _ in range(100):
            if len(pending) == count:
                return
            page.wait_for_timeout(30)
        raise AssertionError('Expected component queries were not dispatched')

    page.route('**/api/engineering-workbench/action', hold)
    first.click()
    wait_pending(1)
    clear()
    route, response = pending.pop()
    route.fulfill(response=response)
    page.wait_for_timeout(100)
    expect(canvas.locator('.selected')).to_have_count(0)
    expect(panel.locator('.ew-refbox')).to_have_count(0)
    first.click()
    second.click()
    wait_pending(2)
    new_route, new_response = pending.pop()
    new_route.fulfill(response=new_response)
    detail(refs[1])
    old_route, old_response = pending.pop()
    old_route.fulfill(response=old_response)
    page.wait_for_timeout(100)
    detail(refs[1])
    expect(second).to_have_class(re.compile(r'\bselected\b'))
    expect(first).not_to_have_class(re.compile(r'\bselected\b'))
    clear()
    page.unroute('**/api/engineering-workbench/action', hold)
    assert not errors, errors
    return {'passed': True, 'checks': ['mouse-100%', 'mouse-200%', 'blank-clear', 'keyboard', 'late-clear', 'out-of-order'], 'components': nodes.count()}


if __name__ == '__main__':
    with sync_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('DSH_BROWSER_PATH'):
            options['executable_path'] = os.environ['DSH_BROWSER_PATH']
        browser = pw.chromium.launch(**options)
        page = browser.new_page(viewport={'width': 1600, 'height': 1080})
        page.goto(os.environ['DSH_TEST_URL'], wait_until='domcontentloaded')
        print(verify(page, os.environ.get('DSH_TEST_ARTIFACTS')))
        browser.close()
