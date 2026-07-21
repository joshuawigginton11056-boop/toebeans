#!/usr/bin/env python3
"""Convert a Quaternius Ultimate Animated Character to a palette .glb.

Third converter in the family, for a third way of carrying color:

    obj2glb_palette.py  — OBJ sources, one material per part (Nature Pack).
    glb_palette.py      — .glb sources colored by a shared texture atlas.
    gltf_character.py   — this one. The Ultimate Animated Character Pack
                          ships .gltf files with **no textures at all** and
                          descriptively named materials (Skin, Face, Hair,
                          Shirt, Pants, Belt, Hat, ...). So there is nothing
                          to bake: recoloring is rewriting each material's
                          baseColorFactor, which is also how the game
                          recolors skin and hair at runtime.

Two more things this tool does, both of which fall out of a fact about the
pack: **all 50 characters share one skeleton and one set of clips** (23
bones, identical names; 16-17 animations, identical names).

  * Animation data is 55% of every file and it is the *same* 55% each time.
    So --strip-animations drops it from each character, --animations-only
    keeps a single shared clip file, and the game binds those clips to any
    character by bone name. Eleven characters cost ~5 MB instead of ~20 MB,
    and only one character plus the clips has to load before you can play.

  * Because the bind skeleton is identical, the game scales every character
    by one constant instead of measuring each model (see skierModel.ts).

Unmapped material names are a hard error rather than a default color: a new
character must not be able to smuggle an off-palette color into the game
just by being converted. Add it to MATERIAL_COLORS or pass --map.

Usage:
    python tools/gltf_character.py Casual_Male.gltf out.glb --strip-animations
    python tools/gltf_character.py BaseCharacter.gltf clips.glb --animations-only
"""

from __future__ import annotations

import argparse
import base64
import json
import struct
import sys
from typing import Any

# Material name -> the color it bakes to, from DESIGN.md's palettes. Skin and
# Hair are overwritten at runtime from the character ramps; the rest are the
# outfit, which is now fixed per character (the player picks the character
# instead of picking its clothes).
MATERIAL_COLORS: dict[str, str] = {
    # Body. Defaults match createDefaultAppearance() in shared/appearance.ts.
    "Skin": "#DCA77E",  # S3 honey
    "Hair": "#4A3628",  # H2 dark brown
    # The facial features are their own small primitive, authored near-white.
    # Sunlit snow keeps them off pure white, which the bible bans.
    "Face": "#F8F5EF",
    # Outerwear -> the coat ramp's saturated mid-darks, which read against snow.
    "Shirt": "#4E72A8",  # skier blue
    "Clothes": "#4E72A8",
    "Main": "#4E72A8",
    "Jacket": "#4E72A8",
    "Top": "#2F6D63",  # pine teal, so layered outfits stay readable
    "Vest": "#C0663A",  # rust
    # Legs.
    "Pants": "#3E3A3A",  # charcoal
    # Trim: belts, bands, cuffs, dark accents. All read as leather/boot dark.
    "Belt": "#3A2F2F",
    "Band": "#3A2F2F",
    "Detail": "#3A2F2F",
    "Details": "#3A2F2F",
    "DarkClothes": "#3A2F2F",
    "Black": "#2B2622",  # soft black — the bible bans pure black
    "Brown": "#6E6152",  # taupe
    "Grey": "#66738C",  # slate
    # Hats.
    "Hat": "#3A2F2F",
    "HatBrown": "#3A2F2F",
    "HatLightBrown": "#6E6152",
    # Signal red stays reserved for the cat's scarf and hazards, so a
    # character's scarf deliberately is not red.
    "Scarf": "#2F6D63",
}


def srgb_to_linear(channel: float) -> float:
    """glTF baseColorFactor is linear; our palette is written in sRGB."""
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def hex_to_linear(value: str) -> list[float]:
    value = value.lstrip("#")
    rgb = [int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [srgb_to_linear(c) for c in rgb] + [1.0]


def read_buffer(gltf: dict[str, Any], path: str) -> bytes:
    """The pack's .gltf files embed their one buffer as a base64 data URI."""
    buffers = gltf.get("buffers", [])
    if len(buffers) != 1:
        sys.exit(f"{path}: expected exactly one buffer, found {len(buffers)}")
    uri = buffers[0].get("uri", "")
    if not uri.startswith("data:"):
        sys.exit(f"{path}: buffer is not embedded (uri={uri[:40]!r})")
    return base64.b64decode(uri.split(",", 1)[1])


def recolor(gltf: dict[str, Any], overrides: dict[str, str], path: str) -> None:
    colors = {**MATERIAL_COLORS, **overrides}
    for material in gltf.get("materials", []):
        name = material.get("name", "")
        if name not in colors:
            sys.exit(
                f"{path}: material {name!r} has no palette color. Add it to "
                f"MATERIAL_COLORS in tools/gltf_character.py or pass "
                f"--map {name}=RRGGBB."
            )
        pbr = material.setdefault("pbrMetallicRoughness", {})
        pbr["baseColorFactor"] = hex_to_linear(colors[name])
        # Flat-shaded matte, per the bible: no gloss, no metal, no maps.
        pbr["metallicFactor"] = 0.0
        pbr.setdefault("roughnessFactor", 0.9)


def strip_meshes(gltf: dict[str, Any]) -> None:
    """Keep the skeleton and clips, drop everything that draws.

    The result is the shared animation file. Its nodes have to stay, because
    animation channels target nodes and three.js binds the resulting tracks
    to a character's bones by name.
    """
    for node in gltf.get("nodes", []):
        node.pop("mesh", None)
        node.pop("skin", None)
    gltf.pop("meshes", None)
    gltf.pop("skins", None)
    gltf.pop("materials", None)


def repack(gltf: dict[str, Any], data: bytes) -> bytes:
    """Drop unreferenced accessors/bufferViews and rebuild the buffer.

    Deleting animations (or meshes) leaves their bytes behind; without this
    the file would keep the weight we set out to remove.
    """
    used: set[int] = set()

    def use(accessor_index: int | None) -> None:
        if accessor_index is not None:
            used.add(accessor_index)

    for mesh in gltf.get("meshes", []):
        for primitive in mesh["primitives"]:
            for accessor in primitive.get("attributes", {}).values():
                use(accessor)
            use(primitive.get("indices"))
            for target in primitive.get("targets", []):
                for accessor in target.values():
                    use(accessor)
    for skin in gltf.get("skins", []):
        use(skin.get("inverseBindMatrices"))
    for animation in gltf.get("animations", []):
        for sampler in animation["samplers"]:
            use(sampler["input"])
            use(sampler["output"])

    accessors = gltf.get("accessors", [])
    views = gltf.get("bufferViews", [])

    # Copy each surviving accessor's slice into a fresh buffer, one view per
    # accessor. Simpler than preserving the original view layout, and the
    # interleaving the pack uses buys nothing here.
    out = bytearray()
    new_views: list[dict[str, Any]] = []
    new_accessors: list[dict[str, Any]] = []
    remap: dict[int, int] = {}

    component_size = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    type_count = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}

    for index, accessor in enumerate(accessors):
        if index not in used:
            continue
        stride = component_size[accessor["componentType"]] * type_count[accessor["type"]]
        length = stride * accessor["count"]
        view = views[accessor["bufferView"]]
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        # Pad to 4 bytes: glTF requires accessor offsets be component-aligned.
        while len(out) % 4:
            out.append(0)
        offset = len(out)
        out += data[start : start + length]

        copy = dict(accessor)
        copy.pop("byteOffset", None)
        copy["bufferView"] = len(new_views)
        new_view: dict[str, Any] = {"buffer": 0, "byteOffset": offset, "byteLength": length}
        if "target" in view:
            new_view["target"] = view["target"]
        new_views.append(new_view)
        remap[index] = len(new_accessors)
        new_accessors.append(copy)

    def rewrite(accessor_index: int) -> int:
        return remap[accessor_index]

    for mesh in gltf.get("meshes", []):
        for primitive in mesh["primitives"]:
            primitive["attributes"] = {
                k: rewrite(v) for k, v in primitive.get("attributes", {}).items()
            }
            if "indices" in primitive:
                primitive["indices"] = rewrite(primitive["indices"])
            if "targets" in primitive:
                primitive["targets"] = [
                    {k: rewrite(v) for k, v in t.items()} for t in primitive["targets"]
                ]
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = rewrite(skin["inverseBindMatrices"])
    for animation in gltf.get("animations", []):
        for sampler in animation["samplers"]:
            sampler["input"] = rewrite(sampler["input"])
            sampler["output"] = rewrite(sampler["output"])

    gltf["accessors"] = new_accessors
    gltf["bufferViews"] = new_views
    gltf["buffers"] = [{"byteLength": len(out)}]
    return bytes(out)


def write_glb(path: str, gltf: dict[str, Any], data: bytes) -> None:
    json_chunk = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * (-len(json_chunk) % 4)
    bin_chunk = data + b"\x00" * (-len(data) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    with open(path, "wb") as out:
        out.write(struct.pack("<III", 0x46546C67, 2, total))
        out.write(struct.pack("<II", len(json_chunk), 0x4E4F534A))
        out.write(json_chunk)
        out.write(struct.pack("<II", len(bin_chunk), 0x004E4942))
        out.write(bin_chunk)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="a .gltf from the Ultimate Animated Character Pack")
    parser.add_argument("output", help="the .glb to write")
    parser.add_argument(
        "--strip-animations",
        action="store_true",
        help="drop the clips (they live in the shared animation file instead)",
    )
    parser.add_argument(
        "--animations-only",
        action="store_true",
        help="drop the meshes, keeping the skeleton and clips: the shared file",
    )
    parser.add_argument(
        "--map",
        action="append",
        default=[],
        metavar="Material=RRGGBB",
        help="override one material's color",
    )
    args = parser.parse_args()

    if args.strip_animations and args.animations_only:
        sys.exit("--strip-animations and --animations-only are opposites")

    with open(args.source, encoding="utf-8") as handle:
        gltf = json.load(handle)
    data = read_buffer(gltf, args.source)

    overrides = {}
    for entry in args.map:
        name, _, value = entry.partition("=")
        overrides[name] = value if value.startswith("#") else f"#{value}"

    if args.animations_only:
        strip_meshes(gltf)
    else:
        recolor(gltf, overrides, args.source)
        if args.strip_animations:
            gltf.pop("animations", None)

    data = repack(gltf, data)
    write_glb(args.output, gltf, data)

    triangles = sum(
        gltf["accessors"][p["indices"]]["count"] // 3
        for m in gltf.get("meshes", [])
        for p in m["primitives"]
        if "indices" in p
    )
    clips = len(gltf.get("animations", []))
    print(f"{args.output}: {triangles} tris, {clips} clips, {len(data) // 1024} KB")


if __name__ == "__main__":
    main()
