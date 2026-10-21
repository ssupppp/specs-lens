import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HandsOnLeafInteractor, getMain, log, resetToStart, v, waitFrames} from "./HandsOnTestKit"

/**
 * Criterion 3 — two real SIK taps on the leg put a dot on each, and "Calf · Shin · Sole"
 * appear above spot 2.
 */
@component
export class HandsOnC3SpotsScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const main = getMain()
    const ix = new HandsOnLeafInteractor()
    await resetToStart(main, ix)
    expect(main.getSpotCount()).toBe(0)

    // two spots on the camera-facing side, spot 2 near the middle of the view so the row's
    // keep-in-view clamp (HandsOnMain.keepInView) doesn't shift it sideways
    const lm = main.legModel
    const aim1 = lm.surfaceToWorld("leg", 33, 40).position
    const aim2 = lm.surfaceToWorld("leg", 24, 40).position
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

    // choices
    expect(main.getStep()).toBe("pickPart")
    expect(main.areChoicesVisible()).toBe(true)
    expect(main.getChoiceOptions().join(" · ")).toBe("Calf · Shin · Sole")
    for (const name of ["Choice_Calf", "Choice_Shin", "Choice_Sole"]) {
      const so = findSceneObjectByName(name)
      expect(so && so.isEnabledInHierarchy, name + " enabled").toBe(true)
    }
    const off = findSceneObjectByName("Choice_Off")
    expect(!!off && off.isEnabledInHierarchy, "Off chip shown on first pick").toBe(false)

    const row = findSceneObjectByName("Choice_Shin").getTransform().getWorldPosition()
    const above = row.y - spots[1].y
    const flat = new vec3(row.x - spots[1].x, 0, row.z - spots[1].z).length
    log("C3: choice row centre " + v(row) + " above spot2 by " + above.toFixed(1) + " cm, horizontal offset " + flat.toFixed(1) + " cm")
    expect(above, "choices height above spot 2 (cm)").toBeGreaterThan(4)
    expect(above, "choices height above spot 2 (cm)").toBeLessThan(14)
    expect(flat, "choices horizontal offset from spot 2 (cm)").toBeLessThan(3)
    log("C3: PASS")
  }
}
