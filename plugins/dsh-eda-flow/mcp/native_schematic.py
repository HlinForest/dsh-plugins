import sys
sys.dont_write_bytecode=True
import json,math,collections,subprocess,hashlib,copy
from pathlib import Path

from design_audit import sexpr,child,children
import fixed_components as fc
import functional_layout as geom
import xml.etree.ElementTree as ET

def val(n,k,default=''):return child(n,k,[k,default])[1]
def nums(n):return [float(x) for x in n[1:]] if n else []
def font(n):
    e=child(n,'effects',[]); f=child(e,'font',[])
    return {'size':nums(child(f,'size',['size','1.27','1.27'])),'justify':child(e,'justify',['justify'])[1:]}
def visible(n):
    return not any(isinstance(x,list) and x and x[0]=='hide' and (len(x)==1 or x[1]=='yes') for x in n) and 'hide' not in n
def prop(n):return {'name':n[1],'value':n[2],'at':nums(child(n,'at',['at','0','0','0'])),'visible':visible(n) and visible(child(n,'effects',[])),'font':font(n)}
def graphic(n):
    d={'kind':n[0],'width':float(val(child(n,'stroke',[]),'width',0)),'fill':val(child(n,'fill',[]),'type','none')}
    for k in ['start','mid','end','center','at']:
        if child(n,k):d[k]=nums(child(n,k))
    if n[0]=='polyline':d['points']=[nums(p) for p in children(child(n,'pts',[]),'xy')]
    if n[0]=='circle':d['radius']=float(val(n,'radius',0))
    if n[0]=='text':d.update(text=n[1],font=font(n),visible=visible(n))
    return d
def parse(path):
    ast=sexpr(path.read_text(encoding='utf8'));state={'name':path.stem,'uuid':val(ast,'uuid'),'items':{},'symbols':{}}
    for s in children(child(ast,'lib_symbols',[]),'symbol'):
        ns=child(s,'pin_names',[]);gs=[];pins=[]
        for unit in children(s,'symbol'):
            for n in unit[2:]:
                if not isinstance(n,list):continue
                if n[0]=='pin':
                    pins.append({'number':val(n,'number'),'name':val(n,'name'),'type':n[1],'shape':n[2], 'at':nums(child(n,'at')),
                        'length':float(val(n,'length',0)),'visible':visible(n),'name_font':font(child(n,'name',[])), 'number_font':font(child(n,'number',[]))})
                elif n[0] in ['rectangle','polyline','arc','circle','text']:gs.append(graphic(n))
        state['symbols'][s[1]]={'name':s[1],'pins':pins,'graphics':gs,'pin_names_visible':visible(ns),
            'pin_numbers_visible':visible(child(s,'pin_numbers',[])),'pin_name_offset':float(val(ns,'offset',.508)), 'power':child(s,'power') is not None}
    for i,n in enumerate(ast):
        if not isinstance(n,list):continue
        k=n[0];uid=val(n,'uuid',str(i));d={'id':uid}
        if k=='symbol':
            ps=[prop(p) for p in children(n,'property')];pd={p['name']:p['value'] for p in ps}
            d.update(kind='component',symbol=val(n,'lib_id'),reference=pd.get('Reference',''),value=pd.get('Value',''),footprint=pd.get('Footprint',''),
                at=nums(child(n,'at')),properties=ps,in_bom=val(n,'in_bom','yes')=='yes',on_board=val(n,'on_board','yes')=='yes',dnp=val(n,'dnp','no')=='yes')
            if child(n,'mirror'):d['mirror']=val(n,'mirror')
        elif k=='wire':d.update(kind=k,points=[nums(p) for p in children(child(n,'pts',[]),'xy')],width=float(val(child(n,'stroke',[]),'width',0)))
        elif k in ['label','global_label','hierarchical_label','text']:
            d.update(kind='text' if k=='text' else 'label',text=n[1],at=nums(child(n,'at')),font=font(n))
            if k!='text':d.update(label_type={'label':'local','global_label':'global','hierarchical_label':'hierarchical'}[k],shape=val(n,'shape','input'))
        elif k in ['junction','no_connect']:d.update(kind=k,at=nums(child(n,'at')),diameter=float(val(n,'diameter',0)))
        else:continue
        state['items'][uid]=d
    paper=child(ast,'paper',['paper','A4']); sizes={'A4':[297,210],'A3':[420,297],'A2':[594,420],'A1':[841,594],'A0':[1189,841]}
    state['page_size_mm']=list(map(float,paper[2:4])) if paper[1]=='User' else sizes.get(paper[1],[297,210])
    return ast,state

def canonical(x):
    if isinstance(x,float):return round(x,4)
    if isinstance(x,list):return [canonical(v) for v in x]
    if isinstance(x,dict):return {k:canonical(v) for k,v in x.items()}
    return x
def signature(s):
    return {'pins':sorted([canonical({k:p[k] for k in ['number','name','type','shape','at','length','visible']}) for p in s['pins']],key=lambda p:p['number']),
        'graphics':sorted([canonical(g) for g in s['graphics']],key=lambda g:json.dumps(g,sort_keys=True)),
        'pin_names_visible':s['pin_names_visible'],'pin_numbers_visible':s['pin_numbers_visible'],'pin_name_offset':s['pin_name_offset']}
