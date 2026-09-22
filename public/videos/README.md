# Films (`public/videos/`)

Every screen in the museum is data-driven from `src/museum/config/videos.ts` (`VIDEOS`).
The files here are **generated placeholders** (`node scripts/generate-placeholder-videos.mjs`)
for layout, lighting and audio calibration only. Replace them with the workshop's footage.

| id | screen | file | audio |
|---|---|---|---|
| `welcome-film` | Atrium LED wall | `welcome-film.webm` + `.jpg` | stereo, spatial (one source at the screen) |
| `theatre-film` | Theatre curved screen | `theatre-film.webm` + `.jpg` | **5.1**, surround (8 virtual speakers) |
| `process-film-1` | Workshop, west wall | `process-film-1.webm` + `.jpg` | stereo, spatial |
| `process-film-2` | Workshop, south wall | `process-film-2.webm` + `.jpg` | stereo, spatial |

## Replacing a film

1. Encode the footage (see below) and drop it in this folder, e.g. `theatre-film.mp4`.
2. Export a poster frame as JPG (same aspect ratio; ~1600 px wide is plenty).
3. In `src/museum/config/videos.ts` point `src` / `poster` at the new files and set
   `placeholder: false`; replace the placeholder `description` (it appears in the info panel).
4. Nothing else: the screen reads the film's intrinsic aspect ratio (poster first, 16:9
   fallback) and sizes its height from the configured `width`.

If a file is missing or cannot be decoded the screen shows the poster, or a deliberate
"Film unavailable" card — it never breaks the scene.

## Recommended encoding

Pick one of:

- **MP4 — H.264 High profile + AAC-LC** (widest compatibility, incl. Safari/iOS).
- **WebM — VP9 + Opus** (smaller at equal quality; what the placeholders use).

For all films:

- 1080p max for the theatre, 720p–1080p elsewhere; **≤ 8 Mbps** video (4–6 Mbps is plenty for
  1080p30 documentary footage); constant frame rate (25 or 30 fps).
- **Keyframe every 2 s** (`-g 60` at 30 fps) so looping and seeking are instant.
- MP4: `-movflags +faststart` so playback starts before the whole file has downloaded.
- sRGB / Rec.709, 8-bit 4:2:0 (`yuv420p`). No HDR.
- Loudness around −23 LUFS integrated; the museum sets the per-film level via `audio.volume`.

Example (ffmpeg):

```sh
# stereo film
ffmpeg -i master.mov -c:v libx264 -profile:v high -preset slow -crf 20 -maxrate 8M -bufsize 16M \
  -g 60 -keyint_min 60 -pix_fmt yuv420p -c:a aac -b:a 192k -ac 2 -movflags +faststart process-film-1.mp4

# theatre, 5.1
ffmpeg -i master.mov -c:v libx264 -profile:v high -preset slow -crf 19 -maxrate 8M -bufsize 16M \
  -g 60 -keyint_min 60 -pix_fmt yuv420p -c:a aac -b:a 384k -ac 6 -channel_layout 5.1 \
  -movflags +faststart theatre-film.mp4
```

The **theatre film should be 5.1** (AAC 5.1, or Opus 5.1 in WebM). A stereo file also works:
it is up-mixed (see below).

## How the speaker layout works

`audio.mode` in each film's config:

- `'spatial'` — the film's sound comes from one HRTF-panned point at the screen centre.
  `refDistance` / `rolloff` / `maxDistance` set how quickly it fades as the visitor walks away.
- `'surround'` — `audio.speakers` lists virtual loudspeakers (`FL FR C LFE SL SR BL BR`) at world
  positions (metres). Each is an HRTF panner; the visible cabinets in the theatre are drawn from
  the same list (front speakers sitting behind the curved screen are hidden, as in a real cinema
  with a perforated screen). A subtle generated room reverb is added (`audio.reverb`, default 0.16).
- `'none'` — silent film.

Channel routing for `'surround'`:

| source | routing |
|---|---|
| 5.1 (`L R C LFE Ls Rs`) | 1:1 → FL FR C LFE SL SR (BL/BR fall back to SL/SR if missing) |
| 7.1 (`… Lb Rb`) | 1:1 → … BL BR |
| stereo | L → FL + SL + BL, R → FR + SR + BR, (L+R)·0.7 → C, low-passed mono → LFE |

The channel count is detected automatically from the decoded stream; set `audio.channels`
(`2`, `6` or `8`) to force it. If the room has no speaker for a channel, it folds into its
neighbours (e.g. no C → FL+FR).

Audio starts muted (browser autoplay rules); the first click / key press anywhere unlocks it,
after which the HUD sound toggle fades everything (films and ambience) in and out. Films keep
playing silently while sound is off, and the ambience ducks while a film is audible.

## Placeholder generator notes

`scripts/generate-placeholder-videos.mjs` renders the films offline in headless Chrome with
WebCodecs (VP9 + Opus) and a small built-in WebM muxer, then re-loads every file and checks
duration, size, channel count and — for the theatre film — that each speaker test tone arrives
on the right channel. Chrome's Opus encoder is stereo-only, so the 5.1 track is written as a
4-stream Opus multistream (channel-mapping family 1), which every Chromium/Firefox decodes as
true 5.1. Safari does not play WebM/Opus reliably: ship MP4/AAC for the final films.
