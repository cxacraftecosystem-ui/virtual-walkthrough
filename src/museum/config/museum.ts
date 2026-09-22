/**
 * MUSEUM CONSTANTS — single source of truth for architecture & experience.
 *
 * Units: 1 Three.js unit = 1 metre.
 * Reference: "3D Virtual Walkthrough — Design Concept Note", drawing GA-101 (30' x 75').
 *
 * World axes
 *   +x = east,  -x = west
 *   +y = up
 *   +z = south (entrance side), -z = north (far end / product wall)
 *
 *   v3 master plan: the whole compound is ONE rectangular footprint (a perfect cuboid
 *   62 m × 53 m × 10 m), organised on a 3 × 2 grid around the GA-101 spine:
 *
 *        x: -31 ········· -10 ······· +10 ········· +31
 *   z -33 ┌───────────────┬───────────┬───────────────┐
 *         │  GALLERY D    │ CRAFT COURT│  DYE GARDEN   │
 *         │  (regional)   │ reveal wall│  COURTYARD    │
 *         │               │  GALLERY   │  (open air)   │
 *         │               │  A │P│ B/C │               │
 *   z  -2 ├───────────────┤    │S│     ├───────────────┤
 *         │  IMMERSIVE    │  RECEPTION │  CRAFT        │
 *         │  THEATRE      ├────────────┤  WORKSHOP     │
 *         │               │GRAND ATRIUM│               │
 *   z 20  └───────────────┴──── ▲ ─────┴───────────────┘
 *                            entrance
 */

export const FT = 0.3048

export const MUSEUM = {
  gallery: {
    /**
     * GA-101 specifies 30' × 60'. v3 (client request: "bigger and grander") scales the same
     * plan to 20 m × 33 m (~66' × 108'), keeping its organisation: central passage,
     * Galleries A/B/C either side, reveal wall and craft court at the far end.
     */
    width: 20,
    length: 33,
    /** Clear height to the underside of the timber ceiling. */
    ceilingHeight: 5.6,
  },

  reception: {
    /** GA-101: 10' × 15'. v3: a proper reception hall, 10 m × 8 m. */
    width: 10,
    length: 8,
    /** Still lower than the gallery: compression before release. */
    ceilingHeight: 3.8,
  },

  walls: {
    exteriorThickness: 0.3,
    /** Wall between reception and main gallery (contains the passage mouth). */
    dividerThickness: 0.2,
    partitionThickness: 0.3,
    /** Partitions stop short of the ceiling so skylight daylight spills over them. */
    partitionHeight: 4.4,
    /** Recessed shadow gap at wall base (museum detail). */
    shadowGapHeight: 0.022,
  },

  /** Central tunnel passage — GA-101 shows it running ~45 ft up the axis from the entrance. */
  passage: {
    clearWidth: 3.2,
    length: 18,
  },

  /** Short return walls on the perimeter that split each side into two display bays (GA-101). */
  bayDivider: {
    length: 1.8,
    thickness: 0.3,
  },

  /** Free-standing double-sided display walls, one centred in each gallery bay (v3). */
  island: {
    length: 3.6,
    thickness: 0.3,
    height: 3.2,
  },

  /**
   * REVEAL WALL — intentional modification to GA-101.
   * A free-standing screen wall at the passage exit that interrupts the axial sightline.
   */
  revealWall: {
    width: 7.6,
    height: 4.4,
    thickness: 0.5,
    /** Clear distance between the passage exit and the wall's south face. */
    gapFromPassage: 2.2,
    /** Horizontal offset of the wall centre from the gallery axis (0 = centred). */
    offsetX: 0,
  },

  entrance: {
    doorWidth: 1.8,
    doorHeight: 2.5,
  },

  /** Central longitudinal skylight lantern. */
  skylight: {
    /** Clear width of the ceiling opening (spans passage + partition tops). */
    width: 5.6,
    /** z-extent of the opening (south → north). */
    startZ: -0.6,
    endZ: -32.4,
    /** Height of the plaster light-well upstand above the ceiling plane. */
    wellHeight: 1.3,
    /** Rise of the shallow glazed gable above the well. */
    ridgeRise: 0.45,
    /** Spacing of transverse glazing bars. */
    mullionSpacing: 1.6,
    /** Spacing of the white steel beams spanning the opening. */
    beamSpacing: 3.2,
    glassTint: '#d9ecf0',
    glassOpacity: 0.16,
  },

  display: {
    /** PDF: "clean eye-level mounting (1.6m center)". */
    artworkCenterHeight: 1.6,
    /** Distance an artwork stands off its wall (hanging cleats). */
    wallStandOff: 0.004,
    /** Default horizontal gap between an artwork edge and its hand-block table. */
    tableGap: 0.45,
  },

  visitor: {
    eyeHeight: 1.62,
    collisionRadius: 0.28,
    /** Unhurried museum pace (m/s). */
    walkSpeed: 1.35,
    briskSpeed: 2.3,
    /** Seconds-ish time constant for acceleration smoothing (higher = snappier). */
    acceleration: 7,
    /** Vertical field of view (deg). Kept moderate to avoid wide-angle distortion. */
    fov: 58,
    /** Minimum horizontal FOV on narrow (portrait) screens. */
    minHorizontalFov: 62,
    lookSensitivity: 0.0032,
    lookDamping: 14,
    pitchLimitDeg: 55,
    /** Visitors now arrive in the Grand Atrium, just inside the main entrance, facing north. */
    start: { x: 0, z: 18.6, yawDeg: 0, pitchDeg: 2 },
  },

  /**
   * v2 EXPANSION WINGS (not in GA-101). The GA-101 gallery + reception remain the
   * core; the new wings wrap around them. Coordinates are interior faces (metres).
   */
  wings: {
    /** The compound envelope: a perfect cuboid (interior faces of the perimeter walls). */
    shell: { minX: -31, maxX: 31, minZ: -33, maxZ: 20.2, height: 10 },
    atrium: { minX: -10, maxX: 10, minZ: 8.5, maxZ: 20.2, height: 9, entranceWidth: 3.2, entranceHeight: 3.6 },
    theatre: { minX: -31, maxX: -10.3, minZ: -2, maxZ: 20.2, height: 8 },
    galleryD: { minX: -31, maxX: -10.3, minZ: -33, maxZ: -2.3, height: 6 },
    workshop: { minX: 10.3, maxX: 31, minZ: -2, maxZ: 20.2, height: 7 },
    courtyard: { minX: 10.3, maxX: 31, minZ: -33, maxZ: -2.3, wallHeight: 10 },
    /** Doorways between spaces (clear width × height; x or z locates the opening centre). */
    doors: {
      receptionToAtrium: { width: 3.2, height: 3.2 },
      atriumToTheatre: { z: 17.4, width: 2.4, height: 3.2 },
      atriumToWorkshop: { z: 14.3, width: 3.4, height: 3.8 },
      workshopToCourtyard: { x: 20.6, width: 3.6, height: 3.6 },
      galleryToGalleryD: { z: -16.2, width: 2.8, height: 3.4 },
      galleryToCourtyard: { z: -16.2, width: 2.8, height: 3.4 },
      theatreToGalleryD: { x: -14.5, width: 2.4, height: 3.2 },
    },
  },
} as const

/* ------------------------------------------------------------------ */
/* Derived key coordinates (computed, never hand-typed elsewhere)      */
/* ------------------------------------------------------------------ */

const g = MUSEUM.gallery
const r = MUSEUM.reception
const w = MUSEUM.walls

export const KEY = {
  gx: g.width / 2, // 10
  gzNorth: -g.length, // -33
  gzSouth: 0,
  rx: r.width / 2, // 5
  rzNorth: w.dividerThickness, // 0.2
  rzSouth: w.dividerThickness + r.length, // 8.2
  passageHalf: MUSEUM.passage.clearWidth / 2, // 1.6
  partitionOuter: MUSEUM.passage.clearWidth / 2 + w.partitionThickness, // 1.9
  passageNorthZ: -MUSEUM.passage.length, // -18
  bayDividerZ: -MUSEUM.passage.length / 2, // -9
  get bayCenterX() {
    return (this.partitionOuter + this.gx) / 2 // 5.95
  },
  /** Track rails: one over each aisle either side of the bay island. */
  get aisleInnerX() {
    return this.partitionOuter + (this.bayCenterX - MUSEUM.island.thickness / 2 - this.partitionOuter) / 2 // ~3.85
  },
  get aisleOuterX() {
    return this.gx - (this.gx - this.bayCenterX - MUSEUM.island.thickness / 2) / 2 // ~8.05
  },
  get revealSouthZ() {
    return this.passageNorthZ - MUSEUM.revealWall.gapFromPassage
  },
  get revealNorthZ() {
    return this.revealSouthZ - MUSEUM.revealWall.thickness
  },
  get revealCenterZ() {
    return this.revealSouthZ - MUSEUM.revealWall.thickness / 2
  },
}

export type Vec3 = [number, number, number]
