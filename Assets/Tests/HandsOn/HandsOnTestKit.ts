/**
 * HandsOnTestKit — shared helpers for the HandsOn LEAF scenarios (test code only).
 *
 * - HandsOnLeafInteractor: a DefaultLeafInteractor that can aim its ray at a chosen world
 *   point (so a real SIK trigger lands on a specific spot of the leg) and records the hit.
 * - getMain(), frame waits, pinch-by-name, and resetToStart() which drives the Lens back to
 *   the opening "Pick the part" state through real pinches.
 */
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, nextFrame, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HandsOnMain} from "../../Scripts/HandsOnMain"

export const START_HINT = "Pick the part"
export const PALM_HINT = "Place your palm where the stroke starts"

export function getMain(): HandsOnMain {
  const so = findSceneObjectByName("HandsOn")
  if (!so) throw new Error("SceneObject 'HandsOn' not found")
  const main = so.getComponent(HandsOnMain.getTypeName()) as HandsOnMain
  if (!main) throw new Error("HandsOnMain component not found on 'HandsOn'")
  return main
}

export function camTransform(): Transform {
  return WorldCameraFinderProvider.getInstance().getTransform()
}

export async function waitFrames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await nextFrame()
}

/** Waits until `cond()` is true, up to `maxFrames` frames. Returns whether it became true. */
export async function waitUntil(cond: () => boolean, maxFrames: number): Promise<boolean> {
  for (let i = 0; i < maxFrames; i++) {
    if (cond()) return true
    await nextFrame()
  }
  return cond()
}

export function v(p: vec3): string {
  return "(" + p.x.toFixed(1) + ", " + p.y.toFixed(1) + ", " + p.z.toFixed(1) + ")"
}

export function log(msg: string): void {
  print("[HandsOnTest] " + msg)
}

/** DefaultLeafInteractor whose ray can be aimed at a chosen world point. */
export class HandsOnLeafInteractor extends DefaultLeafInteractor {
  /** When set, the next hover/trigger aims from the camera through this point. */
  aimPoint: vec3 | null = null
  /** Where the aimed ray hit the target collider (null if it missed / not aimed). */
  lastHit: vec3 | null = null

  constructor() {
    super("HandsOnLeafInteractor")
  }

  protected async setTarget(target: Interactable): Promise<void> {
    if (!this.aimPoint) {
      this.lastHit = null
      return super.setTarget(target)
    }
    const self = this as any
    const camPos = camTransform().getWorldPosition()
    const aim = this.aimPoint
    const far = aim.add(aim.sub(camPos).normalize().uniformScale(10))
    this.overrideInteractable = target
    this.startPoint = camPos
    this.endPoint = aim
    await new Promise<void>((resolve) => {
      Physics.createGlobalProbe().rayCast(camPos, far, (hit) => {
        if (!isNull(hit) && !isNull(hit.collider) && hit.collider.getSceneObject().isSame(target.getSceneObject())) {
          self.raycastHit = hit
          this.endPoint = hit.position
          this.lastHit = hit.position
        } else {
          self.raycastHit = null
          this.lastHit = null
        }
        resolve()
      })
    })
  }

  /** Real SIK trigger (hover -> select -> release) on the leg, aimed at `worldPoint`. */
  async tapLeg(worldPoint: vec3): Promise<vec3> {
    const leg = findInteractableByName("Leg", undefined, true)
    if (!leg) throw new Error("Leg interactable not found / not enabled")
    this.aimPoint = worldPoint
    try {
      await this.trigger(leg)
    } finally {
      this.aimPoint = null
    }
    if (!this.lastHit) throw new Error("Aimed ray at " + v(worldPoint) + " did not hit the Leg collider")
    const hit = this.lastHit
    await sleep(350) // HandsOnMain debounces actions for 0.25 s
    return hit
  }

  /** Real SIK pinch on an enabled interactable by SceneObject name. */
  async pinch(name: string): Promise<void> {
    const it = findInteractableByName(name, undefined, true)
    if (!it) throw new Error("Interactable '" + name + "' not found or not enabled")
    this.aimPoint = null
    await this.trigger(it)
    await sleep(400) // debounce + label fade-in gate
  }

  /** Pinch a part's chip and wait for the leg to settle into that part's position. */
  async pickPart(main: HandsOnMain, partName: string): Promise<void> {
    await this.pinch("Choice_" + partName)
    const settled = await waitUntil(() => !main.isLegRolling(), 120)
    if (!settled) throw new Error("Leg still rolling after picking " + partName)
    await waitFrames(2)
  }
}

/** A point on the leg's camera-facing side near the part's suggested spot. */
export function visibleSpot(main: HandsOnMain, partId: string, index: number): vec3 {
  return main.getSuggestedSpotWorld(partId, index)
}

/** The opening state: choices without "Off", no guide, no spots, no part waiting. */
export function atStart(main: HandsOnMain): boolean {
  return (
    main.getStep() === "pickPart" &&
    main.getChoiceOptions().indexOf("Off") < 0 &&
    main.getSpotCount() === 0 &&
    main.getPendingPartId() === "" &&
    !main.isGuideVisible()
  )
}

/** Drive the Lens back to the opening "Pick the part" state with real input. */
export async function resetToStart(main: HandsOnMain, ix: HandsOnLeafInteractor): Promise<void> {
  for (let i = 0; i < 8; i++) {
    if (atStart(main)) break
    const step = main.getStep()
    const pending = main.getPendingPartId()
    if ((step === "placeStart" || step === "placeEnd") && pending !== "") {
      await waitUntil(() => !main.isLegRolling(), 120)
      await ix.tapLeg(visibleSpot(main, pending, main.getSpotCount() === 0 ? 0 : 1))
    } else if (step === "pickPart") {
      await ix.pinch("Choice_Off")
    } else if (step === "guide") {
      await ix.pinch("TechniqueLabelButton")
    }
    await waitFrames(5)
  }
  if (!atStart(main)) {
    throw new Error("resetToStart failed: step=" + main.getStep() + " spots=" + main.getSpotCount())
  }
  await sleep(500) // let fades finish
}

/** Pick `partName`, then place two palm spots on its suggested points; returns the hit points. */
export async function placePartGuide(main: HandsOnMain, ix: HandsOnLeafInteractor, partId: string, partName: string): Promise<vec3[]> {
  await ix.pickPart(main, partName)
  const hit1 = await ix.tapLeg(visibleSpot(main, partId, 0))
  const hit2 = await ix.tapLeg(visibleSpot(main, partId, 1))
  return [hit1, hit2]
}

/** Pick Calf and place two spots so a Calf guide is showing. */
export async function ensureCalfGuide(main: HandsOnMain, ix: HandsOnLeafInteractor): Promise<void> {
  if (main.getStep() === "guide" && main.getChosenPartId() === "calf") return
  await resetToStart(main, ix)
  await placePartGuide(main, ix, "calf", "Calf")
  const ok = await waitUntil(() => main.isGuideVisible(), 90)
  if (!ok) throw new Error("Calf guide did not appear")
  await sleep(300)
}

/**
 * Place a guide for `partId` on its suggested spots and check both posed ghost hands appear near
 * the arrow. Leaves the guide showing, so the pose can be inspected in the preview afterwards.
 */
export async function showPartGuide(partId: string, partName: string): Promise<void> {
  await sleep(1000)
  const main = getMain()
  const ix = new HandsOnLeafInteractor()
  await resetToStart(main, ix)
  await placePartGuide(main, ix, partId, partName)
  const shown = await waitUntil(() => main.isGuideVisible(), 90)
  expect(shown, partName + " guide visible").toBe(true)
  await waitFrames(15) // hands are posed one point along the stroke per frame
  const a0 = main.getArrowStart()
  const a1 = main.getArrowEnd()
  for (const side of ["L", "R"]) {
    const hand = findSceneObjectByName("GhostHand_" + partName + "_" + side)
    expect(hand && hand.isEnabledInHierarchy, "GhostHand_" + partName + "_" + side).toBe(true)
    const p = hand.getTransform().getWorldPosition()
    const near = Math.min(p.distance(a0), p.distance(a1), p.distance(vec3.lerp(a0, a1, 0.5)))
    log(partName + " hand " + side + " at " + v(p) + ", " + near.toFixed(1) + " cm from the arrow")
    expect(near, side + " hand near the arrow (cm)").toBeLessThan(20)
  }
}
