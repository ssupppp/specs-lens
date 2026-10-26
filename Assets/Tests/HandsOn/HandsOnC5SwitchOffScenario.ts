import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HandsOnLeafInteractor, PALM_HINT, START_HINT, ensureCalfGuide, getMain, log, visibleSpot, waitFrames, waitUntil} from "./HandsOnTestKit"

/**
 * Criterion 5 — real SIK pinches: label reopens choices with Off; Shin rolls the leg face up
 * and asks for two new spots, then shows "Shin glide · gentle"; Off clears guide + spots, back
 * to "Calf · Shin · Sole" and "Pick the part".
 */
@component
export class HandsOnC5SwitchOffScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const main = getMain()
    const ix = new HandsOnLeafInteractor()
    await ensureCalfGuide(main, ix)

    // label -> choices with Off
    await ix.pinch("TechniqueLabelButton")
    expect(main.getStep()).toBe("pickPart")
    expect(main.areChoicesVisible()).toBe(true)
    expect(main.getChoiceOptions().join(" · ")).toBe("Calf · Shin · Sole · Off")
    await waitFrames(3)
    const offChip = findSceneObjectByName("Choice_Off")
    expect(offChip && offChip.isEnabledInHierarchy, "Off chip shown").toBe(true)

    // Shin -> leg rolls face up, asks for two new spots
    await ix.pickPart(main, "Shin")
    expect(main.getStep()).toBe("placeStart")
    expect(main.getPendingPartId()).toBe("shin")
    expect(main.getLegPose()).toBe("faceUp")
    expect(main.getSpotCount(), "old spots cleared").toBe(0)
    expect(main.isGuideVisible(), "old guide gone").toBe(false)
    expect(main.getHintText()).toBe(PALM_HINT)
    await ix.tapLeg(visibleSpot(main, "shin", 0))
    expect(main.getStep()).toBe("placeEnd")
    expect(main.isGuideVisible(), "no guide after one new spot").toBe(false)
    await ix.tapLeg(visibleSpot(main, "shin", 1))
    const shown = await waitUntil(() => main.isGuideVisible(), 90)
    expect(shown, "shin guide visible").toBe(true)
    expect(main.getChosenPartId()).toBe("shin")
    expect(main.getLabelText()).toBe("Shin glide · gentle")
    await waitFrames(5)
    expect(!!findSceneObjectByName("Arrow_Shin"), "Arrow_Shin exists").toBe(true)

    // label -> Off
    await sleep(300)
    await ix.pinch("TechniqueLabelButton")
    expect(main.getChoiceOptions().join(" · ")).toBe("Calf · Shin · Sole · Off")
    await waitFrames(3)
    await ix.pinch("Choice_Off")
    expect(main.getStep()).toBe("pickPart")
    expect(main.isGuideVisible()).toBe(false)
    expect(main.getSpotCount()).toBe(0)
    expect(main.getChosenPartId()).toBe("")
    expect(main.getPendingPartId()).toBe("")
    expect(main.getLabelText()).toBe("")
    expect(main.getHintText()).toBe(START_HINT)
    expect(main.isHintVisible()).toBe(true)
    expect(main.areChoicesVisible(), "opening choices back").toBe(true)
    expect(main.getChoiceOptions().join(" · ")).toBe("Calf · Shin · Sole")

    // after the 300 ms fades, guide + dots are gone from the scene; the leg remains
    await sleep(800)
    expect(!!findSceneObjectByName("Guide_Shin"), "Guide_Shin removed").toBe(false)
    expect(!!findSceneObjectByName("PalmSpot_1"), "PalmSpot_1 removed").toBe(false)
    expect(!!findSceneObjectByName("PalmSpot_2"), "PalmSpot_2 removed").toBe(false)
    const label = findSceneObjectByName("TechniqueLabelButton")
    expect(!!label && label.isEnabledInHierarchy, "label hidden").toBe(false)
    const leg = findSceneObjectByName("Leg")
    expect(leg && leg.isEnabledInHierarchy, "leg still there").toBe(true)
    log("C5: PASS")
  }
}
