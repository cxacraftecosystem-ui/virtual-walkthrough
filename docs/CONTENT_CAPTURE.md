# Content capture guide — textiles, hand blocks, text

A practical field guide for the workshop team: how to photograph printed textiles for the
**"Examine closely"** deep-zoom viewer, how to scan wooden hand blocks with a phone, how to write
the curatorial text, and how to load everything through the admin (`/admin` → **Capture tools**).

> Nothing in the museum should state a fact that the workshop has not supplied. Leave a field
> empty rather than guess — the museum only shows the fields you fill in, and anything still
> marked *Placeholder* is labelled as such to visitors.

---

## 1. Photographing textiles

### What we need
| | Minimum | Good | Best |
|---|---|---|---|
| Long side of the final image | 4 000 px | 8 000 px | 12 000 – 16 000 px (stitched) |
| Resolution on the cloth | 100 px/cm | 200 px/cm | 300+ px/cm (individual threads visible) |
| File | JPEG quality 95 | 16-bit TIFF → JPEG q95 export | RAW → TIFF master, JPEG/PNG export for upload |

The browser tiler accepts JPEG, PNG and WebP up to 16 384 px on the long side (larger files are
reduced automatically, and the admin says so). Keep the TIFF/RAW master in the archive.

### Set-up
- **Flat and square.** Lay the cloth on a clean, neutral board (grey felt or acid-free card) or
  hang it on a vertical board with magnets/pins through the selvedge only. Never stretch it. Camera
  sensor parallel to the cloth — use a spirit level on both the board and the camera back.
- **Lens.** A 50–100 mm macro or standard prime at f/8 (sharpest aperture, enough depth for the
  weave). Avoid wide angles (distortion at the edges).
- **Tripod or copy stand**, remote release or 2 s timer, mirror lock-up / electronic shutter,
  image stabilisation **off** on a tripod. ISO 100.
- **Focus** manually with live-view magnified on the threads, not the print.

### Light
- **Two identical lights at 45°**, one each side, same distance, same height, daylight-balanced
  (5000–5600 K, CRI ≥ 95). Check evenness: a grey card in each corner should read within ⅓ stop.
- Switch off room lights and block window light — mixed colour temperatures cannot be corrected.
- **Cross-polarisation** (recommended for glazed, starched or silk-sheen cloth and any glossy ink):
  put linear polariser film on both lights, all in the same orientation, and a circular polariser
  on the lens. Rotate the lens filter until reflections from a shiny test object (a spoon) vanish.
  Costs ~1½ stops of light; it removes glare and shows the true dye colour.
- **Raking light** (one light at 10–15°, extra shot, optional): shows the texture of the weave and
  the relief of the print. Upload it as a separate artwork image if curators want it.

### Colour
- Put an **X-Rite ColorChecker** (or similar colour card) and a **ruler with cm marks** at the edge
  of the frame in a first reference shot under the same light, then remove them (or crop later).
- Custom white balance from the card's neutral patch; build a camera profile from the chart if the
  software allows (Lightroom/Capture One/darktable/RawTherapee).
- Export in **sRGB** (the museum and browsers assume sRGB). Don't boost saturation or clarity.

### Large pieces: stitching
When the cloth is bigger than one sharp frame, shoot a grid with **30 % overlap** without moving the
lights (move the cloth or the camera on a rail, keeping the camera-to-cloth distance fixed) and stitch
in PTGui, Hugin (free), Photoshop Photomerge or Affinity. Use "planar/flat" projection. Check seams at
100 %.

### Measure
Measure the **width of the photographed area** in cm (edge to edge of what is in the final crop). Type it
into the Deep zoom tool — it drives the centimetre scale bar in the viewer and hangs the work 1:1 in
the gallery (`physicalWidth`).

### File naming
`<accession-or-id>_<short-title>_<view>.jpg`, e.g. `HBP-014_indigo-dabu-length_front.jpg`. No spaces
or personal names in file names.

---

## 2. Scanning hand blocks with a phone

Wooden blocks are small, matte and richly carved — a good photogrammetry subject. Use
**Polycam** (iOS/Android) or **RealityScan** (iOS/Android, free) in **photo mode** (not LiDAR mode —
LiDAR is too coarse for 1–2 mm carving).

### Set-up
- Diffuse, even light: an overcast day outdoors in shade, or two soft boxes. No hard shadows, no sun.
- Put the block on a **turntable** (or a lazy Susan) on a plain, textured mat (newspaper works
  — the app needs texture around the object to track). Do not use a glossy table.
- Wipe dust off; do not oil or polish the block before scanning (shine breaks photogrammetry).
- Place a ruler next to it for the first photos, so the scale can be verified.

### Capture
- 60–150 photos: three rings (low ≈ 15°, middle ≈ 45°, high ≈ 70°), a photo every ~10°, keeping the
  block filling ~60 % of the frame, then close-ups of the carved face.
- Then **turn the block over** and repeat for the handle side; RealityScan/Polycam can merge both
  (or scan the carved face and sides only — visitors mostly see the printing face).
- Keep focus locked on the block, exposure constant, no motion blur (brace your elbows).

### Processing & export
- Polycam: *Process → Full/Raw detail*, crop the ground away, **Export → GLTF/GLB**.
- RealityScan: *Upload → Process in the cloud*, crop, **Export → GLB** (or glTF with textures).
- Don't decimate in the app — the museum's importer does it more carefully (next section).

---

## 3. Writing the curatorial text

Each artwork / block has these fields (all optional except the title). Write them in plain English;
Hindi and Bengali translations have their own fields (*Translations* group in the Content editor).

| Field | Guidance |
|---|---|
| **Title** | The name the workshop uses for the piece. |
| **Artisan** | Only with the maker's consent, spelt as they write it. Link a *Maker profile* if one exists. |
| **Region / Material / Technique / Year** | Short facts the workshop can vouch for (e.g. "Cotton, natural indigo", "Dabu mud-resist, two blocks"). Leave "Year" empty if unknown — never estimate. |
| **Description** | 60–120 words: what the visitor is looking at and what to notice (the repeat, the misregistration of the second block, the resist crackle). Present tense. |
| **Context** | 60–150 words: how and by whom this kind of textile is made and used today — only what the workshop has told you. |
| **Alt text** | One sentence describing the image for blind visitors ("A long cotton panel printed in indigo with rows of small flowers"). |
| **Metadata** | Accession number, dimensions, photographer credit, copyright/licence. |

Style: short sentences, no superlatives, no unexplained jargon (explain *dabu*, *ajrakh*, *bagru*
once if you use them), cite oral sources as "according to …". Ask the artisan to read their own entry
before it goes live. When the real text and image are in, untick **Placeholder**.

---

## 4. Loading everything through the admin

Sign in at `/admin` (curator role or higher). All processing happens **in your browser**, so use a
desktop Chrome/Edge with ≥ 8 GB RAM for large photos.

### A. Textile photograph → deep zoom
1. **Capture tools → Deep zoom.** Choose the **artwork**, then the photograph.
2. Check the pixel size and estimated tile count; choose *JPEG* (universal) or *WebP* (≈ 30 % smaller),
   quality 85 is a good default. Enter the **physical width in cm** if measured.
3. **Create deep zoom & assign.** The photo is sliced into a Deep Zoom Image pyramid (254 px tiles,
   1 px overlap) in a background worker and uploaded in parallel (direct to S3 when configured,
   otherwise to the server's media store) with progress. The server then writes `image.dzi`, records
   the pyramid in the media library and the artwork's `deepZoom` field is set.
4. A preview opens below. In the museum, visitors open it with **Examine closely** in the info panel or
   by **double-clicking** the artwork.
5. For the wall image itself (what hangs in 3D), also upload a ~2 048 px JPEG through **Media** and set
   the artwork's **Image**. Deleting the pyramid's media record deletes all of its tiles.

### B. Hand-block scan → 3D model
1. **Capture tools → 3D scan import.** Choose the `.glb` (or the `.gltf` together with its `.bin` and
   texture files).
2. Set the **triangle budget** (40 k recommended for a block), **max texture** (2 048 px) and the
   block's **real height in cm** as it lies on the table (Y is up). Pick *Z up* only if the preview
   shows it lying on its side.
3. **Optimise.** The model is de-duplicated, welded, simplified with meshoptimizer, given normals if
   missing, its textures resized and re-encoded as WebP, re-centred with its bottom at 0 and scaled to
   metres, then meshopt-compressed. Check the **before/after table** and the **3D preview** (grid =
   10 cm).
4. **Upload & assign** to an **Exhibit** (the hand-block table beside a hero textile) or a **Scene
   object**. This sets `model` and `modelScale: 1`. The museum loads meshopt + WebP glTF natively.
5. Fill in the exhibit's text (section 3) and untick *Placeholder*.

### Checklist before publishing
- [ ] Colours checked against the real cloth on a calibrated screen
- [ ] Physical width entered (scale bar shows plausible cm)
- [ ] 3D block the right size next to the 10 cm grid; carving legible in the preview
- [ ] Text read and approved by the workshop / artisan; translations reviewed by a native speaker
- [ ] Credits and licence in *Metadata*
- [ ] *Placeholder* unticked

---

## Reference: the demo pyramids

The five hero **placeholder** textiles ship with generated pyramids in `public/deepzoom/hero-0N/`
(`node scripts/generate-deepzoom.mjs`, ~9 000 px long side, fine weave detail). They exist only so the
viewer can be demonstrated; they are generic, make no cultural claim, and are replaced by assigning a
real photograph to the artwork as described above.
