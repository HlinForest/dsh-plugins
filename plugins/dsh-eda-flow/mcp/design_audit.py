"""Read-only library queries and independent CAD/XML/BOM/footprint reconciliation."""
import csv, hashlib, json, re, sys, shutil
from pathlib import Path
import xml.etree.ElementTree as ET

def sexpr(text):
    tokens=re.findall(r'"(?:\\.|[^"\\])*"|[()]|[^\s()]+',text)
    stack=[]; result=[]
    for t in tokens:
        if t=='(':
            row=[]
            (stack[-1] if stack else result).append(row);stack.append(row)
        elif t==')': stack.pop()
        else: stack[-1].append(json.loads(t) if t.startswith('"') else t)
    return result[0]
def children(x,key):return [r for r in x if isinstance(r,list) and r and r[0]==key]
def child(x,key,default=None):return next(iter(children(x,key)),default)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def library_path(root,ident,kind):
    if not re.fullmatch(r'[A-Za-z0-9_+.-]+:[A-Za-z0-9_+.,()\-]+',ident):raise ValueError('需要有效库:名称，不能包含路径')
    lib,name=ident.split(':');base=(root/('symbols' if kind=='symbol' else 'footprints')).resolve()
    p=(base/(lib+'.kicad_sym')) if kind=='symbol' else (base/(lib+'.pretty')/(name+'.kicad_mod'))
    if not p.resolve().is_relative_to(base):raise ValueError('库路径越界')
    return p,name
def lookup(root,kind,query):
    if kind=='search':
        if not 2<=len(query)<=80:raise ValueError('搜索词需要2—80字符')
        results=[]
        for p in (root/'symbols').glob('*.kicad_sym'):
            for name in re.findall(r'^\t\(symbol "([^"]+)"',p.read_text(encoding='utf8'),re.M):
                if query.casefold() in name.casefold():results.append({'kind':'symbol','id':p.stem+':'+name})
        for p in (root/'footprints').glob('*.pretty/*.kicad_mod'):
            if query.casefold() in p.stem.casefold():results.append({'kind':'footprint','id':p.parent.stem+':'+p.stem})
        return {'matches':results[:60],'total':len(results),'truncated':len(results)>60}
    p,name=library_path(root,query,kind)
    data=sexpr(p.read_text(encoding='utf8'))
    if kind=='footprint':
        pads=[{'number':r[1],'type':r[2],'at':child(r,'at',[])[1:],'size':child(r,'size',[])[1:]} for r in children(data,'pad') if r[1]]
        return {'id':query,'kind':kind,'sha256':digest(p),'pads':pads,'description':child(data,'descr',['',''])[1]}
    symbols={x[1]:x for x in children(data,'symbol')}
    def resolve(n,seen):
        if n in seen:raise ValueError('库继承循环')
        row=symbols[n];base=child(row,'extends');return (resolve(base[1],seen|{n}) if base else [])+row[2:]
    row=resolve(name,set());props={r[1]:r[2] for r in children(row,'property')}
    pins=[]
    for unit in children(row,'symbol'):
        for pin in children(unit,'pin'):
            pins.append({'number':child(pin,'number')[1],'name':child(pin,'name')[1],'type':pin[1]})
    return {'id':query,'kind':kind,'sha256':digest(p),'pins':pins,'footprint':props.get('Footprint',''),'datasheet':props.get('Datasheet',''),'description':props.get('Description',''),'note':'KiCad库证据；未替代厂家规格书审定'}

def symbol_evidence(root,ident,evidence):
    if not ident.startswith('Evidence:'):return lookup(root,'symbol',ident)
    rows=[r for r in evidence if r.get('symbolId')==ident and r.get('sourceType') in ('mock-pdf-extraction','pdf-specification-appendix','model-specification-fact')]
    if len(rows)!=1 or not rows[0].get('pins'):raise ValueError('专用符号没有唯一的模拟规格书引脚依据：'+ident)
    row=rows[0]
    return {'id':ident,'pins':row['pins'],'document':row['document'],'page':row['page'],'simulated':True,'pageIsPlaceholder':row['pageIsPlaceholder']}

def audit(root,design,project,evidence=()):
    state=json.loads((project/'.precise-state.json').read_text(encoding='utf8'))
    name=state['name'];net=ET.parse(project/(name+'.net.xml')).getroot()
    with (project/(name+'-bom.csv')).open(encoding='utf-8-sig',newline='') as f:bom=list(csv.DictReader(f))
    errors=[];pending=list(design['unresolved']);footprints=[];purchase=[]
    def check(ok,category,detail):
        if not ok:errors.append({'category':category,'detail':detail})
    actual={};helpers=set()
    for item in state['items'].values():
        if item['kind']!='component':continue
        props={x['name']:x['value'] for x in item.get('properties',[])};pins=state['symbols'][item['symbol']]['pins'];ref=item['reference']
        helper=ref.startswith(('#ERC','#PWR')) and props.get('Role')=='ERCHelper' and item.get('in_bom') is False and item.get('on_board') is False and len(pins)==1 and pins[0]['type']=='power_out'
        if helper:helpers.add(ref+'.'+pins[0]['number']);continue
        check(ref not in actual,'components',f'重复位号{ref}');actual[ref]=(item,props,pins)
    check(set(actual)=={c['ref'] for c in design['components']},'components','实际器件集合与设计清单不同')
    helper_refs={n.rsplit('.',1)[0] for n in helpers}
    check({r['Reference'] for r in bom if r['Reference'] not in helper_refs}==set(actual),'bom','BOM包含未知器件或遗漏实际器件')
    for c in design['components']:
        ref=c['ref'];entry=actual.get(ref)
        if not entry:continue
        item,props,pins=entry
        expected={'DesignId':c['id'],'MPN':c['mpn'],'Value':c['value'],'Footprint':c['footprint']}
        values={'Value':item.get('value',item['symbol']),'Footprint':item.get('footprint',''),**props}
        check(item['id']==c['id'],'identity',ref+'稳定item.id不一致')
        for key,value in expected.items():check(values.get(key,'')==value,'attributes',ref+'.'+key+'不一致')
        for key in ['in_bom','on_board','dnp']:check(item.get(key,key!='dnp')==c[key],'assembly',ref+'.'+key+'不一致')
        trip=lambda ps:sorted((str(x['number']),x['name'],x['type']) for x in ps)
        check(trip(pins)==trip(c['pins']),'pins',ref+'实际符号引脚不同')
        try:
            lib=symbol_evidence(root,c['librarySymbol'],evidence)
            check(trip(c['pins'])==trip(lib['pins']),'library-pins',ref+'设计引脚与所选库不一致')
        except Exception as e:errors.append({'category':'library-pins','detail':ref+': '+str(e)})
        rows=[r for r in bom if r['Reference']==ref];check(len(rows)==1,'bom',ref+'BOM行缺失或重复')
        if len(rows)==1:
            r=rows[0]
            for key,value in expected.items():check(r.get(key,'')==value,'bom',ref+'.'+key+'与BOM不一致')
            for k,key in [('in_bom','InBOM'),('on_board','OnBoard'),('dnp','DNP')]:check(r.get(key,'').lower()==str(c[k]).lower(),'bom',ref+'.'+key+'与BOM不一致')
        if not c['mpn']:pending.append(ref+'缺准确采购型号')
        if c['in_bom'] and c['on_board'] and not c['dnp']:purchase.append({'DesignId':c['id'],'Reference':ref,'MPN':c['mpn'],'Value':c['value'],'Footprint':c['footprint'],'Quantity':1})
        if not c['footprint']:pending.append(ref+'缺封装');continue
        try:
            fp=lookup(root,'footprint',c['footprint']);pads={p['number'] for p in fp['pads']}
            check(pads=={p['pad'] for p in c['pins']},'footprint',ref+'符号引脚与实际封装焊盘集合不一致')
            footprints.append({'ref':ref,'footprint':fp['id'],'sha256':fp['sha256'],'pads':sorted(pads),'mapping':[{'pin':p['number'],'pad':p['pad']} for p in c['pins']]})
            source,_=library_path(root,c['footprint'],'footprint')
            target=project/'footprints'/source.parent.name/source.name
            target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
        except Exception as e:errors.append({'category':'footprint','detail':ref+': '+str(e)})
    # Compare partitions, not net names. Preserve all real nodes before projecting valid helpers.
    groups=[];nodegroup={};actual_nc=set();allnodes=set()
    for n in net.findall('./nets/net'):
        nodes=[]
        for x in n.findall('node'):
            node=x.get('ref')+'.'+x.get('pin')
            if node in helpers:continue
            check(node not in allnodes,'nets','重复网表节点'+node);allnodes.add(node);nodes.append(node)
            if 'no_connect' in x.get('pintype','').split('+'):actual_nc.add(node)
        if nodes:
            group=frozenset(nodes);groups.append(group)
            for node in nodes:nodegroup[node]=group
    expected=[frozenset(n['nodes']) for n in design['nets']]+[frozenset([n]) for n in design['nc']]
    check(collections_count(groups)==collections_count(expected),'nets','实际网表分组与冻结连接意图不一致')
    check(actual_nc==set(design['nc']),'nc','实际NC集合与设计清单不一致')
    functions=[]
    for f in design['functions']:
        passed=True
        for c in f['checks']:
            gs=[nodegroup.get(n) for n in c['nodes']]
            ok=all(g is not None for g in gs) and (len(set(gs))==1 if c['kind']=='connected' else len(set(gs))==len(gs))
            check(ok,'function',f['requirementId']+': '+c['kind']+' '+','.join(c['nodes']));passed &= ok
        functions.append({'requirementId':f['requirementId'],'description':f['description'],'status':'failed' if not passed else 'pending' if f['limitations'] or not f['checks'] else 'passed','connectionStatus':'passed' if passed and f['checks'] else 'failed' if not passed else 'not-run','scope':'仅验证声明的连接条件，不证明需求充分性或实物性能','limitations':f['limitations']})
        pending.extend(f['limitations'])
    pending += ['准确厂家规格书、电气额定值与封装机械适配需工程师复核；库焊盘编号一致不等于可投产。','固件、亮度、时序、温升和实物功能未测试。']
    with (project/'purchase-bom.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=['DesignId','Reference','MPN','Value','Footprint','Quantity']);w.writeheader();w.writerows(purchase)
    libraries=sorted({f['footprint'].split(':')[0] for f in footprints})
    (project/'fp-lib-table').write_text('(fp_lib_table\n'+''.join(f'  (lib (name "{lib}")(type "KiCad")(uri "${{KIPRJMOD}}/footprints/{lib}.pretty")(options "")(descr "Verified local library snapshot"))\n' for lib in libraries)+')\n',encoding='utf8')
    return {'status':'passed' if not errors else 'failed','releaseReady':False,'errors':errors,'pending':list(dict.fromkeys(pending)),'functions':functions,'footprints':footprints,'purchaseRows':len(purchase),'components':len(actual),'pins':len(allnodes),'nets':len(groups),'files':{'schematic':digest(project/(name+'.kicad_sch')),'netlist':digest(project/(name+'.net.xml')),'bom':digest(project/(name+'-bom.csv')),'purchaseBom':digest(project/'purchase-bom.csv')}}
def collections_count(rows):
    from collections import Counter
    return Counter(rows)
def review_design(root,design,sources=()):
    errors=[];evidence=[]
    for c in design['components']:
        for kind,ident in [('symbol',c['librarySymbol']),('footprint',c['footprint'])]:
            if not ident:continue
            try:
                value=symbol_evidence(root,ident,sources) if kind=='symbol' else lookup(root,kind,ident)
                evidence.append(value)
                if kind=='symbol':
                    signature=lambda pins:sorted((p['number'],p['name'],p['type']) for p in pins)
                    if signature(value['pins'])!=signature(c['pins']):errors.append(c['ref']+'引脚名称/编号/类型与'+ident+'不一致；使用design_library返回的原始值')
                elif {p['number'] for p in value['pads']}!={p['pad'] for p in c['pins']}:errors.append(c['ref']+'封装焊盘集合与引脚不一致')
            except Exception as e:errors.append(c['ref']+': '+str(e))
    return {'errors':errors,'evidence':evidence,'scope':'库一致性；厂家及机械适配仍需审定'}
if __name__=='__main__':
    request=json.loads(Path(sys.argv[1]).read_text(encoding='utf8'));root=Path(request['libraryRoot'])
    result=lookup(root,request['kind'],request['query']) if request.get('operation')=='lookup' else review_design(root,request['design'],request.get('evidence',[])) if request.get('operation')=='review-design' else audit(root,request['design'],Path(request['project']),request.get('evidence',[]))
    Path(sys.argv[2]).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
