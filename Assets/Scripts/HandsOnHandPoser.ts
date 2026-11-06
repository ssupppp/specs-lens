/**
 * HandsOnHandPoser — rests SIK's rigged hand meshes (GhostHandL/R prefabs) on the leg surface.
 *
 * Owns: posing two hands for one grip, from where the user is (the camera). Each palm seats and
 * cups onto the skin at its spot, fingers wrap joint by joint until they touch (so the wrap fits
 * any leg size) without crossing into the other hand's half, and thumbs rest on the skin.
 * Works in any Leg-local frame: the live leg (HandsOnPoseLab) or a guide's world-locked copy of
 * it (HandsOnGuide), so the hands match whatever the arrow was drawn on.
 * Must not: instantiate or destroy hands, or keep state between poses (callers own the hands).
 */
import {LegShape, SurfaceSample, V3, add, dot, fromVec3, scale, sub, toVec3} from "./HandsOnLegGeometry"

const DEG = Math.PI / 180
const PALM_LIFT_CM = 1.6
const THUMB_LIFT_CM = 0.9
/** Joint-centre distance from the skin that counts as touching (about a finger's radius). */
const CONTACT_CM = 0.9
/** Seated hand: knuckle row and heel of the hand rest this far off the skin; the palm centre may press in to this. */
const KNUCKLE_LIFT_CM = 1.1
const HEEL_LIFT_CM = 1.4
const PALM_MIN_CM = 0.9
/** How far the palm can cup (palm bones flexing toward the skin) to bring the knuckles down onto a round limb. */
const CUP_LIMIT_DEG = 15
const FINGERS = ["index", "mid", "ring", "pinky"]
/** Bend limits at the knuckle, middle and end joints for a full (95 degree) grip. */
const JOINT_LIMIT_DEG = [90, 105, 80]
/** Fingers stop this far short of the halfway line between the two palms, so the hands never cross. */
const SIDE_GAP_CM = 1.0
/** The user's shoulders, relative to the eyes: down and out to each side (cm). */
const SHOULDER_DROP_CM = 25
const SHOULDER_HALF_WIDTH_CM = 18

const X: V3 = [1, 0, 0]

export type Side = "L" | "R"

/** One hand of a grip, in Leg-local coordinates. */
export interface HandSpec {
  /** Where the palm centre rests (a point on the skin). */
  palm: SurfaceSample
  /** Leg-local direction the fingers point (projected onto the skin). Otherwise they wrap around the limb, away from the user. */
  fingers?: V3
  /** Point the fingers along `fingers` even if that bends the hand back toward the user (see canPointFingers). */
  fingersFixed?: boolean
  /** Leg-local point the thumb tip reaches for (as far as it can); otherwise it rests on the nearest skin. */
  thumbTarget?: V3
  maxCurlDeg: number
  /** Keep the thumb open in the hand's natural pose instead of bending it onto the skin. */
  thumbOpen?: boolean
}

/** A hand placed and seated on the leg, waiting for its fingers and thumb. */
interface Posed {
  hand: SceneObject
  spec: HandSpec
  palmDir: vec3
  palmCentre: vec3
}

/** The other hand's half of the leg: probes must stay on this hand's side of the plane through `mid`. */
interface KeepOut {
  mid: vec3
  u: vec3
}

export class HandsOnHandPoser {
  /**
   * @param frame transform whose world matrix maps Leg-local coordinates to the world
   */
  constructor(
    private readonly shape: LegShape,
    private readonly frame: Transform,
    private readonly camera: Transform,
  ) {}

  /** Which hand each spec gets: the palm further to the user's right is the right hand. */
  sides(specs: HandSpec[]): Side[] {
    const m = this.frame.getWorldTransform()
    const right = this.camera.right
    const x = specs.map((h) => m.multiplyPoint(toVec3(h.palm.p)).dot(right))
    return x[0] >= x[1] ? ["R", "L"] : ["L", "R"]
  }

  /** How much the palms face the user (sum of normal · direction to the eyes). */
  facing(specs: HandSpec[]): number {
    const m = this.frame.getWorldTransform()
    const eye = this.camera.getWorldPosition()
    let sum = 0
    for (const h of specs) {
      const n = m.multiplyDirection(toVec3(h.palm.n)).normalize()
      sum += n.dot(eye.sub(m.multiplyPoint(toVec3(h.palm.p))).normalize())
    }
    return sum
  }

  /** Whether the hand on `side` can point its fingers along `spec.fingers` without bending back toward the user. */
  canPointFingers(spec: HandSpec, side: Side): boolean {
    const legM = this.frame.getWorldTransform()
    const P = legM.multiplyPoint(toVec3(spec.palm.p))
    const n = legM.multiplyDirection(toVec3(spec.palm.n)).normalize()
    return this.onPlane(legM.multiplyDirection(toVec3(spec.fingers)), n).dot(this.reach(P, n, side)) > -0.3
  }

  /** Pose `hands[i]` (rigged, in rest pose, side `sides[i]`) onto `specs[i]`. */
  pose(specs: HandSpec[], hands: SceneObject[], sides: Side[]): void {
    const posed = specs.map((h, i) => this.placeHand(hands[i], h, sides[i]))
    for (let i = 0; i < posed.length; i++) {
      const me = posed[i]
      const other = posed[1 - i]
      const keep: KeepOut | null = other
        ? {mid: vec3.lerp(me.palmCentre, other.palmCentre, 0.5), u: me.palmCentre.sub(other.palmCentre).normalize()}
        : null
      for (const f of FINGERS) this.wrapFinger(me.hand, f, me.palmDir, me.spec.maxCurlDeg, keep)
      if (!me.spec.thumbOpen) this.seatThumb(me.hand, me.spec.thumbTarget ?? null)
    }
  }

  // ── one hand ──

  private placeHand(hand: SceneObject, spec: HandSpec, side: Side): Posed {
    const j = (n: string) => findChild(hand, n)
    const wrist = j("wrist")
    const knuckle = j("mid-0")

    // rest frame: F = wrist -> middle knuckle, t = pinky -> index (thumb side), p = palm facing
    const Fr = knuckle.getTransform().getWorldPosition().sub(wrist.getTransform().getWorldPosition()).normalize()
    const tr = j("index-0").getTransform().getWorldPosition().sub(j("pinky-0").getTransform().getWorldPosition()).normalize()
    const pr = this.palmFacing(side, Fr, tr)

    // target frame from the surface spot
    const legM = this.frame.getWorldTransform()
    const P = legM.multiplyPoint(toVec3(spec.palm.p))
    const n = legM.multiplyDirection(toVec3(spec.palm.n)).normalize()
    const p = n.uniformScale(-1)
    const F = this.fingerDirection(spec, side, P, n, legM)

    const ht = hand.getTransform()
    const turn = quat.lookAt(F, p).multiply(quat.lookAt(Fr, pr).invert())
    ht.setWorldRotation(turn.multiply(ht.getWorldRotation()))
    // palm centre (between wrist and knuckles) onto the spot, lifted by the palm's thickness
    const target = P.add(n.uniformScale(PALM_LIFT_CM))
    ht.setWorldPosition(ht.getWorldPosition().add(target.sub(this.palmCentre(wrist, knuckle))))
    this.seatPalm(hand, wrist, knuckle, F.cross(p).normalize(), n)
    for (const f of FINGERS) this.cupPalm(hand, f, p)
    return {hand, spec, palmDir: p, palmCentre: this.palmCentre(wrist, knuckle)}
  }

  /**
   * Where the fingers point: the way the forearm reaches from the user's shoulder, laid onto the
   * skin. Grips that wrap the limb keep only the part that goes around it; grips with a set
   * direction use it unless that would bend the hand back toward the user.
   */
  private fingerDirection(spec: HandSpec, side: Side, P: vec3, n: vec3, legM: mat4): vec3 {
    const eye = this.camera.getWorldPosition()
    if (spec.fingers) {
      const want = this.onPlane(legM.multiplyDirection(toVec3(spec.fingers)), n)
      if (spec.fingersFixed) return want
      const reach = this.reach(P, n, side)
      return want.dot(reach) > -0.3 ? want : reach
    }
    // wrap around the limb, in the direction that leads away from the eyes (the wrist stays on the
    // user's side; on the far side that means reaching over the top with the fingers pointing down)
    const longLocal = spec.palm.region === "leg" ? X : this.shape.footT
    const along = legM.multiplyDirection(toVec3(longLocal)).normalize()
    const around = n.cross(along).normalize()
    return around.dot(P.sub(eye)) >= 0 ? around : around.uniformScale(-1)
  }

  /** The way the forearm reaches from the user's shoulder to P, laid onto the skin (normal n). */
  private reach(P: vec3, n: vec3, side: Side): vec3 {
    const shoulder = this.camera
      .getWorldPosition()
      .add(vec3.up().uniformScale(-SHOULDER_DROP_CM))
      .add(this.camera.right.uniformScale(side === "R" ? SHOULDER_HALF_WIDTH_CM : -SHOULDER_HALF_WIDTH_CM))
    return this.onPlane(P.sub(shoulder), n)
  }

  /** Palm-facing direction from the hand's forward (fingers) and thumb side, by handedness. */
  private palmFacing(side: Side, F: vec3, t: vec3): vec3 {
    return (side === "R" ? t.cross(F) : F.cross(t)).normalize()
  }

  private palmCentre(wrist: SceneObject, knuckle: SceneObject): vec3 {
    return vec3.lerp(wrist.getTransform().getWorldPosition(), knuckle.getTransform().getWorldPosition(), 0.55)
  }

  /**
   * Rest the hand on a curved surface: tilt it (about the thumb-side line) until the heel of the hand
   * and the knuckle row sit equally off the skin, then press it in until one of them, or the palm
   * centre, reaches its contact distance. A flat palm on a round leg otherwise floats at the edges.
   */
  private seatPalm(hand: SceneObject, wrist: SceneObject, knuckle: SceneObject, tiltAxis: vec3, n: vec3): void {
    const ht = hand.getTransform()
    const heel = () => vec3.lerp(wrist.getTransform().getWorldPosition(), knuckle.getTransform().getWorldPosition(), 0.2)
    const gap = () => this.skinDistance(knuckle.getTransform().getWorldPosition()) - this.skinDistance(heel())
    const rotateAbout = (pivot: vec3, q: quat) => {
      ht.setWorldRotation(q.multiply(ht.getWorldRotation()))
      ht.setWorldPosition(pivot.add(q.multiplyVec3(ht.getWorldPosition().sub(pivot))))
    }
    for (let iter = 0; iter < 4 && Math.abs(gap()) > 0.2; iter++) {
      const before = gap()
      const pivot = this.palmCentre(wrist, knuckle)
      const span = knuckle.getTransform().getWorldPosition().distance(heel())
      const ang = Math.atan2(Math.abs(before), span)
      rotateAbout(pivot, quat.angleAxis(ang, tiltAxis))
      if (Math.abs(gap()) > Math.abs(before)) rotateAbout(pivot, quat.angleAxis(-2 * ang, tiltAxis))
    }
    for (let iter = 0; iter < 3; iter++) {
      const sink = Math.min(
        this.skinDistance(knuckle.getTransform().getWorldPosition()) - KNUCKLE_LIFT_CM,
        this.skinDistance(heel()) - HEEL_LIFT_CM,
        this.skinDistance(this.palmCentre(wrist, knuckle)) - PALM_MIN_CM,
      )
      if (Math.abs(sink) < 0.1) break
      ht.setWorldPosition(ht.getWorldPosition().sub(n.uniformScale(sink)))
    }
  }

  /** Flex a finger's palm bone toward the skin until its knuckle rests on it (within CUP_LIMIT_DEG). */
  private cupPalm(hand: SceneObject, finger: string, palmDir: vec3): void {
    const bone = findChild(hand, "wrist_to_" + finger)
    const knuckle = findChild(hand, finger + "-0")
    if (!bone || !knuckle) return
    const t = bone.getTransform()
    const base = t.getWorldRotation()
    const d = knuckle.getTransform().getWorldPosition().sub(t.getWorldPosition()).normalize()
    const axis = d.cross(palmDir).normalize()
    for (let c = 1; c <= CUP_LIMIT_DEG; c++) {
      if (this.skinDistance(knuckle.getTransform().getWorldPosition()) <= KNUCKLE_LIFT_CM) return
      t.setWorldRotation(quat.angleAxis(c * DEG, axis).multiply(base))
    }
  }

  /**
   * Wrap a finger one joint at a time, like a real hand closing on a limb: bend the knuckle until the
   * next joint meets the skin, then the middle joint, then the end joint. Each joint stops at contact,
   * at its closest approach if the skin is out of reach, or before anything further out would sink in
   * or cross into the other hand's half.
   */
  private wrapFinger(hand: SceneObject, finger: string, palmDir: vec3, maxCurlDeg: number, keep: KeepOut | null): void {
    const chain = [0, 1, 2, 3].map((i) => findChild(hand, finger + "-" + i))
    if (chain.some((x) => !x)) return
    const d0 = chain[1].getTransform().getWorldPosition().sub(chain[0].getTransform().getWorldPosition()).normalize()
    const axis = d0.cross(palmDir).normalize()
    const dist = (o: SceneObject) => this.skinDistance(o.getTransform().getWorldPosition())
    const side = (o: SceneObject) => (keep ? o.getTransform().getWorldPosition().sub(keep.mid).dot(keep.u) : Infinity)
    // a joint may not push anything further out into the skin or across the line; bends that only
    // ease an existing overlap (straight fingers already past it on a narrow foot) are allowed
    const blocked = (o: SceneObject, d0: number, s0: number) => {
      const d = dist(o)
      const s = side(o)
      return (d < 0.4 && d < d0 - 0.05) || (s < SIDE_GAP_CM && s < s0 - 0.05)
    }
    // a finger that starts inside the skin (the palm sits on a bump) lifts out at the knuckle first
    const k0 = chain[0].getTransform()
    const k0Base = k0.getWorldRotation()
    let lift = 0
    while (lift > -30 && chain.slice(1).some((o) => dist(o) < 0.5)) {
      lift -= 2
      k0.setWorldRotation(quat.angleAxis(lift * DEG, axis).multiply(k0Base))
    }
    for (let i = 0; i < 3; i++) {
      const t = chain[i].getTransform()
      const base = t.getWorldRotation()
      const limit = JOINT_LIMIT_DEG[i] * Math.min(1, maxCurlDeg / 95)
      const out = chain.slice(i + 1)
      const d0s = out.map(dist)
      const s0s = out.map(side)
      let best = 0
      let bestD = dist(chain[i + 1])
      for (let c = 2; c <= limit; c += 2) {
        t.setWorldRotation(quat.angleAxis(c * DEG, axis).multiply(base))
        if (out.some((o, k) => blocked(o, d0s[k], s0s[k]))) break
        const d = dist(chain[i + 1])
        if (d < bestD) {
          best = c
          bestD = d
        }
        if (d <= CONTACT_CM) break
      }
      t.setWorldRotation(quat.angleAxis(best * DEG, axis).multiply(base))
    }
  }

  /**
   * Rest the thumb tip on the skin: toward its target when the grip gives one, otherwise on the
   * nearest skin.
   */
  private seatThumb(hand: SceneObject, targetLocal: V3 | null): void {
    const chain = [0, 1, 2].map((i) => findChild(hand, "thumb-" + i))
    const tip = findChild(hand, "thumb-3")
    if (chain.some((x) => !x) || !tip) return
    const legM = this.frame.getWorldTransform()
    const onSkin = (world: vec3) => {
      const s = this.shape.project(this.toLocal(world))
      return legM.multiplyPoint(toVec3(add(s.p, scale(s.n, THUMB_LIFT_CM))))
    }
    const pos = (o: SceneObject) => o.getTransform().getWorldPosition()
    const base = pos(chain[0])
    let reach = 0
    for (let k = 0; k < 3; k++) reach += pos(k < 2 ? chain[k + 1] : tip).distance(pos(chain[k]))
    let target = onSkin(pos(tip))
    if (targetLocal) {
      // toward the grip's thumb spot, but only as far as the thumb can actually reach
      const want = onSkin(legM.multiplyPoint(toVec3(targetLocal)))
      const d = want.distance(base)
      target = d <= reach * 0.85 ? want : onSkin(base.add(want.sub(base).uniformScale((reach * 0.85) / d)))
    }
    const rest = chain.map((o) => o.getTransform().getLocalRotation())
    const sunk = () => chain.slice(1).concat([tip]).some((o) => this.skinDistance(pos(o)) < 0.3)
    this.aimThumb(chain, tip, target)
    if (sunk()) {
      // a straight reach cuts through a round limb: follow the skin instead, the middle of the
      // thumb to a point on the skin partway there, then the end joint on to the target
      chain.forEach((o, k) => o.getTransform().setLocalRotation(rest[k]))
      this.aimThumb([chain[0], chain[1]], chain[2], onSkin(vec3.lerp(base, target, 0.6)))
      this.aimThumb([chain[2]], tip, target)
    }
    // a thumb that still has to pass through the leg to get there rests on the nearest skin instead
    if (sunk()) {
      chain.forEach((o, k) => o.getTransform().setLocalRotation(rest[k]))
      this.aimThumb(chain, tip, onSkin(pos(tip)))
    }
  }

  /** Cyclic joint-by-joint aiming of the end of `chain` (at `tip`) at a point, last joint first, a little at a time per joint. */
  private aimThumb(chain: SceneObject[], tip: SceneObject, target: vec3): void {
    const maxStep = 20 * DEG
    for (let iter = 0; iter < 8; iter++) {
      for (let k = chain.length - 1; k >= 0; k--) {
        const jt = chain[k].getTransform()
        const jp = jt.getWorldPosition()
        let q = quat.rotationFromTo(tip.getTransform().getWorldPosition().sub(jp).normalize(), target.sub(jp).normalize())
        const ang = q.getAngle()
        if (ang > maxStep) q = quat.slerp(quat.quatIdentity(), q, maxStep / ang)
        jt.setWorldRotation(q.multiply(jt.getWorldRotation()))
      }
      if (tip.getTransform().getWorldPosition().distance(target) < 0.3) return
    }
  }

  private toLocal(world: vec3): V3 {
    return fromVec3(this.frame.getInvertedWorldTransform().multiplyPoint(world))
  }

  /** Signed distance (cm) from a world point to the leg surface; negative inside. */
  private skinDistance(world: vec3): number {
    const pl = this.toLocal(world)
    const s = this.shape.project(pl)
    return dot(sub(pl, s.p), s.n)
  }

  private onPlane(v: vec3, n: vec3): vec3 {
    return v.sub(n.uniformScale(v.dot(n))).normalize()
  }
}

/** The ghost look for posed hands: lit, light blue, see-through, no depth write (additive washes out to white on the light leg). */
export function ghostHandMaterial(lit: Material, color: vec3, alpha: number): Material {
  const mat = lit.clone()
  mat.mainPass.baseColor = new vec4(color.x, color.y, color.z, alpha)
  mat.mainPass.blendMode = BlendMode.PremultipliedAlphaAuto
  mat.mainPass.depthWrite = false
  return mat
}

/** Show only the hand's full mesh (the prefab carries several), drawn with `mat`. */
export function useFullMesh(hand: SceneObject, mat: Material): void {
  const visit = (o: SceneObject) => {
    const rmv = o.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
    if (rmv) {
      const full = o.name.indexOf("MeshFull") >= 0
      o.enabled = full
      if (full) rmv.mainMaterial = mat
    }
    for (let i = 0; i < o.getChildrenCount(); i++) visit(o.getChild(i))
  }
  visit(hand)
}

export function findChild(root: SceneObject, name: string): SceneObject | null {
  if (root.name === name) return root
  for (let i = 0; i < root.getChildrenCount(); i++) {
    const r = findChild(root.getChild(i), name)
    if (r) return r
  }
  return null
}

/** Every transform under (and including) `root`, in a fixed order, for snapshotting a pose. */
export function allTransforms(root: SceneObject): Transform[] {
  const out: Transform[] = []
  const visit = (o: SceneObject) => {
    out.push(o.getTransform())
    for (let i = 0; i < o.getChildrenCount(); i++) visit(o.getChild(i))
  }
  visit(root)
  return out
}

/** Closest distance (cm) between any joint of `a` and any joint of `b`, after both are posed — the actual
 * geometric separation of two posed hands, independent of how their placement was computed. */
export function minJointDistance(a: SceneObject, b: SceneObject): number {
  const A = allTransforms(a).map((t) => t.getWorldPosition())
  const B = allTransforms(b).map((t) => t.getWorldPosition())
  let best = Infinity
  for (const pa of A) {
    for (const pb of B) {
      const d = pa.distance(pb)
      if (d < best) best = d
    }
  }
  return best
}
