"""Live DSH regression for project continuation and official material sources."""
import hashlib, json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

def verify(page, artifacts):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try: page.get_by_role('button', name='继续', exact=True).click(timeout=2000)
    except Exception: pass
    page.get_by_role('button', name='打开工程工作台', exact=True).click(timeout=60000)
    panel = page.get_by_role('dialog', name='工程工作台', exact=True)
    panel.get_by_role('button', name='原理图评审', exact=True).click()
    section = panel.locator('.ew-engineering:visible')
    section.get_by_role('button', name='选择文件', exact=True).click()
    section.get_by_role('button', name='DisplayBoard.kicad_sch', exact=True).click(timeout=30000)
    expect(section.get_by_text(re.compile('已选择文件。下一步'))).to_be_visible()
    section.get_by_role('button', name='读取文件并继续', exact=True).click()
    expect(section.get_by_role('button', name='开始评审', exact=True)).to_be_visible(timeout=90000)
    expect(section.locator('.ew-drawing-viewer')).to_be_visible()
    assert section.locator('.ew-error').count() == 0
    artifacts.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(artifacts / 'schematic-ready.png'))
    # Changing the file must invalidate the old task before any review action is offered.
    section.get_by_label('待评审工程', exact=True).fill('D:/VisualBoard/dsh-plugins/plugins/dsh-engineering-workbench/examples/independent/divider.kicad_sch')
    expect(section.get_by_role('button', name='开始评审', exact=True)).to_have_count(0)

    panel.get_by_role('button', name='产品方案', exact=True).click()
    expect(panel.get_by_text('麦格米特官网型号与系列资料索引', exact=True)).to_be_visible(timeout=30000)
    panel.locator('.ew-catalog > summary').click()
    panel.get_by_label('查找官网型号或系列', exact=True).fill('SPM-TD61875MBK-W')
    expect(panel.get_by_role('cell', name='SPM-TD61875MBK-W', exact=True)).to_be_visible()
    assert '虚构演示库' not in panel.inner_text()
    page.screenshot(path=str(artifacts / 'official-models.png'))

    panel.get_by_role('button', name='读手册', exact=True).click()
    section = panel.locator('.ew-engineering:visible')
    expect(section.get_by_role('button', name='麦格米特官网', exact=False)).to_have_attribute('aria-pressed', 'true', timeout=30000)
    section.get_by_role('button', name='检索手册', exact=True).click()
    expect(section.get_by_role('button', name='下一页资料')).to_be_visible(timeout=30000)
    first = section.locator('tbody tr').first.text_content()
    section.get_by_role('button', name='下一页资料').click()
    expect(section.locator('tbody tr').first).not_to_have_text(first)
    section.get_by_label('型号或手册关键词').fill('MPT350')
    section.get_by_role('button', name='检索手册', exact=True).click()
    section.get_by_role('button', name='读取此手册', exact=True).first.click(timeout=30000)
    expect(section.get_by_text(re.compile('来源：麦格米特官网全部下载资料'))).to_be_visible(timeout=120000)
    expect(section.get_by_role('region', name='整本手册阅读')).to_be_visible()
    assert section.locator('.ew-error').count() == 0
    page.screenshot(path=str(artifacts / 'official-manual.png'))
    assert not errors, errors
    return {'passed': True, 'checks': ['file-picker-to-schematic-preview', 'review-action-visible', 'input-change-invalidates-old-task', 'official-default-models', 'full-material-pagination', 'live-official-pdf-to-task'], 'browserErrors': errors}

if __name__ == '__main__':
    url = os.environ.get('DSH_TEST_URL')
    if not url:
        log = Path(os.environ['DSH_TEST_SERVER_LOG']).read_text(encoding='utf-8')
        url = re.search(r'https?://[^\s]+', log).group(0)
    source = Path('D:/VisualBoard/DisplayBoard.kicad_sch')
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    artifacts = Path(os.environ.get('DSH_TEST_ARTIFACTS', '.verification/browser-recovery'))
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        try:
            page = browser.new_page(viewport={'width': 1600, 'height': 1050})
            page.goto(url, wait_until='domcontentloaded')
            result = verify(page, artifacts)
            assert hashlib.sha256(source.read_bytes()).hexdigest() == before
            (artifacts / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            print(json.dumps(result))
        finally:
            browser.close()
