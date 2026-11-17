import json,base64,os,numpy as np,sys
from config import DATA
from fw2 import comp
apply='--apply' in sys.argv
ix=json.load(open(os.path.join(DATA,'index.json'))); cache={}
for m in ix:
    p=os.path.join(DATA,(m['b'] if 'b' in m else m['id'])+'.json')
    if p not in cache: cache[p]=json.load(open(p))
    d=cache[p][m['id']] if 'b' in m else cache[p]
    wb,r,th,s=comp(d,60)
    if not s or r.sum()<150: print('keep',m['id'],wb.sum(),r.sum()); continue
    if r.sum()<wb.sum()*.9: print(m['id'],wb.sum(),r.sum(),'removed max h',th[wb&~r].max().round(),'kept max',th[r].max().round())
    if apply:
        d['walk']=base64.b64encode(np.packbits(r.reshape(-1).astype(np.uint8))).decode(); m['walk']=int(r.sum())
if apply:
    for p,d in cache.items(): json.dump(d,open(p,'w'),separators=(',',':'))
    json.dump(ix,open(os.path.join(DATA,'index.json'),'w'),separators=(',',':'))
