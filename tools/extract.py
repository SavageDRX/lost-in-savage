"""Extract Savage .s2z maps into compact JSON for the in-browser renderer.
usage: python3 -I extract.py <maps_dir> <maplist.txt> <out_dir>
"""
import sys, os, re, json, zipfile, struct, base64, math
import numpy as np
from collections import deque

MAPS, LIST, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)

# ---- terrain material ids (must match MATS in the renderer) ----
# 0 grass 1 dirt 2 rock 3 sandstone 4 snow 5 sand 6 wheat 7 stone/pavement 8 dead leaves
# 9 grassy dirt 10 riverbed 11 cracked earth 12 snowy dirt 13 grass+road 14 moss grass 15 tropical grass 16 dark rock 17 wheat road
def material(path):
    p = path.lower()
    base = p.rsplit('/', 1)[-1]
    folder = p.split('/textures/terrain/')[-1].split('/')[0] if '/textures/terrain/' in p else ''
    if 'white' in base and 'core' in p: return 0
    if 'snow' in base or folder == 'snow':
        if 'dirt' in base: return 12
        if 'cliff' in base: return 2
        return 4
    if 'water_bed' in base or 'riverbed' in base: return 10
    if 'cracked' in base or 'scortched' in base: return 11
    if 'deadleaves' in base: return 8
    if 'sandstone' in base or 'orange' in base or 'salmon' in base or 'sandrock' in base: return 3
    if 'tropicalsand' in base: return 5
    if 'tropicalgrass' in base: return 15
    if 'pavement' in base or 'linedstone' in base or 'stone' in base or 'roadbrick' in base: return 7
    if 'rock' in base or 'cliff' in base or 'canyon' in base or 'mountain' in base:
        return 16 if ('ultimate' in base or 'gray' in base or 'rockg' in base) else 2
    if 'wheat' in base or folder in ('wheat', 'wheat2'):
        if 'road' in base or 'pine' in base: return 17
        return 6
    if 'grassydirt' in base or 'grassyrocky' in base or 'mossgrass_dirt' in base or 'gr_dirt' in base: return 9
    if 'dirt' in base or 'ground' in base or 'earth' in base: return 1
    if 'road' in base or 'tshape' in base or 'cross' in base or 'corner' in base or 'blend' in base or 'az' in base and 'grass' not in base:
        return 13
    if 'moss' in base: return 14
    if 'grass' in base or 'handgrass' in base: return 0
    return 0

# ---- object categories (must match renderer) ----
def classify(n):
    n = n.lower()
    if re.match(r'^(npc_|navfloodfill|blocker|rockambient|waterfallsound|birds|insect|wind|default_wind|eerie|_|team$|\d+$|spawn|portal|light_|dark_|pot_|dyn_|sound|cave$|jungle$|swamp$)', n):
        return None
    if n == 'command_center': return ('cc', 0)
    if n.startswith('redstone_mine'): return ('mine', 0)
    if n.startswith('redstone_autominer') or n.startswith('gold_autominer'): return ('mine', 2)
    if n.startswith('gold_mine'): return ('mine', 1)
    if 'waterfall' in n or n.startswith('river'): return ('water', 1 if 'waterfall' in n and 'rapid' not in n else 0)
    if 'bridge' in n or 'stonearch' in n: return ('bridge', 1 if ('stone' in n or 'arch' in n) else 0)
    if 'cattail' in n or 'reed' in n or 'flatplant' in n or 'ivy' in n or 'mushroom' in n: return ('plant', 0)
    snow = 'snow' in n
    if re.search(r'palm|hawaiin|yucca', n): return ('palm', 1 if 'brown' in n else 0, 0.5 if n.endswith('_xr') else (0.45 if 'mini' in n or 'yucca' in n else 1.0))
    if re.search(r'dead|burnt|gnarled', n) and re.search(r'tree|pine', n): return ('dead', 0)
    if re.search(r'pine|spruce|(^|_)fir|redwood|tallforest', n):
        v = 0
        if snow: v = 2
        elif 'dark' in n or 'old' in n: v = 1
        elif 'brown' in n: v = 3
        elif 'light' in n: v = 4
        h = 1.35 if ('redwood' in n or 'tallforest' in n) else 1.0
        return ('pine', v, h)
    if 'bush' in n: return ('bush', 1 if 'blu' in n else 0)
    if re.search(r'tree', n):
        v = 0
        if 'birch' in n: v = 1
        if re.search(r'red|maroon', n): v = 2
        elif re.search(r'fall|yellow|brown|autumn', n): v = 3
        elif snow: v = 4
        elif 'dark' in n: v = 5
        h = 1.6 if 'giant' in n else 1.0
        return ('tree', v, h)
    if re.search(r'rock|boulder|monolith|pillar', n):
        v = 0
        if 'moss' in n: v = 1
        if snow: v = 2
        tall = 1 if ('monolith' in n or 'pillar' in n) else 0
        flat = 1 if 'flat' in n else 0
        size = 0.14 if n.startswith('small_rock') else 1.0
        return ('rock', v, tall, flat, size)
    if re.search(r'fence|wall|stopper|log_|post', n):
        v = 0  # wood
        if re.search(r'stone|ruins|aztec|mountain|plaster|wall_|castle', n): v = 1
        if 'mountain_wall' in n: v = 2
        return ('wall', v)
    if re.search(r'hut|house|building|fort|village|tower|snow_corner|snow_ruins|ruins|brick|block_|passage|xroad|roof|watchtower|tunnel', n):
        v = 0  # wooden/thatch hut
        if re.search(r'ruins|block_|passage|xroad|brick|aztec', n): v = 1
        if snow: v = 2
        if 'plaster' in n: v = 3
        return ('hut', v)
    if re.search(r'plank|platform|beam|ladder|stair|barrel|crate|table|stool|arch', n): return ('wood', 0)
    return None

def read(z, ext):
    for f in z.namelist():
        if f.lower().endswith(ext): return z.read(f)
    return None

def grid(b, dtype, ch=1):
    W, H = struct.unpack('<ii', b[:8])
    a = np.frombuffer(b[8:8 + W * H * ch * np.dtype(dtype).itemsize], dtype=dtype)
    return W, H, (a.reshape(H, W, ch) if ch > 1 else a.reshape(H, W))

def cfgvals(t):
    d = {}
    for k, v in re.findall(r'set (\S+) (\S+)', t):
        try: d[k] = float(v)
        except ValueError: d[k] = v
    return d

SEED_RE = re.compile(r'^(navfloodfillpoint|command_center|redstone|gold_mine|gold_autominer|spawnflag|npc_)', re.I)
index = []
for line in open(LIST):
    nm, plays, author = line.rstrip('\n').split('|')
    path = os.path.join(MAPS, nm + '.s2z')
    if not os.path.exists(path): continue
    z = zipfile.ZipFile(path)
    W, H, hm = grid(read(z, '.hm'), '<f4')
    hm = hm.astype(np.float64) * 1000.0  # game units, row 0 = south
    cmb = read(z, '.cm')
    cm = grid(cmb, np.uint8, 3)[2] if cmb else np.full((H, W, 3), 180, np.uint8)
    sm = grid(read(z, '.sm'), np.uint8)[2]
    sm2b = read(z, '.sm2'); amb = read(z, '.am')
    sm2 = grid(sm2b, np.uint8)[2] if sm2b else np.zeros_like(sm)
    am = grid(amb, np.uint8)[2] if amb else np.zeros_like(sm)
    shd = {}
    t = (read(z, '.shdref') or b'').decode('latin1')
    for k, v in re.findall(r'(\d+)\s*=\s*(\S+)', t): shd[int(k)] = material(v)
    lut = np.array([shd.get(i, 0) for i in range(256)], np.uint8)
    texkeys = [''] * 256
    for k, v in re.findall(r'(\d+)\s*=\s*(\S+)', t):
        v = v.lower()
        if 'textures/terrain/' in v:
            texkeys[int(k)] = re.sub(r'[^a-z0-9]+', '_', v.split('textures/terrain/')[1].rsplit('.', 1)[0])
    used = sorted(set(np.unique(sm).tolist()) | set(np.unique(sm2[am > 0]).tolist()))
    remap = np.zeros(256, np.uint8); tex = []
    for i in used:
        remap[i] = len(tex); tex.append(texkeys[i])
    m1, m2 = lut[sm], lut[sm2]
    cfg = {}
    for f in z.namelist():
        if f.lower().endswith('.cfg') and not f.lower().endswith('tod.cfg'):
            cfg = cfgvals(z.read(f).decode('latin1'))
    g = lambda k, d: float(cfg.get(k, d)) if not isinstance(cfg.get(k, d), str) else d
    env = {
        'fog': [g('gfx_fogr', .8), g('gfx_fogg', .8), g('gfx_fogb', .9)],
        'fogNear': g('gfx_fog_near', 800), 'fogFar': g('gfx_fog_far', 2500),
        'sky': [g('tl_skyr', 1), g('tl_skyg', 1), g('tl_skyb', 1)],
        'bg': [g('tl_backgroundr', 1), g('tl_backgroundg', 1.1), g('tl_backgroundb', 1.8)],
        'sunCol': [g('tl_sunr', 1), g('tl_sung', .9), g('tl_sunb', .85)],
        'sun': [g('wr_sun_x', -.3), g('wr_sun_y', -.3), g('wr_sun_z', -.9)],
        'tl0': [g('ter_light0_r', 1.5), g('ter_light0_g', 1.4), g('ter_light0_b', 1.2)],
        'tl1': [g('ter_light1_r', .6), g('ter_light1_g', .7), g('ter_light1_b', 1.0)],
        'ta': [g('ter_ambient_r', 0), g('ter_ambient_g', 0), g('ter_ambient_b', 0)],
        'ol0': [g('obj_light0_r', 1.2), g('obj_light0_g', 1.0), g('obj_light0_b', .8)],
        'oa': [g('obj_ambient_r', .5), g('obj_ambient_g', .5), g('obj_ambient_b', .6)],
        'skin': str(cfg.get('tl_skyskin', 'blue_sky')),
        'wl': g('gfx_waterlevel', g('ogl_waterlevel', 1)),
    }
    # objects
    objs, seeds = [], []
    t = (read(z, '.objpos') or b'').decode('latin1')
    for l in t.splitlines():
        p = l.split()
        if len(p) < 5: continue
        try: x, y, zz = float(p[2]), float(p[3]), float(p[4])
        except ValueError: continue
        rot = float(p[5]) if len(p) > 5 else 0; sc = float(p[6]) if len(p) > 6 else 1
        if SEED_RE.match(p[1]): seeds.append((x, y, zz))
        c = classify(p[1])
        if not c: continue
        objs.append([c[0], round(x), round(y), round(zz), round(rot), round(sc, 2)] + list(c[1:]))
    # walkable reachable tiles (same rules as the minimap maker)
    TW, TH = W - 1, H - 1
    a, b_, c_, d_ = hm[:-1, :-1], hm[:-1, 1:], hm[1:, :-1], hm[1:, 1:]
    g1 = np.hypot((b_ - a) / 100, (c_ - a) / 100); g2 = np.hypot((d_ - c_) / 100, (d_ - b_) / 100)
    ang = np.degrees(np.arctan(np.maximum(g1, g2)))
    ok = ang <= 40
    reach = np.zeros_like(ok)
    q = deque()
    for (x, y, zz) in seeds:
        xi, yi = int(x // 100), int(y // 100)
        if 0 <= xi < TW and 0 <= yi < TH and ok[yi, xi] and abs(zz - hm[yi, xi]) < 80 and not reach[yi, xi]:
            reach[yi, xi] = True; q.append((xi, yi))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < TW and 0 <= ny < TH and ok[ny, nx] and not reach[ny, nx]:
                reach[ny, nx] = True; q.append((nx, ny))
    if reach.sum() < 50: reach = ok.copy()
    # keep away from the map border
    m = 3
    reach[:m, :] = reach[-m:, :] = False; reach[:, :m] = reach[:, -m:] = False
    hmin, hmax = float(hm.min()), float(hm.max())
    q16 = np.round((hm - hmin) / max(hmax - hmin, 1e-6) * 65535).astype('<u2')
    b64 = lambda arr: base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()
    out = {
        'name': nm, 'plays': int(plays), 'author': author, 'W': W, 'H': H,
        'hmin': hmin, 'hmax': hmax, 'hm': b64(q16), 'cm': b64(cm), 'm1': b64(m1), 'm2': b64(m2), 'am': b64(am),
        'walk': b64(np.packbits(reach.astype(np.uint8))), 'env': env, 'objs': objs,
        's1': b64(remap[sm]), 's2': b64(remap[sm2]), 'tex': tex,
    }
    fn = re.sub(r'[^a-z0-9_]', '_', nm.lower())
    json.dump(out, open(os.path.join(OUT, fn + '.json'), 'w'), separators=(',', ':'))
    index.append({'id': fn, 'name': nm, 'plays': int(plays), 'author': author, 'W': W, 'H': H, 'walk': int(reach.sum())})
    print(nm, W, len(objs), int(reach.sum()), env['skin'])
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
print('maps', len(index))
