"""Convert Savage .model (SMDL) props + skins + .s2g textures into compact web assets.
out: build/models/<name>.json  {g:[{t:texkey,a:alphaTest,d:doubleSided,p:b64 f32 xyz,n:b64 i8 xyz,u:b64 f32 uv,i:b64 u16|u32}], b:[minx,miny,minz,maxx,maxy,maxz]}
     build/mtex/<texkey>.png|.jpg
"""
import os, re, sys, json, struct, base64, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import s2g

from config import EXTRACT as EX, BUILD as OUT
os.makedirs(OUT + '/models', exist_ok=True); os.makedirs(OUT + '/mtex', exist_ok=True)
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()

def ci_path(p):
    """case-insensitive file lookup below EX"""
    if os.path.exists(p): return p
    d, f = os.path.split(p)
    d = ci_path(d) if d and not os.path.isdir(d) else d
    if not d or not os.path.isdir(d): return None
    for x in os.listdir(d):
        if x.lower() == f.lower(): return os.path.join(d, x)
    return None

def parse_model(path):
    b = open(path, 'rb').read(); assert b[:4] == b'SMDL'
    o = 4; meshes = {}
    while o + 8 <= len(b):
        tag = b[o:o + 4]; n = struct.unpack_from('<I', b, o + 4)[0]; d = b[o + 8:o + 8 + n]; o += 8 + n
        if tag == b'mesh':
            i = struct.unpack_from('<I', d)[0]
            name = d[4:36].split(b'\0')[0].decode('latin1'); tex = d[36:100].split(b'\0')[0].decode('latin1')
            meshes[i] = dict(name=name, tex=tex)
        elif tag in (b'vrts', b'nrml'):
            i = struct.unpack_from('<I', d)[0]; meshes[i][tag.decode()] = np.frombuffer(d[4:], '<f4').reshape(-1, 3)
        elif tag == b'texc':
            i = struct.unpack_from('<I', d)[0]; meshes[i]['texc'] = np.frombuffer(d[4:], '<f4').reshape(-1, 2)
        elif tag == b'face':
            i, nf = struct.unpack_from('<II', d); meshes[i]['face'] = np.frombuffer(d[8:8 + nf * 12], '<i4').reshape(-1, 3)
        elif tag == b'colr':
            i = struct.unpack_from('<I', d)[0]; meshes[i]['colr'] = np.frombuffer(d[4:], np.uint8).reshape(-1, 4)
    return [meshes[k] for k in sorted(meshes)]

def parse_skin(path):
    skins = {}; cur = 'default'
    if not path: return skins
    for l in open(path, encoding='latin1'):
        p = l.split()
        if len(p) >= 2 and p[0].lower() == 'skinname': cur = p[1].lower()
        elif len(p) >= 3 and p[0].lower() == 'skinref': skins.setdefault(cur, []).append((p[1].lower(), p[2]))
    return skins

def parse_mat(path):
    m = {}
    if not path: return m
    for k, v in re.findall(r'set\s+(\S+)\s+(\S+)', open(path, encoding='latin1').read()): m[k.lower()] = v
    return m

TEX = {}
def texture(ref, mdir):
    """ref: texture name from a mesh or skin; returns (key, alpha, doubleSided) or None"""
    r = ref.replace('\\', '/')
    base = r.rsplit('.', 1)[0]
    if base.startswith('/'):
        cand = [EX + base.lstrip('/'), EX + base.lstrip('/').replace('textures/terrain/', 'terrain/')]
    else:
        cand = [os.path.join(mdir, base)]
    src = None
    for c in cand:
        src = ci_path(c + '.s2g') or ci_path(c + '.tga')
        if src: break
    if not src: return None
    key = re.sub(r'[^a-z0-9]+', '_', os.path.relpath(src, EX).lower().rsplit('.', 1)[0]).strip('_')[-60:]
    if key not in TEX:
        mat = parse_mat(ci_path(src[:-4] + '.mat'))
        im = s2g.decode(src, True) if src.lower().endswith('.s2g') else Image.open(src).convert('RGBA')
        a = np.asarray(im)[..., 3]
        alpha = float(mat.get('mat_alphacutoff', 0)) > 0 or (a < 128).mean() > .02
        ds = mat.get('mat_doublesided', '0') == '1'
        m = 256
        if max(im.size) > m: im = im.resize((min(m, im.size[0]), min(m, im.size[1])), Image.LANCZOS)
        if alpha:
            im.save(f'{OUT}/mtex/{key}.png', optimize=True); ext = 'png'
        else:
            im.convert('RGB').save(f'{OUT}/mtex/{key}.jpg', quality=82); ext = 'jpg'
        TEX[key] = dict(alpha=alpha, ds=ds, ext=ext, avg=[round(float(v) / 255, 3) for v in np.asarray(im.convert('RGB')).reshape(-1, 3).mean(0)])
    t = TEX[key]
    return key, t['alpha'], t['ds']

def convert(name, od):
    mp = ci_path(EX + od['model'])
    if not mp: return None
    mdir = os.path.dirname(mp)
    meshes = parse_model(mp)
    sko = od.get('skin', 'default'); skp = sko.replace('\\', '/').lstrip('/')
    if skp.lower().endswith('.skin') and ci_path(EX + skp):
        skins = parse_skin(ci_path(EX + skp)); sk = skins.get('default') or (next(iter(skins.values())) if skins else [])
    else:
        skins = parse_skin(ci_path(mp[:-6] + '.skin')); sk = skins.get(sko.lower().replace('.skin', ''), skins.get('default', []))
    groups = {}
    for m in meshes:
        if 'vrts' not in m or 'face' not in m: continue
        nm = m['name'].lower()
        if nm.startswith('_') and any(s in nm for s in ('bound', 'collision', 'nav')): continue
        if 'shadow' in nm or m['tex'].lower().startswith('2_') or not m['tex'].strip(): continue
        tref = m['tex']
        for pre, t in sk:
            if nm == pre: tref = t; break
        else:
            for pre, t in sk:
                if pre != 'default' and nm.startswith(pre): tref = t; break
            else:
                for pre, t in sk:
                    if pre == 'default' and not nm.startswith('_foliage'): tref = t; break
        tx = texture(tref, mdir) or texture(m['tex'], mdir)
        fol = nm.startswith('_foliage')
        key = tx[0] if tx else ''
        alpha = (tx[1] if tx else False) or fol
        ds = (tx[2] if tx else False) or fol
        g = groups.setdefault((key, alpha, ds), dict(p=[], n=[], u=[], i=[], c=[], nv=0))
        V = m['vrts']; N = m.get('nrml', np.zeros_like(V)); U = m.get('texc', np.zeros((len(V), 2), np.float32))
        C = m.get('colr', np.full((len(V), 4), 255, np.uint8))
        if len(N) != len(V): N = np.zeros_like(V)
        if len(U) != len(V): U = np.zeros((len(V), 2), np.float32)
        if len(C) != len(V): C = np.full((len(V), 4), 255, np.uint8)
        g['p'].append(V); g['n'].append(N); g['u'].append(U); g['c'].append(C[:, :3]); g['i'].append(m['face'] + g['nv']); g['nv'] += len(V)
    out = []; allp = []
    for (key, alpha, ds), g in groups.items():
        P = np.concatenate(g['p']).astype('<f4'); allp.append(P)
        N = np.nan_to_num(np.concatenate(g['n']).astype(np.float64), nan=0, posinf=0, neginf=0); N[np.abs(N).max(1)>10]=0; l = np.linalg.norm(N, axis=1, keepdims=True); N = np.where(l > 0, N / np.maximum(l, 1e-6), [0, 0, 1])
        U = np.concatenate(g['u']).astype('<f4'); I = np.concatenate(g['i'])
        C = np.concatenate(g['c']).astype(np.uint8)
        I = I.astype('<u2' if g['nv'] < 65536 else '<u4')
        e = dict(t=key, a=int(alpha), d=int(ds), p=b64(P), n=b64(np.round(N * 127).astype(np.int8)), u=b64(U), i=b64(I), w=int(I.dtype.itemsize))
        if (C < 250).any(): e['c'] = b64(C)
        out.append(e)
    if not allp: return None
    A = np.concatenate(allp)
    return dict(g=out, b=[round(float(v), 1) for v in np.r_[A.min(0), A.max(0)]])

if __name__ == '__main__':
    od = json.load(open(os.path.join(OUT, 'objdefs.json')))
    for mn in ('redstone_mine','redstone_mine_small','gold_mine'): od[mn]=dict(model='mines/'+mn+'.model',skin='default')
    od['command_center'] = dict(model='models/human/buildings/stronghold.model', skin='default')
    od['lair'] = dict(model='models/beast/buildings/lair.model', skin='default')
    if os.path.exists(os.path.join(OUT, 'used_names.json')):
        want = set(json.load(open(os.path.join(OUT, 'used_names.json')))) | {'command_center', 'lair', 'redstone_mine', 'redstone_mine_small', 'gold_mine'}
        od = {k: v for k, v in od.items() if k in want}
    done = {}
    for name, d in sorted(od.items()):
        try:
            r = convert(name, d)
        except Exception as ex:
            print('FAIL', name, ex); continue
        if not r: continue
        json.dump(r, open(f'{OUT}/models/{name}.json', 'w'), separators=(',', ':'))
        done[name] = r['b']
    json.dump(dict(models=done, tex={k: [v['ext'], int(v['alpha']), int(v['ds'])] for k, v in TEX.items()}),
              open(f'{OUT}/models/_index.json', 'w'), separators=(',', ':'))
    print(len(done), 'models', len(TEX), 'textures')
