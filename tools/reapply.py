"""Rebuild rn/ro (real model instances) for every map in the index from its objpos; 2nd command_center becomes the beast lair."""
import json, os, re, zipfile
from config import DATA as D, MAPS as M, BUILD
mi=json.load(open(os.path.join(BUILD,'models/_index.json')))['models']
od=json.load(open(os.path.join(BUILD,'objdefs.json')))
SKIP=re.compile(r'^(navfloodfill|blocker|rockambient|waterfallsound|birds|insect|wind$|default_wind|eerie|team$|\d+$|spawn|sound|cave$|jungle$|swamp$|monkit$|oschore$|teleport_node|waterfallsteam|npc_bearloth)')
def hidden(n):
    p=od.get(n,{}).get('model','').lower()
    return bool(SKIP.match(n)) or p.endswith('null.model') or '/markers/' in p or '/blockers/' in p
idx=json.load(open(f'{D}/index.json')); cache={}
tot=real=lairs=0; cnt={}
for e in idx:
    p=f"{D}/{e['b']}.json" if 'b' in e else f"{D}/{e['id']}.json"
    if p not in cache: cache[p]=json.load(open(p))
    d=cache[p][e['id']] if 'b' in e else cache[p]
    zp=f"{M}/{d['name']}.s2z"
    if not os.path.exists(zp): zp=f"{M}/{e['id']}.s2z"
    z=zipfile.ZipFile(zp)
    t=next((z.read(n).decode('latin1') for n in z.namelist() if n.lower().endswith('.objpos')),'')
    t=re.sub(r'(create(Object|Reference))',r'\n\1',t)
    names=[]; ro=[]; ncc=0
    for l in t.splitlines():
        q=l.split()
        if len(q)<5 or not q[0].startswith('create'): continue
        nm=q[1].lower(); tot+=1
        if nm=='command_center':
            ncc+=1
            if ncc==2: nm='lair'; lairs+=1
        if nm not in mi or hidden(nm): continue
        try: x,y,zz=float(q[2]),float(q[3]),float(q[4])
        except ValueError: continue
        try: rot=float(q[5]) if len(q)>5 else 0; sc=float(q[6]) if len(q)>6 else 1
        except ValueError: rot,sc=0,1
        try: tx=float(q[7]) if len(q)>7 else 0; ty=float(q[8]) if len(q)>8 else 0
        except ValueError: tx=ty=0
        tx=((tx+180)%360)-180; ty=((ty+180)%360)-180
        if nm not in names: names.append(nm)
        ro+=[names.index(nm),round(x),round(y),round(zz),round(rot),round(sc,3),round(tx,1),round(ty,1)]; real+=1; cnt[nm]=cnt.get(nm,0)+1
    d['rn']=names; d['ro']=ro; d['ros']=8
    d['objs']=[o for o in d['objs'] if o[0]=='water']
for p,d in cache.items(): json.dump(d,open(p,'w'),separators=(',',':'))
print('objects',tot,'real',real,'lairs',lairs)
json.dump(cnt,open(os.path.join(BUILD,'instance_counts.json'),'w'))
