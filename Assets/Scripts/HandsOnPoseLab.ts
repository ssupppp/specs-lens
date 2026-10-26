/**
 * HandsOnPoseLab — MVP gallery of massage grips, for reviewing hand posture. Not part of the
 * normal flow: leave this SceneObject disabled unless reviewing poses.
 *
 * Owns: placing two posed ghost hands (SIK's rigged hand mesh, via GhostHandL/R prefabs) on
 * the leg for the chosen grip, and re-posing them when the leg is turned or the user moves.
 * Placement: each palm sits on its body-part spot (mirrored to the side the user can reach);
 * HandsOnHandPoser does the posing, the same way the guide's ghost hands are posed.
 * Must not: change HandsOn state beyond pausing its UI while the lab is on.
 */
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {HandsOnLegModel} from "./HandsOnLegModel"
import {HandSpec, HandsOnHandPoser, ghostHandMaterial, useFullMesh} from "./HandsOnHandPoser"
import {Region, V3, scale} from "./HandsOnLegGeometry"

const DEG = Math.PI / 180
/** Re-pose when the leg or the user moves more than this (checked a few times a second). */
const REPOSE_MOVE_CM = 2
const REPOSE_TURN_DEG = 3
const REPOSE_CHECK_S = 0.3

interface Spot {
  region: Region
  a: number
  b: number
}

interface GripHand {
  palm: Spot
  fingers?: V3
  thumbTarget?: Spot
  maxCurlDeg: number
}

interface Grip {
  name: string
  hands: GripHand[]
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

function mirrorHand(h: GripHand): GripHand {
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
  @hint("Lit material for the ghost hands (cloned, tinted and made see-through)")
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
  private poser: HandsOnHandPoser
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
    this.poser = new HandsOnHandPoser(this.legModel.shape, this.legModel.getSceneObject().getTransform(), this.camera)
    this.mat = ghostHandMaterial(this.handMaterial, new vec3(0.5, 0.68, 0.98), 0.6)
    this.show()
  }

  /** Re-pose when the leg has rolled/moved or the user has moved (not mid-roll). */
  private watch(): void {
    if (!this.camera || getTime() - this.lastCheck < REPOSE_CHECK_S) return
    this.lastCheck = getTime()
    if (this.legModel.isRolling()) return
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
    const original = grip.hands.map((h) => this.toSpec(h))
    const mirrored = grip.hands.map((h) => this.toSpec(mirrorHand(h)))
    const specs = this.poser.facing(mirrored) > this.poser.facing(original) ? mirrored : original
    const sides = this.poser.sides(specs)
    for (const side of sides) {
      const hand = (side === "R" ? this.rightHandPrefab : this.leftHandPrefab).instantiate(this.legModel.getSceneObject())
      hand.name = "PoseHand_" + side
      useFullMesh(hand, this.mat)
      this.hands.push(hand)
    }
    this.poser.pose(specs, this.hands, sides)
    print("[PoseLab] showing grip " + this.gripIndex + ": " + grip.name)
  }

  private toSpec(h: GripHand): HandSpec {
    const shape = this.legModel.shape
    return {
      palm: shape.sampleAt(h.palm.region, h.palm.a, h.palm.b),
      fingers: h.fingers,
      thumbTarget: h.thumbTarget ? shape.sampleAt(h.thumbTarget.region, h.thumbTarget.a, h.thumbTarget.b).p : undefined,
      maxCurlDeg: h.maxCurlDeg,
    }
  }
}
