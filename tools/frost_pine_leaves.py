# Re-paints the StylizedPine_*.glb foliage from solid frost-white to frosted
# GREEN (director call, 2026-07-23: "green with white frosted tips"). The
# original green-textured MegaKit sources aren't kept in the repo, but the
# leaf silhouette's ALPHA is preserved inside each already-converted GLB —
# and the frosted-green look is generated purely from that silhouette (green
# body, white tips = distance from the edge). So this re-processes the
# converted files in place, no re-download.
#
# It reuses glb_stylized_pine's frost_over_green() so the gradient has a
# single definition; that converter (the source pipeline) already produces
# these frosted-green cards for any future source run — this tool just brings
# the shipped assets, converted before the color change, up to date.
#
# Usage:  python tools/frost_pine_leaves.py assets/slope/StylizedPine_*.glb

from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image

from glb_stylized_pine import (
    LEAF_IMAGE_SIZE,
    frost_over_green,
    parse_glb,
    repack,
    write_glb,
)


def refrost(path: Path) -> None:
    gltf, binary = parse_glb(path.read_bytes())
    binary = bytearray(binary)

    leaves = next(
        (m for m in gltf.get("materials", []) if m.get("name") == "PineSnow"), None
    )
    if leaves is None:
        raise ValueError(f"{path.name}: no PineSnow material")

    texture_index = leaves["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    image_index = gltf["textures"][texture_index]["source"]
    image = gltf["images"][image_index]
    view = gltf["bufferViews"][image["bufferView"]]
    start = view.get("byteOffset", 0)
    png = bytes(binary[start : start + view["byteLength"]])

    alpha = (
        Image.open(io.BytesIO(png))
        .convert("RGBA")
        .getchannel("A")
        .resize((LEAF_IMAGE_SIZE, LEAF_IMAGE_SIZE), Image.LANCZOS)
    )
    baked = frost_over_green(alpha)
    out = io.BytesIO()
    baked.save(out, format="PNG", optimize=True)
    new_png = out.getvalue()

    binary += b"\x00" * (-len(binary) % 4)
    gltf["bufferViews"].append(
        {"buffer": 0, "byteOffset": len(binary), "byteLength": len(new_png)}
    )
    binary += new_png
    image["bufferView"] = len(gltf["bufferViews"]) - 1

    # The green lives in the painted RGB now; the factor must be white or it
    # would tint the frost. (Old converted files carried a snow-shadow tint.)
    leaves["pbrMetallicRoughness"]["baseColorFactor"] = [1.0, 1.0, 1.0, 1.0]

    packed = repack(gltf, binary)
    write_glb(path, gltf, packed)
    print(f"{path.name}: re-frosted, {path.stat().st_size // 1024} KB")


def main() -> int:
    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        print("usage: frost_pine_leaves.py <StylizedPine_*.glb>...", file=sys.stderr)
        return 1
    for path in paths:
        refrost(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
