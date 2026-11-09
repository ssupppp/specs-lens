/**
 * HandsOnGuide — one placed massage guide, built at runtime between two palm spots.
 *
 * Owns (view + input for one guide): the stroke arrow along the leg surface with its
 * travelling shimmer, two looping ghost hands (GhostHand_<Name>_L/R, SIK's rigged hands posed
 * onto the skin by HandsOnHandPoser), and the arrow-start handle (ArrowStart_<Name>) used for
 * the drag-to-trace direction check.
 * The hands are posed at a few points along the stroke (one per frame after placing, so
 * placing doesn't stall) and blended between them as they loop, so the grip follows the
 * leg as it narrows toward the ankle.
 * World-locked: its root copies the leg's pose at the moment it was placed and is NOT a
 * child of the leg, so turning the stand-in leg afterwards does not move the guide.
 * Talks to HandsOnMain through callbacks only (onDirectionMatched).
 * Must not: decide which part is chosen, play sounds, or show text.
 */
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import {HandPose, INTENSITY_PROFILE, PartDef} from "./HandsOnParts"
import {HandSpec, HandsOnHandPoser, Side, allTransforms, ghostHandMaterial, minJointDistance, useFullMesh} from "./HandsOnHandPoser"
import {ArrowMesh, StrokePath, SurfaceSample, V3, add, buildChevronMesh, buildDiscMesh, dot, scale, sub, toVec3} from "./HandsOnLegGeometry"

export interface GuideLook {
  guideMaterial: Material
  /** Lit material for the ghost hands (cloned, tinted and made see-through). */
  handMaterial: Material
  rightHandPrefab: ObjectPrefab
  leftHandPrefab: ObjectPrefab
  arrowColor: vec3
  handColor: vec3
  checkColor: vec3
  /** Ghost hand opacity, 0-1. */
  ghostHandStrength: number
  dragMinCm: number
  dragMaxAngleDeg: number
}

const FADE_SECONDS = 0.3
const STROKE_PAUSE = 0.5
const HAND_FADE = 0.25
const DEG = Math.PI / 180
const HAND_SCALE = 0.82
/** Press points along the stroke: about one per this many cm of thumb travel, kept between the limits. The hands are posed at each. */
const STATION_SPACING_CM = 6
const MIN_STATIONS = 2
const MAX_STATIONS = 6
/** One stroke = press, glide, press, glide ... press. Relative lengths of a press and of a glide. */
const PRESS_UNITS = 0.3
const GLIDE_UNITS = 0.5
/** Pressure while gliding (1 = fully sunk, as at a press point). */
const PRESS_GLIDING = 0.45
/** Fingers set within this angle of the stroke point that way; beyond it they wrap the limb. */
const WRAP_YAW_DEG = 45
/** Thumbs on the arrow rest this far ahead of the palm (unless the grip sets thumbLeadCm), either side of the line. */
const THUMB_LEAD_CM = 1.5
const THUMB_ACROSS_CM = 0.9
/** A thumb may lead the palm by at most this share of the stroke, so short strokes still move forward. */
const MAX_LEAD_FRACTION = 0.6
/** The thumb's lead never eases below this share of its full amount, even right at the head of the
 * stroke — see leadEase. */
const MIN_LEAD_KEEP = 0.4
/** Never widen a grip's palm/thumb angle past this (degrees around the limb) while backing hands off each other —
 * kept short of the leg's side (90) so a widened grip still reads as hugging the calf, not wrapping round it. */
const MAX_AROUND_DEG = 86
/** Two hands closer than this (cm, nearest pair of joints) read as touching; widen the grip until they clear it. */
const MIN_HAND_GAP_CM = 2.2
const WIDEN_STEP_DEG = 2
/** A key's own pass: this point on the leg may genuinely need a lot of widening (a tight ankle has nowhere
 * else to put two hands), so give it real headroom. */
const MAX_WIDEN_STEPS = 10
/** The glide-overlap pass, by contrast, is fixing a blend artifact between two already-posed keys, not
 * re-tuning either one — cap how much extra it may add on top of a key's own widen, so a perfectly fine
 * wide-calf key can't get dragged toward the side of the leg just to satisfy a transient mid-blend check. */
const MAX_GLIDE_EXTRA_STEPS = 3
/** Last-resort fix once widening is maxed out and hands still touch: nudge them fore/aft along the
 * stroke, a little at a time, up to this many steps. */
const STAGGER_STEP_CM = 0.5
const MAX_STAGGER_STEPS = 12
/** The direction cue: a chain of ">" chevrons along the stroke with a pulse flowing the way the hands go. */
const CHEVRON_SPACING_CM = 2.2
const CHEVRON_HALF_WIDTH_CM = 1.5
const CHEVRON_DEPTH_CM = 1.1
const CHEVRON_THICK_CM = 0.55
/** How fully chevrons and press points the hands have passed turn green. */
const PASSED_MIX = 0.95
/** Gap kept between a chevron and the tail dot / a press point (a pressed point swells to ~1.3 cm). */
const CHEVRON_CLEAR_CM = 1.0
/** Flow pulse: chevrons per pulse, and pulses passing per second. */
const FLOW_CHEVRONS = 4
const FLOW_HZ = 0.9
const ARROW_LIFT_CM = 0.45
const STATION_RADIUS_CM = 0.6

export class HandsOnGuide {
  readonly part: PartDef
  readonly root: SceneObject
  readonly handleObject: SceneObject

  /** Fired the first time the arrow turns green in a drag. */
  onDirectionMatched: () => void = () => {}

  private alpha = 0
  private fadingOut = false
  private destroyed = false
  private time = 0
  private green = 0
  private greenTarget = 0
  private chimedThisDrag = false
  private dragging = false
  private dragStartWorld: vec3 = vec3.zero()
  private handleReturn = 0
  private handleReleaseWorld: vec3 = vec3.zero()

  private readonly arrowMat: Material
  private readonly dotMat: Material
  private readonly handMat: Material
  private readonly hands: SceneObject[] = []
  private readonly poser: HandsOnHandPoser
  private readonly sides: Side[]
  /** Per hand: fingers point back along the stroke, because the set way would bend the hand toward the user. */
  private readonly flipFingers: boolean[] = []
  /** Per hand: every transform in the rig (index 0 = the hand itself) and its rest pose. */
  private readonly rigs: {joints: Transform[]; restPos: vec3; restRot: quat[]}[] = []
  /** Per hand, per press point: the hand's position, the skin normal there, and every joint's rotation (local). */
  private readonly keys: {pos: vec3; n: vec3; rot: quat[]}[][] = []
  /** Widen amount (degrees) baked into each built key, by key index — so a glide's two ends can be compared. */
  private readonly keyWiden: number[] = []
  /** Each key's widen right after its own pass, before resolveGlideOverlaps adds anything further on top. */
  private readonly keyBaseWiden: number[] = []
  /** Fore/aft stagger (cm) baked into each built key, by key index — the last-resort fix past MAX_AROUND_DEG. */
  private readonly keyStagger: number[] = []
  /** Number of glides in a stroke; there are stations + 1 press points. */
  private readonly stations: number
  /** Press-point discs along the arrow, and their materials. */
  private readonly stationObjs: SceneObject[] = []
  private readonly stationMats: Material[] = []
  private readonly arrow: ArrowMesh
  private readonly handleRestLocal: vec3
  private readonly strokeDirLocal: vec3

  constructor(
    part: PartDef,
    private readonly path: StrokePath,
    container: SceneObject,
    legPose: {position: vec3; rotation: quat},
    private readonly look: GuideLook,
    private readonly camera: Transform,
  ) {
    this.part = part
    // spaced by how far the thumbs travel (the stroke less the thumb's lead), so each gap has room for a chevron
    const travelCm = path.length * (1 - this.leadFraction(part.hands[0]))
    this.stations = Math.max(MIN_STATIONS, Math.min(MAX_STATIONS, Math.round(travelCm / STATION_SPACING_CM)))
    this.root = this.makeObject(container, "Guide_" + part.name)
    const rt = this.root.getTransform()
    rt.setWorldPosition(legPose.position)
    rt.setWorldRotation(legPose.rotation)

    // ── arrow along the surface, with a disc at every press point ──
    const arrowObj = this.makeObject(this.root, "Arrow_" + part.name)
    // the chevrons fill the gaps between the tail and the press points
    const anchors = [0]
    for (let i = 0; i <= this.stations; i++) anchors.push(this.stationS(i))
    this.arrow = buildChevronMesh(path, CHEVRON_SPACING_CM, CHEVRON_HALF_WIDTH_CM, CHEVRON_DEPTH_CM, CHEVRON_THICK_CM, ARROW_LIFT_CM, anchors, CHEVRON_CLEAR_CM)
    this.arrowMat = look.guideMaterial.clone()
    this.addVisual(arrowObj, this.arrow.builder.getMesh(), this.arrowMat)
    const discMesh = buildDiscMesh(STATION_RADIUS_CM).getMesh()
    for (let i = 0; i <= this.stations; i++) {
      const at = path.offset(this.stationS(i), 0, ARROW_LIFT_CM + 0.1)
      const so = this.makeObject(this.root, "Press_" + part.name + "_" + i)
      const st = so.getTransform()
      st.setLocalPosition(toVec3(at.p))
      st.setLocalRotation(this.basisRotation(toVec3(at.n), toVec3(at.t)))
      const mat = look.guideMaterial.clone()
      this.addVisual(so, discMesh, mat)
      this.stationObjs.push(so)
      this.stationMats.push(mat)
    }

    // ── ghost hands: the one further to the user's right is the right hand ──
    this.poser = new HandsOnHandPoser(path.shape, rt, camera)
    this.handMat = ghostHandMaterial(look.handMaterial, look.handColor, 0)
    const mid = this.handSpecs(0.5)
    this.sides = this.poser.sides(mid)
    // decided once for the whole stroke, so a hand never spins round partway along it
    this.flipFingers = mid.map((h, i) => !!h.fingers && !this.poser.canPointFingers(h, this.sides[i]))
    for (const side of this.sides) {
      const hand = (side === "R" ? look.rightHandPrefab : look.leftHandPrefab).instantiate(this.root)
      hand.name = "GhostHand_" + part.name + "_" + side
      useFullMesh(hand, this.handMat)
      // the stand-in leg is slim (ankle radius 3 cm), so the stock hands are shrunk to a believable size on it
      hand.getTransform().setLocalScale(new vec3(HAND_SCALE, HAND_SCALE, HAND_SCALE))
      const joints = allTransforms(hand)
      this.rigs.push({joints, restPos: joints[0].getLocalPosition(), restRot: joints.map((t) => t.getLocalRotation())})
      this.hands.push(hand)
      this.keys.push([])
    }

    // ── arrow-start handle: drag along the arrow to check direction ──
    const tail = path.at(0)
    this.strokeDirLocal = toVec3(tail.t)
    const tailLifted = path.offset(0, 0, 1.0)
    this.handleRestLocal = toVec3(tailLifted.p)
    this.handleObject = this.makeObject(this.root, "ArrowStart_" + part.name)
    const ht = this.handleObject.getTransform()
    ht.setLocalPosition(this.handleRestLocal)
    ht.setLocalRotation(this.basisRotation(toVec3(tail.n), this.strokeDirLocal))
    this.dotMat = look.guideMaterial.clone()
    this.addVisual(this.handleObject, buildDiscMesh(1.3).getMesh(), this.dotMat)
    const collider = this.handleObject.createComponent("Physics.ColliderComponent") as ColliderComponent
    const sphere = Shape.createSphereShape()
    sphere.radius = 2.4
    collider.shape = sphere
    collider.fitVisual = false
    this.handleObject.createComponent(Interactable.getTypeName())
    const manip = this.handleObject.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation
    manip.setCanRotate(false)
    manip.setCanScale(false)
    manip.enableStretchZ = false
    manip.useFilter = false
    // created at runtime (after scene start), so binding here is safe
    manip.onManipulationStart.add(() => this.beginDrag())
    manip.onManipulationEnd.add(() => this.endDrag())

    this.updateStroke()
  }

  // ── Main → guide ──

  /** Fade out over 300 ms, then remove from the scene. */
  fadeOut(): void {
    this.fadingOut = true
    this.dragging = false
    this.greenTarget = 0
  }

  get isGone(): boolean {
    return this.destroyed
  }

  isVisible(): boolean {
    return !this.destroyed && !this.fadingOut && this.alpha > 0.01
  }

  isArrowGreen(): boolean {
    return !this.fadingOut && this.greenTarget > 0.5
  }

  arrowStartWorld(): vec3 {
    return this.toWorld(this.path.at(0).p)
  }

  arrowEndWorld(): vec3 {
    return this.toWorld(this.path.at(1).p)
  }

  /** World direction the arrow points at its start (the stroke direction). */
  arrowDirectionWorld(): vec3 {
    return this.root.getTransform().getWorldTransform().multiplyDirection(this.strokeDirLocal).normalize()
  }

  /**
   * Past the arrowhead: `aheadCm` beyond the stroke's end along its direction, `liftCm` above the
   * top of the leg there. Seen from above this keeps the text clear of the hands for most of the loop.
   */
  aheadAnchorWorld(aheadCm: number, liftCm: number): vec3 {
    const end = this.path.at(1)
    const m = this.root.getTransform().getWorldTransform()
    const endW = m.multiplyPoint(toVec3(end.p))
    const t = m.multiplyDirection(toVec3(end.t))
    const dir = new vec3(t.x, 0, t.z).normalize()
    let top = endW.y
    for (const p of this.path.shape.ringAround(this.path.shape.project(end.p))) top = Math.max(top, m.multiplyPoint(toVec3(p)).y)
    const at = endW.add(dir.uniformScale(aheadCm))
    return new vec3(at.x, top + liftCm, at.z)
  }

  /**
   * Beside the leg: the middle of the stroke, `sideCm` toward the user's right on screen. Clear of the
   * hands and the leg, so a caption there never sits on either.
   */
  sideAnchorWorld(sideCm: number, liftCm: number): vec3 {
    const mid = this.toWorld(this.path.at(0.5).p)
    const right = this.camera.right
    const flat = new vec3(right.x, 0, right.z).normalize()
    return mid.add(flat.uniformScale(sideCm)).add(new vec3(0, liftCm, 0))
  }

  update(dt: number): void {
    if (this.destroyed) return
    const target = this.fadingOut ? 0 : 1
    const step = dt / FADE_SECONDS
    this.alpha = target > this.alpha ? Math.min(1, this.alpha + step) : Math.max(0, this.alpha - step)
    if (this.fadingOut && this.alpha <= 0) {
      this.destroyed = true
      this.root.destroy()
      return
    }
    if (this.keys[0].length <= this.stations) this.poseNextKey()
    this.time += dt
    this.updateDrag(dt)
    this.updateStroke()
  }

  // ── stroke loop: ghost hands + arrow shimmer ──

  /**
   * Where the stroke is `t` seconds in: `u` = press point reached so far (0..stations, fractional while
   * gliding to the next one) and `press` = how hard the hands bear down (peaks at each press point).
   */
  private strokeAt(t: number): {u: number; press: number} {
    const N = this.stations
    const D = INTENSITY_PROFILE[this.part.intensity].strokeSeconds
    let x = (t / D) * ((N + 1) * PRESS_UNITS + N * GLIDE_UNITS)
    for (let i = 0; i <= N; i++) {
      if (x < PRESS_UNITS) return {u: i, press: PRESS_GLIDING + (1 - PRESS_GLIDING) * Math.sin(Math.PI * (x / PRESS_UNITS))}
      x -= PRESS_UNITS
      if (i === N) break
      if (x < GLIDE_UNITS) return {u: i + 0.5 - 0.5 * Math.cos(Math.PI * (x / GLIDE_UNITS)), press: PRESS_GLIDING}
      x -= GLIDE_UNITS
    }
    return {u: N, press: PRESS_GLIDING}
  }

  private updateStroke(): void {
    const prof = INTENSITY_PROFILE[this.part.intensity]
    const D = prof.strokeSeconds
    const N = this.stations
    const cycle = D + STROKE_PAUSE + 2 * HAND_FADE
    const t = this.time % cycle
    let u = N
    let press = 0
    let handFade = 1
    let shimmer = 0
    if (t < D) {
      const s = this.strokeAt(t)
      u = s.u
      press = s.press
      shimmer = 1
    } else if (t < D + STROKE_PAUSE) {
      press = PRESS_GLIDING * (1 - (t - D) / STROKE_PAUSE) // ease off after the last press
    } else if (t < D + STROKE_PAUSE + HAND_FADE) {
      handFade = 1 - (t - D - STROKE_PAUSE) / HAND_FADE
    } else {
      u = 0
      press = PRESS_GLIDING
      handFade = (t - D - STROKE_PAUSE - HAND_FADE) / HAND_FADE
    }
    const prog = u / N

    // ghost hands ride the stroke, blending between the poses at the press points (hidden until all are posed)
    const ready = this.keys[0].length > N
    if (ready) {
      const k0 = Math.min(N - 1, Math.floor(u))
      const w = u - k0
      for (let i = 0; i < this.hands.length; i++) {
        const a = this.keys[i][k0]
        const b = this.keys[i][k0 + 1]
        const joints = this.rigs[i].joints
        // bearing down = sinking along the skin normal
        const sink = vec3.lerp(a.n, b.n, w).uniformScale(prof.pressCm * press)
        joints[0].setLocalPosition(vec3.lerp(a.pos, b.pos, w).sub(sink))
        for (let j = 0; j < joints.length; j++) joints[j].setLocalRotation(quat.slerp(a.rot[j], b.rot[j], w))
      }
    }
    const hk = ready ? this.alpha * handFade : 0
    const c = this.look.handColor
    this.handMat.mainPass.baseColor = new vec4(c.x * hk, c.y * hk, c.z * hk, Math.min(0.9, this.look.ghostHandStrength * (1 + 0.3 * press)) * hk)

    // press points: dim until the hands reach them, then flare and swell while pressed, turning
    // the same confirm-green as a crossed chevron (not just a pale tint) once passed
    const gold = this.look.arrowColor
    const green = this.look.checkColor
    for (let i = 0; i < this.stationObjs.length; i++) {
      // narrow, fast falloff so the swell reads as a snap/pop at the moment of crossing, not a slow swell
      const pulse = Math.max(0, 1 - Math.abs(u - i) * 6) * press
      const visited = u >= i - 0.01 ? 1 : 0
      const k = Math.min(1.3, 0.18 + 0.55 * visited + 0.75 * pulse) * this.alpha
      const m = visited * PASSED_MIX
      this.stationMats[i].mainPass.baseColor = new vec4(
        (gold.x + (green.x - gold.x) * m) * k,
        (gold.y + (green.y - gold.y) * m) * k,
        (gold.z + (green.z - gold.z) * m) * k,
        1,
      )
      const sc = 1 + 0.6 * pulse
      this.stationObjs[i].getTransform().setLocalScale(new vec3(sc, sc, sc))
    }

    // arrow colour: gold <-> green, with a shimmer travelling with the hands
    const n = this.look.arrowColor
    const g = this.look.checkColor
    const gm = this.green
    // hue is driven only by the per-vertex crossed state (lit), never by the whole-path
    // "dragging correctly right now" flash (gm) -- gm used to blend into every vertex's
    // base color uniformly, so while gm~1 (true for most of an active correct drag) the
    // entire trail turned green together, masking the crossed/uncrossed distinction this
    // was meant to show. gm now only brightens (see k below), never changes hue.
    const base = [n.x, n.y, n.z]
    const a = this.arrow
    const verts = a.vertexS.length
    // where the thumbs are on the path, easing from a full lead at the tail down to none at the head
    const leadNow = this.leadFraction(this.part.hands[0])
    const thumbS = this.thumbTrails() ? prog * (1 - leadNow) : this.leadEase(prog, leadNow)
    const flowGain = 0.45 + 0.55 * shimmer
    for (let v = 0; v < verts; v++) {
      const sv = a.vertexS[v]
      // chevrons the thumbs have passed light up and stay lit; the ones still ahead stay dim, with a pulse
      // running along them the way the hands go and a glow just in front of the thumbs. A narrow ramp
      // (vs. a wide one) makes a chevron flip from dim to lit over a short travel distance, reading as
      // a snap rather than a gradient.
      const lit = Math.max(0, Math.min(1, (thumbS - sv) / 0.02 + 0.5))
      const phase = (sv * this.path.length) / CHEVRON_SPACING_CM / FLOW_CHEVRONS - this.time * FLOW_HZ
      const flow = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * phase), 3)
      const ahead = shimmer * Math.exp(-Math.pow((sv - thumbS - 0.05) / 0.1, 2))
      // crossed chevrons must stay the brightest state, or the pre-cross glow/flow
      // pulse (which can hit ~1.05) outshines the green and reads as "never turned
      // green" even though the color math is correct -- so lit's ceiling (0.9) is
      // raised past the pre-cross ceiling (0.85) here. gm (whole-path "correct now"
      // flash) adds brightness only, never hue -- see `base` above.
      const k = Math.min(1.3, (0.25 + 0.9 * lit + (1 - lit) * (0.3 * flowGain * flow + 0.3 * ahead)) * (1 + 0.35 * gm)) * this.alpha
      // chevrons the hand has crossed turn the same confirm-green as a correct drag (checkColor), not
      // just brighter -- a clear "crossed" signal that reads as a snap thanks to the narrow `lit` ramp
      // above. They hold green through the end-of-stroke pause, then drop back to gold together as the
      // hand fades out and the loop restarts (thumbS resets to ~0, so `lit` does too for every vertex).
      const m = lit * PASSED_MIX
      const d = a.baseData
      a.builder.setVertexInterleaved(v, [
        d[v * 6], d[v * 6 + 1], d[v * 6 + 2], d[v * 6 + 3], d[v * 6 + 4], d[v * 6 + 5],
        (base[0] + (g.x - base[0]) * m) * k,
        (base[1] + (g.y - base[1]) * m) * k,
        (base[2] + (g.z - base[2]) * m) * k,
        1,
      ])
    }
    a.builder.updateMesh()
    this.arrowMat.mainPass.baseColor = new vec4(1, 1, 1, 1)
    const dk = this.alpha * (0.75 + 0.25 * gm)
    this.dotMat.mainPass.baseColor = new vec4(base[0] * dk, base[1] * dk, base[2] * dk, 1)
  }

  /**
   * Both hands' grip with the stroke at `prog` (0 = arrow start, 1 = end), Leg-local.
   * `widenDeg` pushes each hand's palm (and thumb target) further around the limb, away from
   * centre, by this many extra degrees — used to back the hands off each other where the leg
   * narrows and the grip's nominal angles would otherwise bring them into contact.
   */
  private handSpecs(prog: number, widenDeg: number = 0, staggerCm: number = 0): HandSpec[] {
    const len = this.path.length
    return this.part.hands.map((pose, i) => {
      // The palm travels the whole stroke, start to end — it has to reach both tapped spots for
      // the massage to actually cover them. The thumb leads ahead of it by `lead` at the tail,
      // easing that lead back down to nothing by the head (see leadEase) instead of being pinned
      // there while the palm kept coming (the fold this was built to avoid).
      const lead = this.leadFraction(pose)
      const trails = this.thumbTrails()
      let s = pose.thumbOnArrow ? (trails ? lead + prog * (1 - lead) : prog) : Math.max(0, Math.min(1, prog + pose.along / len))
      // last-resort fix for a point so narrow that no angle keeps two full hands apart: nudge the
      // hands fore/aft along the stroke instead, so each works with a little more leg radius than
      // the exact narrowest cross-section, rather than both fighting over the same one
      if (staggerCm !== 0) s = Math.max(0, Math.min(1, s + (i === 0 ? -1 : 1) * (staggerCm / len)))
      const o = this.path.offset(s, 0, 0)
      // aroundDeg only ever feeds a left/right tie-break (aroundArrow, thumbTarget's side), so negating
      // it by sideSign cancels the path's own left/right (t, right) flipping cleanly when the stroke is
      // drawn the other way. fingerYawDeg instead rebuilds an actual direction vector (cos*t + sin*right)
      // — negating the angle there does NOT cancel that flip (it reconstructs the vector pointing the
      // wrong way); adding 180 degrees does, since cos/sin of (yaw+180) are both negated together,
      // matching t and right both flipping sign together.
      const reversed = this.sideSign() < 0
      const yaw = (pose.fingerYawDeg + (reversed ? 180 : 0) + (this.flipFingers[i] ? 180 : 0)) * DEG
      const thumbS = trails ? Math.max(0, s - lead) : this.leadEase(s, lead)
      return {
        palm: this.aroundArrow(o, this.widen(pose.aroundDeg * this.sideSign(), widenDeg)),
        fingers: Math.abs(pose.fingerYawDeg) > WRAP_YAW_DEG ? undefined : add(scale(o.t, Math.cos(yaw)), scale(o.right, Math.sin(yaw))),
        fingersFixed: true,
        thumbTarget: pose.thumbOnArrow ? this.thumbTarget(pose, thumbS, widenDeg) : undefined,
        maxCurlDeg: pose.curlDeg,
        thumbOpen: pose.thumbOpen,
      }
    })
  }

  /** `deg` pushed `extraDeg` further from centre (magnitude up from 0), capped short of the limb's far side. */
  private widen(deg: number, extraDeg: number): number {
    return Math.sign(deg) * Math.min(MAX_AROUND_DEG, Math.abs(deg) + extraDeg)
  }

  /**
   * +1 when the path runs a leg stroke's natural a-direction (decreasing, e.g. Calf's ankle -> knee);
   * -1 when the user drew it the other way. The path's own (t, right) frame flips together with draw
   * direction (right = cross(t, n), and n doesn't depend on draw direction) — so aroundDeg, which only
   * ever feeds a left/right sign comparison, is corrected by negating it (two sign flips cancel). Foot-
   * region strokes (Sole) are left alone: a has a different meaning there.
   */
  private sideSign(): number {
    const pts = this.path.pts
    if (this.path.shape.project(pts[0]).region !== "leg") return 1
    return pts[pts.length - 1][0] < pts[0][0] ? 1 : -1
  }

  /**
   * Where the thumb tip rests, on its own side of the arrow line. By angle around the limb when the grip gives
   * one (so the two thumbs keep apart where the leg narrows toward the ankle), otherwise by cm across.
   */
  private thumbTarget(pose: HandPose, thumbS: number, widenDeg: number): V3 {
    const side = Math.sign(pose.aroundDeg * this.sideSign())
    if (pose.thumbAroundDeg !== undefined) return this.aroundArrow(this.path.offset(thumbS, 0, 0), side * this.widen(pose.thumbAroundDeg, widenDeg)).p
    return this.path.offset(thumbS, side * (pose.thumbAcrossCm ?? THUMB_ACROSS_CM), 0).p
  }

  /** How far the thumb tip leads the palm at the tail, as a share of the stroke (0 when the thumb is off the arrow). */
  private leadFraction(pose: HandPose): number {
    if (!pose.thumbOnArrow) return 0
    return Math.min(MAX_LEAD_FRACTION, (pose.thumbLeadCm ?? THUMB_LEAD_CM) / this.path.length)
  }

  /**
   * Thumb position (path s) for a thumb that leads the palm: `lead` ahead at the tail, easing down
   * toward the head but never all the way to zero. A full ease-to-nothing was tried and rejected:
   * with no lead left the thumb's target sits right where the palm already is — right at the edge
   * of the part's usable zone (close to the knee bulge for Calf) — and visually reads as the thumb
   * collapsing into the palm. Capping the ease at `MIN_LEAD_KEEP` of the full lead keeps a small,
   * deliberate gap there; the thumb then clamps against the head by that same small amount instead
   * of folding (the much larger pin this replaced).
   */
  private leadEase(s: number, lead: number): number {
    return Math.min(1, s + lead * (MIN_LEAD_KEEP + (1 - MIN_LEAD_KEEP) * (1 - s)))
  }

  /** The stroke runs toward the ankle but the thumb stays on the knee side: it sits behind the palm instead of ahead of it. */
  private thumbTrails(): boolean {
    const h = this.part.hands[0]
    const pts = this.path.pts
    return !!h.thumbOnArrow && !!h.thumbKneeSide && pts[pts.length - 1][0] > pts[0][0]
  }

  /** Path position of the thumb tip at progress 0 (it leads the palm, or starts at the tail when it trails). */
  private thumbStartS(): number {
    return this.stationS(0)
  }

  /**
   * Path position of press point/dot `i`, evenly spaced across the full tapped stroke (0 to 1) so
   * every inter-station gap is identical — this keeps the marks and the chevron trail between them
   * honoring the real start and end points with no gap. Deliberately NOT run through `leadEase`:
   * that function eases the thumb's own pose target near the stroke's head (see leadEase's doc) and
   * is unrelated to where a mark is drawn — coupling the two once caused the trailing gaps to compress
   * below `buildChevronMesh`'s minimum room, silently dropping chevrons near the end.
   */
  private stationS(i: number): number {
    return i / this.stations
  }

  /** The skin `deg` degrees around the limb from the arrow point `o` (+ = right of the arrow). */
  private aroundArrow(o: {p: V3; right: V3}, deg: number): SurfaceSample {
    const shape = this.path.shape
    const at = shape.project(o.p)
    const s1 = shape.sampleAt(at.region, at.a, at.b + deg)
    const s2 = shape.sampleAt(at.region, at.a, at.b - deg)
    const toRight = (q: SurfaceSample) => dot(sub(q.p, o.p), o.right) * Math.sign(deg)
    const t1 = toRight(s1)
    const t2 = toRight(s2)
    return t1 >= t2 ? s1 : s2
  }

  /** Reset every joint in every rig to its rest pose, ready to pose again from scratch. */
  private resetRigs(): void {
    for (const rig of this.rigs) {
      rig.joints[0].setLocalPosition(rig.restPos)
      rig.joints.forEach((t, j) => t.setLocalRotation(rig.restRot[j]))
    }
  }

  /**
   * Pose both hands for key `k` (0..stations) at widen amount `widen` and record the result,
   * overwriting that key if it already exists. The hands are left in this pose when the call
   * returns; callers that only want to measure it (not display it) must pose over it again.
   */
  private buildKey(k: number, widen: number, stagger: number = 0): void {
    this.resetRigs()
    const specs = this.handSpecs(k / this.stations, widen, stagger)
    this.poser.pose(specs, this.hands, this.sides)
    // gentle hovers just off the skin, firm sinks in a little
    const lift = INTENSITY_PROFILE[this.part.intensity].liftCm
    const m = this.root.getTransform().getWorldTransform()
    for (let i = 0; i < this.hands.length; i++) {
      const ht = this.hands[i].getTransform()
      const n = m.multiplyDirection(toVec3(specs[i].palm.n)).normalize()
      ht.setWorldPosition(ht.getWorldPosition().add(n.uniformScale(lift)))
      const entry = {pos: ht.getLocalPosition(), n: toVec3(specs[i].palm.n), rot: this.rigs[i].joints.map((t) => t.getLocalRotation())}
      if (k < this.keys[i].length) this.keys[i][k] = entry
      else this.keys[i].push(entry)
    }
    this.keyWiden[k] = widen
    this.keyStagger[k] = stagger
  }

  /** Pose both hands for the next point along the stroke and keep the result. */
  private poseNextKey(): void {
    const k = this.keys[0].length
    let widen = 0
    this.buildKey(k, widen)
    // two hands only: back them off each other (wider around the limb) until they actually clear,
    // checked on the posed joints themselves rather than guessed from the grip's nominal angles —
    // a grip that looks fine on a wide calf can still close up where the leg narrows to the ankle
    if (this.hands.length === 2) {
      for (let iter = 0; iter < MAX_WIDEN_STEPS && minJointDistance(this.hands[0], this.hands[1]) < MIN_HAND_GAP_CM; iter++) {
        widen += WIDEN_STEP_DEG
        this.buildKey(k, widen)
      }
      // widening alone has a ceiling: at the true ankle minimum, no angle keeps two full hands
      // apart, since they're just wider than the limb is round there. Once widen is maxed out and
      // the hands still touch, stagger them slightly fore/aft along the stroke instead, so each
      // works with a bit more leg radius than the exact narrowest cross-section.
      let stagger = 0
      for (let iter = 0; iter < MAX_STAGGER_STEPS && minJointDistance(this.hands[0], this.hands[1]) < MIN_HAND_GAP_CM; iter++) {
        stagger += STAGGER_STEP_CM
        this.buildKey(k, widen, stagger)
      }
    }
    this.keyBaseWiden[k] = widen
    // the last key: every key now exists, so the glides between them (not just the keys
    // themselves) can be checked and corrected
    if (k === this.stations) this.resolveGlideOverlaps()
  }

  /**
   * A key pair can each individually clear the other hand yet still cross mid-glide: the runtime
   * blend is a per-joint slerp, which doesn't track the leg's surface, so the path between two
   * safe poses isn't guaranteed safe itself. Sample a few points along every glide and, if any are
   * too close, widen whichever of its two keys is currently less widened and recheck — but only up
   * to a small extra amount past that key's own widen. This is fixing a blend artifact, not
   * re-tuning either key's pose, so it must not have the range to drag an otherwise-fine key (a
   * wide point that never needed widening) toward the side of the leg; a residual, minor mid-glide
   * approach is a smaller problem than that.
   */
  private resolveGlideOverlaps(): void {
    if (this.hands.length !== 2) return
    const samples = [0.2, 0.35, 0.5, 0.65, 0.8]
    const cap = (k: number) => this.keyBaseWiden[k] + MAX_GLIDE_EXTRA_STEPS * WIDEN_STEP_DEG
    for (let k0 = 0; k0 < this.stations; k0++) {
      for (let guard = 0; guard < MAX_GLIDE_EXTRA_STEPS; guard++) {
        if (!samples.some((w) => this.overlapAtGlide(k0, w))) break
        const lower = this.keyWiden[k0] <= this.keyWiden[k0 + 1] ? k0 : k0 + 1
        if (this.keyWiden[lower] >= cap(lower)) break // out of budget for this key; accept the residual risk
        this.buildKey(lower, this.keyWiden[lower] + WIDEN_STEP_DEG, this.keyStagger[lower])
      }
    }
  }

  /** Whether the two hands would overlap `w` of the way through the blend from key `k0` to `k0 + 1`
   * (the same blend `updateStroke` plays) — leaves the rigs in that pose; callers don't rely on it. */
  private overlapAtGlide(k0: number, w: number): boolean {
    for (let i = 0; i < 2; i++) {
      const a = this.keys[i][k0]
      const b = this.keys[i][k0 + 1]
      const joints = this.rigs[i].joints
      joints[0].setLocalPosition(vec3.lerp(a.pos, b.pos, w))
      for (let j = 0; j < joints.length; j++) joints[j].setLocalRotation(quat.slerp(a.rot[j], b.rot[j], w))
    }
    return minJointDistance(this.hands[0], this.hands[1]) < MIN_HAND_GAP_CM
  }

  // ── direction check (drag the arrow-start dot along the arrow) ──

  private beginDrag(): void {
    if (this.fadingOut) return
    this.dragging = true
    this.chimedThisDrag = false
    this.handleReturn = 0
    this.dragStartWorld = this.root.getTransform().getWorldTransform().multiplyPoint(this.handleRestLocal)
  }

  private endDrag(): void {
    if (!this.dragging) return
    this.dragging = false
    this.greenTarget = 0 // fades back to neutral over 300 ms
    this.handleReleaseWorld = this.handleObject.getTransform().getWorldPosition()
    this.handleReturn = 0.0001
  }

  private updateDrag(dt: number): void {
    const ht = this.handleObject.getTransform()
    const restWorld = this.root.getTransform().getWorldTransform().multiplyPoint(this.handleRestLocal)
    if (this.dragging) {
      const d = ht.getWorldPosition().sub(this.dragStartWorld)
      this.greenTarget = this.evaluateDirection(d, restWorld) ? 1 : 0
      if (this.greenTarget > 0.5 && !this.chimedThisDrag) {
        this.chimedThisDrag = true
        this.onDirectionMatched()
      }
    } else if (this.handleReturn > 0) {
      this.handleReturn = Math.min(1, this.handleReturn + dt / FADE_SECONDS)
      const e = 1 - Math.pow(1 - this.handleReturn, 3)
      ht.setWorldPosition(vec3.lerp(this.handleReleaseWorld, restWorld, e))
      if (this.handleReturn >= 1) {
        this.handleReturn = 0
        ht.setLocalPosition(this.handleRestLocal)
      }
    }
    const rate = this.greenTarget > this.green ? dt / 0.1 : dt / FADE_SECONDS
    this.green = this.greenTarget > this.green ? Math.min(this.greenTarget, this.green + rate) : Math.max(this.greenTarget, this.green - rate)
  }

  /**
   * True when displacement `d` follows the arrow: ≥ dragMinCm along it, within dragMaxAngleDeg.
   * Judged in the plane facing the viewer (mouse drags move in that plane), with the
   * arrow's foreshortening compensated.
   */
  private evaluateDirection(d: vec3, restWorld: vec3): boolean {
    const T = this.arrowDirectionWorld()
    const view = restWorld.sub(this.camera.getWorldPosition()).normalize()
    const dp = d.sub(view.uniformScale(d.dot(view)))
    const Tp = T.sub(view.uniformScale(T.dot(view)))
    const k = Math.max(0.25, Tp.length)
    const Th = Tp.normalize()
    const alongScreen = dp.dot(Th)
    if (alongScreen <= 0) return false
    const perp = dp.sub(Th.uniformScale(alongScreen)).length
    const angle = (Math.atan2(perp, alongScreen) * 180) / Math.PI
    return alongScreen / k >= this.look.dragMinCm && angle <= this.look.dragMaxAngleDeg
  }

  // ── helpers ──

  private toWorld(p: [number, number, number]): vec3 {
    return this.root.getTransform().getWorldTransform().multiplyPoint(toVec3(p))
  }

  /** Rotation whose +Z points along `forward` and +Y along `up` (convention-checked). */
  private basisRotation(forward: vec3, up: vec3): quat {
    let q = quat.lookAt(forward, up)
    if (q.multiplyVec3(vec3.forward()).dot(forward) < 0) q = q.multiply(quat.angleAxis(Math.PI, vec3.up()))
    return q
  }

  private makeObject(parent: SceneObject, name: string): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    return so
  }

  private addVisual(so: SceneObject, mesh: RenderMesh, mat: Material): void {
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = mesh
    rmv.mainMaterial = mat
  }
}
