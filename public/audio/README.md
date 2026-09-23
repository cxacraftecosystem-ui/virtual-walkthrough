# Audio

The museum's soundscape is **fully synthesised** by default (see
`src/museum/media/soundscape.ts` and `src/museum/media/soundscape/`). Every file listed
below is **optional**: drop in a recording and it replaces the synthesis for that zone,
site or floor. Missing files are simply skipped. The browser requests each file once,
after the first click or key press, so a 404 in the network panel is expected and
harmless.

All recordings play through the shared audio graph, so the HUD sound toggle, the fade
when the tab is hidden, and the ducking while a film plays apply to them too.

## Zone ambience: `ambience/<zoneId>.mp3`

A looped bed that replaces that zone's synthesised ambience and events. Make it quiet and
seamlessly loopable; it plays at about 0.26 gain, non-positional.

| zoneId | Synthesised default |
| --- | --- |
| `workshop` | soft wooden block-thumps at each printing table, occasional cloth rustle, room tone |
| `atrium` | airy high room tone with a long reverb, very low indistinct distant murmur |
| `shop` | soft room tone |
| `library` | very hushed room tone, faint occasional paper-like rustles |
| `gallery-a` `gallery-b` `gallery-c` `gallery-d` `passage` `reveal` `reception` | hushed room tone with gentle reverb (shared) |
| `theatre` | silent (only the film audio plays), no file is looked up |

Gallery-type zones (`gallery-a` to `gallery-d`, `passage`, `reveal`, `reception`, and any
future zone without its own sound) use the first file found in this order:

1. `ambience/<zoneId>.mp3` (just that zone)
2. `ambience/galleries.mp3` (all gallery-type zones)
3. `ambience.mp3` (the legacy single ambience file, kept as the gallery fallback)
4. the synthesised room tone

## Open-air sites and time of day

The courtyard (`courtyard`) and the forecourt and lawns outside the atrium facade
(`forecourt`) follow the store's `timeOfDay` (`morning`, `midday`, `golden`, `dusk`,
`night`; any other value is treated as `midday`). Changing it crossfades over about 4 s.
You also hear them faintly, and muffled, through open doorways. The atrium hears the
forecourt the most.

Lookup order per site and time of day:

1. `ambience/<site>-<timeOfDay>.mp3` (e.g. `ambience/courtyard-night.mp3`)
2. `ambience/<site>.mp3`
3. synthesis

A recording replaces all of that site's synthesis for that time of day, including the
courtyard's trickling water.

## Footsteps: `footsteps/<material>-1.mp3` … `-4.mp3`

Short one-shot steps. One is picked at random per step, with a slight pitch variation
and a small left/right pan. The files are probed in order from `-1`, and probing stops at
the first missing number. If any file exists for a material, it replaces the
synthesised steps on that material.

| material | zones |
| --- | --- |
| `oak` | galleries A–D, passage, reveal / craft court, reception, shop, library (and unknown zones) |
| `stone` | atrium, courtyard |
| `concrete` | workshop |
| `carpet` | theatre (very muffled) |

Step rate follows walking speed: about 1.8 steps/s at normal pace, about 2.4 when brisk
(Shift), and none below 0.25 m/s.

## Debugging

`window.__soundscape` shows the live state: `zone`, `channel`, `timeOfDay`, `material`,
`speed`, `stepsPerSec`, `steps`, `stepsByMaterial`, bus `levels`, which `sources` are
synth or file, event counters and the `files` probe results.
