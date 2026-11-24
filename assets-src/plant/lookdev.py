"""Quick Cycles proof render of the authored parts: seed (left) and full tree with three leaves (right)."""
import bpy, json, math, os, sys
from mathutils import Vector, Euler
OUT = sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, 'plant.blend'))
sc = bpy.context.scene
B = json.load(open(os.path.join(OUT, 'branches.json')))
g2b = lambda p: Vector((p[0], -p[2], p[1]))
ob = bpy.data.objects
for n in ('Seed_Core', 'Seed_Shell_A', 'Seed_Shell_B'):
    ob[n].location = (-2.2, 0, 1.4); ob[n].rotation_euler = Euler((0, math.radians(-38), 0))
leaf = ob['Leaf']
def place(o, p, tilt, s):
    o.location = p; o.rotation_euler = Euler((0, math.radians(tilt), 0)); o.scale = (s, s, s)
place(leaf, g2b(B['trunk'][-1]), 20, 1.0)
for name, key, tilt, s in (('LeafL', 'left', -70, 0.8), ('LeafR', 'right', 70, 0.6)):
    c = leaf.copy(); c.name = name; sc.collection.objects.link(c); place(c, g2b(B[key][-1]), tilt, s)
bpy.ops.mesh.primitive_plane_add(size=30); 
w = sc.world or bpy.data.worlds.new('w'); sc.world = w
w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.93, 0.91, 0.98, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (0, -7.5, 1.9); cam.rotation_euler = Euler((math.radians(86), 0, 0)); cam.data.lens = 40
L = bpy.data.objects.new('Key', bpy.data.lights.new('Key', 'AREA')); L.data.energy = 900; L.data.size = 5
L.location = (-3, -4, 6); L.rotation_euler = Euler((math.radians(40), math.radians(-30), 0)); sc.collection.objects.link(L)
sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.cycles.use_denoising = True; sc.cycles.device = 'CPU'
sc.render.resolution_x, sc.render.resolution_y = 960, 540
sc.render.filepath = os.path.join(OUT, 'lookdev.png'); bpy.ops.render.render(write_still=True)
