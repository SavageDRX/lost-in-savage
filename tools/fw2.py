import json,base64,os,numpy as np
from config import DATA
from collections import deque
SEED=('command_center','redstone_mine','gold_mine','gold_autominer')
def comp(d,STEP):
    W,H=d['W'],d['H']
    q=np.frombuffer(base64.b64decode(d['hm']),'<u2').reshape(H,W).astype(float)
    hm=d['hmin']+q/65535*(d['hmax']-d['hmin'])
    n=(W-1)*(H-1)
    wb=np.unpackbits(np.frombuffer(base64.b64decode(d['walk']),np.uint8))[:n].reshape(H-1,W-1).astype(bool)
    rn=d.get('rn') or []; ro=d.get('ro') or []; RS=d.get('ros',6)
    seeds=[(ro[i+1],ro[i+2],ro[i+3]) for i in range(0,len(ro),RS) if rn[ro[i]] in SEED]
    th=(hm[:-1,:-1]+hm[1:,:-1]+hm[:-1,1:]+hm[1:,1:])/4
    reach=np.zeros_like(wb); dq=deque()
    for x,y,z in seeds:
        xi,yi=int(x//100),int(y//100)
        for oy in range(-3,4):
            for ox in range(-3,4):
                a,b=xi+ox,yi+oy
                if 0<=a<W-1 and 0<=b<H-1 and wb[b,a] and not reach[b,a] and abs(th[b,a]-z)<120: reach[b,a]=True; dq.append((a,b))
    while dq:
        x,y=dq.popleft()
        for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
            a,b=x+dx,y+dy
            if 0<=a<W-1 and 0<=b<H-1 and wb[b,a] and not reach[b,a] and abs(th[b,a]-th[y,x])<STEP: reach[b,a]=True; dq.append((a,b))
    return wb,reach,th,seeds
if __name__=='__main__':
    import sys
    for id in sys.argv[1:]:
        d=json.load(open(os.path.join(DATA,id+'.json')))
        for S in (30,45,60):
            wb,r,th,s=comp(d,S); print(id,S,wb.sum(),r.sum(), 'max h kept',th[r].max().round() if r.any() else None, 'seeds z',[round(z) for *_,z in s][:6])
