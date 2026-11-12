"""
Nukkad asset kit — builds our own low-poly Bengaluru street models in Blender and
exports each one as a small .glb into apps/web/public/models/.

Run it either way:
  * Blender → Scripting tab → open this file → Run Script
  * or through the Blender MCP connection (Claude runs it)

It never touches your existing scenes: every model gets its own scene named "NK <model>".
Models face Blender +Y (the glTF exporter turns that into -Z, which is "forward" in the game).
A material whose name contains "Paint" is recoloured per copy in the game (car body colours).
Triangle budgets: car ≤ 1,400 · auto ≤ 1,200 · two-wheeler ≤ 700 · bus ≤ 1,600 · stall/stop ≤ 900.
"""

import math
import os

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else ""
DEFAULT_OUT = os.path.join(HERE, "..", "..", "apps", "web", "public", "models") if HERE else ""
OUT = os.path.abspath(os.environ.get("NUKKAD_MODELS") or globals().get("NUKKAD_MODELS") or DEFAULT_OUT)


def linear(hex_colour):
    """Web colour → the linear values Blender's Base Color expects."""
    hex_colour = hex_colour.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(hex_colour[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


def material(name, hex_colour, roughness=0.6, metallic=0.0):
    full = "NK_" + name
    m = bpy.data.materials.get(full) or bpy.data.materials.new(full)
    try:
        m.use_nodes = True
    except Exception:
        pass
    bsdf = m.node_tree.nodes.get("Principled BSDF") if m.node_tree else None
    if bsdf:
        bsdf.inputs["Base Color"].default_value = linear(hex_colour)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    m.diffuse_color = linear(hex_colour)
    return m


M = {
    "paint": material("Paint", "#ffffff", 0.35, 0.2),
    "glass": material("Glass", "#2f3d49", 0.08, 0.3),
    "tyre": material("Tyre", "#1b1c1e", 0.9),
    "hub": material("Hub", "#b9bec4", 0.3, 0.8),
    "trim": material("Trim", "#2a2d31", 0.7),
    "light": material("Light", "#fff6d8", 0.2),
    "tail": material("Tail", "#c4161c", 0.3),
    "plate": material("Plate", "#f4f4ee", 0.6),
    "seat": material("Seat", "#202022", 0.8),
    "auto_green": material("AutoGreen", "#2f8f3a", 0.5),
    "auto_yellow": material("AutoYellow", "#f0c22c", 0.5),
    "bus_body": material("BusBody", "#eef1f3", 0.45),
    "bus_stripe": material("BusStripe", "#2b6cb3", 0.45),
    "wood": material("Wood", "#8a5a32", 0.8),
    "steel": material("Steel", "#c9ccd0", 0.35, 0.7),
    "canopy_a": material("CanopyRed", "#d23c2c", 0.7),
    "canopy_b": material("CanopyCream", "#f3e6c8", 0.7),
    "fruit_a": material("FruitOrange", "#f08a1c", 0.6),
    "fruit_b": material("FruitGreen", "#6aa83a", 0.6),
    "fruit_c": material("FruitYellow", "#f2d23b", 0.6),
    "stop_roof": material("StopRoof", "#2f6f8f", 0.5),
}


class Kit:
    """Builds one model into its own scene from simple, bevelled shapes."""

    def __init__(self, name):
        self.name = name
        old = bpy.data.scenes.get("NK " + name)
        if old:
            for ob in list(old.objects):
                bpy.data.objects.remove(ob, do_unlink=True)
            bpy.data.scenes.remove(old)
        self.scene = bpy.data.scenes.new("NK " + name)
        self.count = 0

    def _object(self, bm, mat, loc, rot, bevel):
        self.count += 1
        me = bpy.data.meshes.new(f"nk_{self.name}_{self.count}")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(me.name, me)
        ob.location = loc
        ob.rotation_euler = rot
        me.materials.append(mat)
        self.scene.collection.objects.link(ob)
        if bevel:
            mod = ob.modifiers.new("bevel", "BEVEL")
            mod.width = bevel
            mod.segments = 2
            mod.limit_method = "ANGLE"
        return ob

    def box(self, mat, size, loc, rot=(0, 0, 0), bevel=0.0, taper=(1.0, 1.0)):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= size[0]
            v.co.y *= size[1]
            v.co.z *= size[2]
            if v.co.z > 0:  # narrower on top (car cabins, cowls)
                v.co.x *= taper[0]
                v.co.y *= taper[1]
        return self._object(bm, mat, loc, rot, bevel)

    def cylinder(self, mat, radius, depth, loc, rot=(0, 0, 0), segments=14):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius, depth=depth)
        return self._object(bm, mat, loc, rot, 0)

    def ball(self, mat, radius, loc, scale=(1, 1, 1)):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=radius)
        for v in bm.verts:
            v.co.x *= scale[0]
            v.co.y *= scale[1]
            v.co.z *= scale[2]
        return self._object(bm, mat, loc, (0, 0, 0), 0)

    def wheel(self, x, y, radius, width):
        side = (0, math.pi / 2, 0)
        self.cylinder(M["tyre"], radius, width, (x, y, radius), side, 16)
        self.cylinder(M["hub"], radius * 0.55, width + 0.02, (x, y, radius), side, 12)

    def export(self):
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, self.name + ".glb")
        layer = self.scene.view_layers[0]
        options = dict(
            filepath=path,
            export_format="GLB",
            export_apply=True,
            export_yup=True,
            export_texcoords=False,
            export_normals=True,
            export_cameras=False,
            export_lights=False,
        )
        with bpy.context.temp_override(scene=self.scene, view_layer=layer):
            try:
                bpy.ops.export_scene.gltf(**options)
            except TypeError:
                bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True)
        return path, self.triangles()

    def triangles(self):
        depsgraph = bpy.context.evaluated_depsgraph_get()
        total = 0
        for ob in self.scene.objects:
            evaluated = ob.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            mesh.calc_loop_triangles()
            total += len(mesh.loop_triangles)
            evaluated.to_mesh_clear()
        return total


def car(name, length, width, height, cabin_length, cabin_shift, wheel_radius, clearance=0.17, boot=True):
    k = Kit(name)
    lower = (height - clearance) * 0.5
    cabin = height - clearance - lower
    k.box(M["paint"], (width, length, lower), (0, 0, clearance + lower / 2), bevel=0.09)
    k.box(M["paint"], (width * 0.9, cabin_length, cabin), (0, cabin_shift, clearance + lower + cabin / 2), bevel=0.05, taper=(0.86, 0.7))
    # Window band: a slightly wider, lower dark box around the cabin.
    k.box(M["glass"], (width * 0.91, cabin_length * 0.97, cabin * 0.7), (0, cabin_shift, clearance + lower + cabin * 0.42), taper=(0.9, 0.78))
    axle = length / 2 - wheel_radius * 1.55
    for x in (-width / 2 + 0.1, width / 2 - 0.1):
        for y in (-axle, axle):
            k.wheel(x, y, wheel_radius, 0.22)
    front, back = length / 2, -length / 2
    for x in (-width * 0.33, width * 0.33):
        k.box(M["light"], (0.32, 0.05, 0.1), (x, front, clearance + lower * 0.72))
        k.box(M["tail"], (0.3, 0.05, 0.1), (x, back, clearance + lower * 0.78))
    k.box(M["trim"], (width * 0.5, 0.05, lower * 0.32), (0, front + 0.005, clearance + lower * 0.45))  # grille
    for y in (front + 0.04, back - 0.04):
        k.box(M["trim"], (width * 1.01, 0.14, 0.16), (0, y, clearance + 0.1), bevel=0.03)  # bumper
        k.box(M["plate"], (0.5, 0.02, 0.12), (0, y + (0.08 if y > 0 else -0.08), clearance + 0.22))  # blank plate (no text)
    for x in (-width / 2 - 0.06, width / 2 + 0.06):
        k.box(M["trim"], (0.08, 0.14, 0.09), (x, cabin_shift + cabin_length * 0.38, clearance + lower + 0.12))  # mirrors
    return k.export()


def auto_rickshaw():
    k = Kit("auto")
    k.box(M["auto_green"], (1.3, 2.05, 0.45), (0, -0.15, 0.48), bevel=0.08)  # passenger tub
    k.box(M["auto_green"], (0.72, 0.55, 0.8), (0, 0.98, 0.62), bevel=0.08, taper=(0.75, 0.6))  # driver cowl
    k.box(M["auto_yellow"], (1.38, 1.95, 0.08), (0, -0.12, 1.74), bevel=0.04)  # canopy roof
    k.box(M["auto_yellow"], (1.38, 0.08, 1.05), (0, -1.08, 1.2), bevel=0.03)  # rear cover
    k.box(M["auto_yellow"], (0.08, 0.7, 0.32), (-0.66, -0.75, 1.55))  # side flaps
    k.box(M["auto_yellow"], (0.08, 0.7, 0.32), (0.66, -0.75, 1.55))
    for x in (-0.64, 0.64):
        k.cylinder(M["trim"], 0.025, 1.05, (x, 0.72, 1.2))  # roof posts
    k.box(M["glass"], (1.0, 0.04, 0.55), (0, 0.76, 1.28), rot=(math.radians(-12), 0, 0))  # windscreen
    k.box(M["seat"], (1.2, 0.5, 0.18), (0, -0.55, 0.8), bevel=0.04)  # passenger seat
    k.box(M["seat"], (1.2, 0.12, 0.5), (0, -0.85, 1.05), bevel=0.03)
    k.box(M["seat"], (0.42, 0.32, 0.12), (0, 0.38, 0.88), bevel=0.03)  # driver seat
    k.cylinder(M["hub"], 0.018, 0.62, (0, 0.6, 1.05), (0, math.pi / 2, 0), 8)  # handlebar
    k.box(M["light"], (0.16, 0.05, 0.12), (0, 1.27, 0.95))
    k.wheel(0, 1.0, 0.23, 0.16)
    k.wheel(-0.6, -0.72, 0.23, 0.16)
    k.wheel(0.6, -0.72, 0.23, 0.16)
    return k.export()


def two_wheeler():
    k = Kit("two_wheeler")
    k.box(M["paint"], (0.5, 0.85, 0.42), (0, -0.35, 0.56), bevel=0.12, taper=(0.85, 0.8))  # rear body
    k.box(M["trim"], (0.34, 0.5, 0.07), (0, 0.15, 0.33))  # floor board
    k.box(M["paint"], (0.44, 0.16, 0.72), (0, 0.48, 0.62), rot=(math.radians(-12), 0, 0), bevel=0.06)  # front apron
    k.box(M["seat"], (0.33, 0.68, 0.1), (0, -0.3, 0.84), bevel=0.04)
    k.cylinder(M["trim"], 0.025, 0.66, (0, 0.55, 1.05), (0, math.pi / 2, 0), 8)  # handlebar
    k.box(M["paint"], (0.24, 0.12, 0.14), (0, 0.58, 1.05), bevel=0.03)  # headset
    k.box(M["light"], (0.12, 0.04, 0.08), (0, 0.65, 1.02))
    k.box(M["tail"], (0.14, 0.04, 0.06), (0, -0.8, 0.68))
    k.cylinder(M["trim"], 0.03, 0.55, (0, 0.6, 0.55), (math.radians(-15), 0, 0), 8)  # fork
    k.wheel(0, 0.62, 0.25, 0.11)
    k.wheel(0, -0.58, 0.25, 0.12)
    return k.export()


def bus():
    k = Kit("bus")
    k.box(M["bus_body"], (2.55, 11.2, 2.7), (0, 0, 0.42 + 1.35), bevel=0.1)
    k.box(M["bus_stripe"], (2.57, 11.22, 0.45), (0, 0, 0.95))
    k.box(M["glass"], (2.58, 10.0, 0.95), (0, -0.4, 2.2))  # side windows
    k.box(M["glass"], (2.3, 0.06, 1.35), (0, 5.6, 2.05))  # windscreen
    k.box(M["trim"], (1.6, 0.06, 0.28), (0, 5.62, 2.95))  # route display (blank)
    k.box(M["glass"], (2.1, 0.06, 0.8), (0, -5.6, 2.3))  # rear window
    k.box(M["steel"], (2.35, 10.6, 0.14), (0, 0, 3.2), bevel=0.04)  # roof cap
    for y in (3.95, -1.0):
        k.box(M["trim"], (0.06, 1.1, 2.1), (1.29, y, 1.5))  # doors on the kerb side
    for y in (5.65, -5.65):
        k.box(M["trim"], (2.6, 0.12, 0.3), (0, y, 0.55), bevel=0.03)
    for x in (-0.95, 0.95):
        k.box(M["light"], (0.32, 0.05, 0.14), (x, 5.62, 0.9))
        k.box(M["tail"], (0.25, 0.05, 0.2), (x, -5.62, 1.0))
    for x in (-1.12, 1.12):
        for y in (3.4, -3.0):
            k.wheel(x, y, 0.5, 0.3)
    return k.export()


def stall():
    """A street-food / fruit cart. Customers stand on the -Y side (the game's front)."""
    k = Kit("stall")
    k.box(M["wood"], (1.8, 1.0, 0.75), (0, 0, 0.75), bevel=0.04)
    k.box(M["steel"], (1.95, 1.1, 0.06), (0, 0, 1.16), bevel=0.02)
    for x in (-0.95, 0.95):
        k.wheel(x, 0.0, 0.34, 0.08)
    for x in (-0.85, 0.85):
        for y in (-0.45, 0.45):
            k.cylinder(M["trim"], 0.02, 1.05, (x, y, 1.7), segments=6)
    for i in range(5):  # striped canopy
        k.box(M["canopy_a"] if i % 2 == 0 else M["canopy_b"], (0.44, 1.5, 0.05), (-0.88 + i * 0.44, 0, 2.24))
    fruits = [M["fruit_a"], M["fruit_b"], M["fruit_c"]]
    for i in range(9):
        k.ball(fruits[i % 3], 0.075, (-0.7 + (i % 5) * 0.32 + (i // 5) * 0.16, -0.25 + (i // 5) * 0.28, 1.26))
    return k.export()


def bus_stop():
    """A shelter whose open side faces -Y (towards the road in the game)."""
    k = Kit("bus_stop")
    k.box(M["stop_roof"], (4.0, 1.75, 0.1), (0, 0.05, 2.5), rot=(math.radians(-4), 0, 0), bevel=0.03)
    k.box(M["glass"], (3.9, 0.05, 1.7), (0, 0.78, 1.35))
    for x in (-1.92, 1.92):
        k.cylinder(M["trim"], 0.05, 2.5, (x, 0.75, 1.25), segments=8)
        k.cylinder(M["trim"], 0.04, 2.45, (x, -0.7, 1.22), segments=8)
    k.box(M["wood"], (2.6, 0.38, 0.06), (0, 0.45, 0.48), bevel=0.01)
    for x in (-1.1, 1.1):
        k.box(M["trim"], (0.06, 0.32, 0.45), (x, 0.45, 0.24))
    k.box(M["plate"], (0.55, 0.05, 0.38), (1.92, 0.7, 2.15))
    return k.export()


BUILDERS = {
    "hatchback": lambda: car("hatchback", 3.8, 1.66, 1.5, 2.0, -0.15, 0.3),
    "sedan": lambda: car("sedan", 4.5, 1.76, 1.45, 2.3, -0.1, 0.31),
    "suv": lambda: car("suv", 4.6, 1.86, 1.78, 2.75, -0.25, 0.36, clearance=0.22),
    "auto": auto_rickshaw,
    "two_wheeler": two_wheeler,
    "bus": bus,
    "stall": stall,
    "bus_stop": bus_stop,
}


def build_all():
    report = {}
    for name, build in BUILDERS.items():
        path, triangles = build()
        report[name] = {"triangles": triangles, "kb": round(os.path.getsize(path) / 1024, 1)}
    return report


result = {"out": OUT, "models": build_all()}
print("NUKKAD_ASSETS", result)
