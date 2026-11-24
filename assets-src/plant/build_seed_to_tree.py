#!/usr/bin/env python3
"""Packs the four stage GLBs of the "Seed to Tree" Blender asset into the one file the website loads.

Run from this folder (needs Python 3 with numpy, and Node for the compression step):
    python3 build_seed_to_tree.py seed-to-tree-src/Nomad out/seed-to-tree.raw.glb
    npx @gltf-transform/cli meshopt out/seed-to-tree.raw.glb ../../apps/web/public/plant/seed-to-tree.glb
The second step quantises and meshopt-compresses it (about 2.8 MB -> 0.53 MB); the scene loads it with three.js'
MeshoptDecoder. If the Blender file changes, re-export the four GLBs from it first (same names, same mesh names).

The four stages share topology, so they are packed as one file:
  * Seed_*   floating-seed pose, morph target 0 = planted-seed pose
  * Trunk, Filaments, Leaf_A_* (left), Leaf_B_* (sprout's right leaf, the tree's crown): sprout pose, morph target 0 = tree pose
  * Roots (identical in both), Leaf_C_* (the tree's third leaf, tree pose only)
Parts with the same look are merged to keep draw calls low. Everything is moved so the trunk base sits at the origin.
Each leaf node carries extras.pivot (and pivotTree) = where its branch leaves the trunk, used to grow it in the scene.
"""
import json, struct, sys, os
import numpy as np

CT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
ORIGIN = np.array([1.58, 0.0, -0.03], dtype=np.float32)   # centre of the root flare


def load(path):
    b = open(path, 'rb').read()
    clen = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + clen]); blob = b[20 + clen + 8:]

    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        n = NC[a['type']]
        return np.frombuffer(blob, dtype='<' + CT[a['componentType']], count=a['count'] * n,
                             offset=bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n)
    out = {}
    for node in j['nodes']:
        if 'mesh' not in node: continue
        pr = j['meshes'][node['mesh']]['primitives'][0]
        name = node['name'].split('.0')[0]
        out[name] = {'p': acc(pr['attributes']['POSITION']) - ORIGIN, 'n': acc(pr['attributes']['NORMAL']),
                     'c': acc(pr['attributes']['COLOR_0'])[:, :3] if 'COLOR_0' in pr['attributes'] else None,
                     'i': acc(pr['indices']).reshape(-1).astype(np.uint32)}
    return out


def merge(src, names, target=None, target_names=None, white=(0.94, 0.91, 1.0), gain=None):
    """Concatenate parts; returns dict(p, n, c, i, tp, tn)."""
    P, N, C, I, TP, TN = [], [], [], [], [], []
    off = 0
    for k, name in enumerate(names):
        m = src[name]
        c = m['c'] if m['c'] is not None else np.tile(np.array(white, dtype=np.float32), (len(m['p']), 1))
        if gain: c = c * gain[k]
        P.append(m['p']); N.append(m['n']); C.append(c); I.append(m['i'] + off); off += len(m['p'])
        if target is not None:
            t = target[(target_names or names)[k]]
            assert len(t['p']) == len(m['p']), name
            TP.append(t['p'] - m['p']); TN.append(t['n'] - m['n'])
    d = {'p': np.vstack(P), 'n': np.vstack(N), 'c': np.vstack(C), 'i': np.concatenate(I)}
    if target is not None: d['tp'] = np.vstack(TP); d['tn'] = np.vstack(TN)
    return d


def ring_centre(mesh, first=True, ring=18):
    return (mesh['p'][:ring] if first else mesh['p'][-ring:]).mean(0)


def main(src_dir, out_path):
    f = lambda n: load(os.path.join(src_dir, n))
    s1, s2, s3, s4 = f('01_Floating_Seed.glb'), f('02_Planted_Seed.glb'), f('03_Two-leaf_Sprout.glb'), f('04_Three-leaf_Tree.glb')
    seams = [f'Seed | luminous seam {i}' for i in range(1, 6)]
    lines = lambda side: [f'{side} | warm lip', f'{side} | pearl lip', f'{side} | central vein', f'{side} | lower vein']
    body = lambda side: [f'{side} | branch', f'{side} | leaf blade']
    fil = [f'Trunk | spiral filament {i}' for i in range(1, 5)]
    roots = [f'Root | flare {i}' for i in range(1, 7)]

    nodes = []   # (name, mesh dict, extras)
    nodes.append(('Seed_Shell', merge(s1, ['Seed | upper porcelain shell', 'Seed | lower porcelain shell'], s2), None))
    nodes.append(('Seed_Body', merge(s1, ['Seed | opalescent inner body'], s2), None))
    nodes.append(('Seed_Lines', merge(s1, seams, s2), None))
    nodes.append(('Trunk', merge(s3, ['Trunk | sculpted stem'], s4), None))
    nodes.append(('Filaments', merge(s3, fil, s4), None))
    nodes.append(('Roots', merge(s3, roots), None))
    piv = lambda m, side: [round(float(x), 4) for x in ring_centre(m[f'{side} | branch'])]
    tip = lambda m, side: [round(float(x), 4) for x in ring_centre(m[f'{side} | branch'], first=False)]
    ex_a = {'pivot': piv(s3, 'Left'), 'pivotTree': piv(s4, 'Left'), 'tip': tip(s3, 'Left'), 'tipTree': tip(s4, 'Left')}
    ex_b = {'pivot': piv(s3, 'Right'), 'pivotTree': piv(s4, 'Crown'), 'tip': tip(s3, 'Right'), 'tipTree': tip(s4, 'Crown')}
    ex_c = {'pivot': piv(s4, 'Right'), 'pivotTree': piv(s4, 'Right'), 'tip': tip(s4, 'Right'), 'tipTree': tip(s4, 'Right')}
    nodes.append(('Leaf_A_Body', merge(s3, body('Left'), s4), ex_a))
    nodes.append(('Leaf_A_Lines', merge(s3, lines('Left'), s4), ex_a))
    nodes.append(('Leaf_B_Body', merge(s3, body('Right'), s4, body('Crown')), ex_b))
    nodes.append(('Leaf_B_Lines', merge(s3, lines('Right'), s4, lines('Crown')), ex_b))
    nodes.append(('Leaf_C_Body', merge(s4, body('Right')), ex_c))
    nodes.append(('Leaf_C_Lines', merge(s4, lines('Right')), ex_c))

    blob = bytearray(); views = []; accs = []
    def add(arr, target=None, minmax=False, ctype=5126, typ='VEC3'):
        arr = np.ascontiguousarray(arr)
        while len(blob) % 4: blob.append(0)
        v = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': arr.nbytes}
        if target: v['target'] = target
        blob.extend(arr.tobytes()); views.append(v)
        a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': len(arr), 'type': typ}
        if minmax: a['min'] = [float(x) for x in arr.min(0)]; a['max'] = [float(x) for x in arr.max(0)]
        accs.append(a); return len(accs) - 1

    gl_nodes, gl_meshes = [], []
    for name, m, extras in nodes:
        assert len(m['p']) < 65536
        prim = {'attributes': {'POSITION': add(m['p'].astype('<f4'), 34962, True), 'NORMAL': add(m['n'].astype('<f4'), 34962),
                               'COLOR_0': add(m['c'].astype('<f4'), 34962)},
                'indices': add(m['i'].astype('<u2'), 34963, ctype=5123, typ='SCALAR'), 'material': 0}
        mesh = {'name': name, 'primitives': [prim]}
        if 'tp' in m:
            prim['targets'] = [{'POSITION': add(m['tp'].astype('<f4'), 34962, True), 'NORMAL': add(m['tn'].astype('<f4'), 34962)}]
            mesh['weights'] = [0.0]; mesh['extras'] = {'targetNames': ['next']}
        node = {'name': name, 'mesh': len(gl_meshes)}
        if extras: node['extras'] = extras
        gl_meshes.append(mesh); gl_nodes.append(node)

    doc = {'asset': {'version': '2.0', 'generator': 'AiMoneyPrinter build_seed_to_tree.py'},
           'scene': 0, 'scenes': [{'name': 'Seed to Tree', 'nodes': list(range(len(gl_nodes)))}],
           'nodes': gl_nodes, 'meshes': gl_meshes,
           'materials': [{'name': 'Placeholder', 'doubleSided': True, 'pbrMetallicRoughness': {'roughnessFactor': 0.3, 'metallicFactor': 0}}],
           'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    while len(blob) % 4: blob.append(0)
    with open(out_path, 'wb') as o:
        o.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        o.write(struct.pack('<II', len(js), 0x4E4F534A)); o.write(js)
        o.write(struct.pack('<II', len(blob), 0x004E4942)); o.write(blob)
    print(out_path, os.path.getsize(out_path), 'bytes;', sum(len(m['p']) for _, m, _ in nodes), 'vertices;', len(nodes), 'meshes')
    for name, m, e in nodes: print(f'  {name:14s} v={len(m["p"]):5d} tris={len(m["i"]) // 3:5d} morph={"tp" in m} {e or ""}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
