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

export interface HandPose {
  side: "left" | "right"
  /** cm offset along the stroke, relative to the moving stroke point. */
  along: number
  /** cm offset across the stroke on the surface (+ = right of the arrow). */
  across: number
  /** Finger direction in the surface plane, degrees from the stroke direction (+ = toward across +). */
  fingerYawDeg: number
  /** How much the fingers wrap around the surface, degrees of total curl. */
  curlDeg: number
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
  /** Plain-language hand cue (for humans editing this list; not rendered). */
  cue: string
  hands: HandPose[]
  /** Default stroke start/end (tests, demos). */
  suggested: {start: SurfaceSpot; end: SurfaceSpot}
}

/** Stroke timing and hand depth per intensity (gentle slower + hovering, firm faster + sunk). */
export const INTENSITY_PROFILE: Record<Intensity, {strokeSeconds: number; liftCm: number}> = {
  gentle: {strokeSeconds: 3.5, liftCm: 0.9},
  medium: {strokeSeconds: 3.0, liftCm: 0.25},
  firm: {strokeSeconds: 2.5, liftCm: -0.45},
}

export const PARTS: PartDef[] = [
  {
    id: "calf",
    name: "Calf",
    label: "Calf knead · medium",
    intensity: "medium",
    cue: "Both hands wrapped around the calf, thumbs on the back of the leg; glide along the arrow (ankle to knee).",
    hands: [
      {side: "left", along: 0, across: -3.2, fingerYawDeg: -95, curlDeg: 70},
      {side: "right", along: 0, across: 3.2, fingerYawDeg: 95, curlDeg: 70},
    ],
    suggested: {start: {region: "leg", a: 31, b: 140}, end: {region: "leg", a: 9, b: 140}},
  },
  {
    id: "shin",
    name: "Shin",
    label: "Shin glide · gentle",
    intensity: "gentle",
    cue: "Palms flat on either side of the shinbone (not on the bone); glide along the arrow (ankle to knee).",
    hands: [
      {side: "left", along: -1.5, across: -3.4, fingerYawDeg: -10, curlDeg: 15},
      {side: "right", along: 1.5, across: 3.4, fingerYawDeg: 10, curlDeg: 15},
    ],
    suggested: {start: {region: "leg", a: 32, b: 40}, end: {region: "leg", a: 9, b: 40}},
  },
  {
    id: "sole",
    name: "Sole",
    label: "Sole thumb glide · medium",
    intensity: "medium",
    cue: "Both thumbs on the sole; glide along the arrow (heel to toes).",
    hands: [
      {side: "left", along: -1, across: -2.0, fingerYawDeg: -110, curlDeg: 85},
      {side: "right", along: -1, across: 2.0, fingerYawDeg: 110, curlDeg: 85},
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
