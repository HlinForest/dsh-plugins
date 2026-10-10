from pathlib import Path
import json
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent
errors=[];requests=[];checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
    for width,height in [(1440,1000),(390,844)]:
        page=browser.new_page(viewport={'width':width,'height':height})
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:requests.append(r.url) if r.url.startswith(('http://','https://')) else None)
        page.goto((ROOT/'index.html').as_uri(),wait_until='load')
        assert page.locator('[data-tab]').count()==5
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        if width==1440:page.screenshot(path=str(ROOT/'preview-desktop.png'),full_page=False)
        else:page.screenshot(path=str(ROOT/'preview-mobile.png'),full_page=False)
        for tab in ['compare','materials','links','method','results']:
            page.locator(f'[data-tab="{tab}"]').click()
            assert page.locator(f'#{tab}').is_visible()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),tab
        page.locator('[data-tab="materials"]').click()
        page.locator('#product-search').fill('MPT150')
        assert page.locator('#product-rows tr:visible').count()==3
        page.locator('#product-search').fill('')
        assert page.locator('#product-rows tr:visible').count()==28
        missing=[]
        for anchor in page.locator('a[href]').all():
            href=anchor.get_attribute('href'); parsed=urlparse(href)
            if not parsed.scheme and not href.startswith('#'):
                target=(ROOT/unquote(parsed.path)).resolve()
                if not target.exists():missing.append(href)
        assert not missing,missing
        page.locator('[data-tab="results"]').click()
        for i in range(6):
            page.locator(f'[data-case="{i}"]').click()
            assert page.locator(f'#case-{i}').is_visible()
            assert page.locator(f'#case-{i} tbody tr').count()==28
        checks.append({'viewport':f'{width}x{height}','tabs':5,'cases':6,'productFilter':True,'localLinksExist':True,'horizontalOverflow':False})
        page.close()
    browser.close()
assert not errors,errors
assert not requests,requests
(ROOT/'page-verification.json').write_text(json.dumps({'pass':True,'checks':checks,'pageErrors':errors,'automaticExternalRequests':requests},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'pass':True,'viewports':checks,'pageErrors':len(errors),'automaticExternalRequests':len(requests)}))
