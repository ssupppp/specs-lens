/**
 * HandsOnMain — orchestrates the HandsOn lower-leg massage guide.
 *
 * Owns (single source of truth): the current step, the palm spots, the chosen part, and the
 * placed guide. Flow:
 *   placeStart --tap leg--> placeEnd --tap leg--> pickPart --pinch a part--> guide
 *   guide --pinch label--> pickPart (+ "Off") --part--> placeStart (part remembered) ... --> guide
 *                                             --Off--> placeStart (guide + spots fade out)
 * Also: start-pose placement of the leg rig and the click/chime sounds.
 * Expects (@input): legModel (HandsOnLegModel on "Leg"), guideUI (HandsOnGuideUI),
 *   legRig (the movable "LegRig" unit), guideMaterial (additive unlit, vertex colour).
 * Must not: author text or UIKit (HandsOnGuideUI does) or build leg geometry (HandsOnLegModel does).
 *
 * Observable state for tests: getStep(), getSpotCount(), getSpotPositions(), areChoicesVisible(),
 * getChoiceOptions(), getChosenPartId(), getPendingPartId(), getLabelText(), isGuideVisible(),
 * getArrowStart(), getArrowEnd(), getArrowDirection(), isArrowGreen(), getHintText(),
 * isHintVisible(), getLegTurnDeg(), getLegRotation(), getSuggestedSpotWorld(), tapLegAt().
 * Size: ~100 lines are the read-only test getters; the flow itself is the "the flow" section.
 */
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {HandsOnGuide} from "./HandsOnGuide"
import {HandsOnGuideUI} from "./HandsOnGuideUI"
import {HandsOnLegModel, LegTap} from "./HandsOnLegModel"
import {StrokePath, toVec3} from "./HandsOnLegGeometry"
import {OFF_CHOICE_ID, OFF_CHOICE_NAME, PARTS, PartDef, findPart} from "./HandsOnParts"
import {HandsOnSpots} from "./HandsOnSpots"

const SFX_CLICK = requireAsset("../GeneratedSFX/HandsOnZoneOn.wav") as AudioTrackAsset
const SFX_OFF = requireAsset("../GeneratedSFX/HandsOnZoneOff.wav") as AudioTrackAsset
const SFX_CHIME = requireAsset("../GeneratedSFX/HandsOnChime.wav") as AudioTrackAsset

export type Step = "placeStart" | "placeEnd" | "pickPart" | "guide"

const HINT_TEXT: Record<Exclude<Step, "guide">, string> = {
  placeStart: "Place your palm where the stroke starts",
  placeEnd: "Now where it ends",
  pickPart: "Pick the part",
}
const HINT_ABOVE_LEG_CM = 10
const CHOICES_ABOVE_SPOT_CM = 8
const LABEL_ABOVE_ARROW_CM = 8
const SPOT_DIAMETER_CM = 2
const GHOST_HAND_STRENGTH = 0.3
const ACTION_DEBOUNCE_S = 0.25
/** Half the display's horizontal field of view, a little inside the edge (Specs ~16 deg). */
const VIEW_HALF_ANGLE_DEG = 14

@component
export class HandsOnMain extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">HandsOnMain – lower-leg massage guide</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("HandsOnLegModel on the Leg object (leg shape, clicks and turning)")
  legModel: HandsOnLegModel

  @input
  @hint("HandsOnGuideUI (hint, part choices, technique label)")
  guideUI: HandsOnGuideUI

  @input
  @hint("LegRig: the movable unit holding leg, cushion and guide text")
  legRig: SceneObject

  @input
  @hint("Additive unlit vertex-colour material used for dots, arrows and ghost hands")
  guideMaterial: Material
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Place the LegRig relative to where the user's head is and looks when the Lens starts (its authored offset is kept, the leg stays level)")
  placeAtStartPose: boolean = true

  @input("vec3", "{0.72, 0.87, 1.0}")
  @hint("Guide colour for palm spots, arrows and ghost hands — light, cool tones only")
  @widget(new ColorWidget())
  guideColor: vec3

  @input("vec3", "{0.40, 1.0, 0.55}")
  @hint("Arrow colour while a drag follows the stroke direction")
  @widget(new ColorWidget())
  checkColor: vec3

  @input
  @hint("Volume of the click and chime sounds (quiet: content is ~50 cm away)")
  @widget(new SliderWidget(0, 1, 0.05))
  sfxVolume: number = 0.4

  @input
  @hint("Drag distance along the arrow before it turns green, cm")
  @widget(new SliderWidget(1, 15, 0.5))
  dragMinCm: number = 4

  @input
  @hint("Maximum angle between the drag and the arrow, degrees")
  @widget(new SliderWidget(5, 60, 1))
  dragMaxAngleDeg: number = 30
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Debug</span>')
  @ui.group_start("Debug")
  @input
  @hint("Draw the leg collider as a wireframe (takes effect on preview restart)")
  debugColliders: boolean = false
  @ui.group_end

  private step: Step = "placeStart"
  private chosen: PartDef | null = null
  /** Part picked from the reopened choices, waiting for two new spots. */
  private pending: PartDef | null = null
  private guide: HandsOnGuide | null = null
  private oldGuides: HandsOnGuide[] = []
  private spots: HandsOnSpots
  private worldRoot: SceneObject
  private camera: Transform
  private lastActionTime = -10
  private sfxClick: AudioComponent
  private sfxOff: AudioComponent
  private sfxChime: AudioComponent
  private rigLocalPos: vec3
  private rigLocalRot: quat
  private placed = false
  private elapsed = 0

  onAwake(): void {
    if (!this.legModel || !this.guideUI || !this.legRig || !this.guideMaterial) {
      console.error("[HandsOn] Required @input not wired (legModel, guideUI, legRig, guideMaterial). Check the scene.")
      return
    }
    const rt = this.legRig.getTransform()
    this.rigLocalPos = rt.getLocalPosition()
    this.rigLocalRot = rt.getLocalRotation()

    // world-locked content (spots, guides) lives outside the rig so turning the leg never moves it
    this.worldRoot = global.scene.createSceneObject("PlacedGuide")
    this.worldRoot.setParent(this.sceneObject)
    this.spots = new HandsOnSpots(this.worldRoot, this.guideMaterial, this.guideColor, SPOT_DIAMETER_CM)

    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  // ── observable state (tests / debugging) ──

  getStep(): Step {
    return this.step
  }

  getSpotCount(): number {
    return this.spots ? this.spots.count() : 0
  }

  getSpotPositions(): vec3[] {
    return this.spots ? this.spots.positions() : []
  }

  areChoicesVisible(): boolean {
    return this.guideUI.areChoicesVisible()
  }

  /** Names on the chips currently offered, e.g. ["Calf", "Shin", "Sole"] or [..., "Off"]. */
  getChoiceOptions(): string[] {
    return this.guideUI.getChoiceIds().map((id) => (id === OFF_CHOICE_ID ? OFF_CHOICE_NAME : findPart(id)?.name ?? id))
  }

  /** Part whose guide is showing ("" when none). */
  getChosenPartId(): string {
    return this.chosen ? this.chosen.id : ""
  }

  /** Part waiting for two new spots after being picked from the reopened choices ("" when none). */
  getPendingPartId(): string {
    return this.pending ? this.pending.id : ""
  }

  getLabelText(): string {
    return this.guideUI.getLabelText()
  }

  isGuideVisible(): boolean {
    return this.guide !== null && this.guide.isVisible()
  }

  getArrowStart(): vec3 {
    return this.guide ? this.guide.arrowStartWorld() : vec3.zero()
  }

  getArrowEnd(): vec3 {
    return this.guide ? this.guide.arrowEndWorld() : vec3.zero()
  }

  /** World direction of the arrow at its start (tail -> head), for scripted drags. */
  getArrowDirection(): vec3 {
    return this.guide ? this.guide.arrowDirectionWorld() : vec3.zero()
  }

  isArrowGreen(): boolean {
    return this.guide !== null && this.guide.isArrowGreen()
  }

  getHintText(): string {
    return this.guideUI.getHintText()
  }

  isHintVisible(): boolean {
    return this.guideUI.isHintVisible()
  }

  /** Accumulated leg turn from dragging: x = yaw, y = roll, degrees. */
  getLegTurnDeg(): vec2 {
    return this.legModel.getTurnDeg()
  }

  getLegRotation(): quat {
    return this.legModel.getLegRotation()
  }

  /** A sensible palm spot on the leg as it is now: index 0 = stroke start, 1 = stroke end. */
  getSuggestedSpotWorld(partId: string, index: number): vec3 {
    const part = findPart(partId)
    if (!part) return vec3.zero()
    const s = index === 0 ? part.suggested.start : part.suggested.end
    return this.legModel.surfaceToWorld(s.region, s.a, s.b).position
  }

  /**
   * Place a palm spot at the leg surface nearest `worldPoint` — the same path a short click on
   * the leg takes. For tests and scripted demos.
   */
  tapLegAt(worldPoint: vec3): void {
    const s = this.legModel.projectWorld(worldPoint)
    const m = this.legModel.getSceneObject().getTransform().getWorldTransform()
    this.onLegTap({position: m.multiplyPoint(toVec3(s.p)), normal: m.multiplyDirection(toVec3(s.n)).normalize()})
  }

  // ── lifecycle ──

  private onStart(): void {
    // every component is awake by now (the UI sits below this object in the hierarchy)
    const options = PARTS.map((p) => ({id: p.id, name: p.name}))
    options.push({id: OFF_CHOICE_ID, name: OFF_CHOICE_NAME})
    let longest = ""
    for (const p of PARTS) if (p.label.length > longest.length) longest = p.label
    this.guideUI.configureChoices(options, longest)

    this.camera = WorldCameraFinderProvider.getInstance().getTransform()
    const sfxRoot = global.scene.createSceneObject("Sfx")
    sfxRoot.setParent(this.legModel.getSceneObject())
    this.sfxClick = this.makeSound(sfxRoot, SFX_CLICK)
    this.sfxOff = this.makeSound(sfxRoot, SFX_OFF)
    this.sfxChime = this.makeSound(sfxRoot, SFX_CHIME)

    this.legModel.onTap.add((tap) => this.onLegTap(tap))
    this.guideUI.onChoice.add((id) => this.onChoice(id))
    this.guideUI.onLabelPinched.add(() => this.onLabelPinched())

    if (this.debugColliders) this.setColliderDebugAll(this.legModel.getSceneObject(), true)
    this.setStep("placeStart")
    console.log("[HandsOn] ready — click the leg where the stroke starts")
  }


  private onUpdate(): void {
    const dt = getDeltaTime()
    this.elapsed += dt
    if (!this.placed && this.elapsed > 0.1) this.placeAtStart()
    if (this.guide) this.guide.update(dt)
    for (const g of this.oldGuides) g.update(dt)
    this.oldGuides = this.oldGuides.filter((g) => !g.isGone)
    this.spots.update(dt)
  }

  // ── the flow: the only place step / guide state changes ──

  private onLegTap(tap: LegTap): void {
    if (this.step !== "placeStart" && this.step !== "placeEnd") return
    if (!this.debounce()) return
    this.spots.add(tap.position, tap.normal)
    this.play(this.sfxClick)
    if (this.step === "placeStart") {
      console.log("[HandsOn] spot 1 at " + tap.position.toString())
      this.setStep("placeEnd")
      return
    }
    console.log("[HandsOn] spot 2 at " + tap.position.toString())
    if (this.pending) {
      const part = this.pending
      this.pending = null
      this.startGuide(part)
    } else {
      this.setStep("pickPart", false)
    }
  }

  private onChoice(id: string): void {
    if (this.step !== "pickPart") return
    this.lastActionTime = this.elapsed
    if (id === OFF_CHOICE_ID) {
      this.retireGuide()
      this.chosen = null
      this.pending = null
      this.spots.clear()
      this.guideUI.hideLabel()
      this.play(this.sfxOff)
      console.log("[HandsOn] guide off")
      this.setStep("placeStart")
      return
    }
    const part = findPart(id)
    if (!part) return
    this.play(this.sfxClick)
    if (this.guide || this.chosen) {
      // switching from a running guide: a different part sits in a different place, so ask for two new spots
      this.retireGuide()
      this.chosen = null
      this.spots.clear()
      this.guideUI.hideLabel()
      this.pending = part
      console.log("[HandsOn] switching to " + part.id + " — waiting for two new spots")
      this.setStep("placeStart")
      return
    }
    this.startGuide(part)
  }

  private onLabelPinched(): void {
    if (this.step !== "guide" || !this.debounce()) return
    this.play(this.sfxClick)
    this.setStep("pickPart", true)
  }

  private startGuide(part: PartDef): void {
    const pts = this.spots.positions()
    if (pts.length < 2) return
    this.retireGuide()
    const legT = this.legModel.getSceneObject().getTransform()
    const path = new StrokePath(this.legModel.shape, this.legModel.worldToLocal(pts[0]), this.legModel.worldToLocal(pts[1]))
    const guide = new HandsOnGuide(
      part,
      path,
      this.worldRoot,
      {position: legT.getWorldPosition(), rotation: legT.getWorldRotation()},
      {
        guideMaterial: this.guideMaterial,
        arrowColor: new vec3(Math.min(1, this.guideColor.x + 0.12), Math.min(1, this.guideColor.y + 0.07), Math.min(1, this.guideColor.z)),
        handColor: this.guideColor,
        checkColor: this.checkColor,
        ghostHandStrength: GHOST_HAND_STRENGTH,
        dragMinCm: this.dragMinCm,
        dragMaxAngleDeg: this.dragMaxAngleDeg,
      },
      this.camera,
    )
    guide.onDirectionMatched = () => this.play(this.sfxChime)
    this.guide = guide
    this.chosen = part
    this.guideUI.showLabel(part.label, this.keepInView(guide.labelAnchorWorld(LABEL_ABOVE_ARROW_CM), this.guideUI.getLabelWidthCm() / 2))
    console.log("[HandsOn] guide on: " + part.id + " (" + part.label + "), arrow " + path.length.toFixed(1) + " cm")
    this.setStep("guide")
  }

  private retireGuide(): void {
    if (!this.guide) return
    this.guide.fadeOut()
    this.oldGuides.push(this.guide)
    this.guide = null
  }

  private setStep(step: Step, withOff: boolean = false): void {
    this.step = step
    if (step === "pickPart") {
      const ids = PARTS.map((p) => p.id)
      if (withOff) ids.push(OFF_CHOICE_ID)
      const pos = this.keepInView(this.choicesWorldPosition(withOff), this.guideUI.getChoiceRowWidthCm(ids.length) / 2)
      this.guideUI.showChoices(ids, pos)
    } else {
      if (this.guideUI.areChoicesVisible()) this.guideUI.hideChoices()
    }
    if (step === "guide") this.guideUI.hideHint()
    else this.guideUI.showHint(HINT_TEXT[step], this.hintWorldPosition())
  }

  // ── placement ──

  /** ~8 cm above the second palm spot; when reopened from the label, above the label instead. */
  private choicesWorldPosition(fromLabel: boolean): vec3 {
    if (fromLabel) return this.guideUI.getLabelWorldPosition().add(new vec3(0, 4, 0))
    const pts = this.spots.positions()
    const anchor = pts.length > 0 ? pts[pts.length - 1] : this.legTopWorld()
    return anchor.add(new vec3(0, CHOICES_ABOVE_SPOT_CM, 0))
  }

  /** ~10 cm above the middle of the leg (clear of the foot); raised if the choice row sits there. */
  private hintWorldPosition(): vec3 {
    let p = this.legTopWorld().add(new vec3(0, HINT_ABOVE_LEG_CM, 0))
    if (this.guideUI.areChoicesVisible()) {
      const c = this.guideUI.getChoiceWorldPosition()
      const dx = Math.abs(c.x - p.x)
      if (dx < 16 && Math.abs(c.y - p.y) < 4.5) p = new vec3(p.x, c.y + 4.5, p.z)
    }
    return p
  }

  /** Slide a floating row sideways (in the view) so all of it stays inside the display. */
  private keepInView(pos: vec3, halfWidthCm: number): vec3 {
    if (!this.camera) return pos
    const local = this.camera.getInvertedWorldTransform().multiplyPoint(pos)
    const depth = -local.z
    if (depth < 5) return pos
    const maxX = Math.max(0, Math.tan((VIEW_HALF_ANGLE_DEG * Math.PI) / 180) * depth - halfWidthCm)
    const x = Math.max(-maxX, Math.min(maxX, local.x))
    return this.camera.getWorldTransform().multiplyPoint(new vec3(x, local.y, local.z))
  }

  /** Highest point of the shank's middle ring, world space. */
  private legTopWorld(): vec3 {
    const shape = this.legModel.shape
    const m = this.legModel.getSceneObject().getTransform().getWorldTransform()
    const a = shape.params.shankLengthCm / 2
    const mid = m.multiplyPoint(toVec3(shape.legAxis(a)))
    let top = mid.y
    for (let th = 0; th < 360; th += 15) top = Math.max(top, m.multiplyPoint(toVec3(shape.legPoint(a, th))).y)
    return new vec3(mid.x, top, mid.z)
  }

  private placeAtStart(): void {
    this.placed = true
    if (this.placeAtStartPose) {
      const cam = WorldCameraFinderProvider.getInstance().getTransform()
      const look = cam.back // camera looks along its -Z
      const flat = new vec3(look.x, 0, look.z)
      if (flat.length > 0.01) {
        const dir = flat.normalize()
        const base = new vec3(0, 0, -1)
        const yaw = dir.dot(base) < -0.999 ? quat.angleAxis(Math.PI, vec3.up()) : quat.rotationFromTo(base, dir)
        // the offset also follows where the head is looking up/down (someone already looking at
        // their lap gets the leg in their lap); the leg itself stays level
        const pitch = Math.max(-50, Math.min(10, (Math.asin(Math.max(-1, Math.min(1, look.normalize().y))) * 180) / Math.PI))
        const aim = yaw.multiply(quat.angleAxis((pitch * Math.PI) / 180, vec3.right()))
        const rt = this.legRig.getTransform()
        rt.setWorldPosition(cam.getWorldPosition().add(aim.multiplyVec3(this.rigLocalPos)))
        rt.setWorldRotation(yaw.multiply(this.rigLocalRot))
        console.log("[HandsOn] leg placed relative to start pose at " + rt.getWorldPosition().toString())
      }
    }
    // re-anchor the hint now that the leg is where it will stay
    if (this.step !== "guide") this.guideUI.showHint(HINT_TEXT[this.step], this.hintWorldPosition())
  }

  // ── audio ──

  private makeSound(parent: SceneObject, track: AudioTrackAsset): AudioComponent {
    const so = global.scene.createSceneObject("Sfx_" + track.name)
    so.setParent(parent)
    const audio = so.createComponent("Component.AudioComponent") as AudioComponent
    audio.audioTrack = track
    audio.volume = this.sfxVolume
    audio.playbackMode = Audio.PlaybackMode.LowLatency
    audio.spatialAudio.enabled = true
    audio.spatialAudio.positionEffect.enabled = true
    audio.spatialAudio.distanceEffect.enabled = true
    audio.spatialAudio.distanceEffect.minDistance = 30
    audio.spatialAudio.distanceEffect.maxDistance = 300
    return audio
  }

  private play(audio: AudioComponent): void {
    if (!audio) return
    if (audio.isPlaying()) audio.stop(false)
    audio.play(1)
  }

  // ── helpers ──

  /** One pinch, one action. */
  private debounce(): boolean {
    if (this.elapsed - this.lastActionTime < ACTION_DEBOUNCE_S) return false
    this.lastActionTime = this.elapsed
    return true
  }

  private setColliderDebugAll(root: SceneObject, on: boolean): void {
    const colliders = root.getComponents("Physics.ColliderComponent") as ColliderComponent[]
    for (const c of colliders) c.debugDrawEnabled = on
    for (let i = 0; i < root.getChildrenCount(); i++) this.setColliderDebugAll(root.getChild(i), on)
  }
}
