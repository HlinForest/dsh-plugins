"""Small format helpers for this local trial; no historical project dependency."""
import collections, csv, hashlib, json, re, uuid
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"vendor"))
import sexpdata as sx

ROOT = Path(__file__).resolve().parents[1]
READS = []
def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):
    p = Path(p); READS.append({'path': str(p), 'sha256': digest(p)})
    return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p, data):
    p=Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
def table(p, fields, rows):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.writer(f);w.writerow(fields);w.writerows(rows)
def tag(x): return str(x[0]) if isinstance(x,list) and x else ''
def child(x,t,default=None): return next((v for v in x if tag(v)==t),default)
def children(x,t): return [v for v in x if tag(v)==t]
def prop(x): return {v[1]:v[2] for v in children(x,'property')}
def S(x): return sx.Symbol(x)
def node(t,*args): return [S(t),*args]
def decode(x):
    if isinstance(x,dict) and set(x)=={'atom'}:return S(x['atom'])
    return [decode(v) for v in x] if isinstance(x,list) else x
def encode(x):
    if isinstance(x,sx.Symbol):return {'atom':str(x)}
    return [encode(v) for v in x] if isinstance(x,list) else x
def uid(key):return str(uuid.uuid5(uuid.NAMESPACE_URL,'display-board-local-trial/'+str(key)))
def save_sexp(p,x):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    # Root records are separate lines; the CAD writer may further format them.
    p.write_text('('+str(x[0])+'\n'+'\n'.join('  '+sx.dumps(v) for v in x[1:])+'\n)\n',encoding='utf-8')
def strip_ids(x):
    if not isinstance(x,list):
        if isinstance(x,(str,sx.Symbol)):return re.sub(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}','<id>',str(x))
        return x
    if tag(x) in {'uuid','tstamp'}:return None
    values=[strip_ids(v) for v in x[1:]];values=[v for v in values if v is not None]
    if tag(x) in {'kicad_pcb','kicad_sch','kicad_symbol_lib','footprint','lib_symbols','symbol'}:
        values=[v for v in values if not isinstance(v,list)]+sorted([v for v in values if isinstance(v,list)],key=lambda v:json.dumps(v,ensure_ascii=True))
    return [tag(x)]+values
def object_key(x):return hashlib.sha256(json.dumps(strip_ids(x),ensure_ascii=False).encode()).hexdigest()
def walk(x):
    if isinstance(x,list):
        yield x
        for y in x:yield from walk(y)
def text(f,k='Text'):return f.get('%UTF8%'+k,f.get(k,''))
def number(f,k):return float(f.get(k,0))+float(f.get(k+'_Frac',0))/100000
def source_point(f):return number(f,'Location.X'),number(f,'Location.Y')
def safe(s):return re.sub(r'[^A-Za-z0-9_.-]','_',s) or 'Display'
