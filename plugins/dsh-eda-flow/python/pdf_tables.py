"""Preserve ruled PDF table evidence, without interpreting device ratings.

Only explicit value and unit columns permit unit inheritance. Original cells,
page coordinates and nearby source text remain available to audit the result.
No source value, condition, circuit connection or layout is invented here.
"""
import re

_UNIT_HEADERS={'unit','units','单位'}
_VALUE_HEADERS={'min','minimum','typ','typical','max','maximum','value','values','range',
                '最小','最小值','典型','典型值','最大','最大值','数值','值','范围'}
_UNIT=re.compile(r'(?:[pnumkKMGTµμ]?(?:A|V|F|W|Hz|s)|[kKMm]?(?:Ω|Ohms?|ohms?))')
_NUMBER=re.compile(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?')

def _clean(value):
    return re.sub(r'\s+',' ',str(value or '')).strip()

def _header(value):
    return _clean(value).lower().rstrip('.:：')

def extract_tables(page,digest,name,binding,simulated):
    records,warnings=[],[]
    try:
        tables=page.find_tables(strategy='lines_strict').tables
    except Exception as error:
        return [],[{'page':page.number+1,'kind':'table-extraction-unavailable','message':type(error).__name__}]
    for index,table in enumerate(sorted(tables,key=lambda t:(t.bbox[1],t.bbox[0]))):
        rows=[[_clean(c) for c in row] for row in table.extract()]
        if len(rows)<2 or len(rows[0])<2:continue
        if index>=50 or sum(len(row) for row in rows)>2000:
            warnings.append({'page':page.number+1,'kind':'table-size-limit','table':index+1})
            continue
        external=bool(table.header.external)
        headers=[_clean(c) for c in table.header.names] if external else rows[0]
        data_rows=rows if external else rows[1:]
        if len(headers)!=len(rows[0]):headers=[f'Column {n+1}' for n in range(len(rows[0]))]
        units=[n for n,h in enumerate(headers) if _header(h) in _UNIT_HEADERS]
        unit_index=units[0] if len(units)==1 else None
        bbox=[round(float(v),3) for v in table.bbox]
        context=page.get_text(clip=(0,max(0,bbox[1]-90),page.rect.width,bbox[1]),sort=True).strip()
        lines=['PDF表格，按原行列展开。空白单元格保持空白；单位只继承明确的单位列，额定性质与适用条件仍需结合原文判断。']
        if context:lines+=['表格前文（原文）：',context]
        lines.append('列：'+' | '.join(headers))
        for number,row in enumerate(data_rows,1):
            unit=row[unit_index] if unit_index is not None and unit_index<len(row) else ''
            fields=[]
            for column,cell in enumerate(row):
                label=headers[column] or f'Column {column+1}'
                value=cell
                if _header(label) in _VALUE_HEADERS and _NUMBER.fullmatch(cell) and _UNIT.fullmatch(unit):
                    value=f'{cell} {unit}'
                fields.append(f'{label}={value}')
            lines.append(f'行{number}: '+'; '.join(fields))
        records.append({'id':f'pdf-{digest[:16]}-{page.number+1}-table-{index+1}',
                        'document':name,'page':page.number+1,'binding':binding,
                        'content':'\n'.join(lines),'simulated':simulated,'pageIsPlaceholder':False,
                        'sourceType':'pdf-table-extraction','sourceSha256':digest,
                        'stages':[2,3,4,5,7],'readable':True,
                        'table':{'bbox':bbox,'headers':headers,'headerExternal':external,'rows':rows,
                                 'extraction':'ruled-lines','semanticRatingVerified':False}})
    return records,warnings
