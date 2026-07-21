#!/usr/bin/env python3
"""Bake a textured .glb's flat colors into palette-remapped vertex colors.

Companion to obj2glb_palette.py. That tool handles the Nature Pack's OBJ
files, which carry one material per part; this one handles downloaded .glb
characters, which instead carry a single "atlas" material — one shared PNG
of flat color swatches that every part's UVs point into.

The Art Style Bible (DESIGN.md) bans textures: color must come from flat
materials or vertex colors. So we read the swatch each vertex lands on,
remap it to a palette color, write that into the mesh's COLOR_0 attribute,
and delete the texture entirely. The result is bible-clean, smaller, and —
because we know which swatch every vertex came from — leaves the mesh
split into named color regions that can be recolored at runtime. That's
the seam character/cat customization hangs off later.

Usage:
    python tools/glb_palette.py in.glb out.glb --map 686F6D=E9A960 ...
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from typing import Any

from PIL import Image

# glTF component types we need to read.
_COMPONENT = {
    5120: ("b", 1),
    5121: ("B", 1),
    5122: ("h", 2),
    5123: ("H", 2),
    5125: ("I", 4),
    5126: ("f", 4),
}
_TYPE_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def _srgb_to_linear(channel: float) -> float:
    """glTF vertex colors are linear; the atlas PNG is sRGB."""
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


class Glb:
    """A parsed .glb: its JSON chunk plus its binary chunk."""

    def __init__(self, path: str) -> None:
        data = open(path, "rb").read()
        if data[:4] != b"glTF":
            raise SystemExit(f"{path} is not a .glb")
        json_len = struct.unpack_from("<I", data, 12)[0]
        self.json: dict[str, Any] = json.loads(data[20 : 20 + json_len])
        bin_header = 20 + json_len
        bin_len = struct.unpack_from("<I", data, bin_header)[0]
        self.bin = bytearray(data[bin_header + 8 : bin_header + 8 + bin_len])

    def view_bytes(self, index: int) -> bytes:
        view = self.json["bufferViews"][index]
        start = view.get("byteOffset", 0)
        return bytes(self.bin[start : start + view["byteLength"]])

    def read_accessor(self, index: int) -> list[tuple[float, ...]]:
        accessor = self.json["accessors"][index]
        view = self.json["bufferViews"][accessor["bufferView"]]
        fmt, size = _COMPONENT[accessor["componentType"]]
        count = _TYPE_COUNT[accessor["type"]]
        stride = view.get("byteStride") or size * count
        base = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        return [
            struct.unpack_from("<" + fmt * count, self.bin, base + i * stride)
            for i in range(accessor["count"])
        ]

    def add_accessor(self, values: list[tuple[float, ...]], kind: str) -> int:
        """Append tightly-packed float data as a new bufferView + accessor."""
        count = _TYPE_COUNT[kind]
        while len(self.bin) % 4:  # accessor data must be 4-byte aligned
            self.bin.append(0)
        offset = len(self.bin)
        for value in values:
            self.bin.extend(struct.pack("<" + "f" * count, *value))
        self.json["bufferViews"].append(
            {"buffer": 0, "byteOffset": offset, "byteLength": len(self.bin) - offset}
        )
        self.json["accessors"].append(
            {
                "bufferView": len(self.json["bufferViews"]) - 1,
                "componentType": 5126,
                "count": len(values),
                "type": kind,
            }
        )
        return len(self.json["accessors"]) - 1

    def write(self, path: str) -> None:
        self.json["buffers"] = [{"byteLength": len(self.bin)}]
        blob = json.dumps(self.json, separators=(",", ":")).encode("utf-8")
        blob += b" " * (-len(blob) % 4)
        binary = bytes(self.bin) + b"\0" * (-len(self.bin) % 4)
        total = 12 + 8 + len(blob) + 8 + len(binary)
        with open(path, "wb") as handle:
            handle.write(b"glTF" + struct.pack("<II", 2, total))
            handle.write(struct.pack("<I", len(blob)) + b"JSON" + blob)
            handle.write(struct.pack("<I", len(binary)) + b"BIN\0" + binary)


def bake(glb: Glb, mapping: dict[str, str]) -> dict[str, int]:
    """Sample each vertex's atlas swatch, remap it, write it to COLOR_0."""
    atlas_by_material: dict[int, Image.Image] = {}
    for index, material in enumerate(glb.json.get("materials", [])):
        texture = material.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if texture is None:
            continue
        source = glb.json["textures"][texture["index"]]["source"]
        image = glb.json["images"][source]
        if "bufferView" not in image:
            raise SystemExit("external image files are not supported")
        atlas_by_material[index] = Image.open(
            __import__("io").BytesIO(glb.view_bytes(image["bufferView"]))
        ).convert("RGB")

    if not atlas_by_material:
        raise SystemExit("no textured materials found — nothing to bake")

    tally: dict[str, int] = {}
    for mesh in glb.json["meshes"]:
        for primitive in mesh["primitives"]:
            atlas = atlas_by_material.get(primitive.get("material", -1))
            if atlas is None:
                continue
            width, height = atlas.size
            uvs = glb.read_accessor(primitive["attributes"]["TEXCOORD_0"])
            colors: list[tuple[float, ...]] = []
            for u, v in uvs:
                # glTF UVs run top-down; PIL pixels do too, so v maps directly.
                x = min(width - 1, max(0, int(u * width)))
                y = min(height - 1, max(0, int(v * height)))
                source_hex = "%02X%02X%02X" % atlas.getpixel((x, y))
                if source_hex not in mapping:
                    raise SystemExit(
                        f"atlas color #{source_hex} has no --map entry "
                        f"(seen at uv {u:.3f},{v:.3f})"
                    )
                target = mapping[source_hex]
                tally[f"#{source_hex} -> #{target}"] = (
                    tally.get(f"#{source_hex} -> #{target}", 0) + 1
                )
                rgb = tuple(int(target[i : i + 2], 16) / 255 for i in (0, 2, 4))
                colors.append(tuple(_srgb_to_linear(c) for c in rgb) + (1.0,))
            primitive["attributes"]["COLOR_0"] = glb.add_accessor(colors, "VEC4")
    return tally


def strip_textures(glb: Glb) -> None:
    """Drop every image/texture/sampler and point materials at vertex colors."""
    for material in glb.json.get("materials", []):
        pbr = material.setdefault("pbrMetallicRoughness", {})
        pbr.pop("baseColorTexture", None)
        pbr["baseColorFactor"] = [1.0, 1.0, 1.0, 1.0]  # multiplies COLOR_0
        # Matte, non-metallic: the bible's flat-shaded look, lit only by the
        # scene's sun and ambient.
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 0.9
        material.pop("normalTexture", None)
        material.pop("occlusionTexture", None)
        material.pop("emissiveTexture", None)
        material.pop("metallicRoughnessTexture", None)

    for key in ("textures", "images", "samplers"):
        glb.json.pop(key, None)
    _compact(glb)


def _compact(glb: Glb) -> None:
    """Rebuild the binary chunk with only the bufferViews still referenced."""
    used: set[int] = set()
    for accessor in glb.json["accessors"]:
        if "bufferView" in accessor:
            used.add(accessor["bufferView"])
    for image in glb.json.get("images", []):
        if "bufferView" in image:
            used.add(image["bufferView"])

    payload = bytearray()
    remap: dict[int, int] = {}
    views: list[dict[str, Any]] = []
    for index in sorted(used):
        view = dict(glb.json["bufferViews"][index])
        data = glb.view_bytes(index)
        while len(payload) % 4:
            payload.append(0)
        view["byteOffset"] = len(payload)
        view["byteLength"] = len(data)
        payload.extend(data)
        remap[index] = len(views)
        views.append(view)

    for accessor in glb.json["accessors"]:
        if "bufferView" in accessor:
            accessor["bufferView"] = remap[accessor["bufferView"]]
    for image in glb.json.get("images", []):
        if "bufferView" in image:
            image["bufferView"] = remap[image["bufferView"]]

    glb.json["bufferViews"] = views
    glb.bin = payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("destination")
    parser.add_argument(
        "--map",
        action="append",
        required=True,
        metavar="SRCHEX=DSTHEX",
        help="atlas swatch -> palette color, e.g. 686F6D=E9A960",
    )
    args = parser.parse_args()

    mapping = {}
    for entry in args.map:
        source, _, target = entry.partition("=")
        mapping[source.lstrip("#").upper()] = target.lstrip("#").upper()

    glb = Glb(args.source)
    tally = bake(glb, mapping)
    strip_textures(glb)
    glb.write(args.destination)

    for label, count in sorted(tally.items(), key=lambda item: -item[1]):
        print(f"  {label}  ({count} vertices)")
    triangles = sum(
        glb.json["accessors"][p["indices"]]["count"] // 3
        for mesh in glb.json["meshes"]
        for p in mesh["primitives"]
        if "indices" in p
    )
    print(f"wrote {args.destination}: {triangles} triangles, textures stripped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
