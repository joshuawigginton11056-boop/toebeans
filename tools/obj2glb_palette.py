# Converts Quaternius OBJ/MTL models into palette-recolored .glb files that
# pass the Art Style Bible in DESIGN.md ("Asset sourcing rules"):
#   - every material color is remapped to the 12-color palette (or a value
#     shift of one, which the bible allows for shading),
#   - flat-shaded geometry and normals are kept as-is,
#   - origin is snapped to the base of the model (min Y -> 0),
#   - triangle counts are checked against the bible's budgets.
#
# Usage:  python tools/obj2glb_palette.py <obj file>... -o <output dir>
#
# No dependencies beyond Python 3 - the GLB is written directly.

import argparse
import json
import struct
import sys
from pathlib import Path

# Material-name -> palette hex, per the Art Style Bible palette table.
# "Value shifts for shading are fine; new hues are not."
PALETTE_BY_MATERIAL = {
    "Snow": "#F8F5EF",       # 1  sunlit snow
    "White": "#E3DCCD",      # 8  birch bark
    "Black": "#4F4A42",      # 8  birch bark, deep value shift (branch marks)
    "Green": "#E9A960",      # 7  birch amber (all foliage goes amber)
    "DarkGreen": "#B6844B",  # 7  birch amber, value shift
    "Wood": "#8C6539",       # 7  birch amber, deep value shift (trunks/logs)
    "Rock": "#66738C",       # 9  slate rock
}

TRIANGLE_BUDGET = 2000  # bible: props stay under ~2,000 triangles


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(hex_color: str) -> list[float]:
    r, g, b = (int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return [srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0]


def parse_obj(path: Path):
    """Returns (positions, normals, {material: [(vi, ni), ...] triangles})."""
    positions: list[tuple[float, ...]] = []
    normals: list[tuple[float, ...]] = []
    tris_by_material: dict[str, list[tuple[int, int]]] = {}
    current = None
    for line in path.read_text().splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "v":
            positions.append(tuple(float(x) for x in parts[1:4]))
        elif parts[0] == "vn":
            normals.append(tuple(float(x) for x in parts[1:4]))
        elif parts[0] == "usemtl":
            current = parts[1]
            tris_by_material.setdefault(current, [])
        elif parts[0] == "f":
            corners = []
            for ref in parts[1:]:
                fields = ref.split("/")
                vi = int(fields[0]) - 1
                ni = int(fields[2]) - 1 if len(fields) > 2 and fields[2] else vi
                corners.append((vi, ni))
            if current is None:
                current = "default"
                tris_by_material.setdefault(current, [])
            for i in range(1, len(corners) - 1):  # triangle fan
                tris_by_material[current].extend(
                    [corners[0], corners[i], corners[i + 1]]
                )
    return positions, normals, tris_by_material


def convert(obj_path: Path, out_dir: Path) -> tuple[int, int]:
    positions, normals, tris_by_material = parse_obj(obj_path)

    min_y = min(p[1] for p in positions)  # snap origin to the model's base
    positions = [(p[0], p[1] - min_y, p[2]) for p in positions]

    # Weld (position index, normal index) pairs into one vertex stream.
    vertex_index: dict[tuple[int, int], int] = {}
    vertex_data: list[float] = []
    primitives: list[dict] = []
    materials: list[dict] = []
    index_streams: list[list[int]] = []

    for material_name, corners in tris_by_material.items():
        if not corners:
            continue
        # Blender exports duplicate materials as e.g. "Rock.001".
        base_name = material_name.split(".")[0]
        hex_color = PALETTE_BY_MATERIAL.get(base_name)
        if hex_color is None:
            raise SystemExit(
                f"{obj_path.name}: material '{material_name}' has no palette "
                f"mapping - add it to PALETTE_BY_MATERIAL first."
            )
        indices = []
        for corner in corners:
            if corner not in vertex_index:
                vertex_index[corner] = len(vertex_index)
                vi, ni = corner
                vertex_data.extend(positions[vi])
                vertex_data.extend(normals[ni])
            indices.append(vertex_index[corner])
        index_streams.append(indices)
        materials.append(
            {
                "name": material_name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": hex_to_linear_rgba(hex_color),
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0,
                },
            }
        )

    vertex_count = len(vertex_index)
    triangle_count = sum(len(s) for s in index_streams) // 3

    # --- build binary buffer: interleaved pos+normal, then index streams ---
    vertex_bytes = struct.pack(f"<{len(vertex_data)}f", *vertex_data)
    index_type = 5123 if vertex_count <= 0xFFFF else 5125  # u16 / u32
    index_format = "H" if index_type == 5123 else "I"
    index_size = 2 if index_type == 5123 else 4

    buffer = bytearray(vertex_bytes)
    accessors = []
    buffer_views = [
        {
            "buffer": 0,
            "byteOffset": 0,
            "byteLength": len(vertex_bytes),
            "byteStride": 24,
            "target": 34962,
        }
    ]
    xs = [vertex_data[i] for i in range(0, len(vertex_data), 6)]
    ys = [vertex_data[i] for i in range(1, len(vertex_data), 6)]
    zs = [vertex_data[i] for i in range(2, len(vertex_data), 6)]
    accessors.append(
        {
            "bufferView": 0,
            "byteOffset": 0,
            "componentType": 5126,
            "count": vertex_count,
            "type": "VEC3",
            "min": [min(xs), min(ys), min(zs)],
            "max": [max(xs), max(ys), max(zs)],
        }
    )
    accessors.append(
        {
            "bufferView": 0,
            "byteOffset": 12,
            "componentType": 5126,
            "count": vertex_count,
            "type": "VEC3",
        }
    )

    for stream_number, indices in enumerate(index_streams):
        while len(buffer) % 4:
            buffer.append(0)
        offset = len(buffer)
        buffer.extend(struct.pack(f"<{len(indices)}{index_format}", *indices))
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": offset,
                "byteLength": len(indices) * index_size,
                "target": 34963,
            }
        )
        accessors.append(
            {
                "bufferView": 1 + stream_number,
                "componentType": index_type,
                "count": len(indices),
                "type": "SCALAR",
            }
        )
        primitives.append(
            {
                "attributes": {"POSITION": 0, "NORMAL": 1},
                "indices": 2 + stream_number,
                "material": stream_number,
            }
        )

    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "toebeans tools/obj2glb_palette.py",
        },
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": obj_path.stem}],
        "meshes": [{"primitives": primitives, "name": obj_path.stem}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(buffer)}],
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    while len(buffer) % 4:
        buffer.append(0)

    glb = b"glTF"
    glb += struct.pack("<II", 2, 12 + 8 + len(json_bytes) + 8 + len(buffer))
    glb += struct.pack("<I", len(json_bytes)) + b"JSON" + json_bytes
    glb += struct.pack("<I", len(buffer)) + b"BIN\x00" + bytes(buffer)

    out_path = out_dir / (obj_path.stem + ".glb")
    out_path.write_bytes(glb)
    return triangle_count, len(glb)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("objs", nargs="+", type=Path)
    parser.add_argument("-o", "--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    over_budget = []
    for obj_path in args.objs:
        triangles, size = convert(obj_path, args.out)
        flag = ""
        if triangles > TRIANGLE_BUDGET:
            flag = f"  <-- OVER the {TRIANGLE_BUDGET} triangle prop budget"
            over_budget.append(obj_path.stem)
        print(f"{obj_path.stem}: {triangles} tris, {size / 1024:.0f} KB{flag}")
    if over_budget:
        sys.exit(f"over budget: {', '.join(over_budget)}")


if __name__ == "__main__":
    main()
