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
import {INTENSITY_PROFILE, PartDef} from "./HandsOnParts"
import {HandSpec, HandsOnHandPoser, Side, allTransforms, ghostHandMaterial, useFullMesh} from "./HandsOnHandPoser"
import {ArrowMesh, StrokePath, SurfaceSample, V3, add, buildArrowMesh, buildDiscMesh, dot, scale, sub, toVec3} from "./HandsOnLegGeometry"

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
/** Points along the stroke where the hands are posed; they blend between these while looping. */
const POSE_KEYS = 6
/** Fingers set within this angle of the stroke point that way; beyond it they wrap the limb. */
const WRAP_YAW_DEG = 45
/** Thumbs on the arrow rest this far ahead of the palm, either side of the line. */
const THUMB_LEAD_CM = 1.5
const THUMB_ACROSS_CM = 0.9
const ARROW_WIDTH_CM = 3
const ARROW_LIFT_CM = 0.45

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
  /** Per hand, per pose key: the hand's position and every joint's rotation (local). */
  private readonly keys: {pos: vec3; rot: quat[]}[][] = []
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
    this.root = this.makeObject(container, "Guide_" + part.name)
    const rt = this.root.getTransform()
    rt.setWorldPosition(legPose.position)
    rt.setWorldRotation(legPose.rotation)

    // ── arrow along the surface ──
    const arrowObj = this.makeObject(this.root, "Arrow_" + part.name)
    this.arrow = buildArrowMesh(path, ARROW_WIDTH_CM, ARROW_LIFT_CM)
    this.arrowMat = look.guideMaterial.clone()
    this.addVisual(arrowObj, this.arrow.builder.getMesh(), this.arrowMat)

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

  /** Where the technique label goes: `heightCm` above the arrow's middle, clear of the leg under it. */
  labelAnchorWorld(heightCm: number): vec3 {
    const mid = this.path.at(0.5)
    const m = this.root.getTransform().getWorldTransform()
    const midW = m.multiplyPoint(toVec3(mid.p))
    let top = midW.y
    for (const p of this.path.shape.ringAround(this.path.shape.project(mid.p))) top = Math.max(top, m.multiplyPoint(toVec3(p)).y)
    return new vec3(midW.x, top + heightCm, midW.z)
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
    if (this.keys[0].length < POSE_KEYS) this.poseNextKey()
    this.time += dt
    this.updateDrag(dt)
    this.updateStroke()
  }

  // ── stroke loop: ghost hands + arrow shimmer ──

  private updateStroke(): void {
    const prof = INTENSITY_PROFILE[this.part.intensity]
    const D = prof.strokeSeconds
    const cycle = D + STROKE_PAUSE + 2 * HAND_FADE
    const t = this.time % cycle
    let prog = 1
    let handFade = 1
    let shimmer = 0
    if (t < D) {
      prog = 0.5 - 0.5 * Math.cos(Math.PI * (t / D)) // ease-in / ease-out
      shimmer = 1
    } else if (t < D + STROKE_PAUSE) {
      prog = 1
    } else if (t < D + STROKE_PAUSE + HAND_FADE) {
      prog = 1
      handFade = 1 - (t - D - STROKE_PAUSE) / HAND_FADE
    } else {
      prog = 0
      handFade = (t - D - STROKE_PAUSE - HAND_FADE) / HAND_FADE
    }

    // ghost hands ride the stroke, blending between the poses along it (hidden until all are posed)
    const ready = this.keys[0].length >= POSE_KEYS
    if (ready) {
      const f = prog * (POSE_KEYS - 1)
      const k0 = Math.min(POSE_KEYS - 2, Math.floor(f))
      const w = f - k0
      for (let i = 0; i < this.hands.length; i++) {
        const a = this.keys[i][k0]
        const b = this.keys[i][k0 + 1]
        const joints = this.rigs[i].joints
        joints[0].setLocalPosition(vec3.lerp(a.pos, b.pos, w))
        for (let j = 0; j < joints.length; j++) joints[j].setLocalRotation(quat.slerp(a.rot[j], b.rot[j], w))
      }
    }
    const hk = ready ? this.alpha * handFade : 0
    const c = this.look.handColor
    this.handMat.mainPass.baseColor = new vec4(c.x * hk, c.y * hk, c.z * hk, this.look.ghostHandStrength * hk)

    // arrow colour: neutral pale blue <-> green, with a shimmer travelling with the hands
    const n = this.look.arrowColor
    const g = this.look.checkColor
    const gm = this.green
    const base = [n.x + (g.x - n.x) * gm, n.y + (g.y - n.y) * gm, n.z + (g.z - n.z) * gm]
    const a = this.arrow
    const verts = a.vertexS.length
    for (let v = 0; v < verts; v++) {
      const sv = a.vertexS[v]
      const glow = 0.5 + 0.7 * shimmer * Math.exp(-Math.pow((sv - prog) / 0.08, 2))
      const k = Math.min(1.2, glow) * this.alpha
      const d = a.baseData
      a.builder.setVertexInterleaved(v, [d[v * 6], d[v * 6 + 1], d[v * 6 + 2], d[v * 6 + 3], d[v * 6 + 4], d[v * 6 + 5], base[0] * k, base[1] * k, base[2] * k, 1])
    }
    a.builder.updateMesh()
    this.arrowMat.mainPass.baseColor = new vec4(1, 1, 1, 1)
    const dk = this.alpha * (0.75 + 0.25 * gm)
    this.dotMat.mainPass.baseColor = new vec4(base[0] * dk, base[1] * dk, base[2] * dk, 1)
  }

  /** Both hands' grip with the stroke at `prog` (0 = arrow start, 1 = end), Leg-local. */
  private handSpecs(prog: number): HandSpec[] {
    const len = this.path.length
    return this.part.hands.map((pose, i) => {
      const s = Math.max(0, Math.min(1, prog + pose.along / len))
      const o = this.path.offset(s, 0, 0)
      const yaw = (pose.fingerYawDeg + (this.flipFingers[i] ? 180 : 0)) * DEG
      const thumbS = Math.max(0, Math.min(1, s + THUMB_LEAD_CM / len))
      return {
        palm: this.aroundArrow(o, pose.aroundDeg),
        fingers: Math.abs(pose.fingerYawDeg) > WRAP_YAW_DEG ? undefined : add(scale(o.t, Math.cos(yaw)), scale(o.right, Math.sin(yaw))),
        fingersFixed: true,
        thumbTarget: pose.thumbOnArrow ? this.path.offset(thumbS, Math.sign(pose.aroundDeg) * THUMB_ACROSS_CM, 0).p : undefined,
        maxCurlDeg: pose.curlDeg,
      }
    })
  }

  /** The skin `deg` degrees around the limb from the arrow point `o` (+ = right of the arrow). */
  private aroundArrow(o: {p: V3; right: V3}, deg: number): SurfaceSample {
    const shape = this.path.shape
    const at = shape.project(o.p)
    const s1 = shape.sampleAt(at.region, at.a, at.b + deg)
    const s2 = shape.sampleAt(at.region, at.a, at.b - deg)
    const toRight = (q: SurfaceSample) => dot(sub(q.p, o.p), o.right) * Math.sign(deg)
    return toRight(s1) >= toRight(s2) ? s1 : s2
  }

  /** Pose both hands for the next point along the stroke and keep the result. */
  private poseNextKey(): void {
    const k = this.keys[0].length
    for (const rig of this.rigs) {
      rig.joints[0].setLocalPosition(rig.restPos)
      rig.joints.forEach((t, j) => t.setLocalRotation(rig.restRot[j]))
    }
    const specs = this.handSpecs(k / (POSE_KEYS - 1))
    this.poser.pose(specs, this.hands, this.sides)
    // gentle hovers just off the skin, firm sinks in a little
    const lift = INTENSITY_PROFILE[this.part.intensity].liftCm
    const m = this.root.getTransform().getWorldTransform()
    for (let i = 0; i < this.hands.length; i++) {
      const ht = this.hands[i].getTransform()
      const n = m.multiplyDirection(toVec3(specs[i].palm.n)).normalize()
      ht.setWorldPosition(ht.getWorldPosition().add(n.uniformScale(lift)))
      this.keys[i].push({pos: ht.getLocalPosition(), rot: this.rigs[i].joints.map((t) => t.getLocalRotation())})
    }
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
