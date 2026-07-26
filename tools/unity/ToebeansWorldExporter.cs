// Toebeans world exporter — the Unity → Three.js seam.
//
// WHAT THIS IS FOR
// Toebeans has no terrain system: ground height comes from a 1-D grade curve
// (shared/src/route.ts) and the mountain is a ribbon swept along it. That is why
// "make the mountain look like my drawing" never converged — you cannot describe
// a landscape to a hallway. This script lets Unity own the landscape instead.
//
// WHAT CROSSES THE SEAM
// Shape and placement ONLY. Materials, terrain texture painting, lighting, fog
// and shaders are NOT exported and never will be — Toebeans re-applies its own
// palette and snow shader on arrival, which is where the look you liked lives.
// Three things come across:
//
//   1. heightmap.bin  — the terrain heights, 16-bit, raw. The game builds its
//                       own mesh from this and drives ground height off it.
//   2. the trail      — your spline, resampled at even spacing. This replaces
//                       the hand-tuned turn angles and GRADE_PROFILE numbers.
//   3. props          — NAME + TRANSFORM of every tree/rock, not their geometry.
//                       The game instantiates the palette-baked GLBs it already
//                       has in assets/slope/, matched by name. So you can paint
//                       with the raw Quaternius FBX/OBJ in Unity and the art
//                       style cannot drift, and the export stays tiny.
//
// COORDINATES
// Unity is left-handed (+Z forward); Three.js is right-handed (-Z forward). The
// conversion is z_three = -z_unity and rotY_three = -rotY_unity, and it is done
// HERE, once. Everything in the output file is already in Toebeans world space,
// so the loader needs no flips. The heightmap rows are written in reverse Z
// order for the same reason: row 0 is the SMALLEST z in Toebeans space.
//
// USAGE
//   Toebeans ▸ Set Export Folder…   (once — point it at <repo>/assets/world)
//   Toebeans ▸ Export World         (every time you want to see it in the game)
//
// REQUIREMENTS
// The Splines package (Window ▸ Package Manager ▸ Unity Registry ▸ "Splines").
// If it is not installed this file will not COMPILE — the console will say
// "The type or namespace name 'Splines' does not exist". Install it, don't
// debug it. If you would rather not use Splines at all, the exporter also
// accepts a plain GameObject named "Trail" whose children are waypoints.

using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.Splines;

namespace Toebeans
{
    public static class WorldExporter
    {
        // Where the export lands. This is <repo>/assets/world, which Vite serves
        // at the site root (client/vite.config.ts sets publicDir: "../assets"),
        // so the game fetches it from /world/manifest.json.
        private const string OutputFolderPrefKey = "Toebeans.ExportFolder";
        private const string DefaultOutputFolder =
            @"C:\Users\joshu\Toebeans-unity-world\assets\world";

        // How finely the trail is resampled, in world units. The game's route
        // distance is arc length along this line, so 1 unit keeps route distance
        // and the sampled index interchangeable.
        private const float TrailSampleSpacing = 1f;

        // Manifest format version. Bump when the shape of the JSON changes so the
        // loader can refuse an export it does not understand rather than
        // misreading it.
        private const int FormatVersion = 1;

        private static string OutputFolder =>
            EditorPrefs.GetString(OutputFolderPrefKey, DefaultOutputFolder);

        [MenuItem("Toebeans/Set Export Folder…", priority = 0)]
        private static void SetExportFolder()
        {
            var picked = EditorUtility.OpenFolderPanel(
                "Toebeans world export folder", OutputFolder, "");
            if (string.IsNullOrEmpty(picked)) return;
            EditorPrefs.SetString(OutputFolderPrefKey, picked);
            Debug.Log($"[Toebeans] Export folder set to {picked}");
        }

        [MenuItem("Toebeans/Export World", priority = 1)]
        private static void ExportWorld()
        {
            var terrain = Object.FindFirstObjectByType<Terrain>();
            if (terrain == null)
            {
                Fail("No Terrain in the scene. GameObject ▸ 3D Object ▸ Terrain.");
                return;
            }

            var folder = OutputFolder;
            Directory.CreateDirectory(folder);

            var data = terrain.terrainData;
            var origin = terrain.transform.position;

            // --- 1. Heightmap ------------------------------------------------
            // GetHeights returns normalised 0..1 indexed [z, x]. We write rows in
            // reverse z so the file is already in Toebeans' Z direction.
            var res = data.heightmapResolution;
            var heights = data.GetHeights(0, 0, res, res);
            var bytes = new byte[res * res * 2];
            var b = 0;
            for (var iz = res - 1; iz >= 0; iz--)
            {
                for (var ix = 0; ix < res; ix++)
                {
                    var v = (ushort)Mathf.Clamp(
                        Mathf.RoundToInt(heights[iz, ix] * 65535f), 0, 65535);
                    bytes[b++] = (byte)(v & 0xFF);
                    bytes[b++] = (byte)(v >> 8);
                }
            }
            File.WriteAllBytes(Path.Combine(folder, "heightmap.bin"), bytes);

            // Terrain extent in Toebeans space. X is unchanged; Z is negated, so
            // the Unity corner at max Z becomes the Toebeans corner at min Z.
            var size = data.size;
            var minX = origin.x;
            var minZ = -(origin.z + size.z);
            var baseY = origin.y;

            // --- 2. Trail ----------------------------------------------------
            var trail = SampleTrail(terrain, out var trailSource);
            if (trail.Count < 2)
            {
                Fail("No trail found. Draw one with GameObject ▸ Spline ▸ Draw " +
                     "Splines Tool, or make an empty GameObject named \"Trail\" " +
                     "with child objects as waypoints.");
                return;
            }

            // --- 3. Props ----------------------------------------------------
            var props = new List<Prop>();
            CollectTerrainTrees(terrain, props);
            CollectPlacedProps(props);

            // --- 4. Manifest -------------------------------------------------
            var json = new StringBuilder();
            json.Append("{\n");
            json.Append($"  \"version\": {FormatVersion},\n");
            json.Append($"  \"scene\": {J(terrain.gameObject.scene.name)},\n");
            json.Append("  \"terrain\": {\n");
            json.Append($"    \"minX\": {F(minX)}, \"minZ\": {F(minZ)},\n");
            json.Append($"    \"sizeX\": {F(size.x)}, \"sizeZ\": {F(size.z)},\n");
            json.Append($"    \"baseY\": {F(baseY)}, \"heightScale\": {F(size.y)},\n");
            json.Append($"    \"resolution\": {res},\n");
            json.Append("    \"encoding\": \"uint16-le\",\n");
            json.Append("    \"file\": \"heightmap.bin\"\n");
            json.Append("  },\n");

            json.Append("  \"trail\": {\n");
            json.Append($"    \"source\": {J(trailSource)},\n");
            json.Append($"    \"spacing\": {F(TrailSampleSpacing)},\n");
            json.Append($"    \"length\": {F((trail.Count - 1) * TrailSampleSpacing)},\n");
            json.Append("    \"x\": [");
            for (var i = 0; i < trail.Count; i++)
                json.Append(i == 0 ? F(trail[i].x) : "," + F(trail[i].x));
            json.Append("],\n    \"y\": [");
            for (var i = 0; i < trail.Count; i++)
                json.Append(i == 0 ? F(trail[i].y) : "," + F(trail[i].y));
            json.Append("],\n    \"z\": [");
            for (var i = 0; i < trail.Count; i++)
                json.Append(i == 0 ? F(trail[i].z) : "," + F(trail[i].z));
            json.Append("]\n  },\n");

            json.Append("  \"props\": [\n");
            for (var i = 0; i < props.Count; i++)
            {
                var p = props[i];
                json.Append("    {");
                json.Append($"\"model\": {J(p.Model)}, ");
                json.Append($"\"x\": {F(p.Position.x)}, ");
                json.Append($"\"y\": {F(p.Position.y)}, ");
                json.Append($"\"z\": {F(p.Position.z)}, ");
                json.Append($"\"rotY\": {F(p.RotationY)}, ");
                json.Append($"\"scale\": {F(p.Scale)}");
                json.Append(i == props.Count - 1 ? "}\n" : "},\n");
            }
            json.Append("  ]\n}\n");

            File.WriteAllText(Path.Combine(folder, "manifest.json"), json.ToString());

            var kb = (bytes.Length + json.Length) / 1024;
            Debug.Log(
                $"[Toebeans] Exported to {folder} — terrain {res}×{res} over " +
                $"{size.x:0}×{size.z:0} units, trail {(trail.Count - 1) * TrailSampleSpacing:0} " +
                $"units long ({trailSource}), {props.Count} props, ~{kb} KB total.");
        }

        // --- Trail sampling --------------------------------------------------

        /// Resamples the trail at even spacing. You draw the trail's PATH looking
        /// down at the terrain; its height is read off the terrain underneath, so
        /// there is nothing to line up vertically by hand.
        ///
        /// Spacing is measured HORIZONTALLY (X/Z only), because that is what the
        /// sim's route distance already is: route.ts stores grade as tan(pitch)
        /// and integrates it over route distance to get height, which only holds
        /// if route distance is the horizontal run. Measuring along the 3-D
        /// surface here would stretch the whole route on the steeps.
        private static List<Vector3> SampleTrail(Terrain terrain, out string source)
        {
            var raw = RawTrailPoints(out source);
            var result = new List<Vector3>();
            if (raw.Count < 2) return result;

            result.Add(Grounded(terrain, raw[0]));

            // `since` is how far we have travelled past the last emitted point.
            var since = 0f;
            for (var i = 1; i < raw.Count; i++)
            {
                var a = raw[i - 1];
                var b = raw[i];
                var seg = Vector2.Distance(new Vector2(a.x, a.z), new Vector2(b.x, b.z));
                if (seg <= 0.0001f) continue;

                // How far along THIS segment the last emitted point sat.
                var walked = 0f;
                while (since + (seg - walked) >= TrailSampleSpacing)
                {
                    walked += TrailSampleSpacing - since;
                    result.Add(Grounded(terrain, Vector3.Lerp(a, b, walked / seg)));
                    since = 0f;
                }
                since += seg - walked;
            }
            return result;
        }

        /// The trail as drawn, densely evaluated but not yet evenly spaced.
        /// Prefers a Splines SplineContainer; falls back to a GameObject named
        /// "Trail" whose children are waypoints in order.
        private static List<Vector3> RawTrailPoints(out string source)
        {
            var points = new List<Vector3>();

            var container = Object.FindFirstObjectByType<SplineContainer>();
            if (container != null && container.Splines.Count > 0)
            {
                source = "spline";
                // Dense uniform-t evaluation; the resampler above fixes spacing.
                const int steps = 4000;
                for (var i = 0; i <= steps; i++)
                {
                    var world = container.EvaluatePosition(0, i / (float)steps);
                    points.Add(ToToebeans(new Vector3(world.x, world.y, world.z)));
                }
                return points;
            }

            var waypoints = GameObject.Find("Trail");
            if (waypoints != null)
            {
                source = "waypoints";
                foreach (Transform child in waypoints.transform)
                    points.Add(ToToebeans(child.position));
                return points;
            }

            source = "none";
            return points;
        }

        /// Drops a point onto the terrain surface. Height is the terrain's, not
        /// whatever height the point happened to be drawn at.
        private static Vector3 Grounded(Terrain terrain, Vector3 toebeansPoint)
        {
            // SampleHeight wants Unity space, so undo the Z flip for the query.
            var unity = new Vector3(toebeansPoint.x, 0f, -toebeansPoint.z);
            var y = terrain.SampleHeight(unity) + terrain.transform.position.y;
            return new Vector3(toebeansPoint.x, y, toebeansPoint.z);
        }

        // --- Props -----------------------------------------------------------

        private readonly struct Prop
        {
            public readonly string Model;
            public readonly Vector3 Position;
            public readonly float RotationY;
            public readonly float Scale;

            public Prop(string model, Vector3 position, float rotationY, float scale)
            {
                Model = model;
                Position = position;
                RotationY = rotationY;
                Scale = scale;
            }
        }

        /// Trees painted with the terrain's tree brush. Their positions are
        /// normalised to the terrain, so they scale with it.
        private static void CollectTerrainTrees(Terrain terrain, List<Prop> into)
        {
            var data = terrain.terrainData;
            var prototypes = data.treePrototypes;
            if (prototypes.Length == 0) return;

            var origin = terrain.transform.position;
            var size = data.size;

            foreach (var tree in data.treeInstances)
            {
                var proto = prototypes[tree.prototypeIndex].prefab;
                if (proto == null) continue;

                var unity = new Vector3(
                    origin.x + tree.position.x * size.x,
                    origin.y + tree.position.y * size.y,
                    origin.z + tree.position.z * size.z);

                into.Add(new Prop(
                    proto.name,
                    ToToebeans(unity),
                    -tree.rotation * Mathf.Rad2Deg,
                    tree.heightScale));
            }
        }

        /// Anything you drag into the scene by hand under a GameObject named
        /// "Props" — cabins, hero rocks, a lift tower. One export entry per
        /// direct child, named after the child (rename it to match a GLB in
        /// assets/slope/, or the loader will warn and skip it).
        private static void CollectPlacedProps(List<Prop> into)
        {
            var root = GameObject.Find("Props");
            if (root == null) return;

            foreach (Transform child in root.transform)
            {
                if (!child.gameObject.activeInHierarchy) continue;
                // Unity appends " (1)", " (2)" etc. to duplicates — strip it so
                // twenty copies of one rock still resolve to one model name.
                var name = child.name;
                var paren = name.IndexOf(" (", System.StringComparison.Ordinal);
                if (paren > 0) name = name.Substring(0, paren);

                into.Add(new Prop(
                    name,
                    ToToebeans(child.position),
                    -child.eulerAngles.y,
                    child.localScale.y));
            }
        }

        // --- Helpers ---------------------------------------------------------

        /// Unity (left-handed, +Z forward) → Toebeans/Three.js (right-handed,
        /// -Z forward). Negating Z alone flips handedness without mirroring the
        /// world: a tree ahead-and-right in Unity stays ahead-and-right here.
        private static Vector3 ToToebeans(Vector3 unity) =>
            new Vector3(unity.x, unity.y, -unity.z);

        /// Invariant-culture float, so a machine with comma decimals cannot
        /// silently write JSON the browser reads as garbage.
        private static string F(float v) =>
            v.ToString("0.####", CultureInfo.InvariantCulture);

        private static string J(string s) =>
            "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

        private static void Fail(string message)
        {
            Debug.LogError("[Toebeans] " + message);
            EditorUtility.DisplayDialog("Toebeans export failed", message, "OK");
        }
    }
}
