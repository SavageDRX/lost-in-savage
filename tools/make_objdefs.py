"""Step 1: index every .objdef under SAVAGE_EXTRACT (object name -> model + skin) and list the object names
the maps in data/index.json actually place. Writes build/objdefs.json and build/used_names.json."""
import os, re, json, zipfile
from config import EXTRACT, MAPS, DATA, BUILD

od = {}
for root, _, files in os.walk(EXTRACT):
    for f in files:
        if not f.lower().endswith('.objdef'):
            continue
        rel = os.path.relpath(root, EXTRACT).replace('\\', '/')
        text = open(os.path.join(root, f), encoding='latin1').read()
        for m in re.finditer(r'beginObjdef\s+\S+\s+(\S+)(.*?)endObjdef', text, re.S):
            name, body = m.group(1).lower(), m.group(2)
            mm = re.search(r'obj_model\s+(\S+)', body)
            if not mm:
                continue
            model = mm.group(1).replace('\\', '/')
            model = model.lstrip('/') if '/' in model else rel + '/' + model      # bare names are relative to the objdef
            sk = re.search(r'obj_skin\s+(\S+)', body)
            skin = sk.group(1).replace('\\', '/') if sk else 'default'
            if skin.lower().endswith('.skin') and '/' not in skin:
                skin = rel + '/' + skin
            od[name] = dict(model=model, skin=skin)
json.dump(od, open(os.path.join(BUILD, 'objdefs.json'), 'w'), indent=0)

used = set()
for e in json.load(open(os.path.join(DATA, 'index.json'))):
    p = os.path.join(MAPS, e['id'] + '.s2z')
    if not os.path.exists(p):
        continue
    z = zipfile.ZipFile(p)
    t = next((z.read(n).decode('latin1') for n in z.namelist() if n.lower().endswith('.objpos')), '')
    used |= {m.group(1).lower() for m in re.finditer(r'create(?:Object|Reference)\s+(\S+)', t)}
json.dump(sorted(n for n in used if n in od), open(os.path.join(BUILD, 'used_names.json'), 'w'))
print(len(od), 'objdefs,', len(used), 'object names used by the maps')
