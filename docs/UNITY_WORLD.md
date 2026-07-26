# Building the world in Unity

The mountain is built in Unity and imported into Toebeans. This is the
walkthrough and the contract between the two.

**Why.** Toebeans has no terrain system. Ground height comes from a 1-D grade
curve (`GRADE_PROFILE` in `shared/src/route.ts`) and the mountain is a ribbon
swept along it — the world is, structurally, a hallway. Twelve hours went into
describing a landscape to it and none of it converged, because you cannot
describe a landscape to a hallway. So Unity owns the landscape now, and the
game reads it.

**Director's call (2026-07-26):** Unity owns the **terrain and the trail**. The
branching graph, forks, chasms and checkpoints stay in code, re-anchored to the
imported trail.

---

## What crosses the seam

Shape and placement only. Materials, terrain texture painting, lighting, fog and
shaders are **not** exported and never will be — Toebeans re-applies its own
palette and snow shader on arrival, which is where the look already lives. Paint
whatever you like in Unity for your own eyes while sculpting; it stays there.

| Exported | As | Consumed by |
|---|---|---|
| Terrain heights | `assets/world/heightmap.bin` (16-bit raw) | the terrain mesh + ground height |
| The trail spline | `assets/world/manifest.json` → `trail` | replaces `GRADE_PROFILE` + the hand-tuned turns |
| Trees, rocks, props | `manifest.json` → `props` (**name + transform, not geometry**) | instantiates the existing GLBs in `assets/slope/` |

The prop rule is the important one: you paint in Unity with the raw Quaternius
meshes, and only the *names and transforms* come across. The game builds the
scene from the palette-baked GLBs it already has, so the art style cannot drift
and the export stays a few hundred KB.

---

## One-time setup

### 1. Create the project

Unity Hub ▸ **New project** ▸ editor **6000.5.5f1** ▸ template **Universal 3D**.
Name it `ToebeansWorld`, location `C:\Users\joshu`. Keep it **outside** the
Toebeans repo — a Unity project's `Library/` folder is gigabytes and has no
business in git.

### 2. Install the Splines package

**Window ▸ Package Manager ▸ Unity Registry**, search `Splines`, **Install**.

Do this *before* step 4. The exporter imports `UnityEngine.Splines`; without the
package it will not compile and the console will say *"The type or namespace name
'Splines' does not exist"*. That is a missing package, not a bug.

### 3. Create the terrain

**GameObject ▸ 3D Object ▸ Terrain**. Select it, and in the Inspector open
**Terrain Settings** (the gear tab):

| Field | Value | Why |
|---|---|---|
| Terrain Width | `2000` | ~2× the current run's footprint, room for the drawn meanders |
| Terrain Length | `2000` | |
| Terrain Height | `700` | the run needs real vertical: today it drops ~460 units over 920 |
| Heightmap Resolution | `1025` | ~2 units per sample — plenty for a mountain |
| Position | `X -1000, Y 0, Z -1000` | puts the terrain's centre at the world origin |

All of these can be changed later and re-exported. They are a starting point,
not a commitment.

**One Unity unit = one Toebeans unit.** Don't scale anything to "look right" in
the editor.

### 4. Add the exporter

Copy `tools/unity/ToebeansWorldExporter.cs` from this repo into the Unity
project at `Assets/Editor/ToebeansWorldExporter.cs`. Unity compiles it and a
**Toebeans** menu appears in the menu bar.

Then **Toebeans ▸ Set Export Folder…** and point it at this repo's
`assets/world` folder. (Vite serves `assets/` at the site root — see
`client/vite.config.ts` — so the game fetches it from `/world/manifest.json`.)

### 5. Put the drawing under the terrain

Drag `slope-map.png` from this repo into the Unity project's `Assets` folder.
Then on the terrain: **Paint Terrain ▸ Paint Texture ▸ Edit Terrain Layers ▸
Create Layer**, pick `slope-map`, and set that layer's **Size** to `2000 × 2000`
with **Offset** `0, 0`.

Your drawing is now painted across the whole terrain at 1:1. You sculpt on top of
your own map and draw the trail along the line you already drew, instead of
translating it into words.

---

## The loop

### Sculpt

Select the terrain ▸ **Paint Terrain** dropdown:

- **Raise or Lower Terrain** — click to raise, **Shift**-click to lower. Big
  brush (size 200+), low opacity, many passes for landforms.
- **Smooth Height** — the one that makes it look like a mountain instead of
  lumps. Use it constantly.
- **Set Height** — flat shelves: the lake bed, the runout, a plateau.
- **Stamp Terrain** — drop a whole peak shape in one click.

### Draw the trail

**GameObject ▸ Spline ▸ Draw Splines Tool**, then click down the mountain along
the painted trail. Name the object `Trail`.

Look **straight down** (top view) while you draw and ignore height entirely — the
exporter drops every point onto the terrain surface underneath. You are drawing
the trail's *path*, not its elevation. There is nothing to line up vertically.

Only the **first** spline is exported. One spline, one run.

### Export

**Toebeans ▸ Export World**. The console prints what it wrote. Then reload the
game.

---

## Gotchas worth knowing

- **Coordinates.** Unity is left-handed (+Z forward), Three.js is right-handed
  (−Z forward). The exporter converts once, `z_three = -z_unity`, and everything
  in the output file is already in Toebeans world space. Negating Z (rather than
  X) flips handedness *without* mirroring: a tree ahead-and-right in Unity stays
  ahead-and-right in the game.
- **Route distance is horizontal.** `route.ts` stores grade as `tan(pitch)` and
  integrates it over route distance, which only holds if route distance is the
  horizontal run. The exporter therefore resamples the trail by X/Z distance, not
  along the 3-D surface.
- **Grade drives speed.** `gradeSpeedFactor` is floored at 1 and that floor bites
  below ~13°, so any shallow stretch you sculpt plays as mechanically identical
  to true flat. A gentle-looking pitch will not gently feed speed — that needs
  the `iceGlide` carry, not geometry.
- **Trail length changes the tuning.** The sim's segment lengths, chasm positions
  and `TOTAL_ROUTE_LENGTH` are all in route distance. Draw a 2000-unit trail
  where today's is 920 and those all need rescaling. Not hard, but it is a
  separate pass — expect it, don't be surprised by it.
- **Unity can't import GLB.** The 16 slope models in `assets/slope/` are GLB, and
  Unity 6 reads FBX/OBJ only. Foliage painting needs OBJ proxies (a converter is
  coming) or the original Quaternius pack downloads.
