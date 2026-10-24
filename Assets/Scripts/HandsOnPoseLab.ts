/**
 * HandsOnPoseLab — MVP gallery of massage grips, for reviewing hand posture before the
 * guide is rebuilt around them. Not part of the normal flow: leave this SceneObject
 * disabled unless reviewing poses.
 *
 * Owns: placing two posed ghost hands (SIK's rigged hand mesh, via GhostHandL/R prefabs) on
 * the leg for the chosen grip, posed from where the user is (the camera), and re-posing them
 * when the leg is turned or the user moves.
 * Placement: each palm sits on its body-part spot (mirrored to the side the user can reach);
 * the hand on the user's right is the right hand; forearms point back toward the user. The palm
 * seats and cups onto the skin, fingers wrap joint by joint until they touch (so the wrap fits
 * any leg size) without crossing into the other hand's half, and thumbs rest on the skin.
 * Must not: change HandsOn state beyond pausing its UI while the lab is on.
 */
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {HandsOnLegModel} from "./HandsOnLegModel"
import {Region, V3, add, dot, scale, sub, toVec3} from "./HandsOnLegGeometry"

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
/** Re-pose when the leg or the user moves more than this (checked a few times a second). */
const REPOSE_MOVE_CM = 2
const REPOSE_TURN_DEG = 3
const REPOSE_CHECK_S = 0.3

interface Spot {
  region: Region
  a: number
  b: number
}

interface HandSpec {
  palm: Spot
  /** Leg-local direction the fingers point (projected onto the skin). Otherwise they wrap around the limb, away from the user. */
  fingers?: V3
  thumbTarget?: Spot
  maxCurlDeg: number
}

interface Grip {
  name: string
  hands: HandSpec[]
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

const X: V3 = [1, 0, 0]

/**
 * Grips from the reference clips. Spots are on the body part, leg-local: +X knee->ankle,
 * leg b = degrees around (0 shin, 90 inner, 180 calf), foot b = degrees around its long axis
 * (-90 sole, 90 top). Which hand goes where is decided from the user's position.
 */
function grips(): Grip[] {
  return [
    {
      name: "Calf · thumb press-walk (thumbs on the midline, fingers wrap the sides)",
      hands: [
        {palm: {region: "leg", a: 16, b: 132}, thumbTarget: {region: "leg", a: 11, b: 176}, maxCurlDeg: 95},
        {palm: {region: "leg", a: 16, b: 228}, thumbTarget: {region: "leg", a: 11, b: 184}, maxCurlDeg: 95},
      ],
    },
    {
      name: "Calf · two-hand squeeze (heels of the hands on the sides, fingers around)",
      hands: [
        {palm: {region: "leg", a: 15, b: 262}, maxCurlDeg: 100},
        {palm: {region: "leg", a: 16.5, b: 98}, maxCurlDeg: 100},
      ],
    },
    {
      name: "Shin · palm glide (palms either side of the shinbone, fingers toward the knee)",
      hands: [
        {palm: {region: "leg", a: 22, b: 305}, fingers: scale(X, -1), maxCurlDeg: 35},
        {palm: {region: "leg", a: 22, b: 55}, fingers: scale(X, -1), maxCurlDeg: 35},
      ],
    },
    {
      name: "Shin · thumb circles beside the bone (other hand steadies the ankle)",
      hands: [
        {palm: {region: "leg", a: 16, b: 282}, thumbTarget: {region: "leg", a: 12, b: 332}, maxCurlDeg: 90},
        {palm: {region: "leg", a: 34, b: 20}, maxCurlDeg: 80},
      ],
    },
    {
      name: "Sole · thumb walk (fingers over the top of the foot, thumbs on the sole)",
      hands: [
        {palm: {region: "foot", a: 11, b: 180}, thumbTarget: {region: "foot", a: 8, b: -100}, maxCurlDeg: 95},
        {palm: {region: "foot", a: 11, b: 0}, thumbTarget: {region: "foot", a: 8, b: -80}, maxCurlDeg: 95},
      ],
    },
    {
      name: "Sole · heel circles (thumb on the heel, other hand steadies the ball of the foot)",
      hands: [
        {palm: {region: "foot", a: 4, b: 180}, thumbTarget: {region: "foot", a: 4, b: -95}, maxCurlDeg: 95},
        {palm: {region: "foot", a: 15, b: -90}, maxCurlDeg: 60},
      ],
    },
  ]
}

/** The same spot on the other side of the limb (inner <-> outer). */
function mirrorSpot(s: Spot): Spot {
  return {region: s.region, a: s.a, b: s.region === "leg" ? (360 - s.b) % 360 : 180 - s.b}
}

function mirrorSpec(h: HandSpec): HandSpec {
  return {
    palm: mirrorSpot(h.palm),
    fingers: h.fingers,
    thumbTarget: h.thumbTarget ? mirrorSpot(h.thumbTarget) : undefined,
    maxCurlDeg: h.maxCurlDeg,
  }
}

@component
export class HandsOnPoseLab extends BaseScriptComponent {
  @input
  @hint("HandsOnLegModel on the Leg object")
  legModel: HandsOnLegModel

  @input
  @hint("GhostHandR prefab (SIK right hand model)")
  rightHandPrefab: ObjectPrefab

  @input
  @hint("GhostHandL prefab (SIK left hand model)")
  leftHandPrefab: ObjectPrefab

  @input
  @hint("Lit material for the ghost hands (cloned, tinted and made additive)")
  handMaterial: Material

  @input
  @hint("Objects to switch off while the lab is on (e.g. GuideUI)")
  hideWhileOn: SceneObject[] = []

  @input
  @hint("Script components to pause while the lab is on (e.g. HandsOnMain)")
  pauseWhileOn: ScriptComponent[] = []

  @input
  @hint("Which grip to show")
  @widget(new SliderWidget(0, 5, 1))
  gripIndex: number = 0

  private camera: Transform
  private mat: Material
  private hands: SceneObject[] = []
  private lastLegPos: vec3
  private lastLegRot: quat
  private lastCamPos: vec3
  private lastCheck = 0

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.start())
    this.createEvent("UpdateEvent").bind(() => this.watch())
  }

  private start(): void {
    for (const o of this.hideWhileOn) if (o) o.enabled = false
    for (const s of this.pauseWhileOn) if (s) s.enabled = false
    this.camera = WorldCameraFinderProvider.getInstance().getTransform()
    this.mat = this.handMaterial.clone()
    // ghost look: lit, light blue, see-through, no depth write (additive washed out to white on the light leg)
    this.mat.mainPass.baseColor = new vec4(0.5, 0.68, 0.98, 0.6)
    this.mat.mainPass.blendMode = BlendMode.PremultipliedAlphaAuto
    this.mat.mainPass.depthWrite = false
    this.show()
  }

  /** Re-pose when the leg has been turned/moved or the user has moved (not mid-drag). */
  private watch(): void {
    if (!this.camera || getTime() - this.lastCheck < REPOSE_CHECK_S) return
    this.lastCheck = getTime()
    if (this.legModel.isTurning()) return
    const legT = this.legModel.getSceneObject().getTransform()
    const moved =
      legT.getWorldPosition().distance(this.lastLegPos) > REPOSE_MOVE_CM ||
      quat.angleBetween(legT.getWorldRotation(), this.lastLegRot) > REPOSE_TURN_DEG * DEG ||
      this.camera.getWorldPosition().distance(this.lastCamPos) > REPOSE_MOVE_CM
    if (moved) this.show()
  }

  private show(): void {
    for (const h of this.hands) h.destroy()
    this.hands = []
    const legT = this.legModel.getSceneObject().getTransform()
    this.lastLegPos = legT.getWorldPosition()
    this.lastLegRot = legT.getWorldRotation()
    this.lastCamPos = this.camera.getWorldPosition()

    const all = grips()
    const grip = all[Math.max(0, Math.min(all.length - 1, Math.round(this.gripIndex)))]

    // the layout (or its mirror image) whose palms face the user more
    const mirrored = grip.hands.map(mirrorSpec)
    const specs = this.facing(mirrored) > this.facing(grip.hands) ? mirrored : grip.hands
    // the hand further to the user's right is the right hand
    const right = this.camera.right
    const x = specs.map((h) => this.spotWorld(h.palm).position.dot(right))
    const rightIdx = x[0] >= x[1] ? 0 : 1

    const posed = specs.map((h, i) => this.placeHand(h, i === rightIdx ? "R" : "L"))
    for (let i = 0; i < posed.length; i++) {
      const me = posed[i]
      const other = posed[1 - i]
      const keep: KeepOut | null = other
        ? {mid: vec3.lerp(me.palmCentre, other.palmCentre, 0.5), u: me.palmCentre.sub(other.palmCentre).normalize()}
        : null
      for (const f of FINGERS) this.wrapFinger(me.hand, f, me.palmDir, me.spec.maxCurlDeg, keep)
      this.seatThumb(me.hand, me.spec.thumbTarget ?? null)
    }
    print("[PoseLab] showing grip " + this.gripIndex + ": " + grip.name)
  }

  private facing(specs: HandSpec[]): number {
    const eye = this.camera.getWorldPosition()
    let sum = 0
    for (const h of specs) {
      const s = this.spotWorld(h.palm)
      sum += s.normal.dot(eye.sub(s.position).normalize())
    }
    return sum
  }

  private spotWorld(s: Spot): {position: vec3; normal: vec3} {
    return this.legModel.surfaceToWorld(s.region, s.a, s.b)
  }

  // ── one hand ──

  private placeHand(spec: HandSpec, side: "L" | "R"): Posed {
    const prefab = side === "R" ? this.rightHandPrefab : this.leftHandPrefab
    const leg = this.legModel.getSceneObject()
    const hand = prefab.instantiate(leg)
    hand.name = "PoseHand_" + side
    this.hands.push(hand)
    this.useFullMesh(hand, this.mat)
    const j = (n: string) => this.find(hand, n)
    const wrist = j("wrist")
    const knuckle = j("mid-0")

    // rest frame: F = wrist -> middle knuckle, t = pinky -> index (thumb side), p = palm facing
    const Fr = knuckle.getTransform().getWorldPosition().sub(wrist.getTransform().getWorldPosition()).normalize()
    const tr = j("index-0").getTransform().getWorldPosition().sub(j("pinky-0").getTransform().getWorldPosition()).normalize()
    const pr = this.palmFacing(side, Fr, tr)

    // target frame from the surface spot
    const legM = leg.getTransform().getWorldTransform()
    const s = this.legModel.shape.sampleAt(spec.palm.region, spec.palm.a, spec.palm.b)
    const P = legM.multiplyPoint(toVec3(s.p))
    const n = legM.multiplyDirection(toVec3(s.n)).normalize()
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
  private fingerDirection(spec: HandSpec, side: "L" | "R", P: vec3, n: vec3, legM: mat4): vec3 {
    const eye = this.camera.getWorldPosition()
    const shoulder = eye
      .add(vec3.up().uniformScale(-SHOULDER_DROP_CM))
      .add(this.camera.right.uniformScale(side === "R" ? SHOULDER_HALF_WIDTH_CM : -SHOULDER_HALF_WIDTH_CM))
    const reach = this.onPlane(P.sub(shoulder), n)
    if (spec.fingers) {
      const want = this.onPlane(legM.multiplyDirection(toVec3(spec.fingers)), n)
      return want.dot(reach) > -0.3 ? want : reach
    }
    // wrap around the limb, in the direction that leads away from the eyes (the wrist stays on the
    // user's side; on the far side that means reaching over the top with the fingers pointing down)
    const longLocal = spec.palm.region === "leg" ? X : this.legModel.shape.footT
    const along = legM.multiplyDirection(toVec3(longLocal)).normalize()
    const around = n.cross(along).normalize()
    return around.dot(P.sub(eye)) >= 0 ? around : around.uniformScale(-1)
  }

  /** Palm-facing direction from the hand's forward (fingers) and thumb side, by handedness. */
  private palmFacing(side: "L" | "R", F: vec3, t: vec3): vec3 {
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
    const bone = this.find(hand, "wrist_to_" + finger)
    const knuckle = this.find(hand, finger + "-0")
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
    const chain = [0, 1, 2, 3].map((i) => this.find(hand, finger + "-" + i))
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
   * Rest the thumb tip on the skin: on its target spot when the grip gives one, otherwise on the
   * nearest skin. Cyclic joint-by-joint aiming (tip joint first), a little at a time per joint.
   */
  private seatThumb(hand: SceneObject, targetSpot: Spot | null): void {
    const chain = [0, 1, 2].map((i) => this.find(hand, "thumb-" + i))
    const tip = this.find(hand, "thumb-3")
    if (chain.some((x) => !x) || !tip) return
    const legM = this.legModel.getSceneObject().getTransform().getWorldTransform()
    const onSkin = (world: vec3) => {
      const s = this.legModel.projectWorld(world)
      return legM.multiplyPoint(toVec3(add(s.p, scale(s.n, THUMB_LIFT_CM))))
    }
    const pos = (o: SceneObject) => o.getTransform().getWorldPosition()
    const base = pos(chain[0])
    let reach = 0
    for (let k = 0; k < 3; k++) reach += pos(k < 2 ? chain[k + 1] : tip).distance(pos(chain[k]))
    let target = onSkin(pos(tip))
    if (targetSpot) {
      // toward the grip's thumb spot, but only as far as the thumb can actually reach
      const s = this.legModel.shape.sampleAt(targetSpot.region, targetSpot.a, targetSpot.b)
      const want = legM.multiplyPoint(toVec3(add(s.p, scale(s.n, THUMB_LIFT_CM))))
      const d = want.distance(base)
      target = d <= reach * 0.85 ? want : onSkin(base.add(want.sub(base).uniformScale((reach * 0.85) / d)))
    }
    const rest = chain.map((o) => o.getTransform().getLocalRotation())
    this.aimThumb(chain, tip, target)
    // a thumb that had to pass through the leg to get there rests on the nearest skin instead
    if (chain.slice(1).concat([tip]).some((o) => this.skinDistance(pos(o)) < 0.3)) {
      chain.forEach((o, k) => o.getTransform().setLocalRotation(rest[k]))
      this.aimThumb(chain, tip, onSkin(pos(tip)))
    }
  }

  /** Cyclic joint-by-joint aiming of the thumb tip at a point (tip joint first), a little at a time per joint. */
  private aimThumb(chain: SceneObject[], tip: SceneObject, target: vec3): void {
    const maxStep = 20 * DEG
    for (let iter = 0; iter < 8; iter++) {
      for (let k = 2; k >= 0; k--) {
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

  /** Signed distance (cm) from a world point to the leg surface; negative inside. */
  private skinDistance(world: vec3): number {
    const pl = this.legModel.worldToLocal(world)
    const s = this.legModel.shape.project(pl)
    return dot(sub(pl, s.p), s.n)
  }

  private onPlane(v: vec3, n: vec3): vec3 {
    return v.sub(n.uniformScale(v.dot(n))).normalize()
  }

  private useFullMesh(hand: SceneObject, mat: Material): void {
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

  private find(root: SceneObject, name: string): SceneObject | null {
    if (root.name === name) return root
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const r = this.find(root.getChild(i), name)
      if (r) return r
    }
    return null
  }
}
