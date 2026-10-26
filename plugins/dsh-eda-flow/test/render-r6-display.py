"""Render only the specification-driven display; not an electrical acceptance test."""
from pathlib import Path
import json,sys,subprocess
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'mcp'))
import evidence_symbols as es,native_resources as nr,generic_layout as gl
from design_audit import child,children
import pymupdf as f
rows=json.loads((ROOT/'test/fixtures/mock-r6-records.json').read_text(encoding='utf8'));s=es.build('Evidence:R6_Display',rows)
out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
c=dict(id='display',ref='*',value='LED',mpn='',footprint='',librarySymbol=s['id'],dnp=False,in_bom=True,on_board=True,pins=s['pins'])
raw=gl.instance(c,s,x=100,y=110)
for p in children(raw,'property'):
 a=child(p,'at');a[1]=gl.number(float(a[1])+100);a[2]=gl.number(float(a[2])+110)
ast=gl.document({'symbols':{s['id']:s},'mockEvidence':rows},[raw],paper='A4');(out/'Symbol.kicad_sch').write_text(nr.dump(ast),encoding='utf8')
subprocess.run(['D:/Kicad/bin/kicad-cli.exe','sch','export','pdf','-o',str(out/'Symbol.pdf'),str(out/'Symbol.kicad_sch')],check=True)
d=f.open(out/'Symbol.pdf');d[0].get_pixmap(matrix=f.Matrix(4,4),clip=f.Rect(85*72/25.4,75*72/25.4,135*72/25.4,122*72/25.4)).save(out/'symbol.png')
print(out/'symbol.png')
