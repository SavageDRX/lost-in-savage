"""Pack converted models/textures into a small index plus chunk files the page loads on demand."""
import json,glob,base64,os,collections
from config import ROOT, BUILD
os.chdir(ROOT)
idx=json.load(open(os.path.join(BUILD,'models/_index.json')))
NG=NT=12
# how many maps use each model
use=collections.Counter()
for f in glob.glob('data/*.json')+glob.glob('data/h/*.json'):
    if f.endswith('index.json'): continue
    j=json.load(open(f)); ds=j.values() if f.startswith('data/h/') else [j]
    for d in ds:
        for n in set(d.get('rn') or []): use[n]+=1
names=sorted([n for n in idx['models'] if use[n]],key=lambda n:(-use[n],n))
geo={n:json.load(open(os.path.join(BUILD,f'models/{n}.json')))['g'] for n in names}
size={n:len(json.dumps(geo[n],separators=(',',':'))) for n in names}
total=sum(size.values()); per=total/NG
gc={};ch=0;acc=0
for n in names:
    if acc>per and ch<NG-1: ch+=1;acc=0
    gc[n]=ch;acc+=size[n]
for c in range(NG): json.dump({n:geo[n] for n in names if gc[n]==c},open(f'mpack/g{c}.json','w'),separators=(',',':'))
# textures in the order models first use them
order=[];seen=set()
for n in names:
    for g in geo[n]:
        if g['t'] and g['t'] not in seen and g['t'] in idx['tex']: seen.add(g['t']);order.append(g['t'])
order+=[k for k in idx['tex'] if k not in seen]
data={k:f"data:image/{'png' if idx['tex'][k][0]=='png' else 'jpeg'};base64,"+base64.b64encode(open(os.path.join(BUILD,f'mtex/{k}.{idx["tex"][k][0]}'),'rb').read()).decode() for k in order}
tt=sum(len(v) for v in data.values());per=tt/NT;tc={};ch=0;acc=0
for k in order:
    if acc>per and ch<NT-1: ch+=1;acc=0
    tc[k]=ch;acc+=len(data[k])
for c in range(NT): json.dump({k:data[k] for k in order if tc[k]==c},open(f'mpack/t{c}.json','w'),separators=(',',':'))
json.dump({'models':{n:idx['models'][n] for n in names},'tex':idx['tex'],'gc':gc,'tc':tc},open('mpack/models.json','w'),separators=(',',':'))
if os.path.exists('mpack/textures.json'): os.remove('mpack/textures.json')
print('geo',total//1024,'KB','tex',tt//1024,'KB')
