# Artwork images

All images in this folder are **placeholders**: procedurally generated stand-ins
used for layout and lighting calibration. They do not depict any documented
traditional design and make no cultural or historical claim. Replace them with the
workshop's photographed textiles.

## Replacing an image

1. Drop the new image into this folder (JPG recommended; sRGB; long edge 2048–4096 px).
   **Any aspect ratio works**: the frame, mat and spotlight are generated from the
   image's intrinsic size, so nothing else needs to change.
2. Either keep the same filename (e.g. `hero-01.jpg`), or point the entry at the new
   file in `src/museum/config/artworks.ts` (`image: '/artworks/<file>'`).
3. In the same entry, fill in the real metadata (`title`, `artisan`, `region`,
   `material`, `technique`, `year`, `description`) and remove `placeholder: true`
   so the UI stops labelling it as a placeholder.
4. Optional: set `physicalWidth` (metres) to show the piece at true scale, or adjust
   `maxWidth` / `maxHeight` to change the size it is fitted to.

## Regenerating the placeholders

    node scripts/generate-placeholders.mjs

(This uses the Vite dev server and headless Chrome via puppeteer-core; set
`CHROME_PATH` if Chrome is not at the default Windows location, and `ONLY=hero-01.jpg`
to render a subset.) Running it overwrites same-named files here, so do not
run it after the real images have been added under those names.
