/**
 * HandsOnParts — the ONE place leg parts and their strokes are defined.
 *
 * Owns: the part list (id, name shown on the choice chip, technique label, intensity,
 * ghost-hand poses, and a suggested start/end for demos and tests).
 * Add a part or swap a stroke by editing this list only; HandsOnMain builds the choice
 * row and the guides from it at runtime.
 * Must not: touch the scene or hold runtime state.
 *
 * The user places every stroke with two palm spots, so a part does NOT store where it is
 * on the leg. `suggested` is only a convenient default for tests/demos, in leg surface
 * coordinates (see HandsOnLegGeometry):
 *   region "leg":  a = cm from the knee toward the ankle, b = degrees around the leg
 *                  (0 = front/shin, 90 = inner side, 180 = back/calf)
 *   region "foot": a = cm from the heel toward the toes, b = degrees around the foot's
 *                  long axis (-90 = middle of the sole, 90 = top of the foot)
 */

export type Intensity = "gentle" | "medium" | "firm"

/** How the leg lies on the bed for a part: face down (calf up) or face up (shin up). */
export type LegPose = "faceDown" | "faceUp"

export interface HandPose {
  /** cm offset along the stroke, relative to the moving stroke point. */
  along: number
  /**
   * Where the palm sits around the limb, degrees from the arrow line (+ = right of the arrow).
   * Which hand sits here follows from where the user is.
   */
  aroundDeg: number
  /**
   * Finger direction in the surface plane, degrees from the stroke direction (+ = toward aroundDeg +).
   * Beyond 45 degrees the fingers wrap around the limb instead, away from the user.
   */
  fingerYawDeg: number
  /** The most the fingers may bend to wrap the surface, degrees (95 = a full grip). */
  curlDeg: number
  /** Thumb tip rests on the arrow line, just ahead of the hand; otherwise on the nearest skin. */
  thumbOnArrow: boolean
  /** How far ahead of the palm (along the stroke) the thumb tip reaches on the arrow line, cm (default 1.5). */
  thumbLeadCm?: number
  /** How far to its own side of the arrow line the thumb tip rests, cm (default 0.9). */
  thumbAcrossCm?: number
  /** Instead of thumbAcrossCm: degrees around the limb from the arrow line, so the gap shrinks with the leg. */
  thumbAroundDeg?: number
}

export interface SurfaceSpot {
  region: "leg" | "foot"
  a: number
  b: number
}

export interface PartDef {
  id: string
  /** Text on the choice chip ("Calf"). */
  name: string
  /** Floating technique label, e.g. "Calf knead · medium". */
  label: string
  intensity: Intensity
  /** Position the leg settles into when this part is picked. */
  pose: LegPose
  /** Plain-language hand cue (for humans editing this list; not rendered). */
  cue: string
  hands: HandPose[]
  /** Default stroke start/end (tests, demos). */
  suggested: {start: SurfaceSpot; end: SurfaceSpot}
}

/**
 * Stroke timing and hand depth per intensity (gentle slower + hovering, firm faster + sunk).
 * pressCm = how far the hands sink into the skin at a press point.
 */
export const INTENSITY_PROFILE: Record<Intensity, {strokeSeconds: number; liftCm: number; pressCm: number}> = {
  gentle: {strokeSeconds: 4.2, liftCm: 0.9, pressCm: 0.5},
  medium: {strokeSeconds: 3.8, liftCm: 0.25, pressCm: 0.8},
  firm: {strokeSeconds: 3.2, liftCm: -0.45, pressCm: 1.1},
}

export const PARTS: PartDef[] = [
  {
    id: "calf",
    name: "Calf",
    label: "Calf knead · medium",
    intensity: "medium",
    pose: "faceDown",
    cue: "Palms hug the sides of the calf, fingers pointing up toward the knee; both thumbs side by side on the centre line, gliding along the arrow (ankle to knee).",
    hands: [
      {along: -4, aroundDeg: -62, fingerYawDeg: -8, curlDeg: 60, thumbOnArrow: true, thumbLeadCm: 7, thumbAroundDeg: 58},
      {along: -4, aroundDeg: 62, fingerYawDeg: 8, curlDeg: 60, thumbOnArrow: true, thumbLeadCm: 7, thumbAroundDeg: 58},
    ],
    suggested: {start: {region: "leg", a: 31, b: 180}, end: {region: "leg", a: 9, b: 180}},
  },
  {
    id: "shin",
    name: "Shin",
    label: "Shin glide · gentle",
    intensity: "gentle",
    pose: "faceUp",
    cue: "Palms flat on either side of the shinbone (not on the bone); glide along the arrow (ankle to knee).",
    hands: [
      {along: -1.5, aroundDeg: -55, fingerYawDeg: 0, curlDeg: 35, thumbOnArrow: false},
      {along: 1.5, aroundDeg: 55, fingerYawDeg: 0, curlDeg: 35, thumbOnArrow: false},
    ],
    suggested: {start: {region: "leg", a: 32, b: 0}, end: {region: "leg", a: 9, b: 0}},
  },
  {
    id: "sole",
    name: "Sole",
    label: "Sole thumb glide · medium",
    intensity: "medium",
    pose: "faceDown",
    cue: "Both thumbs on the sole; glide along the arrow (heel to toes).",
    hands: [
      {along: -1, aroundDeg: -90, fingerYawDeg: -110, curlDeg: 95, thumbOnArrow: true},
      {along: -1, aroundDeg: 90, fingerYawDeg: 110, curlDeg: 95, thumbOnArrow: true},
    ],
    suggested: {start: {region: "foot", a: 3.5, b: -90}, end: {region: "foot", a: 17.5, b: -90}},
  },
]

/** Choice id for turning the guide off (shown only when the choices are reopened from the label). */
export const OFF_CHOICE_ID = "off"
export const OFF_CHOICE_NAME = "Off"

export function findPart(id: string): PartDef | null {
  for (const p of PARTS) if (p.id === id) return p
  return null
}
