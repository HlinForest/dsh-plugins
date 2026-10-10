from pathlib import Path
import json
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
errors=[];external=[];checks=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
 for width,height in [(1440,1000),(390,844)]:
  page=browser.new_page(viewport={'width':width,'height':height});page.on('pageerror',lambda x:errors.append(str(x)));page.on('request',lambda r:external.append(r.url) if r.url.startswith(('http://','https://')) else None)
  page.goto((ROOT/'index.html').as_uri(),wait_until='load');assert page.locator('#scene-initial').is_visible()
  for scene in ['initial','changed','expanded']:
   page.locator(f'[data-scene="{scene}"]').click();assert page.locator(f'#scene-{scene}').is_visible();assert page.locator(f'#scene-{scene} svg').count()==2
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),scene
  detail=page.locator('#scene-expanded > details');detail.locator('summary').first.click();page.locator('#scene-expanded [data-filter]').fill('CP20');assert page.locator('#scene-expanded [data-matrix] tbody tr:visible').count()==4
  page.locator('#scene-expanded select[data-status]').select_option('matches_listed_constraints');assert page.locator('#scene-expanded [data-matrix] tbody tr:visible').count()==4
  page.locator('[data-scene="initial"]').click();page.screenshot(path=str(ROOT/f'preview-{width}.png'),full_page=False)
  if page.locator('#repeat').count():
   for repeat in ['1','2','3']:
    page.locator('#repeat').select_option(repeat)
    for scene in ['initial','changed','expanded']:
     page.locator('#stage').select_option(scene)
     for arm in ['a','b','c','d']:
      page.locator(f'button[data-arm="{arm}"]').click();assert page.locator('.raw-answer:visible').count()==1
  missing=[]
  for a in page.locator('a[href]').all():
   href=a.get_attribute('href');u=urlparse(href)
   if not u.scheme and not href.startswith('#') and not (ROOT/unquote(u.path)).resolve().exists():missing.append(href)
  assert not missing,missing[:15]
  checks.append({'viewport':[width,height],'sceneSwitch':True,'charts':True,'matrixFilter':True,'overflow':False,'localLinks':True});page.close()
 static=browser.new_context(java_script_enabled=False);page=static.new_page();page.goto((ROOT/'index.html').as_uri());assert page.locator('.scene:visible').count()==3;assert page.locator('.engineering-charts svg').count()==6;checks.append({'staticMode':True,'allConclusions':True,'allCharts':True});static.close();browser.close()
assert not errors,errors;assert not external,external
(ROOT/'page-verification.json').write_text(json.dumps({'pass':True,'checks':checks,'scriptErrors':errors,'automaticExternalRequests':external},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'pass':True,'checks':checks}))
