# Furniture variant of obj2glb_palette.py — same converter, different
# material table. The Quaternius furniture packs reuse material names the
# Nature Pack also uses (White, Black, Wood) with different meanings, so
# the bedroom set gets its own mapping instead of growing the nature one.
#
# Mapping decisions (Art Style Bible: existing hues + value shifts only):
#   - Woods land on the birch-amber family, deeper than the birch-bark
#     floor so furniture reads against it.
#   - Bedding "White" is sunlit snow (linen), and the duvet's Red/DarkRed
#     become dawn pink + a deep value shift of it — signal red is reserved
#     ("red means look at this"), and a dawn-pink duvet ties the room to
#     the haze outside the window.
#   - Metals/greys are slate, matching the code-built lamps they replace.
#   - "Light" (bulb faces) is sun glow, the brightest value in any scene.
#
# Usage:  python tools/obj2glb_bedroom.py <obj file>... -o <output dir>

import obj2glb_palette as base

base.PALETTE_BY_MATERIAL = {
    "Wood": "#B6844B",       # 7  birch amber, mid value shift (frames, tops)
    "Wood_Dark": "#8C6539",  # 7  birch amber, deep value shift (fronts)
    "Wood_Light": "#E9A960", # 7  birch amber (highlights)
    "DarkWood": "#8C6539",   # 7  birch amber, deep value shift (desk)
    "White": "#F8F5EF",      # 1  sunlit snow (mattress, pillows, shades)
    "Grey": "#66738C",       # 9  slate rock (legs, fittings)
    "Metal": "#66738C",      # 9  slate rock (handles)
    "LightMetal": "#66738C", # 9  slate rock (lamp stems and arms)
    "Black": "#4F4A42",      #    deep neutral shift, same as the nature map
    "Light": "#FFF4DA",      # 6  sun glow (bulb faces — they visibly glow)
    "Red": "#F6D7CE",        # 5  dawn pink (duvet)
    "DarkRed": "#D1B7AF",    # 5  dawn pink, deep value shift (blanket folds)
    "Cushing": "#F6D7CE",    # 5  dawn pink (chair cushion, matches the duvet)
}

if __name__ == "__main__":
    base.main()
