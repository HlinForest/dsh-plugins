from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
errors = []
requests = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url))
    page.goto((ROOT / "index.html").as_uri(), wait_until="load")
    assert page.locator("#output").is_visible()
    assert page.locator(".report-content").count() == 2
    assert page.locator(".report-content table").count() >= 8
    page.screenshot(path=str(ROOT / "preview-desktop.png"))
    for panel in ["evidence", "input", "notes", "output"]:
        page.locator(f"#tab-{panel}").click()
        assert page.locator(f"#{panel}").is_visible()
        assert page.locator("[role=tabpanel]:visible").count() == 1
    page.locator("#tab-evidence").click()
    assert page.locator("details.candidate").count() == 5
    assert page.locator("details.candidate[open]").count() == 1
    assert page.locator(".call-list li").count() == 8
    assert page.locator("details.candidate[open] tbody tr").count() == 11
    page.screenshot(path=str(ROOT / "preview-evidence.png"))
    page.locator("#tab-notes").click()
    page.screenshot(path=str(ROOT / "preview-notes.png"))
    page.locator("#tab-output").focus()
    page.keyboard.press("ArrowRight")
    assert page.locator("#evidence").is_visible()
    page.keyboard.press("End")
    assert page.locator("#notes").is_visible()
    page.set_viewport_size({"width": 390, "height": 844})
    for panel in ["output", "evidence", "input", "notes"]:
        page.locator(f"#tab-{panel}").click()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Horizontal page overflow in {panel}"
    page.locator("#tab-output").click()
    page.screenshot(path=str(ROOT / "preview-mobile.png"))
    assert not errors, errors
    assert not [url for url in requests if url.startswith(("https:", "http:"))]
    links = page.locator("a[href]").evaluate_all("items => items.map(item => item.getAttribute('href'))")
    for relative in links:
        assert (ROOT / relative).is_file(), relative
    browser.close()
result = {"passed": True, "desktopViewport": [1440, 1000], "mobileViewport": [390, 844], "tabsWork": True, "keyboardNavigation": True, "pageOverflow": False, "consoleErrors": errors, "externalRequests": 0, "linkedArtifactsExist": True}
(ROOT / "page-verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result))
