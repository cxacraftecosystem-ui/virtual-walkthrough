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
 *   Main gallery interior:  x ∈ [-15', +15'],  z ∈ [-60', 0]
 *   Reception interior:     x ∈ [-5', +5'],    z ∈ [divider, divider + 15']
 */

export const FT = 0.3048

export const MUSEUM = {
  gallery: {
    /**
     * GA-101 specifies 30 ft. Widened to 36 ft at the client's request (v2) for more
     * generous circulation in the side bays; every other element derives from this.
     */
    width: 36 * FT,
    /** 60 ft of the 75 ft overall is main gallery (15 ft is reception) — GA-101 */
    length: 60 * FT,
    /** Clear height to the underside of the timber ceiling. Not specified in PDF — museum-typical 4.6 m (~15 ft). */
    ceilingHeight: 4.6,
  },

  reception: {
    /** 10 ft — GA-101 */
    width: 10 * FT,
    /** 15 ft — GA-101 */
    length: 15 * FT,
    /** Deliberately lower than the gallery: compression before release. */
    ceilingHeight: 3.0,
  },

  walls: {
    exteriorThickness: 0.3,
    /** Wall between reception and main gallery (contains the passage mouth). */
    dividerThickness: 0.2,
    partitionThickness: 0.24,
    /** Partitions stop short of the ceiling so skylight daylight spills over them. */
    partitionHeight: 3.7,
    /** Recessed shadow gap at wall base (museum detail). */
    shadowGapHeight: 0.022,
  },

  /** Central tunnel passage — GA-101 shows it running ~45 ft up the axis from the entrance. */
  passage: {
    clearWidth: 2.6,
    length: 45 * FT,
  },

  /** Short return walls on the perimeter that split each side into two display bays (GA-101). */
  bayDivider: {
    length: 0.9,
    thickness: 0.24,
  },

  /**
   * REVEAL WALL — intentional modification to GA-101.
   * A free-standing screen wall at the passage exit that interrupts the axial sightline.
   */
  revealWall: {
    width: 4.2,
    height: 3.7,
    thickness: 0.4,
    /** Clear distance between the passage exit and the wall's south face. */
    gapFromPassage: 1.3,
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
    width: 4.2,
    /** z-extent of the opening (south → north). */
    startZ: -0.45,
    endZ: -17.85,
    /** Height of the plaster light-well upstand above the ceiling plane. */
    wellHeight: 1.1,
    /** Rise of the shallow glazed gable above the well. */
    ridgeRise: 0.32,
    /** Spacing of transverse glazing bars. */
    mullionSpacing: 1.45,
    /** Spacing of the white steel beams spanning the opening. */
    beamSpacing: 2.9,
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
    start: { x: 0, z: 15.6, yawDeg: 0, pitchDeg: 2 },
  },

  /**
   * v2 EXPANSION WINGS (not in GA-101). The GA-101 gallery + reception remain the
   * core; the new wings wrap around them. Coordinates are interior faces (metres).
   */
  wings: {
    atrium: { minX: -10, maxX: 10, minZ: 5.072, maxZ: 17.5, height: 8.2, entranceWidth: 2.8, entranceHeight: 3.4 },
    theatre: { minX: -23, maxX: -10.3, minZ: 5.072, maxZ: 17.5, height: 6.2 },
    workshop: { minX: 10.3, maxX: 25, minZ: -6.0, maxZ: 17.5, height: 6.6 },
    courtyard: { minX: 10.3, maxX: 25, minZ: -18.6, maxZ: -6.3, wallHeight: 3.2 },
    /** Doorways between wings (clear width x height). */
    doors: {
      receptionToAtrium: { width: 2.2, height: 2.8 },
      atriumToTheatre: { z: 15.0, width: 2.0, height: 3.0 },
      atriumToWorkshop: { z: 11.0, width: 3.0, height: 3.6 },
      workshopToCourtyard: { x: 17.6, width: 3.2, height: 3.4 },
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
  gx: g.width / 2, // 4.572
  gzNorth: -g.length, // -18.288
  gzSouth: 0,
  rx: r.width / 2, // 1.524
  rzNorth: w.dividerThickness, // 0.2
  rzSouth: w.dividerThickness + r.length, // 4.772
  passageHalf: MUSEUM.passage.clearWidth / 2, // 1.0
  partitionOuter: MUSEUM.passage.clearWidth / 2 + w.partitionThickness, // 1.24
  passageNorthZ: -MUSEUM.passage.length, // -13.716
  bayDividerZ: -MUSEUM.passage.length / 2, // -6.858
  get bayCenterX() {
    return (this.partitionOuter + this.gx) / 2 // 2.906
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
