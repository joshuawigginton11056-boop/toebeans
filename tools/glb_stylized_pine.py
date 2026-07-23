# Converts Quaternius Stylized Nature MegaKit pine .glb files (downloaded
# from Poly Pizza) into palette-conformant slope decor. Third case in the
# converter family: obj2glb_palette.py handles flat OBJ/MTL, glb_palette.py
# handles atlas-textured characters, and this handles *painted-texture*
# models under the amended Art Style Bible (DESIGN.md, transition note):
# painted detail on trees is approved, but it comes from the runtime
# triplanar canvases in skiScene.ts, not from shipped image files.
#
# What it does, per file:
#   - Bark material: drops the baseColor texture and the normal map (still
#     banned by the bible) and becomes a flat palette material named
#     "PineBark" (birch amber, deep value shift — same family as "Wood").
#     The mesh's COLOR_0 vertex shading (baked AO-ish variation) is kept.
#   - Leaves material: the foliage is alpha-cutout cards, so the texture's
#     alpha channel IS the frond silhouette and must survive. The RGB is
#     REPAINTED from that silhouette into frosted green (director call,
#     2026-07-23): pine green in the interior, white frost on the needle
#     tips. "Tips" = the outer edge of the silhouette, so the frost is a
#     distance-from-edge gradient (thin lobes stay white, the dense body
#     goes green). baseColorFactor is then WHITE so the painted RGB shows
#     through unmodified — the green lives in the pixels, not the factor,
#     because a tinting factor would also tint the white frost. The image
#     is downscaled, and alphaMode goes BLEND -> MASK so a forest of
#     overlapping cards depth-sorts correctly and casts real shadows.
#     Renamed "PineSnow". The green is the game's first (pine-green family
#     added to the palette by director call); the snow-shadow family stays
#     the frost color on top of it.
#   - Origin snapped to the base (min Y -> 0), matching every other prop.
#   - Unreferenced buffer data (the dropped ~2 MB of bark textures) is
#     repacked away; triangle counts are reported against the bible's
#     budgets (props ~2,000; large one-off set pieces ~5,000 — these
#     giants are set pieces, see the ROADMAP entry).
#
# Usage:  python tools/glb_stylized_pine.py <in.glb>... -o <output dir>

from __future__ import annotations

import argparse
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

# Palette targets (sRGB hex). Value shifts of palette colors, per the bible.
BARK_HEX = "#8C6539"  # 7 birch amber, deep shift — same as obj2glb "Wood"
# Pine-green family — the game's FIRST green, added by director call
# (2026-07-23). Tuned on the slope under dawn light. The frost is white
# (snow-shadow family reads as the frost, sat on the green needle body).
GREEN_HEX = "#4E6B4C"
FROST_HEX = "#FFFFFF"
# How many 1px erosions from the silhouette edge fade fully to green. Bigger
# = thinner frost / more green; smaller = frostier. Tuned on screen.
FROST_DEPTH = 10
LEAF_IMAGE_SIZE = 256  # the source silhouette is 1024px; 256 keeps the edge

PROP_BUDGET = 2000
SET_PIECE_BUDGET = 5000


def srgb_to_linear(channel: float) -> float:
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def hex_to_linear_factor(hex_color: str) -> list[float]:
    value = hex_color.lstrip("#")
    rgb = [int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [round(srgb_to_linear(c), 6) for c in rgb] + [1.0]


def parse_glb(data: bytes) -> tuple[dict, bytearray]:
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError("not a GLB file")
    offset = 12
    gltf: dict | None = None
    binary = bytearray()
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8 : offset + 8 + chunk_length]
        if chunk_type == 0x4E4F534A:  # JSON
            gltf = json.loads(chunk)
        elif chunk_type == 0x004E4942:  # BIN
            binary = bytearray(chunk)
        offset += 8 + chunk_length
    if gltf is None:
        raise ValueError("GLB has no JSON chunk")
    return gltf, binary


def write_glb(path: Path, gltf: dict, binary: bytes) -> None:
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    binary = bytes(binary) + b"\x00" * (-len(binary) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    with path.open("wb") as handle:
        handle.write(struct.pack("<III", 0x46546C67, 2, total))
        handle.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        handle.write(json_bytes)
        handle.write(struct.pack("<II", len(binary), 0x004E4942))
        handle.write(binary)


def buffer_view_bytes(gltf: dict, binary: bytearray, index: int) -> bytes:
    view = gltf["bufferViews"][index]
    start = view.get("byteOffset", 0)
    return bytes(binary[start : start + view["byteLength"]])


def snap_origin_to_base(gltf: dict, binary: bytearray) -> float:
    """Shift every POSITION accessor so the model's min Y lands on 0."""
    position_indices = {
        primitive["attributes"]["POSITION"]
        for mesh in gltf.get("meshes", [])
        for primitive in mesh["primitives"]
    }
    min_y = min(gltf["accessors"][i]["min"][1] for i in position_indices)
    if abs(min_y) < 1e-6:
        return 0.0
    for index in sorted(position_indices):
        accessor = gltf["accessors"][index]
        view = gltf["bufferViews"][accessor["bufferView"]]
        stride = view.get("byteStride", 12)
        base = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        for vertex in range(accessor["count"]):
            offset = base + vertex * stride + 4  # +4 skips X, lands on Y
            (y,) = struct.unpack_from("<f", binary, offset)
            struct.pack_into("<f", binary, offset, y - min_y)
        accessor["min"][1] -= min_y
        accessor["max"][1] -= min_y
    return -min_y


def _hex_rgb(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def frost_over_green(alpha: Image.Image) -> Image.Image:
    """RGBA card: green interior fading to white frost at the needle tips.

    Frost is keyed off distance from the silhouette edge — a pixel's depth is
    how many 1px erosions (Chebyshev distance) it survives, so thin outer
    lobes stay near the edge (white) while the dense body reaches full green.
    Pure PIL (no numpy/scipy in this env): erode with a 3x3 min filter and
    accumulate a depth map.
    """
    mask = alpha.point(lambda v: 255 if v > 127 else 0)
    depth = Image.new("L", alpha.size, 0)
    current = mask
    for _ in range(FROST_DEPTH):
        current = current.filter(ImageFilter.MinFilter(3))
        depth = ImageChops.add(depth, current.point(lambda v: 1 if v > 127 else 0))
    # t: 0 at the edge (white frost) -> 255 deep in the body (green).
    t = depth.point(lambda d: int(255 * min(d / FROST_DEPTH, 1.0)))
    green = Image.new("RGB", alpha.size, _hex_rgb(GREEN_HEX))
    frost = Image.new("RGB", alpha.size, _hex_rgb(FROST_HEX))
    rgb = Image.composite(green, frost, t)  # green where t=255, frost where t=0
    r, g, b = rgb.split()
    return Image.merge("RGBA", (r, g, b, alpha))


def rebake_leaf_image(png_bytes: bytes) -> bytes:
    """Frosted-green RGB + original alpha, downscaled."""
    image = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    alpha = image.getchannel("A").resize(
        (LEAF_IMAGE_SIZE, LEAF_IMAGE_SIZE), Image.LANCZOS
    )
    baked = frost_over_green(alpha)
    out = io.BytesIO()
    baked.save(out, format="PNG", optimize=True)
    return out.getvalue()


def repack(gltf: dict, binary: bytearray) -> bytes:
    """Rebuild the BIN keeping only bufferViews something still references."""
    referenced: set[int] = set()
    for accessor in gltf.get("accessors", []):
        if "bufferView" in accessor:
            referenced.add(accessor["bufferView"])
    for image in gltf.get("images", []):
        if "bufferView" in image:
            referenced.add(image["bufferView"])
    new_binary = bytearray()
    remap: dict[int, int] = {}
    new_views = []
    for old_index, view in enumerate(gltf["bufferViews"]):
        if old_index not in referenced:
            continue
        start = view.get("byteOffset", 0)
        chunk = binary[start : start + view["byteLength"]]
        new_binary += b"\x00" * (-len(new_binary) % 4)
        new_view = dict(view)
        new_view["byteOffset"] = len(new_binary)
        new_binary += chunk
        remap[old_index] = len(new_views)
        new_views.append(new_view)
    gltf["bufferViews"] = new_views
    for accessor in gltf.get("accessors", []):
        if "bufferView" in accessor:
            accessor["bufferView"] = remap[accessor["bufferView"]]
    for image in gltf.get("images", []):
        if "bufferView" in image:
            image["bufferView"] = remap[image["bufferView"]]
    gltf["buffers"] = [{"byteLength": len(new_binary)}]
    return bytes(new_binary)


def convert(source: Path, output_dir: Path, name: str) -> None:
    gltf, binary = parse_glb(source.read_bytes())

    materials = gltf.get("materials", [])
    by_name = {material.get("name", ""): material for material in materials}
    bark = by_name.get("Bark_NormalTree")
    leaves = by_name.get("Leaves_Pine")
    if bark is None or leaves is None:
        raise ValueError(
            f"{source.name}: expected Bark_NormalTree + Leaves_Pine materials, "
            f"found {sorted(by_name)}"
        )

    # --- Bark: flat palette material, textures gone, vertex COLOR_0 kept.
    bark.clear()
    bark.update(
        {
            "name": "PineBark",
            "pbrMetallicRoughness": {
                "baseColorFactor": hex_to_linear_factor(BARK_HEX),
                "metallicFactor": 0.0,
                "roughnessFactor": 1.0,
            },
        }
    )

    # --- Leaves: keep the alpha silhouette, recolor via baseColorFactor.
    leaf_texture_index = leaves["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    leaf_image_index = gltf["textures"][leaf_texture_index]["source"]
    leaf_image = gltf["images"][leaf_image_index]
    baked_png = rebake_leaf_image(
        buffer_view_bytes(gltf, binary, leaf_image["bufferView"])
    )
    binary += b"\x00" * (-len(binary) % 4)
    gltf["bufferViews"].append(
        {"buffer": 0, "byteOffset": len(binary), "byteLength": len(baked_png)}
    )
    binary += baked_png
    leaf_view_index = len(gltf["bufferViews"]) - 1

    leaves.clear()
    leaves.update(
        {
            "name": "PineSnow",
            "alphaMode": "MASK",
            "alphaCutoff": 0.5,
            "doubleSided": True,  # cards must read from both sides
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0, "texCoord": 0},
                # White: the frosted-green color lives in the painted RGB
                # (a tint here would also tint the white frost).
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 1.0,
            },
        }
    )
    gltf["images"] = [
        {
            "name": "PineSnow_Silhouette.png",
            "mimeType": "image/png",
            "bufferView": leaf_view_index,
        }
    ]
    gltf["textures"] = [{"source": 0}]
    gltf.pop("samplers", None)

    # --- Bark primitives no longer need UVs; leaf cards still do.
    material_index = {id(m): i for i, m in enumerate(materials)}
    bark_index = material_index[id(bark)]
    triangles = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh["primitives"]:
            if primitive.get("material") == bark_index:
                primitive["attributes"].pop("TEXCOORD_0", None)
            primitive["attributes"].pop("TANGENT", None)
            if "indices" in primitive:
                triangles += gltf["accessors"][primitive["indices"]]["count"] // 3

    lift = snap_origin_to_base(gltf, binary)
    packed = repack(gltf, binary)

    output = output_dir / f"{name}.glb"
    write_glb(output, gltf, packed)

    budget = (
        "over SET-PIECE budget!"
        if triangles > SET_PIECE_BUDGET
        else "set piece"
        if triangles > PROP_BUDGET
        else "prop"
    )
    height = max(
        gltf["accessors"][p["attributes"]["POSITION"]]["max"][1]
        for m in gltf["meshes"]
        for p in m["primitives"]
    )
    print(
        f"{output.name}: {triangles} tris ({budget}), {height:.1f}m tall, "
        f"base lifted {lift:.2f}m, {output.stat().st_size // 1024} KB"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("-o", "--output", type=Path, required=True)
    parser.add_argument(
        "--names",
        nargs="*",
        help="output basenames, parallel to sources (default: source stem)",
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    names = args.names or [source.stem for source in args.sources]
    if len(names) != len(args.sources):
        print("--names must match sources 1:1", file=sys.stderr)
        return 1
    for source, name in zip(args.sources, names):
        convert(source, args.output, name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
