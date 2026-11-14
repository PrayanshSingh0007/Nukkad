"""
Nukkad's own vehicle models, built in Blender by script (run through the Blender MCP add-on
or Blender's Text editor). Every model is ours: no downloaded parts, no brand marks.

    exec(open('<repo>/tools/blender/vehicles.py').read()); build_all('<repo>/apps/web/public/models')

Conventions (the game expects these): metres, front towards +Y in Blender (= -Z in glTF),
wheels on the ground at Z = 0. Material names matter to the game's loader:
  "Paint..."  takes the per-vehicle colour · "Glass/Chrome/Light..." are glossy · the rest matte.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

MATS = {}


def mat(name, rgb, rough=0.6, metal=0.0):
    """One flat-colour material per name (the game reads only the base colour and the name)."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*rgb, 1)
    MATS[name] = m
    return m


def srgb(hex_colour):
    """#rrggbb → linear RGB (what Blender materials expect)."""
    h = hex_colour.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


class Model:
    """Collects the parts of one vehicle in its own collection."""

    def __init__(self, name):
        self.name = name
        self.col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(self.col)

    def _finish(self, obj, material, bevel=0.0, segments=2, smooth=True, subsurf=0):
        self.col.objects.link(obj)
        obj.data.materials.append(material)
        if bevel > 0:
            b = obj.modifiers.new('Bevel', 'BEVEL')
            b.width = bevel
            b.segments = segments
            b.limit_method = 'ANGLE'
            b.angle_limit = math.radians(40)
        if subsurf:
            obj.modifiers.new('Subsurf', 'SUBSURF').levels = subsurf
        if smooth:
            for p in obj.data.polygons:
                p.use_smooth = True
        return obj

    def mesh(self, name, build, material, **kw):
        """`build(bm)` fills a bmesh; returns the new object."""
        me = bpy.data.meshes.new(f'{self.name}_{name}')
        bm = bmesh.new()
        build(bm)
        bm.normal_update()
        bm.to_mesh(me)
        bm.free()
        return self._finish(bpy.data.objects.new(f'{self.name}_{name}', me), material, **kw)

    def box(self, name, size, at, material, bevel=0.02, rot=(0, 0, 0), taper=None, **kw):
        """A box `size` (x, y, z) centred at `at`. `taper(v)` may move each corner (before rotation)."""
        def build(bm):
            bmesh.ops.create_cube(bm, size=1)
            for v in bm.verts:
                v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
                if taper:
                    taper(v)
            bmesh.ops.transform(bm, matrix=Matrix.Translation(at) @ (Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X')), verts=bm.verts)
        return self.mesh(name, build, material, bevel=bevel, **kw)

    def cyl(self, name, radius, depth, at, material, axis='X', segments=20, radius2=None, bevel=0.0, **kw):
        """A cylinder (or cone when radius2 is given) along `axis`."""
        def build(bm):
            bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius if radius2 is None else radius2, depth=depth)
            turn = {'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 4, 'X'), 'Z': Matrix.Identity(4)}[axis]
            bmesh.ops.transform(bm, matrix=Matrix.Translation(at) @ turn, verts=bm.verts)
        return self.mesh(name, build, material, bevel=bevel, **kw)

    def wheel(self, name, at, radius, width, tyre, rim, hub):
        """A tyre (torus-like, rounded shoulders), a dished rim and a hub, axle along X."""
        def build(bm):
            # Lathe a tyre cross-section around the axle.
            profile = [(radius * 0.62, -width / 2), (radius * 0.9, -width / 2), (radius, -width * 0.3), (radius, width * 0.3), (radius * 0.9, width / 2), (radius * 0.62, width / 2)]
            steps = 24
            rings = []
            for s in range(steps):
                a = 2 * math.pi * s / steps
                rings.append([bm.verts.new((x, math.cos(a) * r, math.sin(a) * r)) for r, x in profile])
            for s in range(steps):
                a, b = rings[s], rings[(s + 1) % steps]
                for k in range(len(profile) - 1):
                    bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
            bmesh.ops.transform(bm, matrix=Matrix.Translation(at), verts=bm.verts)
        self.mesh(f'{name}_tyre', build, tyre)
        self.cyl(f'{name}_rim', radius * 0.63, width * 0.8, at, rim, segments=20, bevel=0.01)
        self.cyl(f'{name}_hub', radius * 0.2, width * 0.95, at, hub, segments=10)

    def export(self, folder):
        """Applies modifiers, joins nothing (the game merges), writes <folder>/<name>.glb."""
        bpy.ops.object.select_all(action='DESELECT')
        for o in self.col.objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = self.col.objects[0]
        path = f'{folder}/{self.name}.glb'
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_materials='EXPORT', export_normals=True, export_texcoords=False, export_animations=False)
        tris = 0
        deps = bpy.context.evaluated_depsgraph_get()
        for o in self.col.objects:
            me = o.evaluated_get(deps).to_mesh()
            me.calc_loop_triangles()
            tris += len(me.loop_triangles)
        return {'path': path, 'triangles': tris, 'objects': len(self.col.objects)}


def clear(name):
    col = bpy.data.collections.get(name)
    if col:
        for o in list(col.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(col)


def auto_rickshaw():
    """The Bengaluru auto: green body, yellow canvas roof, one front wheel, bench at the back."""
    clear('auto')
    m = Model('auto')
    green = mat('BodyGreen', srgb('#2a8a3a'), 0.45)
    green_dark = mat('BodyGreenDark', srgb('#1d6229'), 0.5)
    yellow = mat('CanvasYellow', srgb('#f0be28'), 0.85)
    black = mat('Black', srgb('#17181a'), 0.6)
    rubber = mat('Tyre', srgb('#141516'), 0.9)
    rim = mat('RimSteel', srgb('#6f747a'), 0.5, 0.6)
    chrome = mat('Chrome', srgb('#c9ced3'), 0.2, 0.9)
    glass = mat('Glass', srgb('#1b2a33'), 0.08)
    lamp = mat('LightHead', srgb('#f6f2e2'), 0.1)
    tail = mat('LightTail', srgb('#b3121b'), 0.2)
    amber = mat('LightAmber', srgb('#f2a12a'), 0.2)
    seat = mat('SeatBlue', srgb('#22385a'), 0.7)
    plate = mat('Plate', srgb('#f2f2ea'), 0.6)
    floor = mat('Floor', srgb('#2b2c2f'), 0.8)

    # Lower body (the tub): narrower and rising at the nose.
    def nose(v):
        if v.co.y > 0:  # front end: narrower, and its top edge higher (the dashboard cowl)
            v.co.x *= 0.62
            if v.co.z > 0:
                v.co.z += 0.46
                v.co.y -= 0.28
    m.box('tub', (1.32, 2.7, 0.4), (0, 0.05, 0.54), green, bevel=0.09, segments=3, taper=nose)
    m.box('skirt', (1.36, 2.3, 0.07), (0, -0.1, 0.35), green_dark, bevel=0.02)
    m.box('strip_l', (0.02, 1.9, 0.05), (-0.67, -0.25, 0.8), chrome, bevel=0.008)
    m.box('strip_r', (0.02, 1.9, 0.05), (0.67, -0.25, 0.8), chrome, bevel=0.008)
    m.box('floor', (1.2, 2.2, 0.04), (0, -0.1, 0.42), floor, bevel=0.0)

    # Canvas roof: an arch across the width, a little longer than the cabin, with black piping.
    def roof(bm, thickness=0.035, y0=-1.12, y1=0.98, lift=0.0, half=0.7):
        nx, ny = 12, 6
        grid = [[None] * (ny + 1) for _ in range(nx + 1)]
        for i in range(nx + 1):
            x = -half + 2 * half * i / nx
            for j in range(ny + 1):
                y = y0 + (y1 - y0) * j / ny
                z = 1.6 + lift + 0.24 * math.cos(x / half * math.pi / 2) - 0.03 * ((y - (y0 + y1) / 2) / ((y1 - y0) / 2)) ** 2
                grid[i][j] = bm.verts.new((x, y, z))
        for i in range(nx):
            for j in range(ny):
                bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thickness)
    m.mesh('roof', roof, yellow)
    m.mesh('roof_pipe_f', lambda bm: roof(bm, 0.05, 0.94, 1.0, 0.004, 0.71), black)
    m.mesh('roof_pipe_b', lambda bm: roof(bm, 0.05, -1.14, -1.08, 0.004, 0.71), black)
    # Rolled side curtains under the roof edges.
    for s, n in ((-1, 'l'), (1, 'r')):
        m.cyl(f'curtain_{n}', 0.045, 1.55, (s * 0.69, -0.15, 1.6), black, axis='Y', segments=10)

    # Rear cover (black rexine) with a small window, and the rear body panel.
    m.box('rear_cover', (1.34, 0.05, 0.86), (0, -1.1, 1.2), black, bevel=0.02)
    m.box('rear_window', (0.72, 0.02, 0.26), (0, -1.13, 1.38), glass, bevel=0.01)

    # Cab: windscreen with a frame, pillars, wiper, mirrors.
    m.box('screen', (1.06, 0.03, 0.62), (0, 0.9, 1.36), glass, bevel=0.01, rot=(math.radians(-10), 0, 0))
    for z, n in ((1.67, 't'), (1.05, 'b')):
        m.box(f'screen_{n}', (1.14, 0.05, 0.05), (0, 0.9 + (0.055 if n == 'b' else -0.055), z), black, bevel=0.01)
    for s, n in ((-1, 'l'), (1, 'r')):
        m.cyl(f'pillar_f_{n}', 0.025, 0.72, (s * 0.56, 0.9, 1.36), black, axis='Z', segments=10)
        m.cyl(f'pillar_m_{n}', 0.022, 0.84, (s * 0.67, 0.2, 1.2), black, axis='Z', segments=10)
        m.cyl(f'pillar_b_{n}', 0.022, 0.86, (s * 0.67, -1.08, 1.2), black, axis='Z', segments=10)
        m.cyl(f'mirror_arm_{n}', 0.01, 0.2, (s * 0.66, 0.92, 1.3), black, axis='X', segments=6)
        m.box(f'mirror_{n}', (0.11, 0.02, 0.08), (s * 0.78, 0.92, 1.32), glass, bevel=0.01)
    m.box('wiper', (0.4, 0.012, 0.02), (0.12, 0.925, 1.2), black, bevel=0.0, rot=(0, math.radians(-25), 0))

    # Nose: round headlamp in a chrome ring, indicators, bumper, blank plate.
    m.cyl('headlamp', 0.095, 0.05, (0, 1.36, 1.0), lamp, axis='Y', segments=20, bevel=0.01)
    m.cyl('headlamp_ring', 0.115, 0.04, (0, 1.345, 1.0), chrome, axis='Y', segments=20)
    for s, n in ((-1, 'l'), (1, 'r')):
        m.box(f'indicator_{n}', (0.08, 0.03, 0.05), (s * 0.24, 1.32, 0.86), amber, bevel=0.01)
    m.box('bumper', (0.86, 0.07, 0.08), (0, 1.4, 0.42), black, bevel=0.03)
    m.box('plate_f', (0.36, 0.01, 0.12), (0, 1.385, 0.62), plate, bevel=0.0)

    # Front wheel under a mudguard, on a fork.
    def guard(bm):
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=1)
        bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 1.0, 0.27)) @ Matrix.Diagonal((0.1, 0.33, 0.3, 1)), verts=bm.verts)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.3], context='VERTS')
    m.mesh('mudguard', guard, green)
    m.cyl('fork', 0.02, 0.5, (0.09, 1.0, 0.5), chrome, axis='Z', segments=8)
    m.wheel('wheel_f', (0, 1.0, 0.23), 0.23, 0.13, rubber, rim, black)
    m.wheel('wheel_l', (-0.6, -0.72, 0.23), 0.23, 0.13, rubber, rim, black)
    m.wheel('wheel_r', (0.6, -0.72, 0.23), 0.23, 0.13, rubber, rim, black)

    # Inside: driver's seat, handlebar with grips, meter; passenger bench, backrest, grab rail.
    m.box('driver_seat', (0.5, 0.36, 0.12), (0, 0.36, 0.88), black, bevel=0.04, segments=3)
    m.cyl('handlebar', 0.018, 0.66, (0, 0.62, 1.07), chrome, axis='X', segments=8)
    for s, n in ((-1, 'l'), (1, 'r')):
        m.cyl(f'grip_{n}', 0.026, 0.1, (s * 0.34, 0.62, 1.07), black, axis='X', segments=8)
    m.cyl('steering', 0.02, 0.34, (0, 0.7, 0.93), black, axis='Z', segments=8)
    m.box('meter', (0.14, 0.08, 0.12), (0.4, 0.8, 1.16), black, bevel=0.02)
    m.box('bench', (1.22, 0.52, 0.16), (0, -0.56, 0.84), seat, bevel=0.05, segments=3)
    m.box('backrest', (1.22, 0.12, 0.52), (0, -0.88, 1.1), seat, bevel=0.05, segments=3)
    m.cyl('grab_rail', 0.016, 1.2, (0, -0.2, 1.44), chrome, axis='X', segments=8)
    m.box('partition', (1.2, 0.04, 0.36), (0, 0.14, 0.84), green_dark, bevel=0.01)

    # Back: tail lamps, plate, the engine cover under the bench, the silencer.
    for s, n in ((-1, 'l'), (1, 'r')):
        m.box(f'tail_{n}', (0.1, 0.03, 0.08), (s * 0.52, -1.3, 0.66), tail, bevel=0.01)
        m.box(f'tail_amber_{n}', (0.06, 0.03, 0.05), (s * 0.4, -1.3, 0.66), amber, bevel=0.01)
    m.box('plate_b', (0.36, 0.01, 0.12), (0, -1.31, 0.5), plate, bevel=0.0)
    m.box('engine', (0.9, 0.5, 0.22), (0, -0.95, 0.31), floor, bevel=0.03)
    m.cyl('silencer', 0.04, 0.45, (0.3, -1.05, 0.22), chrome, axis='Y', segments=10)
    return m


def scooter():
    """A step-through scooter (the game calls it two_wheeler). The body takes the per-vehicle paint."""
    clear('two_wheeler')
    m = Model('two_wheeler')
    paint = mat('PaintBody', (1, 1, 1), 0.35)
    black = mat('Black', srgb('#17181a'), 0.6)
    seat = mat('SeatBlack', srgb('#202022'), 0.8)
    rubber = mat('Tyre', srgb('#141516'), 0.9)
    rim = mat('RimSteel', srgb('#6f747a'), 0.5, 0.6)
    chrome = mat('Chrome', srgb('#c9ced3'), 0.2, 0.9)
    glass = mat('Glass', srgb('#1b2a33'), 0.08)
    lamp = mat('LightHead', srgb('#f6f2e2'), 0.1)
    tail = mat('LightTail', srgb('#b3121b'), 0.2)
    amber = mat('LightAmber', srgb('#f2a12a'), 0.2)
    plate = mat('Plate', srgb('#f2f2ea'), 0.6)
    floor = mat('Floor', srgb('#2b2c2f'), 0.8)

    # Rear body: rounded, narrower at the tail, with the seat on top.
    def tail_taper(v):
        if v.co.y < 0:
            v.co.x *= 0.72
            if v.co.z > 0:
                v.co.z += 0.04
    m.box('rear', (0.44, 0.95, 0.4), (0, -0.48, 0.58), paint, bevel=0.13, segments=4, taper=tail_taper)
    m.box('seat', (0.32, 0.8, 0.1), (0, -0.42, 0.85), seat, bevel=0.045, segments=3)
    m.box('floorboard', (0.36, 0.52, 0.06), (0, 0.1, 0.34), floor, bevel=0.02)
    # Front apron (leg shield) leaning back to the handlebar, and the inner dark panel.
    m.box('apron', (0.44, 0.09, 0.66), (0, 0.42, 0.68), paint, bevel=0.04, segments=3, rot=(math.radians(14), 0, 0))
    m.box('apron_in', (0.3, 0.03, 0.44), (0, 0.345, 0.62), black, bevel=0.01, rot=(math.radians(14), 0, 0))
    # Handlebar cowl with the headlamp; bar, grips, mirrors, indicators.
    m.box('cowl', (0.46, 0.18, 0.15), (0, 0.5, 1.06), paint, bevel=0.06, segments=3)
    m.cyl('headlamp', 0.07, 0.04, (0, 0.6, 1.06), lamp, axis='Y', segments=18, bevel=0.008)
    m.cyl('bar', 0.016, 0.7, (0, 0.46, 1.1), chrome, axis='X', segments=8)
    m.cyl('column', 0.03, 0.42, (0, 0.47, 0.86), black, axis='Z', segments=10)
    for s, n in ((-1, 'l'), (1, 'r')):
        m.cyl(f'grip_{n}', 0.024, 0.11, (s * 0.33, 0.46, 1.1), black, axis='X', segments=8)
        m.cyl(f'mirror_arm_{n}', 0.008, 0.22, (s * 0.27, 0.46, 1.22), black, axis='Z', segments=6)
        m.box(f'mirror_{n}', (0.09, 0.015, 0.06), (s * 0.29, 0.46, 1.34), glass, bevel=0.01)
        m.box(f'indicator_{n}', (0.05, 0.03, 0.03), (s * 0.19, 0.58, 0.98), amber, bevel=0.008)
        m.cyl(f'fork_{n}', 0.016, 0.46, (s * 0.07, 0.6, 0.47), chrome, axis='Z', segments=6)
        m.box(f'tail_ind_{n}', (0.04, 0.03, 0.03), (s * 0.13, -0.95, 0.66), amber, bevel=0.008)

    def guard(bm):
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=1)
        bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 0.62, 0.26)) @ Matrix.Diagonal((0.085, 0.31, 0.28, 1)), verts=bm.verts)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.3], context='VERTS')
    m.mesh('mudguard', guard, paint)
    m.wheel('wheel_f', (0, 0.62, 0.24), 0.24, 0.1, rubber, rim, black)
    m.wheel('wheel_r', (0, -0.58, 0.24), 0.24, 0.11, rubber, rim, black)
    # Back: tail lamp, grab rail, plates, exhaust, stand.
    m.box('tail', (0.18, 0.04, 0.07), (0, -0.955, 0.7), tail, bevel=0.015)
    m.box('plate_b', (0.18, 0.01, 0.1), (0, -0.96, 0.52), plate, bevel=0.0)
    m.box('plate_f', (0.16, 0.01, 0.09), (0, 0.635, 0.74), plate, bevel=0.0)
    m.box('grab', (0.3, 0.05, 0.02), (0, -0.9, 0.9), black, bevel=0.008)
    m.cyl('exhaust', 0.045, 0.44, (0.18, -0.48, 0.3), chrome, axis='Y', segments=10, bevel=0.01)
    m.cyl('stand', 0.012, 0.3, (-0.13, -0.05, 0.16), black, axis='X', segments=6)
    return m


def city_bus():
    """A city bus in our own colours (white with a blue band, no operator marks). Doors on the left (India)."""
    clear('bus')
    m = Model('bus')
    white = mat('BusWhite', srgb('#eef1f3'), 0.4)
    blue = mat('BusBlue', srgb('#2b6cb3'), 0.4)
    dark = mat('Black', srgb('#17181a'), 0.6)
    rubber = mat('Tyre', srgb('#141516'), 0.9)
    rim = mat('RimSteel', srgb('#6f747a'), 0.5, 0.6)
    glass = mat('Glass', srgb('#1b2a33'), 0.08)
    lamp = mat('LightHead', srgb('#f6f2e2'), 0.1)
    tail = mat('LightTail', srgb('#b3121b'), 0.2)
    amber = mat('LightAmber', srgb('#f2a12a'), 0.2)
    plate = mat('Plate', srgb('#f2f2ea'), 0.6)
    grey = mat('RoofGrey', srgb('#c9cdd1'), 0.6)

    m.box('body', (2.5, 11.2, 2.55), (0, 0, 1.85), white, bevel=0.2, segments=4)
    m.box('band', (2.53, 11.22, 0.5), (0, 0, 0.98), blue, bevel=0.05)
    m.box('skirt', (2.46, 11.0, 0.36), (0, 0, 0.52), dark, bevel=0.04)
    # Windows: one long strip of glass each side, with pillars every 1.35 m.
    m.box('windows', (2.535, 9.4, 0.92), (0, -0.5, 2.22), glass, bevel=0.03)
    for i in range(8):
        m.box(f'pillar_{i}', (2.55, 0.09, 0.94), (0, -5.0 + i * 1.3, 2.22), white, bevel=0.01)
    m.box('windscreen', (2.3, 0.06, 1.4), (0, 5.59, 2.0), glass, bevel=0.03)
    m.box('rear_window', (2.1, 0.06, 0.8), (0, -5.59, 2.3), glass, bevel=0.03)
    m.box('board', (1.7, 0.05, 0.28), (0, 5.6, 2.92), dark, bevel=0.01)
    m.box('board_text', (1.5, 0.02, 0.16), (0, 5.63, 2.92), amber, bevel=0.0)
    # Two doors on the left side (the side facing the footpath in India).
    for y, n in ((3.9, 'f'), (-1.2, 'r')):
        m.box(f'door_{n}', (0.04, 1.15, 2.05), (-1.255, y, 1.5), glass, bevel=0.01)
        m.box(f'door_frame_{n}', (0.05, 0.05, 2.05), (-1.26, y, 1.5), dark, bevel=0.0)
        m.box(f'step_{n}', (0.2, 1.1, 0.06), (-1.3, y, 0.5), dark, bevel=0.01)
    # Lights, bumpers, plates, mirrors, wipers.
    for s, n in ((-1, 'l'), (1, 'r')):
        m.box(f'head_{n}', (0.34, 0.05, 0.2), (s * 0.88, 5.6, 0.98), lamp, bevel=0.03)
        m.box(f'ind_{n}', (0.14, 0.05, 0.1), (s * 1.12, 5.6, 0.98), amber, bevel=0.02)
        m.box(f'tail_{n}', (0.2, 0.05, 0.34), (s * 0.98, -5.6, 1.15), tail, bevel=0.03)
        m.box(f'mirror_arm_{n}', (0.3, 0.04, 0.04), (s * 1.38, 5.45, 2.5), dark, bevel=0.0)
        m.box(f'mirror_{n}', (0.06, 0.16, 0.36), (s * 1.52, 5.45, 2.36), dark, bevel=0.02)
        m.box(f'wiper_{n}', (0.03, 0.02, 0.7), (s * 0.5, 5.63, 1.75), dark, bevel=0.0, rot=(0, s * math.radians(25), 0))
    m.box('bumper_f', (2.5, 0.14, 0.26), (0, 5.62, 0.56), dark, bevel=0.05)
    m.box('bumper_b', (2.5, 0.14, 0.26), (0, -5.62, 0.56), dark, bevel=0.05)
    m.box('plate_f', (0.5, 0.01, 0.13), (0, 5.7, 0.58), plate, bevel=0.0)
    m.box('plate_b', (0.5, 0.01, 0.13), (0, -5.7, 0.78), plate, bevel=0.0)
    m.box('grille', (1.4, 0.03, 0.22), (0, 5.61, 1.0), dark, bevel=0.01)
    # Roof: air-conditioner box and two hatches.
    m.box('ac', (1.7, 3.0, 0.24), (0, -1.5, 3.2), grey, bevel=0.06, segments=3)
    for y, n in ((2.6, 'a'), (-4.2, 'b')):
        m.box(f'hatch_{n}', (0.8, 0.8, 0.06), (0, y, 3.14), grey, bevel=0.02)
    for s, n in ((-1, 'l'), (1, 'r')):
        m.wheel(f'wheel_f{n}', (s * 1.05, 3.5, 0.5), 0.5, 0.3, rubber, rim, dark)
        m.wheel(f'wheel_r{n}', (s * 1.05, -3.3, 0.5), 0.5, 0.34, rubber, rim, dark)
        m.box(f'arch_f{n}', (0.06, 1.3, 0.3), (s * 1.24, 3.5, 0.95), dark, bevel=0.02)
        m.box(f'arch_r{n}', (0.06, 1.3, 0.3), (s * 1.24, -3.3, 0.95), dark, bevel=0.02)
    return m


def build_all(folder):
    out = {}
    for build in (auto_rickshaw, scooter, city_bus):
        model = build()
        out[model.name] = model.export(folder)
    return out
