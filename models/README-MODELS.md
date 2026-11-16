# 🪨🌿 Custom 3D Tank Models Folder (`models/`)

Place your exported **`.glb` (glTF Binary)** 3D models in this folder!

## Best Export Settings in Blender (`File → Export → glTF 2.0 (.glb)`):
1. **Format:** `glTF Binary (.glb)` (packs meshes + textures + animations into 1 single file!)
2. **Include:** Check `Selected Objects` (if exporting only tank objects, without Blender's default Camera/Light)
3. **Transform:** Keep `+Y Up` checked
4. **Geometry:** Check `Apply Modifiers`, `UVs`, `Normals`
5. **Materials:** Use Blender `Principled BSDF` (Base Color, Roughness, Metallic, Emissiontextures pack automatically into `.glb`!)
6. **Animation:** Check `Animations` if you animated swaying plants, bubbles, crabs, or treasure chests!

## Two Ways to Use for Tank Environment:
- **Way 1 (1-File Full Tank):** Export your whole tank interior (sand, rocks, plants, corals) as **`models/tank.glb`** and upload it here. The Aquarium will automatically load `models/tank.glb` and replace the old rocks & plants!
- **Way 2 (Separate Props):** Export `rock1.glb`, `plant1.glb`, etc. into `models/` and list their positions in `js/environment-config.js`!

---

# 🐠🪸🐢⭐ Custom 3D Sea Creatures + Paper Coloring Sheets (`models/creatures/`)

See **`models/creatures/UV_MAPPING_GUIDE.png`** for the visual diagram!

You can replace any of the 6 built-in species (`clownfish`, `angelfish`, `seahorse`, `turtle`, `jellyfish`, `starfish`) OR add brand-new species (`dolphin`, `manta_ray`, etc.) using `js/custom-creatures-config.js`.

## Step-by-Step Blender UV Workflow (How 1 Paper Coloring Sheet Maps to 3D):

### A) Side-View Creatures (Fish & Seahorse)
1. Model your Fish or Seahorse in Blender. Press **`Numpad 1` (Front Orthographic)**.
2. Orient the **Nose / Snout pointing LEFT (`-X`)** and **Dorsal / Crown pointing UP (`+Z` in Blender)**.
3. Enter **Edit Mode (`Tab`)** → Select ALL faces (**`A`**) → Press **`U`** → Choose **`Project from View`**.
   - Why? Because both the Left and Right sides of the 3D mesh overlap cleanly onto the exact same 2D silhouette! When a child colors ONE fish on paper, BOTH sides of the 3D fish get colored seamlessly with zero blank spots!
4. Open the **UV Editor**: scale (`S`) and center (`G`) the UV island inside the `[0..1, 0..1]` UV square leaving ~8–10% white margin around the edges.
5. In the UV Editor menu click **`UV → Export UV Layout`**:
   - Size: **`512 x 512` PNG**
   - (Optional) Open in Photoshop / Illustrator / Krita / Canva to draw thick, kid-friendly black coloring outlines (`#111827`) on a pure white background (`#ffffff`), and save as **`models/creatures/<species>_template.png`** (e.g. `seahorse_template.png`).
6. Export your 3D model via **`File → Export → glTF 2.0 (.glb)`** as **`models/creatures/<species>.glb`** (e.g. `seahorse.glb`).
   - *Want 3D eyes to keep their own glossy Blender material instead of paper crayon texture?* Name the eye material **`Eye`** or **`Keep_Eye`** in Blender!
   - *Animated Armature?* If your `.glb` includes skeletal animations (`Swim`), `THREE.AnimationMixer` plays them automatically! If your `.glb` is a static mesh, the engine automatically adds a smooth swimming wave!

### B) Top-View Creatures (Sea Turtle, Starfish, Manta Ray)
1. Press **`Numpad 7` (Top Orthographic)** in Blender.
2. Point the **Head / Top Star Arm UP (`+Y` in Blender)**.
3. Enter **Edit Mode (`Tab`)** → Select ALL faces (**`A`**) → Press **`U`** → **`Project from View`**.
4. Export **`512 x 512`** PNG layout as **`models/creatures/<species>_template.png`** and `.glb` as **`models/creatures/<species>.glb`**.
   - In `js/custom-creatures-config.js`, `turtle` already uses `facingOffsetDegY: -90` so a top-view model facing `+Y` swims forward along `+X` automatically!

### C) Instant Live Browser Test (Before Uploading to GitHub!)
- Open **`/scan.html`** → scan or load a sample sheet → on **Step 3 (3D Preview)** click **`📦 Test .GLB`** and select your `.glb` file to inspect the UV wrap in real-time 3D!
- Open **`/sheets.html`** once `<species>_template.png` is inside `models/creatures/` — the app automatically wraps your `512x512` template inside the **4-Corner Fiducial Frame + 6-bit Species Code Dots + QR Code** ready to print on A4!

