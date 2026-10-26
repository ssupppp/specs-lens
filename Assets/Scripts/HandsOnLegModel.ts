/**
 * HandsOnLegModel — the stand-in lower leg (knee down to foot), its cushion, and how
 * the user touches it.
 *
 * Owns: building the plain grey leg + foot mesh on this SceneObject ("Leg") in a natural
 * pose, the low cushion mesh on the authored Cushion object, a mesh collider + SIK
 * Interactable on the leg (a click = a palm spot), and the leg's two fixed positions on
 * the bed: face down (as authored) and face up, rolled between over ROLL_SECONDS.
 * Public API: shape (LegShape), onTap (Event<LegTap>), setPose(), getPose(), isRolling(),
 *   getLegRotation(), surfaceToWorld(), worldToLocal().
 * Expects: legMaterial, cushionMaterial, cushion (authored SceneObject, sibling of Leg);
 *   the Leg's authored rotation is the face-down position.
 * Must not: own guide/step state (HandsOnMain does) or show text.
 */
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {Interactor} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {InteractorEvent} from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {LegShape, Region, SurfaceSample, V3, buildCushionMesh, buildLegMesh, fromVec3, toVec3} from "./HandsOnLegGeometry"
import {LegPose} from "./HandsOnParts"

/** A palm spot placed by a short click on the leg (world space). */
export interface LegTap {
  position: vec3
  normal: vec3
}

/** How long the leg takes to roll between face down and face up. */
const ROLL_SECONDS = 0.7

@component
export class HandsOnLegModel extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">HandsOnLegModel – stand-in leg + cushion</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("Material for the plain light-grey leg")
  legMaterial: Material

  @input
  @hint("Material for the low cushion under the leg")
  cushionMaterial: Material

  @input
  @hint("Authored Cushion SceneObject (sibling of this Leg); its height is fitted under the leg at start")
  cushion: SceneObject
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Knee-to-ankle length of the lower leg, cm (knee to heel is about this + 6)")
  @widget(new SliderWidget(30, 50, 0.5))
  shankLengthCm: number = 39

  @input
  @hint("Heel to big-toe tip, cm")
  @widget(new SliderWidget(20, 30, 0.5))
  footLengthCm: number = 25

  @input
  @hint("How much the relaxed foot points its toes away from the knee, degrees")
  @widget(new SliderWidget(0, 45, 1))
  footPlantarflexDeg: number = 25

  @input
  @hint("Cushion size W/H/D in cm")
  cushionSizeCm: vec3 = new vec3(62, 7, 26)
  @ui.group_end

  private shapeCache: LegShape | null = null
  private readonly tapEvent = new Event<LegTap>()
  private legMat: Material | null = null
  private baseColor: vec4 = new vec4(0.42, 0.43, 0.45, 1)
  private hover = 0
  private hoverTarget = 0

  // active click on the leg
  private active: Interactor | null = null
  private hitPos: vec3 = vec3.zero()
  private hitNormal: vec3 = vec3.up()

  // position on the bed (local rotations of this object)
  private pose: LegPose = "faceDown"
  private faceDownRot: quat = quat.quatIdentity()
  private faceUpRot: quat = quat.quatIdentity()
  private rollFrom: quat = quat.quatIdentity()
  private rollTo: quat = quat.quatIdentity()
  private rollT = 1

  /** Parametric leg surface (Leg-local cm). Built lazily so other scripts can call it from their onAwake. */
  get shape(): LegShape {
    if (!this.shapeCache) {
      this.shapeCache = new LegShape({
        shankLengthCm: this.shankLengthCm,
        kneeRadiusCm: 5.3,
        ankleRadiusCm: 3.0,
        calfBulgeCm: 2.4,
        footLengthCm: this.footLengthCm,
        plantarflexDeg: this.footPlantarflexDeg,
      })
    }
    return this.shapeCache
  }

  /** Fires when a short click lands on the leg (a palm spot). */
  get onTap(): PublicApi<LegTap> {
    return this.tapEvent.publicApi()
  }

  /** Roll the leg to lie face down or face up (instantly when `animate` is false). */
  setPose(pose: LegPose, animate: boolean = true): void {
    if (pose === this.pose && this.rollT >= 1) return
    this.pose = pose
    this.rollFrom = this.sceneObject.getTransform().getLocalRotation()
    this.rollTo = pose === "faceUp" ? this.faceUpRot : this.faceDownRot
    this.rollT = animate ? 0 : 1
    if (!animate) this.applyRoll()
  }

  /** The position the leg is in, or rolling toward. */
  getPose(): LegPose {
    return this.pose
  }

  isRolling(): boolean {
    return this.rollT < 1
  }

  getLegRotation(): quat {
    return this.sceneObject.getTransform().getWorldRotation()
  }

  /** World position + normal of a surface coordinate on the leg as it is now. */
  surfaceToWorld(region: Region, a: number, b: number): {position: vec3; normal: vec3} {
    const s = this.shape.sampleAt(region, a, b)
    const m = this.sceneObject.getTransform().getWorldTransform()
    return {position: m.multiplyPoint(toVec3(s.p)), normal: m.multiplyDirection(toVec3(s.n)).normalize()}
  }

  /** Nearest surface point (Leg-local) to a world point, using the leg as it is now. */
  projectWorld(world: vec3): SurfaceSample {
    return this.shape.project(this.worldToLocal(world))
  }

  worldToLocal(world: vec3): V3 {
    return fromVec3(this.sceneObject.getTransform().getInvertedWorldTransform().multiplyPoint(world))
  }

  onAwake(): void {
    // authored rotation = face down; face up = rolled half a turn around the leg's long axis (+X)
    this.faceDownRot = this.sceneObject.getTransform().getLocalRotation()
    this.faceUpRot = this.faceDownRot.multiply(quat.angleAxis(Math.PI, vec3.right()))

    const legRmv = this.sceneObject.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    const legMesh = buildLegMesh(this.shape).getMesh()
    legRmv.mesh = legMesh
    if (this.legMaterial) {
      this.legMat = this.legMaterial.clone()
      this.baseColor = this.legMat.mainPass.baseColor
      legRmv.mainMaterial = this.legMat
    } else {
      console.warn("[HandsOnLegModel] legMaterial not wired")
    }

    // collider + interactable: the whole leg is one big target
    const collider = this.sceneObject.createComponent("Physics.ColliderComponent") as ColliderComponent
    const meshShape = Shape.createMeshShape()
    meshShape.mesh = legMesh
    collider.shape = meshShape
    collider.fitVisual = false
    const interactable = this.sceneObject.createComponent(Interactable.getTypeName()) as Interactable

    this.createEvent("OnStartEvent").bind(() => {
      interactable.onHoverEnter.add(() => (this.hoverTarget = 1))
      interactable.onHoverExit.add(() => (this.hoverTarget = 0))
      interactable.onTriggerStart.add((e) => this.beginPress(e))
      interactable.onTriggerEnd.add((e) => this.endPress(e, true))
      interactable.onTriggerEndOutside.add((e) => this.endPress(e, true))
      interactable.onTriggerCanceled.add((e) => this.endPress(e, false))
    })
    this.createEvent("UpdateEvent").bind(() => {
      this.updateHover()
      this.updateRoll()
    })

    if (this.cushion) {
      const s = this.cushionSizeCm
      const cushionRmv = this.cushion.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      cushionRmv.mesh = buildCushionMesh(s.x, s.y, s.z).getMesh()
      if (this.cushionMaterial) cushionRmv.mainMaterial = this.cushionMaterial
      this.fitCushionUnderLeg()
    } else {
      console.warn("[HandsOnLegModel] cushion not wired; skipping cushion")
    }
  }

  // ── click = palm spot ──

  private beginPress(e: InteractorEvent): void {
    if (this.active) return
    const it = e.interactor
    this.active = it
    const hit = it.targetHitInfo?.hit ?? null
    if (hit) {
      this.hitPos = hit.position
      this.hitNormal = hit.normal
    } else {
      // no physics hit (scripted interactors): use the nearest surface point to where it aims
      const aim = it.targetHitPosition ?? it.endPoint ?? this.sceneObject.getTransform().getWorldPosition()
      const m = this.sceneObject.getTransform().getWorldTransform()
      const s = this.shape.project(this.worldToLocal(aim))
      this.hitPos = m.multiplyPoint(toVec3(s.p))
      this.hitNormal = m.multiplyDirection(toVec3(s.n)).normalize()
    }
  }

  private endPress(e: InteractorEvent, completed: boolean): void {
    if (e.interactor !== this.active) return
    this.active = null
    // the spot is where the press landed; clicks while rolling are ignored
    if (completed && !this.isRolling()) this.tapEvent.invoke({position: this.hitPos, normal: this.hitNormal})
  }

  // ── rolling between positions ──

  private updateRoll(): void {
    if (this.rollT >= 1) return
    this.rollT = Math.min(1, this.rollT + getDeltaTime() / ROLL_SECONDS)
    this.applyRoll()
  }

  private applyRoll(): void {
    const t = this.rollT
    const eased = t * t * (3 - 2 * t)
    this.sceneObject.getTransform().setLocalRotation(quat.slerp(this.rollFrom, this.rollTo, eased))
    if (this.cushion) this.fitCushionUnderLeg()
  }

  // ── hover highlight + cushion ──

  private updateHover(): void {
    if (!this.legMat || this.hover === this.hoverTarget) return
    const step = getDeltaTime() / 0.15
    this.hover = this.hoverTarget > this.hover ? Math.min(1, this.hover + step) : Math.max(0, this.hover - step)
    const k = 1 + 0.18 * this.hover
    const c = this.baseColor
    this.legMat.mainPass.baseColor = new vec4(Math.min(1, c.x * k), Math.min(1, c.y * k), Math.min(1, c.z * k), c.w)
  }

  /** Rest the cushion top just under the lowest point of the leg (in the cushion parent's space). */
  private fitCushionUnderLeg(): void {
    const parent = this.cushion.getParent()
    if (!parent) return
    const toParent = parent.getTransform().getInvertedWorldTransform()
    const legWorld = this.sceneObject.getTransform().getWorldTransform()
    let minY = 1e9
    const shape = this.shape
    for (let a = 0; a <= shape.params.shankLengthCm; a += 2) {
      for (let th = 0; th < 360; th += 10) {
        const p = shape.legPoint(a, th)
        const w = toParent.multiplyPoint(legWorld.multiplyPoint(new vec3(p[0], p[1], p[2])))
        if (w.y < minY) minY = w.y
      }
    }
    const t = this.cushion.getTransform()
    const pos = t.getLocalPosition()
    // sink the leg ~0.8 cm into the soft cushion so it reads as resting, not floating
    t.setLocalPosition(new vec3(pos.x, minY - this.cushionSizeCm.y / 2 + 0.8, pos.z))
  }
}
