"""Read the director's hand-drawn map (`slope-map.png`) and emit the world's frame.

The drawing is a top-down plan in flat MS-Paint colours, so the layout is not a
matter of interpretation — it can be measured. This tool segments the image by
colour, thins the trail stroke to a centreline, fits the lake, lifts every forest
dot as its own tree, and writes the result as world coordinates.

Nothing here decides what the world LOOKS like. It decides where things ARE.

    python tools/extract_map.py            # writes shared/src/mapLayout.generated.ts
    python tools/extract_map.py --overlay  # + an overlay PNG proving the fit

Convention: the image is a plan view, so image x -> world X and image y -> world Z,
with the origin at the drawn start marker and the run heading broadly +X/+Z.
Elevation is NOT in the drawing; height still comes from the route's grade profile.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "slope-map.png"
OUT_TS = REPO / "shared" / "src" / "mapLayout.generated.ts"
OUT_JSON = REPO / "shared" / "src" / "mapLayout.generated.json"
OUT_OVERLAY = REPO / "docs" / "screens" / "map-frame-overlay.png"

# The drawing's palette, sampled straight out of the file (probe_map showed 405
# distinct colours, but 9 of them are 99.9% of the pixels — the rest is antialiasing).
PALETTE = {
    "background": (127, 127, 127),
    "mountain": (59, 59, 59),
    "trail": (255, 255, 255),
    "forest": (34, 177, 76),
    "lake": (0, 162, 232),
    "cave": (195, 195, 195),
    "penguin": (63, 72, 204),
    "treehouse": (185, 122, 87),
    "marker": (237, 28, 36),
}
COLOUR_TOL = 40  # L1 distance; wide enough for antialiased edges, tight enough to not bleed

# The total route length the sim already runs on. Keeping it fixed means the frame
# changes the world's SHAPE without retiming the run (see route.ts TOTAL_ROUTE_LENGTH).
TARGET_ROUTE_LENGTH = 920.0

TRAIL_STEP = 2.0  # world units between emitted centreline samples (index i == route i·step)
# Smoothing is a trade, and both sides are measured below: too little and the trail's
# curvature steps (a camera that snaps), too much and the drawn meander gets ironed
# out. 71 is the smallest window that clears CURVATURE_LIMIT — chosen against the
# numbers the tool prints, not by feel.
SMOOTH_WINDOW = 71  # pixels of moving average over the traced skeleton
SMOOTH_PASSES = 3   # box passes; see smooth_iterated — curvature, not position, sets this
CURVATURE_LIMIT = 0.01  # rad per unit², the bar slopePath.test.ts holds the trail to
TRAIL_LEAD_PX = 40  # how far along the drawn line the start heading is measured


# ---------------------------------------------------------------- masks & blobs


def load() -> np.ndarray:
    return np.asarray(Image.open(SRC).convert("RGB")).astype(np.int16)


def mask_for(img: np.ndarray, name: str) -> np.ndarray:
    target = np.array(PALETTE[name], dtype=np.int16)
    return np.abs(img - target).sum(axis=2) <= COLOUR_TOL


def components(mask: np.ndarray, min_area: int = 40) -> list[dict]:
    """4-connected blobs, largest first, each carrying its pixel mask."""
    seen = np.zeros(mask.shape, dtype=bool)
    out: list[dict] = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        q = deque([(int(y0), int(x0))])
        seen[y0, x0] = True
        pix: list[tuple[int, int]] = []
        while q:
            y, x = q.popleft()
            pix.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1]:
                    if mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
        if len(pix) < min_area:
            continue
        p = np.array(pix)
        sub = np.zeros(mask.shape, dtype=bool)
        sub[p[:, 0], p[:, 1]] = True
        out.append({
            "area": len(pix),
            "x0": int(p[:, 1].min()), "x1": int(p[:, 1].max()),
            "y0": int(p[:, 0].min()), "y1": int(p[:, 0].max()),
            "cx": float(p[:, 1].mean()), "cy": float(p[:, 0].mean()),
            "mask": sub,
        })
    out.sort(key=lambda c: -c["area"])
    return out


def erode(mask: np.ndarray, radius: int) -> np.ndarray:
    """Binary erosion by a square structuring element (no scipy in this repo)."""
    out = mask.copy()
    for _ in range(radius):
        shifted = out.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            shifted &= np.roll(out, (dy, dx), axis=(0, 1))
        out = shifted
    return out


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(radius):
        grown = out.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            grown |= np.roll(out, (dy, dx), axis=(0, 1))
        out = grown
    return out


def close(mask: np.ndarray, radius: int) -> np.ndarray:
    """Dilate then erode — bridges a notch without growing the mass overall.

    The start mountain needs this: the trail is painted across its eastern edge,
    which opens a 45px channel that a radial outline trace escapes through.
    """
    return erode(dilate(mask, radius), radius)


def holes_of(comp: dict, min_area: int = 80) -> list[dict]:
    """Background regions fully enclosed by the component, in image coordinates.

    A drawn box IS its hole: the treehouse and the penguin castle are rectangle
    outlines with pointer lines attached, so the enclosed void is a far cleaner
    read of where the landmark sits than the stroke's bounding box.
    """
    sub = comp["mask"]
    free = ~sub
    h, w = free.shape
    seen = np.zeros_like(free)
    q: deque = deque()
    for x in range(w):
        for y in (0, h - 1):
            if free[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if free[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and free[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return components(free & ~seen, min_area=min_area)


def boxed_landmark(mask: np.ndarray, pad: int = 4) -> dict | None:
    """The largest drawn rectangle in a colour layer, read from the void it encloses."""
    best: dict | None = None
    for comp in components(mask, 150):
        for hole in holes_of(comp):
            if best is None or hole["area"] > best["area"]:
                best = hole
    if best is None:
        return None
    return {
        "x0": best["x0"] - pad, "x1": best["x1"] + pad,
        "y0": best["y0"] - pad, "y1": best["y1"] + pad,
        "cx": best["cx"], "cy": best["cy"], "area": best["area"],
    }


def largest_hole(comp: dict) -> int:
    """Area of the biggest background region fully enclosed by this component.

    This is what separates a drawn rectangle OUTLINE (a landmark) from a word of
    text in the same colour: letters enclose holes of a dozen pixels, the ice
    castle encloses hundreds.
    """
    pad = 2
    sub = comp["mask"][comp["y0"] - pad if comp["y0"] >= pad else 0: comp["y1"] + pad + 1,
                       comp["x0"] - pad if comp["x0"] >= pad else 0: comp["x1"] + pad + 1]
    free = ~sub
    h, w = free.shape
    seen = np.zeros_like(free)
    q: deque = deque()
    for x in range(w):
        for y in (0, h - 1):
            if free[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if free[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and free[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    enclosed = free & ~seen
    if not enclosed.any():
        return 0
    return max(c["area"] for c in components(enclosed, min_area=1))


def classify(comp: dict) -> str:
    """`solid` (a filled feature), `outline` (a drawn box), or `text` (a label)."""
    if erode(comp["mask"], 3).any():
        return "solid"
    if largest_hole(comp) >= 150:
        return "outline"
    return "text"


def rectangularity(comp: dict) -> float:
    """How much of its bounding box the component fills once holes are closed.

    A drawn landmark box scores ~1.0; a painted trail — a curve inside a wide
    bbox — scores far lower. This is what keeps the ice castle out of the trail.
    """
    sub = comp["mask"][comp["y0"]:comp["y1"] + 1, comp["x0"]:comp["x1"] + 1]
    filled = sub.copy()
    holes = components(~sub, min_area=1)
    h, w = sub.shape
    for hole in holes:
        touches_edge = hole["x0"] == 0 or hole["y0"] == 0 or hole["x1"] == w - 1 or hole["y1"] == h - 1
        if not touches_edge:
            filled |= hole["mask"]
    return float(filled.sum()) / float(max(1, h * w))


def boundary_points(mask: np.ndarray, stride: int = 3) -> np.ndarray:
    edge = mask & ~erode(mask, 1)
    ys, xs = np.nonzero(edge)
    pts = np.stack([ys, xs], axis=1)
    return pts[::stride] if len(pts) > stride else pts


def draw_segment(mask: np.ndarray, a: tuple[int, int], b: tuple[int, int], width: int = 3) -> None:
    steps = int(max(abs(a[0] - b[0]), abs(a[1] - b[1]))) + 1
    for i in range(steps + 1):
        t = i / max(1, steps)
        y = int(round(a[0] + (b[0] - a[0]) * t))
        x = int(round(a[1] + (b[1] - a[1]) * t))
        y0, y1 = max(0, y - width), min(mask.shape[0], y + width + 1)
        x0, x1 = max(0, x - width), min(mask.shape[1], x + width + 1)
        mask[y0:y1, x0:x1] = True


def bridge_components(masks: list[np.ndarray], shape: tuple[int, int]) -> np.ndarray:
    """Join separate strokes with the shortest possible link (an MST over blobs).

    The director drew the treehouse and the cliff ON TOP of the trail, so the
    painted stroke is cut into pieces. Reconnecting by the closest pixel pair
    restores the line without thickening it the way a dilate/erode pass would.
    """
    out = np.zeros(shape, dtype=bool)
    for m in masks:
        out |= m
    if len(masks) < 2:
        return out
    bounds = [boundary_points(m) for m in masks]
    connected = {0}
    remaining = set(range(1, len(masks)))
    while remaining:
        best = None
        for i in connected:
            for j in remaining:
                pi, pj = bounds[i], bounds[j]
                d2 = ((pi[:, None, :] - pj[None, :, :]) ** 2).sum(axis=2)
                idx = int(d2.argmin())
                a, b = idx // d2.shape[1], idx % d2.shape[1]
                dist = float(d2[a, b])
                if best is None or dist < best[0]:
                    best = (dist, j, tuple(pi[a]), tuple(pj[b]))
        _, j, pa, pb = best
        draw_segment(out, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])))
        connected.add(j)
        remaining.discard(j)
    return out


def drop_labels(comps: list[dict]) -> list[dict]:
    return [c for c in comps if classify(c) != "text"]


# ------------------------------------------------------------------- centreline


def thin(mask: np.ndarray) -> np.ndarray:
    """Zhang-Suen thinning — reduces the painted stroke to a 1px centreline."""
    img = mask.copy().astype(np.uint8)
    changed = True
    while changed:
        changed = False
        for step in (0, 1):
            p = [np.roll(np.roll(img, dy, axis=0), dx, axis=1)
                 for dy, dx in ((-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1))]
            # p[0]=N p[1]=NE p[2]=E p[3]=SE p[4]=S p[5]=SW p[6]=W p[7]=NW
            neighbours = sum(p)
            seq = 0
            for i in range(8):
                a, b = p[i], p[(i + 1) % 8]
                seq = seq + ((a == 0) & (b == 1))
            cond = (img == 1) & (neighbours >= 2) & (neighbours <= 6) & (seq == 1)
            if step == 0:
                cond &= (p[0] * p[2] * p[4] == 0) & (p[2] * p[4] * p[6] == 0)
            else:
                cond &= (p[0] * p[2] * p[6] == 0) & (p[0] * p[4] * p[6] == 0)
            if cond.any():
                img[cond] = 0
                changed = True
    return img.astype(bool)


def path_between(skel: np.ndarray, start: tuple[int, int], goal: tuple[int, int]) -> list[tuple[int, int]]:
    """Shortest 8-connected walk along the skeleton — ignores spurs by construction."""
    pts = {(int(y), int(x)) for y, x in zip(*np.nonzero(skel))}

    def nearest(target: tuple[int, int]) -> tuple[int, int]:
        return min(pts, key=lambda p: (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2)

    s, g = nearest(start), nearest(goal)
    prev: dict = {s: None}
    q = deque([s])
    while q:
        cur = q.popleft()
        if cur == g:
            break
        y, x = cur
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                nxt = (y + dy, x + dx)
                if nxt in pts and nxt not in prev:
                    prev[nxt] = cur
                    q.append(nxt)
    if g not in prev:
        raise SystemExit("trail skeleton is not connected between start and finish")
    walk = []
    cur = g
    while cur is not None:
        walk.append(cur)
        cur = prev[cur]
    walk.reverse()
    return walk


def resample(points: list[tuple[float, float]], spacing: float) -> list[tuple[float, float]]:
    if not points:
        return []
    out = [points[0]]
    carry = 0.0
    for a, b in zip(points, points[1:]):
        seg = math.dist(a, b)
        if seg <= 1e-9:
            continue
        travelled = -carry
        while travelled + spacing <= seg:
            travelled += spacing
            t = travelled / seg
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        carry = seg - travelled
    if math.dist(out[-1], points[-1]) > spacing * 0.25:
        out.append(points[-1])
    return out


def polyline_length(points) -> float:
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))


def smooth_polyline(points: list[tuple[float, float]], window: int) -> list[tuple[float, float]]:
    """Moving average with clamped ends.

    A skeleton traced out of painted pixels staircases by a pixel at a time, and the
    trail's TANGENT is what aims the camera and the skier — so the jaggedness would be
    felt, not just seen. Averaging keeps the drawn shape and drops the staircase.
    """
    if window < 3 or len(points) < window:
        return list(points)
    half = window // 2
    # Reflect the ends rather than truncating the window there. A clamped window is a
    # weaker filter at the ends than in the middle, and that GRADIENT in smoothing is
    # itself a curvature ramp — which is why the worst jump kept landing in the first
    # few units of the run no matter how hard the interior was smoothed. Mirroring
    # about the endpoint keeps the window full and the local direction intact.
    padded = (
        [(2 * points[0][0] - points[i][0], 2 * points[0][1] - points[i][1])
         for i in range(half, 0, -1)]
        + list(points)
        + [(2 * points[-1][0] - points[-1 - i][0], 2 * points[-1][1] - points[-1 - i][1])
           for i in range(1, half + 1)]
    )
    out: list[tuple[float, float]] = []
    for i in range(len(points)):
        span = padded[i:i + window]
        out.append((sum(p[0] for p in span) / len(span), sum(p[1] for p in span) / len(span)))
    # NB the endpoints are deliberately NOT pinned back to their raw positions. Doing
    # that snaps the last sample back onto the pixel staircase the rest of the pass just
    # removed, which is a curvature spike at both ends — and it survives more passes,
    # because every pass re-applies it. The start is re-anchored to the origin later by
    # the world transform; the flag is free to settle a unit or two.
    return out


def smooth_iterated(points: list[tuple[float, float]], window: int, passes: int) -> list[tuple[float, float]]:
    """Repeated box smoothing — a cheap Gaussian, applied in even 1px steps.

    One box pass leaves corners in the CURVATURE even when the position looks clean,
    and curvature is what the run feels: slopePath's own test caps the per-unit change
    in heading at 0.01 rad, because a step there is a camera that snaps. Three passes
    put the noise well under it while leaving turns of tens of units untouched.
    """
    out = list(points)
    for _ in range(passes):
        out = smooth_polyline(out, window)
    return out


def curvature_jump(points: list[tuple[float, float]], step: float) -> float:
    """The metric slopePath.test.ts pins: the biggest change in per-unit heading.

    Reproduced here so the tool reports whether the extracted line is rideable before
    anything is generated from it — a failing number means smooth harder, not edit a test.
    """
    headings = polyline_headings(points)

    def heading_at(d: float) -> float:
        u = d / step
        i = max(0, min(len(headings) - 2, int(u)))
        t = u - i
        return headings[i] * (1 - t) + headings[i + 1] * t

    total = (len(points) - 1) * step
    worst, where = 0.0, 0.0
    prev_k = heading_at(1.0) - heading_at(0.0)
    d = 2.0
    while d <= total:
        k = heading_at(d) - heading_at(d - 1)
        if abs(k - prev_k) > worst:
            worst, where = abs(k - prev_k), d
        prev_k = k
        d += 1.0
    return worst, where


def polyline_headings(points: list[tuple[float, float]]) -> list[float]:
    """Heading per point in the game's convention: tangent = (sin H, -cos H).

    UNWRAPPED — the run turns more than 180° around the second mountain, so a raw
    atan2 series steps by 2π there and any curvature read off it is nonsense. The
    client's TRAIL_LINE unwraps for the same reason (a wrapped heading would lerp
    the long way round mid-wrap); this has to agree with it or the tool's own
    smoothness check measures something the game never sees.
    """
    out: list[float] = []
    acc = 0.0
    for i in range(len(points)):
        a = points[max(0, i - 1)]
        b = points[min(len(points) - 1, i + 1)]
        raw = math.atan2(b[0] - a[0], -(b[1] - a[1]))
        if i == 0:
            acc = raw
        else:
            delta = raw - acc
            while delta > math.pi:
                delta -= 2 * math.pi
            while delta < -math.pi:
                delta += 2 * math.pi
            acc += delta
        out.append(acc)
    return out


# ------------------------------------------------------------------ circle fit


def fill_holes(mask: np.ndarray) -> np.ndarray:
    """Close anything drawn ON TOP of a mass — labels, markers, the trail crossing it."""
    free = ~mask
    h, w = free.shape
    seen = np.zeros_like(free)
    q: deque = deque()
    for x in range(w):
        for y in (0, h - 1):
            if free[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if free[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and free[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return mask | (free & ~seen)


def fit_circle(mask: np.ndarray, exclude: np.ndarray | None = None) -> tuple[float, float, float]:
    """Algebraic (Kasa) circle fit over a blob's boundary.

    The lake matters here: the second mountain is drawn ON TOP of its right side,
    so its bounding box understates it. Fitting the visible arc recovers the disc
    the director actually drew — but only if the occluded edge is excluded, since
    that boundary is where the mountain starts, not where the water ends.
    """
    solid = fill_holes(mask)
    edge = solid & ~erode(solid, 1)
    if exclude is not None:
        edge &= ~exclude
    ys, xs = np.nonzero(edge)
    x = xs.astype(float)
    y = ys.astype(float)
    a_mat = np.stack([x, y, np.ones_like(x)], axis=1)
    b_vec = x ** 2 + y ** 2
    sol, *_ = np.linalg.lstsq(a_mat, b_vec, rcond=None)
    cx = sol[0] / 2
    cy = sol[1] / 2
    r = math.sqrt(max(0.0, sol[2] + cx ** 2 + cy ** 2))
    return cx, cy, r


def outline_of(mask: np.ndarray, tolerance: float = 3.0) -> list[tuple[float, float]]:
    """A simplified closed outline: radial sampling from the blob's centroid.

    Good enough for a frame — these become the footprint of a mountain mass, not
    a silhouette anyone reads up close.
    """
    solid = fill_holes(mask)  # the start marker sits at the start mountain's centroid
    ys, xs = np.nonzero(solid)
    cx, cy = xs.mean(), ys.mean()
    rays = 64
    pts: list[tuple[float, float]] = []
    for i in range(rays):
        ang = 2 * math.pi * i / rays
        dx, dy = math.cos(ang), math.sin(ang)
        best = 0.0
        r = 0.0
        while True:
            r += 1.0
            px, py = int(round(cx + dx * r)), int(round(cy + dy * r))
            if not (0 <= py < solid.shape[0] and 0 <= px < solid.shape[1]):
                break
            if solid[py, px]:
                best = r
            elif r - best > 45:  # cross labels drawn over the mass, stop at real sky
                break
        pts.append((cx + dx * best, cy + dy * best))
    return pts


# ------------------------------------------------------------------- extraction


def extract(verbose: bool = True) -> dict:
    img = load()
    log = (lambda *a: print(*a)) if verbose else (lambda *a: None)

    # --- markers: the two red triangles anchor the whole coordinate system.
    markers = sorted(drop_labels(components(mask_for(img, "marker"), 200)), key=lambda c: c["cx"])
    if len(markers) < 2:
        raise SystemExit("expected two red race markers in the drawing")
    start_px = (markers[0]["cy"], markers[0]["cx"])
    finish_px = (markers[-1]["cy"], markers[-1]["cx"])
    log(f"markers: start=({start_px[1]:.0f},{start_px[0]:.0f}) finish=({finish_px[1]:.0f},{finish_px[0]:.0f})")

    # --- trail: white strokes, minus the ice-castle box, rejoined where the
    #     director drew the treehouse and the cliff across the line.
    trail_comps = components(mask_for(img, "trail"), 150)
    trail_solid = [c for c in trail_comps if classify(c) == "solid"]

    # The race markers are hollow triangles, so each one holds a patch of white that is
    # NOT trail. Bridged in, it hooks the line sideways in the first few units — which
    # is exactly where the curvature check kept failing.
    marker_boxes = [(m["x0"], m["x1"], m["y0"], m["y1"]) for m in markers]
    def inside_marker(c: dict) -> bool:
        return any(x0 <= c["cx"] <= x1 and y0 <= c["cy"] <= y1 for x0, x1, y0, y1 in marker_boxes)

    dropped = [c for c in trail_solid if inside_marker(c)]
    trail_solid = [c for c in trail_solid if not inside_marker(c)]
    if dropped:
        log(f"trail: dropped {len(dropped)} white patch(es) enclosed by a race marker")
    boxes = [c for c in trail_solid if rectangularity(c) > 0.9]
    strokes = [c for c in trail_solid if rectangularity(c) <= 0.9]
    log(f"trail: {len(strokes)} strokes, {len(boxes)} drawn box(es) held back "
        f"(rectangularity {[round(rectangularity(c), 2) for c in trail_solid]})")
    bridged = bridge_components([c["mask"] for c in strokes], img.shape[:2])
    skel = thin(bridged)
    walk = path_between(skel, start_px, finish_px)
    log(f"trail: skeleton walk of {len(walk)} px")

    # --- cave line: the light-grey alternate through the second mountain.
    cave_comps = [c for c in components(mask_for(img, "cave"), 150) if classify(c) == "solid"]
    cave_bridged = bridge_components([c["mask"] for c in cave_comps], img.shape[:2])
    cave_skel = thin(cave_bridged)
    cave_pts = sorted({(int(y), int(x)) for y, x in zip(*np.nonzero(cave_skel))})
    cave_walk: list[tuple[int, int]] = []
    if cave_pts:
        top = min(cave_pts, key=lambda p: p[0])
        bottom = max(cave_pts, key=lambda p: p[0])
        try:
            cave_walk = path_between(cave_skel, top, bottom)
        except SystemExit:
            cave_walk = []
    log(f"cave line: {len(cave_walk)} px")

    # --- masses.
    mountains = [c for c in components(mask_for(img, "mountain"), 2000) if classify(c) == "solid"]
    log(f"mountain blobs: {[(c['area'], c['x0'], c['x1']) for c in mountains]}")
    # The second mountain is split in two by the cave line drawn through it — merge
    # anything that overlaps horizontally with a neighbour into one mass.
    merged: list[np.ndarray] = []
    for c in sorted(mountains, key=lambda c: c["cx"]):
        placed = False
        for i, m in enumerate(merged):
            ys, xs = np.nonzero(m)
            if not (c["x1"] < xs.min() - 40 or c["x0"] > xs.max() + 40):
                merged[i] = m | c["mask"]
                placed = True
                break
        if not placed:
            merged.append(c["mask"].copy())
    log(f"mountain masses after merge: {len(merged)}")

    lake_mask = np.zeros(img.shape[:2], dtype=bool)
    for c in components(mask_for(img, "lake"), 200):
        if classify(c) == "solid":
            lake_mask |= c["mask"]
    # The lake is drawn taller than it is wide and the second mountain covers its
    # right side, so a circle fit both understates and invents. Its real drawn
    # footprint is the honest answer — the mountain IS the lake's eastern shore.
    lake_ring_px = outline_of(lake_mask)
    lake_cx = sum(p[0] for p in lake_ring_px) / len(lake_ring_px)
    lake_cy = sum(p[1] for p in lake_ring_px) / len(lake_ring_px)
    lake_r = sum(math.dist((lake_cx, lake_cy), p) for p in lake_ring_px) / len(lake_ring_px)
    log(f"lake footprint: centre=({lake_cx:.0f},{lake_cy:.0f}) mean r={lake_r:.0f}px")

    # --- forest: every drawn dot is a tree.
    trees = [c for c in components(mask_for(img, "forest"), 60) if classify(c) != "text"]
    log(f"forest dots: {len(trees)}")

    # --- landmarks. The treehouse and penguin castle are drawn as rectangles with
    #     pointer lines / connecting paths attached, so read the box they enclose.
    treehouse = boxed_landmark(mask_for(img, "treehouse"))
    penguin = boxed_landmark(mask_for(img, "penguin"))
    ice_castle = {"x0": boxes[0]["x0"], "x1": boxes[0]["x1"],
                  "y0": boxes[0]["y0"], "y1": boxes[0]["y1"],
                  "cx": boxes[0]["cx"], "cy": boxes[0]["cy"]} if boxes else None
    log(f"landmarks: treehouse={bool(treehouse)} penguinCastle={bool(penguin)} iceCastle={bool(ice_castle)}")

    # --- from pixels to the world.
    #
    # Three things happen here and the order matters. The painted stroke is
    # pixel-jagged, so it is SMOOTHED before anything measures a heading off it —
    # otherwise the trail's tangent (which drives the camera and the skier's facing)
    # would judder every few units. Then it is ROTATED so the run leaves the start
    # marker along the fall line, because the game's convention is heading 0 = −Z
    # while the drawing's start heads off to the right. Finally it is SCALED so the
    # drawn line is exactly the route length the sim already runs, which keeps every
    # existing distance — chasms, checkpoints, the flag — landing where it does today.
    walk_xy = resample([(float(x), float(y)) for y, x in walk], 1.0)
    smooth_px = smooth_iterated(walk_xy, SMOOTH_WINDOW, SMOOTH_PASSES)
    px_len = polyline_length(smooth_px)
    scale = TARGET_ROUTE_LENGTH / px_len
    ox, oy = start_px[1], start_px[0]

    # Heading the drawing leaves the start at, measured over the first stretch rather
    # than off one pixel step.
    lead = min(len(smooth_px) - 1, max(1, int(TRAIL_LEAD_PX)))
    d0x = smooth_px[lead][0] - smooth_px[0][0]
    d0z = smooth_px[lead][1] - smooth_px[0][1]
    theta = -math.pi / 2 - math.atan2(d0z, d0x)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    log(f"trail is {px_len:.0f}px -> scale {scale:.4f} units/px; rotating {math.degrees(theta):+.1f}° "
        f"so the run leaves the start down the fall line")

    def to_world(px: float, py: float) -> tuple[float, float]:
        x = (px - ox) * scale
        z = (py - oy) * scale
        return round(x * cos_t - z * sin_t, 3), round(x * sin_t + z * cos_t, 3)

    def box_of(comp: dict) -> dict:
        corners = [to_world(comp["x0"], comp["y0"]), to_world(comp["x1"], comp["y0"]),
                   to_world(comp["x1"], comp["y1"]), to_world(comp["x0"], comp["y1"])]
        cx, cz = to_world(comp["cx"], comp["cy"])
        return {
            "x": cx, "z": cz,
            "minX": round(min(c[0] for c in corners), 2),
            "maxX": round(max(c[0] for c in corners), 2),
            "minZ": round(min(c[1] for c in corners), 2),
            "maxZ": round(max(c[1] for c in corners), 2),
        }

    # The trail, resampled at an exact arc-length step so index i IS route distance
    # i·step — which is what lets the client index it without re-solving arc length.
    trail_world = resample([to_world(x, y) for x, y in smooth_px], TRAIL_STEP)
    headings = polyline_headings(trail_world)
    jump, jump_at = curvature_jump(trail_world, TRAIL_STEP)
    verdict = "OK" if jump < CURVATURE_LIMIT else "TOO JERKY — raise SMOOTH_WINDOW/PASSES"
    log(f"trail resampled to {len(trail_world)} points at {TRAIL_STEP}u "
        f"({(len(trail_world) - 1) * TRAIL_STEP:.0f} units of route)")
    log(f"curvature jump {jump:.5f} rad/unit^2 at route {jump_at:.0f} (limit {CURVATURE_LIMIT}) — {verdict}")

    # The other half of the trade: how far smoothing pulled the line off the stroke the
    # director actually painted. Reported in world units against the ±12 lane, so the
    # cost of the smoothing above is a number rather than a hope.
    raw_world = [to_world(x, y) for x, y in walk_xy]
    drift = 0.0
    for rx, rz in raw_world[:: max(1, len(raw_world) // 400)]:
        drift = max(drift, min(math.dist((rx, rz), p) for p in trail_world))
    log(f"smoothing pulled the line at most {drift:.1f} units off the painted stroke "
        f"(the playable lane is ±{12})")

    def project(px: float, pz: float) -> tuple[float, float]:
        """World point -> (route distance, signed lateral) on the drawn trail."""
        best = (0.0, 0.0, float("inf"))
        for i, (ax, az) in enumerate(trail_world):
            d = (ax - px) ** 2 + (az - pz) ** 2
            if d < best[2]:
                best = (float(i), 0.0, d)
        i = int(best[0])
        route = i * TRAIL_STEP
        h = headings[i]
        # lateral runs along (cos h, sin h) — the rider's right, matching
        # centerlineToWorld in slopePath.ts.
        lateral = (px - trail_world[i][0]) * math.cos(h) + (pz - trail_world[i][1]) * math.sin(h)
        return round(route, 1), round(lateral, 1)

    def anchored(px: float, py: float) -> dict:
        x, z = to_world(px, py)
        route, lateral = project(x, z)
        return {"x": x, "z": z, "route": route, "lateral": lateral}

    cave_world = resample([to_world(x, y) for x, y in smooth_iterated(
        resample([(float(x), float(y)) for y, x in cave_walk], 1.0),
        SMOOTH_WINDOW, SMOOTH_PASSES)], TRAIL_STEP) if cave_walk else []
    cave_from = project(*cave_world[0]) if cave_world else None
    cave_to = project(*cave_world[-1]) if cave_world else None
    if cave_world:
        log(f"cave line leaves the trail at route {cave_from[0]:.0f} and rejoins at {cave_to[0]:.0f}")

    masses = []
    for m in merged:
        m = close(m, 30)  # the trail is painted across the start mountain's edge
        ring_px = outline_of(m)
        ring = [to_world(px, py) for px, py in ring_px]
        ys, xs = np.nonzero(m)
        centre = anchored(xs.mean(), ys.mean())
        radius = round(max(math.dist((centre["x"], centre["z"]), p) for p in ring), 2)
        masses.append({
            **centre,
            "radius": radius,
            "areaWorld": round(float(m.sum()) * scale * scale, 1),
            "outline": ring,
        })
    masses.sort(key=lambda m: m["route"])

    lake = anchored(lake_cx, lake_cy)
    lake_ring = [to_world(px_, py_) for px_, py_ in lake_ring_px]
    fx, fz = to_world(finish_px[1], finish_px[0])

    data = {
        "source": "slope-map.png",
        "scaleWorldUnitsPerPixel": round(scale, 5),
        "rotationDegrees": round(math.degrees(theta), 3),
        "routeLength": TARGET_ROUTE_LENGTH,
        "trailStep": TRAIL_STEP,
        "start": {"x": 0.0, "z": 0.0},
        "finish": {"x": fx, "z": fz},
        "trail": {
            "step": TRAIL_STEP,
            "xs": [round(p[0], 3) for p in trail_world],
            "zs": [round(p[1], 3) for p in trail_world],
        },
        "caveLine": {
            "step": TRAIL_STEP,
            "xs": [round(p[0], 3) for p in cave_world],
            "zs": [round(p[1], 3) for p in cave_world],
            "fromRoute": cave_from[0] if cave_from else None,
            "toRoute": cave_to[0] if cave_to else None,
        },
        "mountains": masses,
        "lake": {
            **lake,
            "radius": round(lake_r * scale, 2),
            "areaWorld": round(float(fill_holes(lake_mask).sum()) * scale * scale, 1),
            "outline": lake_ring,
        },
        "trees": [anchored(c["cx"], c["cy"]) | {
            "radius": round(0.5 * (c["x1"] - c["x0"] + c["y1"] - c["y0"]) * 0.5 * scale, 2)
        } for c in sorted(trees, key=lambda c: c["cx"])],
        "landmarks": {
            "treehouse": (box_of(treehouse) | anchored(treehouse["cx"], treehouse["cy"])) if treehouse else None,
            "penguinCastle": (box_of(penguin) | anchored(penguin["cx"], penguin["cy"])) if penguin else None,
            "iceCastle": (box_of(ice_castle) | anchored(ice_castle["cx"], ice_castle["cy"])) if ice_castle else None,
        },
        "_pixels": {
            "start": [start_px[1], start_px[0]],
            "finish": [finish_px[1], finish_px[0]],
            "trail": [[int(x), int(y)] for y, x in walk],
            "caveLine": [[int(x), int(y)] for y, x in cave_walk],
            "origin": [ox, oy],
            "theta": theta,
            "scale": scale,
        },
    }
    return data


# --------------------------------------------------------------------- outputs


def write_ts(data: dict) -> None:
    public = {k: v for k, v in data.items() if not k.startswith("_")}
    body = json.dumps(public, indent=2)
    OUT_JSON.write_text(body + "\n", encoding="utf8")

    header = """// GENERATED by tools/extract_map.py from slope-map.png — DO NOT EDIT BY HAND.
//
// This is the director's drawn map, measured. Every number below came out of the
// image by colour segmentation — the trail by thinning the painted stroke, the
// masses by tracing their filled outlines, the trees one per drawn dot. None of
// it was estimated by eye, which is the whole point: the map stopped being a
// thing described in words and became a thing the build reads.
//
// Re-run `python tools/extract_map.py --overlay` after changing the drawing. The
// overlay it writes (docs/screens/map-frame-overlay.png) draws this data back over
// the source image, which is how you check the extraction rather than trusting it.
//
// FRAME ONLY. This says where things ARE, never what they look like.
//
// Conventions, matching slopePath.ts:
//   * plan view — the drawing's x/y become world X/Z
//   * the origin is the drawn start marker, rotated so the run leaves it heading 0
//     (down the fall line, tangent = (sin H, −cos H))
//   * `route` is distance along the trail and `lateral` is offset to the rider's
//     right — the basis the sim and the terrain already share
//   * elevation is NOT in a plan view; height still comes from route.ts's grade

/** A polyline sampled at a fixed arc-length step, so index i is route distance i·step. */
export interface MapPolyline {
  readonly step: number;
  readonly xs: readonly number[];
  readonly zs: readonly number[];
}

/** Anywhere on the map, given both in world space and against the trail. */
export interface MapAnchor {
  readonly x: number;
  readonly z: number;
  readonly route: number;
  readonly lateral: number;
}

export interface MapMass extends MapAnchor {
  readonly radius: number;
  readonly areaWorld: number;
  readonly outline: readonly (readonly [number, number])[];
}

export interface MapBox extends MapAnchor {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface MapLayout {
  readonly source: string;
  readonly scaleWorldUnitsPerPixel: number;
  readonly rotationDegrees: number;
  readonly routeLength: number;
  readonly trailStep: number;
  readonly start: { readonly x: number; readonly z: number };
  readonly finish: { readonly x: number; readonly z: number };
  readonly trail: MapPolyline;
  readonly caveLine: MapPolyline & {
    readonly fromRoute: number | null;
    readonly toRoute: number | null;
  };
  readonly mountains: readonly MapMass[];
  readonly lake: MapMass;
  readonly trees: readonly (MapAnchor & { readonly radius: number })[];
  readonly landmarks: {
    readonly treehouse: MapBox | null;
    readonly penguinCastle: MapBox | null;
    readonly iceCastle: MapBox | null;
  };
}

"""
    OUT_TS.write_text(header + f"export const MAP_LAYOUT: MapLayout = {body};\n", encoding="utf8")
    print(f"wrote {OUT_TS.relative_to(REPO)} and {OUT_JSON.relative_to(REPO)}")


def write_overlay(data: dict) -> None:
    """Draw what was extracted back over the drawing — the proof it matches."""
    from PIL import ImageDraw

    base = Image.open(SRC).convert("RGB")
    faded = Image.blend(base, Image.new("RGB", base.size, (255, 255, 255)), 0.62)
    d = ImageDraw.Draw(faded)
    px = data["_pixels"]
    ox, oy = px["origin"]
    theta, scale = px["theta"], px["scale"]
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    def back(x: float, z: float) -> tuple[float, float]:
        """World -> pixel: undo the rotation, then the scale and the origin shift."""
        xr = x * cos_t + z * sin_t
        zr = -x * sin_t + z * cos_t
        return xr / scale + ox, zr / scale + oy

    for m in data["mountains"]:
        d.polygon([back(x, z) for x, z in m["outline"]], outline=(200, 0, 0), width=3)
    d.polygon([back(x, z) for x, z in data["lake"]["outline"]], outline=(0, 90, 220), width=3)

    for t in data["trees"]:
        tx, tz = back(t["x"], t["z"])
        r = max(3.0, t["radius"] / scale)
        d.ellipse([tx - r, tz - r, tx + r, tz + r], outline=(0, 120, 0), width=2)

    trail = data["trail"]
    d.line([back(x, z) for x, z in zip(trail["xs"], trail["zs"])], fill=(255, 0, 200), width=5)
    cave = data["caveLine"]
    if cave["xs"]:
        d.line([back(x, z) for x, z in zip(cave["xs"], cave["zs"])], fill=(255, 140, 0), width=5)

    for name in ("start", "finish"):
        cx, cy = px[name]
        d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], outline=(255, 0, 0), width=4)

    for key, box in data["landmarks"].items():
        if not box:
            continue
        corners = [back(box["minX"], box["minZ"]), back(box["maxX"], box["maxZ"])]
        d.rectangle([min(c[0] for c in corners), min(c[1] for c in corners),
                     max(c[0] for c in corners), max(c[1] for c in corners)],
                    outline=(120, 0, 160), width=3)
        d.text((corners[0][0], corners[0][1] - 12), key, fill=(120, 0, 160))

    OUT_OVERLAY.parent.mkdir(parents=True, exist_ok=True)
    faded.save(OUT_OVERLAY)
    print(f"wrote {OUT_OVERLAY.relative_to(REPO)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--overlay", action="store_true", help="also write the verification overlay")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    if not SRC.exists():
        raise SystemExit(f"missing {SRC}")
    data = extract(verbose=not args.quiet)
    write_ts(data)
    if args.overlay:
        write_overlay(data)

    lake, cave = data["lake"], data["caveLine"]
    print("\nframe summary — everything below is trail-relative, the basis the sim shares")
    print(f"  trail        {len(data['trail']['xs'])} samples at {data['trailStep']}u "
          f"= {data['routeLength']:.0f} units of route")
    print(f"  cave line    {len(cave['xs'])} samples, leaves at route {cave['fromRoute']}, "
          f"rejoins at {cave['toRoute']}")
    for i, m in enumerate(data["mountains"], 1):
        print(f"  mountain {i}   route {m['route']:.0f}, lateral {m['lateral']:+.0f}, radius {m['radius']:.0f}")
    print(f"  lake         route {lake['route']:.0f}, lateral {lake['lateral']:+.0f}, radius {lake['radius']:.0f}")
    print(f"  trees        {len(data['trees'])}")
    for key, box in data["landmarks"].items():
        if box:
            print(f"  {key:<12} route {box['route']:.0f}, lateral {box['lateral']:+.0f}")
    print(f"  finish       ({data['finish']['x']:.0f}, {data['finish']['z']:.0f})")


if __name__ == "__main__":
    main()
