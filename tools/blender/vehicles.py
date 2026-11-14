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


# ---------------------------------------------------------------- shaping tools

def section_ring(bm, y, zc, hw, h_bot, h_top, power=2.6, ring=20, xc=0.0):
    """One closed cross-section across X/Z at depth y: a rounded rectangle (superellipse).
    power 2 = ellipse, higher = squarer. Different top and bottom heights allowed."""
    verts = []
    for k in range(ring):
        t = 2 * math.pi * k / ring
        c, s = math.cos(t), math.sin(t)
        x = xc + hw * math.copysign(abs(c) ** (2 / power), c)
        z = zc + (h_top if s > 0 else h_bot) * math.copysign(abs(s) ** (2 / power), s)
        verts.append(bm.verts.new((x, y, z)))
    return verts


def loft_build(sections, ring=20, cap=True):
    """sections = [(y, zc, hw, h_bot, h_top, power), ...] front to back or back to front."""
    def build(bm):
        rings = [section_ring(bm, *sec[:5], power=sec[5] if len(sec) > 5 else 2.6, ring=ring) for sec in sections]
        for a, b in zip(rings, rings[1:]):
            for k in range(ring):
                bm.faces.new((a[k], a[(k + 1) % ring], b[(k + 1) % ring], b[k]))
        if cap:
            bm.faces.new(rings[0])
            bm.faces.new(list(reversed(rings[-1])))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return build


def rod(m, name, a, b, radius, material, segments=10, radius_b=None):
    """A tube from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    def build(bm):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius if radius_b is None else radius_b, depth=d.length)
        rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=bm.verts)
    return m.mesh(name, build, material, smooth=True)


def path(m, name, points, radius, material, segments=10):
    """A bent tube through several points (exhausts, frames, handlebars)."""
    for i in range(len(points) - 1):
        rod(m, f'{name}_{i}', points[i], points[i + 1], radius, material, segments)
        if 0 < i:
            m.mesh(f'{name}_j{i}', lambda bm, at=points[i]: (bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=6, radius=radius), bmesh.ops.transform(bm, matrix=Matrix.Translation(at), verts=bm.verts)), material)


def arc_fender(m, name, centre, radius, width, start, end, material, thickness=0.012, steps=14):
    """A curved mudguard: a strip around a wheel from angle `start` to `end` (radians, 0 = forward, up = pi/2)."""
    def build(bm):
        rows = []
        for i in range(steps + 1):
            t = start + (end - start) * i / steps
            y = centre[1] + math.cos(t) * radius
            z = centre[2] + math.sin(t) * radius
            rows.append([bm.verts.new((centre[0] + x, y, z)) for x in (-width / 2, -width / 2 * 0.8, width / 2 * 0.8, width / 2)])
        # slight crown across the width
        for row in rows:
            for v, lift in zip(row, (0.0, 0.012, 0.012, 0.0)):
                dy, dz = v.co.y - centre[1], v.co.z - centre[2]
                n = math.hypot(dy, dz) or 1
                v.co.y += dy / n * lift
                v.co.z += dz / n * lift
        for a, b in zip(rows, rows[1:]):
            for k in range(3):
                bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thickness)
    return m.mesh(name, build, material)


def spoked_wheel(m, name, at, radius, width, tyre, rim, hub, spokes=32):
    """A real motorcycle wheel: tyre, chrome rim, hub and crossed wire spokes."""
    x, y, z = at
    # A narrow tyre (no solid disc: the spokes must show through).
    def tyre_build(bm):
        profile = [(radius * 0.84, -width * 0.42), (radius * 0.93, -width / 2), (radius, -width * 0.25), (radius, width * 0.25), (radius * 0.93, width / 2), (radius * 0.84, width * 0.42)]
        steps = 32
        rings = []
        for s_ in range(steps):
            a_ = 2 * math.pi * s_ / steps
            rings.append([bm.verts.new((x + px, y + math.cos(a_) * r, z + math.sin(a_) * r)) for r, px in profile])
        for s_ in range(steps):
            a1, b1 = rings[s_], rings[(s_ + 1) % steps]
            for k in range(len(profile) - 1):
                bm.faces.new((a1[k], a1[k + 1], b1[k + 1], b1[k]))
    m.mesh(f'{name}_tyre', tyre_build, tyre)
    # thin rim channel and a big hub drum
    def ring_build(bm, r_in=radius * 0.78, r_out=radius * 0.84):
        prof = [(r_in, -width * 0.32), (r_out, -width * 0.32), (r_out, width * 0.32), (r_in, width * 0.32)]
        steps = 32
        rings = []
        for s in range(steps):
            a = 2 * math.pi * s / steps
            rings.append([bm.verts.new((x + px, y + math.cos(a) * r, z + math.sin(a) * r)) for r, px in prof])
        for s in range(steps):
            a, b = rings[s], rings[(s + 1) % steps]
            for k in range(4):
                bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    m.mesh(f'{name}_rimring', ring_build, rim)
    m.cyl(f'{name}_drum', radius * 0.2, width * 1.3, at, hub, segments=16)
    for k in range(spokes):
        a = 2 * math.pi * k / spokes
        side = 1 if k % 2 else -1
        a_hub = a + side * 0.35
        hub_pt = (x + side * width * 0.45, y + math.cos(a_hub) * radius * 0.17, z + math.sin(a_hub) * radius * 0.17)
        rim_pt = (x + side * width * 0.12, y + math.cos(a) * radius * 0.79, z + math.sin(a) * radius * 0.79)
        rod(m, f'{name}_spoke{k}', hub_pt, rim_pt, 0.0028, rim, segments=4)


# ---------------------------------------------------------------- the vehicles

def auto_rickshaw():
    """Bengaluru auto-rickshaw (the 3-wheeler most autos are): 2.63 m long, 1.3 m wide, 1.7 m tall.
    Single front wheel under a tall narrow nose with the headlamp in its face; a curved windscreen;
    the driver's cab opens into a wide passenger tub; a yellow canvas hood on a tube frame curves
    down over the back; black rexine rear with a small window; green body below the waist."""
    clear('auto')
    m = Model('auto')
    green = mat('PaintGreen', srgb('#1f8a3b'), 0.35)
    yellow = mat('CanvasYellow', srgb('#f2c12e'), 0.85)
    black = mat('Black', srgb('#151618'), 0.55)
    rexine = mat('Rexine', srgb('#1b1c1f'), 0.75)
    rubber = mat('Tyre', srgb('#131415'), 0.9)
    rim = mat('RimSteel', srgb('#7b8086'), 0.45, 0.6)
    chrome = mat('Chrome', srgb('#d3d7db'), 0.15, 0.95)
    glass = mat('Glass', srgb('#1a2833'), 0.05)
    lamp = mat('LightHead', srgb('#fbf6e6'), 0.1)
    tail = mat('LightTail', srgb('#b3121b'), 0.2)
    amber = mat('LightAmber', srgb('#f2a12a'), 0.2)
    seat = mat('SeatRexine', srgb('#2a2b2e'), 0.7)
    plate = mat('Plate', srgb('#f4f3ea'), 0.6)
    floor = mat('Floor', srgb('#2b2c2f'), 0.8)

    # Nose / front fairing: tall and narrow at the front, widening and lower into the cab.
    m.mesh('nose', loft_build([
        (1.33, 0.8, 0.24, 0.42, 0.34, 4.5),
        (1.24, 0.83, 0.34, 0.47, 0.36, 5.0),
        (1.04, 0.84, 0.48, 0.5, 0.36, 5.5),
        (0.84, 0.8, 0.61, 0.48, 0.32, 6.0),
        (0.62, 0.74, 0.65, 0.42, 0.18, 6.0),
    ]), green, subsurf=1)
    # Lower body (passenger tub): waist-high, rounded at the back over the engine.
    m.mesh('tub', loft_build([
        (0.66, 0.6, 0.65, 0.26, 0.26, 6.0),
        (0.2, 0.6, 0.66, 0.26, 0.26, 7.0),
        (-0.6, 0.6, 0.66, 0.26, 0.26, 7.0),
        (-1.05, 0.62, 0.64, 0.28, 0.3, 6.0),
        (-1.25, 0.64, 0.54, 0.28, 0.27, 4.5),
        (-1.32, 0.64, 0.36, 0.22, 0.18, 3.0),
    ]), green, subsurf=1)
    # Chrome waist strip and a black rub strip along the bottom.
    for s, n in ((-1, 'l'), (1, 'r')):
        m.box(f'waist_{n}', (0.012, 1.95, 0.03), (s * 0.664, -0.2, 0.7), chrome, bevel=0.006)
    # Windscreen in a black frame, raked back, curved slightly (a thin loft).
    m.mesh('screen', loft_build([
        (0.9, 1.4, 0.5, 0.3, 0.3, 6.0),
        (0.86, 1.41, 0.52, 0.3, 0.3, 6.0),
    ], ring=16), glass)
    m.mesh('screen_frame', loft_build([
        (0.92, 1.4, 0.55, 0.33, 0.33, 7.0),
        (0.9, 1.4, 0.55, 0.33, 0.33, 7.0),
    ], ring=16), black)
    # Canvas hood: an arched shell from the screen to the back, then down the rear (one loft).
    def hood(bm):
        ring = 24
        secs = []
        for i, (y, z_top, z_side) in enumerate([(0.98, 1.72, 1.52), (0.6, 1.77, 1.56), (0.0, 1.78, 1.57), (-0.6, 1.77, 1.56), (-1.05, 1.72, 1.52), (-1.22, 1.6, 1.4)]):
            rowo = []
            rowi = []
            for k in range(ring + 1):
                t = math.pi * k / ring  # 0..pi across the width
                x = math.cos(t) * 0.7
                z = z_side + (z_top - z_side) * math.sin(t) ** 0.8
                rowo.append(bm.verts.new((x, y, z)))
                rowi.append(bm.verts.new((x * 0.97, y, z - 0.03)))
            secs.append((rowo, rowi))
        for (ao, ai), (bo, bi) in zip(secs, secs[1:]):
            for k in range(ring):
                bm.faces.new((ao[k], ao[k + 1], bo[k + 1], bo[k]))
                bm.faces.new((ai[k + 1], ai[k], bi[k], bi[k + 1]))
        for rowo, rowi in (secs[0], secs[-1]):
            for k in range(ring):
                bm.faces.new((rowo[k], rowo[k + 1], rowi[k + 1], rowi[k]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    m.mesh('hood', hood, yellow, subsurf=1)
    # Black piping along the hood's front and back edges.
    for y, n in ((0.99, 'f'), (-1.23, 'b')):
        pts = []
        for k in range(13):
            t = math.pi * k / 12
            z_top, z_side = (1.73, 1.53) if n == 'f' else (1.61, 1.41)
            pts.append((math.cos(t) * 0.71, y, z_side + (z_top - z_side) * math.sin(t) ** 0.8))
        path(m, f'pipe_{n}', pts, 0.018, black)
    # Rear: black rexine panel closing the back, a small window, the engine bay below.
    m.mesh('rear_panel', loft_build([
        (-1.2, 1.12, 0.62, 0.32, 0.28, 5.0),
        (-1.26, 1.1, 0.6, 0.3, 0.26, 5.0),
    ], ring=16), rexine)
    m.box('rear_window', (0.6, 0.02, 0.22), (0, -1.275, 1.24), glass, bevel=0.01)
    # Roof frame tubes: screen pillars and the middle hoop.
    for s, n in ((-1, 'l'), (1, 'r')):
        rod(m, f'pillar_f_{n}', (s * 0.52, 0.88, 1.06), (s * 0.66, 0.92, 1.56), 0.022, black)
        rod(m, f'hoop_{n}', (s * 0.66, 0.15, 0.76), (s * 0.69, 0.15, 1.56), 0.02, black)
        rod(m, f'rear_post_{n}', (s * 0.62, -1.18, 0.78), (s * 0.68, -1.18, 1.44), 0.02, black)
        # Mirrors on stalks from the screen pillars.
        rod(m, f'mirror_arm_{n}', (s * 0.58, 0.92, 1.3), (s * 0.82, 0.98, 1.36), 0.008, black)
        m.box(f'mirror_{n}', (0.12, 0.025, 0.08), (s * 0.86, 0.99, 1.38), glass, bevel=0.02)
        # Rolled curtains along the hood sides.
        rod(m, f'curtain_{n}', (s * 0.69, 0.75, 1.5), (s * 0.69, -1.0, 1.5), 0.04, rexine)
    rod(m, 'grab_rail', (-0.6, 0.15, 1.42), (0.6, 0.15, 1.42), 0.015, chrome)
    # Face of the nose: round headlamp in a chrome bezel, indicators, black bumper, plate.
    m.cyl('headlamp', 0.085, 0.05, (0, 1.33, 0.98), lamp, axis='Y', segments=24, bevel=0.01)
    m.cyl('bezel', 0.105, 0.04, (0, 1.315, 0.98), chrome, axis='Y', segments=24, bevel=0.01)
    for s, n in ((-1, 'l'), (1, 'r')):
        m.box(f'ind_{n}', (0.07, 0.03, 0.045), (s * 0.18, 1.3, 1.12), amber, bevel=0.012)
    m.box('plate_f', (0.3, 0.012, 0.12), (0, 1.335, 0.62), plate, bevel=0.0)
    m.box('bumper', (0.6, 0.06, 0.06), (0, 1.38, 0.42), black, bevel=0.025)
    # Front wheel, fork and a mudguard hugging it.
    m.wheel('wheel_f', (0, 1.0, 0.22), 0.22, 0.12, rubber, rim, black)
    arc_fender(m, 'guard_f', (0, 1.0, 0.22), 0.27, 0.16, math.radians(15), math.radians(165), green)
    rod(m, 'fork', (0.08, 1.0, 0.22), (0.05, 1.04, 0.72), 0.02, black)
    # Rear wheels with their own fenders.
    for s, n in ((-1, 'l'), (1, 'r')):
        m.wheel(f'wheel_{n}', (s * 0.58, -0.75, 0.22), 0.22, 0.12, rubber, rim, black)
    # Inside: driver's seat, handlebar with grips, meter; passenger bench and backrest; floor.
    m.box('floor', (1.2, 2.0, 0.04), (0, -0.2, 0.38), floor, bevel=0.0)
    m.mesh('driver_seat', loft_build([(0.48, 0.86, 0.22, 0.05, 0.06, 3.0), (0.22, 0.86, 0.25, 0.05, 0.07, 3.0)], ring=16), seat, subsurf=1)
    path(m, 'handlebar', [(-0.36, 0.68, 1.06), (-0.2, 0.72, 1.08), (0.2, 0.72, 1.08), (0.36, 0.68, 1.06)], 0.016, chrome)
    for s, n in ((-1, 'l'), (1, 'r')):
        rod(m, f'grip_{n}', (s * 0.34, 0.685, 1.06), (s * 0.44, 0.67, 1.055), 0.024, black)
    rod(m, 'column', (0, 0.74, 0.7), (0, 0.72, 1.07), 0.025, black)
    m.box('meter', (0.14, 0.07, 0.11), (0.42, 0.82, 1.14), black, bevel=0.025)
    m.mesh('bench', loft_build([(-0.3, 0.84, 0.6, 0.06, 0.09, 4.0), (-0.82, 0.84, 0.6, 0.06, 0.09, 4.0)], ring=20), seat, subsurf=1)
    m.mesh('backrest', loft_build([(-0.86, 1.08, 0.6, 0.24, 0.26, 4.0), (-0.98, 1.08, 0.6, 0.24, 0.26, 4.0)], ring=20), seat, subsurf=1)
    # Tail lamps and plate on the rear of the tub; silencer underneath.
    for s, n in ((-1, 'l'), (1, 'r')):
        m.box(f'tail_{n}', (0.1, 0.03, 0.07), (s * 0.4, -1.31, 0.66), tail, bevel=0.015)
    m.box('plate_b', (0.32, 0.012, 0.12), (0, -1.335, 0.5), plate, bevel=0.0)
    rod(m, 'silencer', (0.3, -0.7, 0.24), (0.32, -1.25, 0.26), 0.04, chrome)
    return m


def scooter():
    """Step-through scooter (the commonest two-wheeler in Bengaluru): 1.76 m long, seat 0.7 m high.
    Front apron/leg shield leaning back, headlamp in the handlebar cowl, flat floorboard, a
    smooth rear body that swells over the engine and tapers to the tail lamp, long seat,
    12-inch wheels. The paint takes the per-vehicle colour; the game calls it two_wheeler."""
    clear('two_wheeler')
    m = Model('two_wheeler')
    paint = mat('PaintBody', (1, 1, 1), 0.3)
    black = mat('Black', srgb('#151618'), 0.55)
    seat = mat('SeatBlack', srgb('#1d1e20'), 0.75)
    rubber = mat('Tyre', srgb('#131415'), 0.9)
    rim = mat('RimAlloy', srgb('#5c6066'), 0.4, 0.6)
    chrome = mat('Chrome', srgb('#d3d7db'), 0.15, 0.95)
    glass = mat('Glass', srgb('#1a2833'), 0.05)
    lamp = mat('LightHead', srgb('#fbf6e6'), 0.1)
    tail = mat('LightTail', srgb('#b3121b'), 0.2)
    amber = mat('LightAmber', srgb('#f2a12a'), 0.2)
    plate = mat('Plate', srgb('#f4f3ea'), 0.6)
    floor = mat('Floor', srgb('#26272a'), 0.85)

    # Rear body: from under the seat front, swelling over the engine, tapering to the tail.
    m.mesh('rear', loft_build([
        (0.12, 0.47, 0.12, 0.17, 0.24, 2.8),
        (-0.05, 0.5, 0.17, 0.2, 0.24, 3.0),
        (-0.3, 0.52, 0.2, 0.2, 0.23, 3.0),
        (-0.55, 0.55, 0.19, 0.18, 0.2, 3.0),
        (-0.76, 0.6, 0.14, 0.14, 0.14, 2.6),
        (-0.88, 0.63, 0.07, 0.07, 0.06, 2.2),
    ], ring=20), paint, subsurf=2)
    # Seat on top of the rear body, long and padded, a little step for the pillion.
    m.mesh('seat', loft_build([
        (0.1, 0.77, 0.12, 0.03, 0.04, 2.8),
        (-0.15, 0.79, 0.15, 0.04, 0.06, 3.0),
        (-0.45, 0.8, 0.15, 0.04, 0.07, 3.0),
        (-0.72, 0.8, 0.12, 0.04, 0.05, 2.8),
    ], ring=18), seat, subsurf=2)
    # Floorboard joining the apron to the rear body.
    m.mesh('floor', loft_build([
        (0.44, 0.32, 0.17, 0.04, 0.03, 4.0),
        (0.0, 0.32, 0.17, 0.04, 0.03, 4.0),
    ], ring=16), floor, subsurf=1)
    m.mesh('floor_skirt', loft_build([
        (0.46, 0.26, 0.18, 0.05, 0.04, 3.0),
        (-0.05, 0.26, 0.18, 0.05, 0.04, 3.0),
    ], ring=16), paint, subsurf=1)
    # Front apron: rising and leaning back from the floor to the handlebar (lofted upwards).
    def apron(bm):
        ring = 18
        rows = []
        for z, y, hw, depth in ((0.28, 0.47, 0.21, 0.1), (0.5, 0.5, 0.22, 0.1), (0.75, 0.53, 0.2, 0.09), (0.95, 0.55, 0.15, 0.08), (1.06, 0.55, 0.1, 0.07)):
            row = []
            for k in range(ring):
                t = 2 * math.pi * k / ring
                c, s = math.cos(t), math.sin(t)
                x = hw * math.copysign(abs(c) ** (2 / 3), c)
                yy = y + depth * math.copysign(abs(s) ** (2 / 3), s)
                row.append(bm.verts.new((x, yy, z)))
            rows.append(row)
        for a, b in zip(rows, rows[1:]):
            for k in range(ring):
                bm.faces.new((a[k], a[(k + 1) % ring], b[(k + 1) % ring], b[k]))
        bm.faces.new(rows[0])
        bm.faces.new(list(reversed(rows[-1])))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    m.mesh('apron', apron, paint, subsurf=2)
    m.box('apron_in', (0.26, 0.02, 0.42), (0, 0.475, 0.6), black, bevel=0.01, rot=(math.radians(8), 0, 0))
    # Handlebar cowl with the headlamp in its face, the bar, grips, levers, mirrors.
    m.mesh('cowl', loft_build([
        (0.68, 1.07, 0.1, 0.06, 0.05, 2.6),
        (0.6, 1.08, 0.2, 0.07, 0.06, 3.0),
        (0.48, 1.09, 0.2, 0.06, 0.06, 3.0),
        (0.42, 1.09, 0.12, 0.05, 0.05, 2.6),
    ], ring=18), paint, subsurf=2)
    m.mesh('headlamp', loft_build([(0.69, 1.07, 0.085, 0.04, 0.035, 2.4), (0.665, 1.07, 0.09, 0.045, 0.04, 2.4)], ring=16), lamp)
    m.box('dash', (0.2, 0.08, 0.02), (0, 0.48, 1.15), black, bevel=0.01, rot=(math.radians(-20), 0, 0))
    for s, n in ((-1, 'l'), (1, 'r')):
        rod(m, f'bar_{n}', (s * 0.18, 0.47, 1.1), (s * 0.34, 0.44, 1.1), 0.013, chrome)
        rod(m, f'grip_{n}', (s * 0.3, 0.445, 1.1), (s * 0.4, 0.43, 1.1), 0.02, black)
        rod(m, f'lever_{n}', (s * 0.2, 0.5, 1.12), (s * 0.36, 0.53, 1.11), 0.006, chrome)
        rod(m, f'stalk_{n}', (s * 0.19, 0.47, 1.12), (s * 0.24, 0.46, 1.3), 0.007, black)
        m.mesh(f'mirror_{n}', loft_build([(0.47, 1.33, 0.06, 0.04, 0.04, 2.2), (0.455, 1.33, 0.06, 0.04, 0.04, 2.2)], ring=14), glass)
        for v in m.col.objects[f'two_wheeler_mirror_{n}'].data.vertices:
            v.co.x += s * 0.25
        m.box(f'ind_f_{n}', (0.05, 0.03, 0.025), (s * 0.15, 0.665, 1.07), amber, bevel=0.01)
        m.box(f'ind_b_{n}', (0.04, 0.03, 0.025), (s * 0.1, -0.86, 0.66), amber, bevel=0.01)
    # Front: telescopic fork, a mudguard hugging the wheel, a small plate on the apron.
    for s, n in ((-1, 'l'), (1, 'r')):
        rod(m, f'fork_{n}', (s * 0.065, 0.62, 0.23), (s * 0.05, 0.56, 0.62), 0.018, chrome)
    arc_fender(m, 'guard_f', (0, 0.62, 0.23), 0.27, 0.12, math.radians(20), math.radians(160), paint)
    m.box('plate_f', (0.15, 0.01, 0.09), (0, 0.6, 0.86), plate, bevel=0.0)
    m.wheel('wheel_f', (0, 0.62, 0.23), 0.23, 0.1, rubber, rim, black)
    # Rear: wheel, swinging engine case, exhaust with a guard, tail lamp, grab rail, plate.
    m.wheel('wheel_r', (0, -0.6, 0.23), 0.23, 0.11, rubber, rim, black)
    m.mesh('engine', loft_build([(-0.2, 0.3, 0.07, 0.08, 0.09, 3.0), (-0.65, 0.27, 0.07, 0.07, 0.08, 3.0)], ring=14), black, subsurf=1)
    for v in m.col.objects['two_wheeler_engine'].data.vertices:
        v.co.x -= 0.11
    path(m, 'exhaust', [(0.0, -0.1, 0.18), (0.12, -0.3, 0.2), (0.16, -0.55, 0.26), (0.16, -0.8, 0.3)], 0.032, chrome)
    m.mesh('tail', loft_build([(-0.86, 0.68, 0.1, 0.03, 0.03, 2.6), (-0.9, 0.68, 0.09, 0.03, 0.03, 2.6)], ring=14), tail)
    path(m, 'grab', [(-0.14, -0.6, 0.86), (-0.15, -0.82, 0.86), (0.15, -0.82, 0.86), (0.14, -0.6, 0.86)], 0.012, black)
    m.box('plate_b', (0.17, 0.01, 0.1), (0, -0.88, 0.5), plate, bevel=0.0)
    rod(m, 'stand', (-0.12, -0.05, 0.2), (-0.22, 0.05, 0.02), 0.011, black)
    return m


def motorbike():
    """A classic 350 cc bullet-style motorcycle (generic, no brand): 2.14 m long, seat 0.8 m,
    19-inch spoked wheels, teardrop tank, round headlamp in a nacelle, finned single-cylinder
    engine, long chrome exhaust, sprung saddle, round toolbox, deep mudguards."""
    clear('motorbike')
    m = Model('motorbike')
    paint = mat('PaintTank', (1, 1, 1), 0.25)
    black = mat('Black', srgb('#141517'), 0.5)
    frame = mat('FrameBlack', srgb('#101113'), 0.45)
    seat = mat('SeatBrown', srgb('#2a1d16'), 0.7)
    rubber = mat('Tyre', srgb('#121314'), 0.9)
    chrome = mat('Chrome', srgb('#dfe3e7'), 0.12, 0.95)
    alloy = mat('RimAlloy', srgb('#9aa0a6'), 0.35, 0.7)
    engine = mat('EngineAlloy', srgb('#8d9298'), 0.45, 0.6)
    glass = mat('Glass', srgb('#1a2833'), 0.05)
    lamp = mat('LightHead', srgb('#fbf6e6'), 0.1)
    tail = mat('LightTail', srgb('#b3121b'), 0.2)
    amber = mat('LightAmber', srgb('#f2a12a'), 0.2)
    plate = mat('Plate', srgb('#f4f3ea'), 0.6)
    gold = mat('PinstripeGold', srgb('#c8a24a'), 0.3, 0.6)

    front = (0, 0.7, 0.34)
    back = (0, -0.69, 0.34)
    spoked_wheel(m, 'wheel_f', front, 0.34, 0.09, rubber, chrome, alloy)
    spoked_wheel(m, 'wheel_r', back, 0.33, 0.11, rubber, chrome, alloy)
    # Deep mudguards in the tank colour, on chrome stays.
    arc_fender(m, 'guard_f', front, 0.39, 0.13, math.radians(10), math.radians(150), paint, thickness=0.01)
    arc_fender(m, 'guard_r', back, 0.39, 0.16, math.radians(40), math.radians(200), paint, thickness=0.01)
    for s in (-1, 1):
        rod(m, f'stay_f{s}', (s * 0.07, 0.7, 0.34), (s * 0.07, 0.95, 0.55), 0.006, chrome)
        rod(m, f'stay_r{s}', (s * 0.085, -0.69, 0.34), (s * 0.085, -0.98, 0.6), 0.007, chrome)
    # Front fork (raked), shrouds, and the headlamp nacelle.
    for s in (-1, 1):
        rod(m, f'fork_{s}', (s * 0.075, 0.7, 0.34), (s * 0.075, 0.56, 0.96), 0.022, chrome)
        rod(m, f'shroud_{s}', (s * 0.075, 0.6, 0.78), (s * 0.075, 0.56, 0.98), 0.03, paint)
    m.mesh('nacelle', loft_build([
        (0.74, 1.0, 0.1, 0.1, 0.1, 2.0),
        (0.66, 1.0, 0.115, 0.115, 0.115, 2.0),
        (0.56, 1.0, 0.11, 0.11, 0.11, 2.0),
        (0.52, 1.0, 0.07, 0.07, 0.07, 2.0),
    ], ring=24), black, subsurf=1)
    m.cyl('bezel', 0.103, 0.025, (0, 0.745, 1.0), chrome, axis='Y', segments=28)
    m.cyl('lens', 0.09, 0.02, (0, 0.758, 1.0), lamp, axis='Y', segments=28)
    m.cyl('pilot', 0.018, 0.02, (0, 0.76, 1.07), lamp, axis='Y', segments=10)
    m.cyl('speedo', 0.045, 0.03, (0, 0.6, 1.12), black, axis='Z', segments=18)
    m.cyl('speedo_face', 0.04, 0.005, (0, 0.6, 1.137), glass, axis='Z', segments=18)
    for s, n in ((-1, 'l'), (1, 'r')):
        m.box(f'ind_f_{n}', (0.05, 0.03, 0.03), (s * 0.16, 0.64, 0.98), amber, bevel=0.01)
    # Wide swept-back handlebar with grips, levers and round mirrors.
    path(m, 'handlebar', [(-0.38, 0.47, 1.1), (-0.3, 0.5, 1.13), (-0.12, 0.56, 1.13), (0.12, 0.56, 1.13), (0.3, 0.5, 1.13), (0.38, 0.47, 1.1)], 0.012, chrome)
    for s, n in ((-1, 'l'), (1, 'r')):
        rod(m, f'grip_{n}', (s * 0.33, 0.485, 1.115), (s * 0.43, 0.455, 1.09), 0.02, black)
        rod(m, f'lever_{n}', (s * 0.16, 0.58, 1.12), (s * 0.34, 0.55, 1.08), 0.006, chrome)
        rod(m, f'stalk_{n}', (s * 0.24, 0.53, 1.14), (s * 0.3, 0.52, 1.32), 0.006, chrome)
        m.cyl(f'mirror_{n}', 0.05, 0.015, (s * 0.31, 0.52, 1.34), chrome, axis='Y', segments=18)
        m.cyl(f'mirror_glass_{n}', 0.044, 0.004, (s * 0.31, 0.512, 1.34), glass, axis='Y', segments=18)
    # Teardrop fuel tank with knee pads and a gold pinstripe, a chrome filler cap.
    m.mesh('tank', loft_build([
        (0.5, 0.98, 0.08, 0.05, 0.06, 2.2),
        (0.42, 0.98, 0.14, 0.09, 0.09, 2.4),
        (0.26, 0.98, 0.16, 0.11, 0.1, 2.6),
        (0.08, 0.96, 0.15, 0.1, 0.09, 2.6),
        (-0.06, 0.94, 0.11, 0.08, 0.07, 2.4),
        (-0.12, 0.93, 0.06, 0.05, 0.05, 2.2),
    ], ring=22), paint, subsurf=2)
    for s, n in ((-1, 'l'), (1, 'r')):
        m.mesh(f'kneepad_{n}', loft_build([(0.16, 0.95, 0.05, 0.05, 0.05, 2.4), (0.0, 0.94, 0.045, 0.045, 0.045, 2.4)], ring=14), black, subsurf=1)
        for v in m.col.objects[f'motorbike_kneepad_{n}'].data.vertices:
            v.co.x = s * (0.145 + abs(v.co.x) * 0.15)
        m.box(f'stripe_{n}', (0.004, 0.36, 0.012), (s * 0.158, 0.2, 1.03), gold, bevel=0.0)
    m.cyl('filler', 0.035, 0.02, (0, 0.28, 1.085), chrome, axis='Z', segments=16)
    # Frame: single downtube, top tube under the tank, seat rails, rear subframe.
    rod(m, 'headstock', (0, 0.55, 0.78), (0, 0.5, 1.0), 0.032, frame)
    rod(m, 'downtube', (0, 0.52, 0.86), (0, 0.32, 0.26), 0.022, frame)
    rod(m, 'cradle', (0, 0.32, 0.26), (0, -0.25, 0.24), 0.02, frame)
    rod(m, 'toptube', (0, 0.5, 0.92), (0, -0.2, 0.88), 0.02, frame)
    for s in (-1, 1):
        rod(m, f'rail_{s}', (s * 0.08, -0.15, 0.82), (s * 0.08, -0.85, 0.82), 0.015, frame)
        rod(m, f'swing_{s}', (s * 0.09, -0.2, 0.38), (s * 0.09, -0.69, 0.34), 0.02, frame)
        # Rear shocks: chrome springs (as a thicker tube) to the rail.
        rod(m, f'shock_{s}', (s * 0.11, -0.62, 0.37), (s * 0.1, -0.5, 0.8), 0.025, chrome)
    # Engine: square-ish crankcase, a finned barrel leaning forward, the head, gearbox, kick lever.
    m.mesh('crankcase', loft_build([(0.22, 0.38, 0.11, 0.13, 0.12, 3.0), (-0.25, 0.38, 0.11, 0.12, 0.12, 3.0)], ring=18), engine, subsurf=1)
    for i in range(9):
        z = 0.52 + i * 0.035
        y = 0.1 + i * 0.012
        m.box(f'fin_{i}', (0.2, 0.17, 0.012), (0, y, z), engine, bevel=0.004)
    m.box('barrel', (0.12, 0.11, 0.33), (0, 0.15, 0.66), engine, bevel=0.02, rot=(math.radians(-12), 0, 0))
    m.box('head', (0.17, 0.15, 0.08), (0, 0.21, 0.86), engine, bevel=0.02)
    m.cyl('gearbox', 0.1, 0.17, (0, -0.2, 0.36), engine, axis='X', segments=18)
    m.cyl('primary', 0.13, 0.04, (-0.14, 0.0, 0.37), chrome, axis='X', segments=24, bevel=0.01)
    rod(m, 'kick', (0.15, -0.18, 0.42), (0.19, -0.42, 0.52), 0.012, chrome)
    m.box('battery', (0.1, 0.12, 0.14), (-0.13, -0.18, 0.62), black, bevel=0.01)
    # Round toolbox on the right, oil tank on the left.
    m.cyl('toolbox', 0.11, 0.08, (0.13, -0.22, 0.62), paint, axis='X', segments=24, bevel=0.01)
    m.cyl('oiltank', 0.1, 0.07, (-0.13, -0.24, 0.63), paint, axis='X', segments=24, bevel=0.01)
    # Long chrome exhaust from the head down the right side to a tapered silencer.
    path(m, 'exhaust', [(0.06, 0.32, 0.82), (0.12, 0.42, 0.7), (0.15, 0.4, 0.42), (0.17, 0.2, 0.26), (0.18, -0.25, 0.26)], 0.024, chrome)
    rod(m, 'silencer', (0.18, -0.25, 0.26), (0.19, -0.9, 0.32), 0.04, chrome, radius_b=0.03)
    # Sprung saddle for the rider (two chrome springs under it), a pillion pad behind.
    m.mesh('saddle', loft_build([(-0.02, 0.93, 0.13, 0.03, 0.05, 2.8), (-0.18, 0.93, 0.15, 0.03, 0.06, 2.8), (-0.32, 0.92, 0.11, 0.03, 0.05, 2.6)], ring=18), seat, subsurf=2)
    for s in (-1, 1):
        rod(m, f'spring_{s}', (s * 0.07, -0.3, 0.83), (s * 0.07, -0.3, 0.9), 0.016, chrome)
    m.mesh('pillion', loft_build([(-0.45, 0.88, 0.1, 0.03, 0.04, 2.8), (-0.68, 0.88, 0.1, 0.03, 0.04, 2.8)], ring=16), seat, subsurf=2)
    rod(m, 'grab', (-0.11, -0.72, 0.9), (0.11, -0.72, 0.9), 0.01, chrome)
    # Rear: round tail lamp on the mudguard, plate, indicators; footpegs and a side stand.
    m.cyl('tail', 0.04, 0.03, (0, -1.04, 0.66), tail, axis='Y', segments=16)
    m.box('plate_b', (0.2, 0.01, 0.12), (0, -1.06, 0.55), plate, bevel=0.0)
    for s, n in ((-1, 'l'), (1, 'r')):
        m.box(f'ind_b_{n}', (0.045, 0.03, 0.03), (s * 0.13, -0.95, 0.72), amber, bevel=0.01)
        rod(m, f'peg_{n}', (s * 0.1, 0.05, 0.3), (s * 0.22, 0.05, 0.3), 0.012, black)
    rod(m, 'stand', (-0.1, -0.05, 0.26), (-0.2, 0.1, 0.02), 0.01, black)
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
    for build in (auto_rickshaw, scooter, motorbike, city_bus):
        model = build()
        out[model.name] = model.export(folder)
    return out
