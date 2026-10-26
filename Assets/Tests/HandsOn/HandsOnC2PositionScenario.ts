import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HandsOnLeafInteractor, PALM_HINT, camTransform, getMain, log, resetToStart, visibleSpot, waitFrames, waitUntil} from "./HandsOnTestKit"

function angleDeg(a: quat, b: quat): number {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI
}

/**
 * Criterion 2 — picking a part settles the leg in that part's position (real SIK pinches):
 * "Shin" rolls it face up, "Calf" back face down. A real click-drag on the leg doesn't turn it.
 */
@component
export class HandsOnC2PositionScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const main = getMain()
    const ix = new HandsOnLeafInteractor()
    await resetToStart(main, ix)
    const lm = main.legModel
    expect(main.getLegPose(), "opens face down").toBe("faceDown")

    // dragging on the leg doesn't turn it
    const leg = findInteractableByName("Leg", undefined, true)
    expect(leg, "Leg interactable").toBeTruthy()
    const rot0 = main.getLegRotation()
    await ix.drag(leg, camTransform().right.uniformScale(0.4), 600)
    await waitFrames(2)
    const dragTurn = angleDeg(rot0, main.getLegRotation())
    log("C2: rotation change from a drag " + dragTurn.toFixed(2) + " deg")
    expect(dragTurn, "rotation change from a drag (deg)").toBeLessThan(0.5)
    await sleep(400)

    // Shin -> face up, shin bone on top, then asks for the first palm
    await ix.pickPart(main, "Shin")
    expect(main.getLegPose()).toBe("faceUp")
    const shinUp = lm.surfaceToWorld("leg", 20, 0).normal.y
    log("C2: face up, shin normal y=" + shinUp.toFixed(2) + ", rotation change " + angleDeg(rot0, main.getLegRotation()).toFixed(1) + " deg")
    expect(shinUp, "shin faces up").toBeGreaterThan(0.7)
    expect(main.getStep()).toBe("placeStart")
    expect(main.getHintText()).toBe(PALM_HINT)

    // finish a shin guide, reopen the choices from its label, pick Calf -> face down again
    await ix.tapLeg(visibleSpot(main, "shin", 0))
    await ix.tapLeg(visibleSpot(main, "shin", 1))
    expect(await waitUntil(() => main.isGuideVisible(), 90), "shin guide").toBe(true)
    await sleep(300)
    await ix.pinch("TechniqueLabelButton")
    await waitFrames(3)
    await ix.pickPart(main, "Calf")
    expect(main.getLegPose()).toBe("faceDown")
    const calfUp = lm.surfaceToWorld("leg", 20, 180).normal.y
    const back = angleDeg(rot0, main.getLegRotation())
    log("C2: face down again, calf normal y=" + calfUp.toFixed(2) + ", off the opening rotation by " + back.toFixed(2) + " deg")
    expect(calfUp, "calf faces up").toBeGreaterThan(0.7)
    expect(back, "back in the opening position (deg)").toBeLessThan(0.5)
    log("C2: PASS")
  }
}
