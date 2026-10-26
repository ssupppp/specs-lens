import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HandsOnLeafInteractor, PALM_HINT, getMain, log, resetToStart, v, visibleSpot, waitFrames} from "./HandsOnTestKit"

/**
 * Criterion 3 — after picking a part (real SIK pinch) the hint asks for the first palm; two
 * real SIK taps on the leg put a dot on each.
 */
@component
export class HandsOnC3SpotsScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const main = getMain()
    const ix = new HandsOnLeafInteractor()
    await resetToStart(main, ix)
    expect(main.getSpotCount()).toBe(0)

    // a tap before picking a part places nothing
    await ix.tapLeg(visibleSpot(main, "calf", 0))
    expect(main.getSpotCount(), "spots before a part is picked").toBe(0)

    await ix.pickPart(main, "Calf")
    expect(main.getStep()).toBe("placeStart")
    expect(main.getPendingPartId()).toBe("calf")
    expect(main.getHintText()).toBe(PALM_HINT)
    expect(main.areChoicesVisible(), "choices after pick").toBe(false)

    const aim1 = visibleSpot(main, "calf", 0)
    const aim2 = visibleSpot(main, "calf", 1)
    const hit1 = await ix.tapLeg(aim1)
    expect(main.getSpotCount(), "spots after tap 1").toBe(1)
    expect(main.getStep()).toBe("placeEnd")
    expect(main.getHintText()).toBe("Now where it ends")
    expect(main.areChoicesVisible(), "choices after 1 spot").toBe(false)

    const hit2 = await ix.tapLeg(aim2)
    expect(main.getSpotCount(), "spots after tap 2").toBe(2)
    const spots = main.getSpotPositions()
    log("C3: hits " + v(hit1) + " " + v(hit2) + " spots " + v(spots[0]) + " " + v(spots[1]))
    expect(spots[0].distance(hit1), "spot 1 vs tap 1 (cm)").toBeLessThan(1.0)
    expect(spots[1].distance(hit2), "spot 2 vs tap 2 (cm)").toBeLessThan(1.0)

    // a visible dot object for each spot
    await waitFrames(10)
    for (const name of ["PalmSpot_1", "PalmSpot_2"]) {
      const dot = findSceneObjectByName(name)
      expect(dot, name).toBeTruthy()
      expect(dot.isEnabledInHierarchy, name + " enabled").toBe(true)
      expect(isNull(dot.getComponent("Component.RenderMeshVisual")), name + " has a mesh").toBe(false)
    }
    expect(main.areChoicesVisible(), "no choices after the second spot").toBe(false)
    log("C3: PASS")
  }
}
