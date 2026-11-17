import json,os,re,zipfile,struct,base64,numpy as np,sys
from config import DATA as D, MAPS as M, ROOT
def read(z,ext):
    for f in z.namelist():
        if f.lower().endswith(ext): return z.read(f)
def grid(b):
    W,H=struct.unpack('<ii',b[:8]); return np.frombuffer(b[8:8+W*H],np.uint8).reshape(H,W)
idx=json.load(open(f'{D}/index.json')); cache={}; need=set(); n3=0
have={f[:-4] for f in os.listdir(os.path.join(ROOT,'tex'))}
apply='--apply' in sys.argv
for e in idx:
    p=f"{D}/{e['b']}.json" if 'b' in e else f"{D}/{e['id']}.json"
    if p not in cache: cache[p]=json.load(open(p))
    d=cache[p][e['id']] if 'b' in e else cache[p]
    if not d.get('tex'): continue
    zp=f"{M}/{d['name']}.s2z"
    if not os.path.exists(zp): zp=f"{M}/{e['id']}.s2z"
    z=zipfile.ZipFile(zp); a2b=read(z,'.am2'); s3b=read(z,'.sm3')
    if not a2b or not s3b: continue
    am2=grid(a2b); sm3=grid(s3b)
    if not (am2>0).any(): continue
    t=(read(z,'.shdref') or b'').decode('latin1'); keys={}
    for k,v in re.findall(r'(\d+)\s*=\s*(\S+)',t):
        v=v.lower()
        if 'textures/terrain/' in v: keys[int(k)]=re.sub(r'[^a-z0-9]+','_',v.split('textures/terrain/')[1].rsplit('.',1)[0])
    used=np.unique(sm3[am2>0]).tolist(); tex=list(d['tex']); remap=np.zeros(256,np.uint8)
    am2=am2.copy()
    for i in used:
        k=keys.get(i,'')
        if not k: am2[sm3==i]=0; continue
        if k not in tex: tex.append(k)
        remap[i]=tex.index(k)
        if k not in have: need.add(k)
    n3+=1
    if apply:
        d['tex']=tex; d['s3']=base64.b64encode(remap[sm3].tobytes()).decode(); d['am2']=base64.b64encode(am2.tobytes()).decode()
print('maps with a 3rd layer',n3,'textures missing',sorted(need))
if apply:
    for p,d in cache.items(): json.dump(d,open(p,'w'),separators=(',',':'))
