"""Seedline seed-to-tree asset. Run: python build_plant.py <out_dir>  (Blender 5.2 as Python module, or blender -b -P).

Builds, in one Blender scene with one shared scale (Z up, ground at z=0, tree base at origin):
  Seed_Core     translucent teardrop core (glass in the browser)
  Seed_Shell_A  white matte shell, wraps the core with a spiral opening
  Seed_Shell_B  second shell piece, split from A by a narrow seam so the seed can open
  Leaf          one curved, pointed glass leaf, base at origin, growing along +Z (cloned 3x in the browser)
  Tree_Stem     twisted two-strand trunk + left and right branches as tubes. COLOR_0 encodes growth:
                R = arc-length fraction along its own branch (0 base .. 1 tip), G = branch id (0 trunk, .5 left, 1 right)
Also writes branches.json: sampled branch centre-lines in glTF (Y-up) coordinates so the browser can place leaves at
growing tips, and saves plant.blend for editing.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def link(name, mesh):
    ob = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(ob)
    return ob

def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

# ---------------------------------------------------------------- seed
SEED_L, SEED_R = 1.9, 0.46
NT, NA = 56, 96

def seed_profile(t):
    # full rounded base (t=0) sweeping to a fine pointed tip (t=1), like the reference seed
    return SEED_R * math.sin(math.pi * min(t, 0.999)) ** 0.5 * (1 - t) ** 0.35 * 1.25

def seed_point(t, a, scale=1.0):
    r = seed_profile(t) * scale
    bend = 0.16 * math.sin(math.pi * t) - 0.1 * t ** 2   # sweeping, slightly hooked tip
    return Vector((r * math.cos(a) + bend, r * math.sin(a) * 0.82, SEED_L * (t - 0.42)))

def strip(name, scale, a0, a1, thickness=0.0, nt=NT, na=44):
    """Surface over t in [0,1] and per-row angle range [a0(t), a1(t)] -> clean parametric edges (no jagged deletes)."""
    bm = bmesh.new()
    rows = []
    for i in range(nt + 1):
        t = i / nt
        lo, hi = a0(t), a1(t)
        rows.append([bm.verts.new(seed_point(t, lo + (hi - lo) * k / na, scale)) for k in range(na + 1)])
    for i in range(nt):
        for k in range(na):
            bm.faces.new((rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = link(name, me)
    if thickness:
        mod = ob.modifiers.new('solid', 'SOLIDIFY'); mod.thickness = thickness; mod.offset = -1.0; mod.use_even_offset = True
    for p in me.polygons: p.use_smooth = True
    return ob

FRONT = -math.pi / 2                      # faces the camera (camera looks along +Y in Blender)
def centre(t): return FRONT + (t - 0.5) * 2.3      # opening spirals across the front
def half(t): return 1.25 * math.sin(math.pi * t) ** 0.9 + 0.02
SEAM = 0.05
core = strip('Seed_Core', 0.86, lambda t: 0.0, lambda t: 2 * math.pi, na=NA)
# shell A: from the opening's right edge round the back to the seam; shell B: from the seam to the opening's left edge
shell_a = strip('Seed_Shell_A', 1.0, lambda t: centre(t) + half(t), lambda t: centre(t) + math.pi - SEAM, thickness=0.06)
shell_b = strip('Seed_Shell_B', 1.0, lambda t: centre(t) + math.pi + SEAM, lambda t: centre(t) + 2 * math.pi - half(t), thickness=0.06)

# ---------------------------------------------------------------- leaf
LEAF_L, LEAF_W, NU, NV = 1.0, 0.3, 56, 20

def leaf_point(u, v, top):
    w = LEAF_W * math.sin(math.pi * u ** 0.85) ** 0.85 * (1 - 0.25 * u)
    x = v * w
    thick = 0.03 * (1 - v * v) * math.sin(math.pi * u) ** 0.7
    cup = -0.22 * (v * v) * w            # cupped across the blade
    arch = 0.2 * math.sin(math.pi * u * 0.9) + 0.3 * u ** 2.4   # arches and curls at the tip
    twist = 0.5 * u                                               # slight twist along the blade
    xr = x * math.cos(twist) - (cup) * math.sin(twist)
    yr = x * math.sin(twist) + (cup) * math.cos(twist)
    return Vector((xr, yr + arch + (thick if top else -thick), LEAF_L * u))

bm = bmesh.new()
grids = {}
for top in (True, False):
    g = []
    for i in range(NU + 1):
        u = i / NU
        row = [bm.verts.new(leaf_point(u, -1 + 2 * k / NV, top)) for k in range(NV + 1)]
        g.append(row)
    grids[top] = g
    for i in range(NU):
        for k in range(NV):
            q = (g[i][k], g[i][k + 1], g[i + 1][k + 1], g[i + 1][k])
            bm.faces.new(q if top else tuple(reversed(q)))
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
# colour: white matte crown along one edge of the blade, glass elsewhere (R=whiteness)
white_layer = bm.verts.layers.float.new('_white')
for vert in bm.verts:
    p = vert.co
    u = max(0.0, min(1.0, p.z / LEAF_L))
    w = LEAF_W * math.sin(math.pi * max(u, 1e-3) ** 0.85) ** 0.85 * (1 - 0.25 * u) + 1e-4
    v = p.x / w
    vert[white_layer] = smoothstep(0.1, 0.8, v) * smoothstep(0.05, 0.35, u)
me = bpy.data.meshes.new('Leaf'); bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
leaf = link('Leaf', me)

# ---------------------------------------------------------------- tree (trunk + branches)
def bezier(p0, p1, p2, p3, t):
    a = 1 - t
    return p0 * a ** 3 + p1 * 3 * a * a * t + p2 * 3 * a * t * t + p3 * t ** 3

def sample(ctrl, n):
    pts = [bezier(*ctrl, i / n) for i in range(n + 1)]
    # re-parameterise by arc length
    d = [0.0]
    for i in range(1, len(pts)): d.append(d[-1] + (pts[i] - pts[i - 1]).length)
    L = d[-1]
    out = []
    for k in range(n + 1):
        s = L * k / n
        j = max(1, next(i for i in range(1, len(d)) if d[i] >= s - 1e-9))
        f = (s - d[j - 1]) / max(1e-9, d[j] - d[j - 1])
        out.append(pts[j - 1].lerp(pts[j], f))
    return out

V = Vector
trunk = sample((V((0, 0, 0)), V((0.42, 0, 0.55)), V((-0.32, 0, 1.25)), V((0.05, 0, 2.0))), 160)
SPROUT = 0.42                       # trunk fraction reached at the sprout stage (= left branch origin)
RIGHT_AT = 0.7                      # right branch origin on the trunk
li = int(SPROUT * 160); ri = int(RIGHT_AT * 160)
lo, ro = trunk[li], trunk[ri]
left = sample((lo, lo + V((-0.25, 0, 0.35)), V((-0.75, 0, 1.55)), V((-1.05, 0, 1.75))), 90)
right = sample((ro, ro + V((0.3, 0, 0.25)), V((0.8, 0, 1.6)), V((1.05, 0, 1.78))), 80)

def frame(pts, i):
    a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
    tng = (b - a).normalized()
    ref = V((0, 1, 0)) if abs(tng.y) < 0.9 else V((1, 0, 0))
    n1 = tng.cross(ref).normalized(); n2 = tng.cross(n1).normalized()
    return tng, n1, n2

def tube(bm, gs, gb, pts, radius, branch_id, sides=14, helix=None):
    rings = []
    n = len(pts) - 1
    for i, c in enumerate(pts):
        s = i / n
        tng, n1, n2 = frame(pts, i)
        centre = c.copy()
        if helix:
            amp, turns, phase = helix
            ang = phase + 2 * math.pi * turns * s
            centre += (n1 * math.cos(ang) + n2 * math.sin(ang)) * amp(s)
        r = radius(s)
        ring = [bm.verts.new(centre + (n1 * math.cos(2 * math.pi * k / sides) + n2 * math.sin(2 * math.pi * k / sides)) * r) for k in range(sides)]
        for vv in ring:
            vv[gs] = s; vv[gb] = branch_id
        rings.append((ring, s))
    for i in range(n):
        (ra, sa), (rb, sb) = rings[i], rings[i + 1]
        for k in range(sides):
            bm.faces.new((ra[k], ra[(k + 1) % sides], rb[(k + 1) % sides], rb[k]))

bm = bmesh.new(); gs = bm.verts.layers.float.new('_gs'); gb = bm.verts.layers.float.new('_gb')
flare = lambda s: 0.15 * math.exp(-s * 9)
for phase in (0.0, math.pi):
    tube(bm, gs, gb, trunk, lambda s: 0.062 * (1 - 0.6 * s) + flare(s), 0.0, sides=16,
         helix=(lambda s: 0.05 * (1 - 0.7 * s) * (1 - math.exp(-s * 20)), 1.6, phase))
tube(bm, gs, gb, left, lambda s: 0.04 * (1 - 0.55 * s), 0.5, sides=12)
tube(bm, gs, gb, right, lambda s: 0.034 * (1 - 0.55 * s), 1.0, sides=12)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new('Tree_Stem'); bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
stem = link('Tree_Stem', me)

# Blender colour attributes default to sRGB; mark them linear-free by storing as FLOAT_COLOR byte-exact values

# apply modifiers
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
for ob in list(scene.objects):
    if ob.modifiers:
        new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        ob.modifiers.clear(); old = ob.data; ob.data = new; new.name = old.name; bpy.data.meshes.remove(old)

# ---------------------------------------------------------------- simple lookdev materials (Blender renders + glTF fallback)
def mat(name, color, rough, transmission=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes.get('Principled BSDF') if m.node_tree else None
    if bsdf is None:
        m.use_nodes = True; bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Transmission Weight'].default_value = transmission
    return m

core.data.materials.append(mat('Glass_Core', (0.78, 0.7, 1.0), 0.05, 1.0))
for s in (shell_a, shell_b): s.data.materials.append(mat('Shell_White', (0.97, 0.96, 0.98), 0.35))
leaf.data.materials.append(mat('Glass_Leaf', (0.85, 0.78, 1.0), 0.08, 1.0))
stem.data.materials.append(mat('Glass_Stem', (0.92, 0.88, 1.0), 0.15, 0.6))

# ---------------------------------------------------------------- export
def to_gltf(v):  # Blender Z-up -> glTF Y-up
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]

json.dump({
    'units': 'metres, glTF Y-up, tree base at origin',
    'sproutTrunkFraction': SPROUT, 'rightBranchAt': RIGHT_AT,
    'seed': {'length': SEED_L, 'radius': SEED_R},
    'leaf': {'length': LEAF_L},
    'trunk': [to_gltf(p) for p in trunk[::4]],
    'left': [to_gltf(p) for p in left[::3]],
    'right': [to_gltf(p) for p in right[::3]],
}, open(os.path.join(OUT, 'branches.json'), 'w'))

bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'plant.glb'), export_format='GLB', export_yup=True,
                          export_apply=True, export_normals=True, export_texcoords=False, export_materials='EXPORT',
                          export_vertex_color='NONE', export_attributes=True, export_cameras=False,
                          export_lights=False, export_animations=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'plant.blend'))
print('OK', {o.name: len(o.data.vertices) for o in scene.objects})
