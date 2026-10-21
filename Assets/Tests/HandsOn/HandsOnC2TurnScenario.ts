import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HandsOnLeafInteractor, camTransform, getMain, log, resetToStart, waitFrames} from "./HandsOnTestKit"

function angleDeg(a: quat, b: quat): number {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI
}

/** Criterion 2 — a real SIK click-drag on the leg turns it, and it stays where released. */
@component
export class HandsOnC2TurnScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const main = getMain()
    const ix = new HandsOnLeafInteractor()
    await resetToStart(main, ix)

    const leg = findInteractableByName("Leg", undefined, true)
    expect(leg, "Leg interactable").toBeTruthy()
    const rot0 = main.getLegRotation()
    const turn0 = main.getLegTurnDeg()
    const spots0 = main.getSpotCount()

    // drag sideways (camera right), 0.4 cm per drag update for 600 ms
    const step = camTransform().right.uniformScale(0.4)
    await ix.drag(leg, step, 600)
    await waitFrames(2)
    const rot1 = main.getLegRotation()
    const turn1 = main.getLegTurnDeg()
    const turned = angleDeg(rot0, rot1)
    log("C2: yaw " + turn0.x.toFixed(1) + " -> " + turn1.x.toFixed(1) + ", rotation change " + turned.toFixed(1) + " deg")
    expect(turned, "leg rotation change (deg)").toBeGreaterThan(5)
    expect(Math.abs(turn1.x - turn0.x), "yaw change (deg)").toBeGreaterThan(5)
    expect(main.getSpotCount(), "a turning drag must not place a spot").toBe(spots0)

    // stays where released
    await sleep(1000)
    const rot2 = main.getLegRotation()
    const drift = angleDeg(rot1, rot2)
    log("C2: drift after release " + drift.toFixed(2) + " deg")
    expect(drift, "drift after release (deg)").toBeLessThan(0.5)
    log("C2: PASS")
  }
}
