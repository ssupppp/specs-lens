import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HandsOnLeafInteractor, getMain, log, resetToStart, v, visibleSpot, waitFrames, waitUntil} from "./HandsOnTestKit"

/**
 * Criterion 4 — pinching "Calf" (real SIK trigger) clears the choices and shows the arrow
 * from spot 1 to spot 2, the ghost hands looping along it, and "Calf knead · medium".
 */
@component
export class HandsOnC4CalfScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const main = getMain()
    const ix = new HandsOnLeafInteractor()
    await resetToStart(main, ix)
    await ix.tapLeg(visibleSpot(main, "calf", 0))
    await ix.tapLeg(visibleSpot(main, "calf", 1))
    expect(main.areChoicesVisible(), "choices before pick").toBe(true)
    const spots = main.getSpotPositions()

    await ix.pinch("Choice_Calf")
    expect(main.areChoicesVisible(), "choices after pick").toBe(false)
    const shown = await waitUntil(() => main.isGuideVisible(), 90)
    expect(shown, "guide visible within 90 frames").toBe(true)
    expect(main.getStep()).toBe("guide")
    expect(main.getChosenPartId()).toBe("calf")
    expect(main.getLabelText()).toBe("Calf knead · medium")
    expect(main.isHintVisible(), "hint hidden while guide plays").toBe(false)

    // choice row fades out and disables itself
    await waitFrames(20)
    for (const name of ["Choice_Calf", "Choice_Shin", "Choice_Sole"]) {
      const so = findSceneObjectByName(name)
      expect(!!so && so.isEnabledInHierarchy, name + " still shown").toBe(false)
    }
    const label = findSceneObjectByName("TechniqueLabelButton")
    expect(label && label.isEnabledInHierarchy, "technique label shown").toBe(true)
    const labelText = findSceneObjectByName("ButtonLabel", label).getComponent("Component.Text") as Text
    expect(labelText.text).toBe("Calf knead · medium")

    // arrow from spot 1 to spot 2
    const arrow = findSceneObjectByName("Arrow_Calf")
    expect(arrow && arrow.isEnabledInHierarchy, "Arrow_Calf").toBe(true)
    const a0 = main.getArrowStart()
    const a1 = main.getArrowEnd()
    log("C4: arrow " + v(a0) + " -> " + v(a1) + " spots " + v(spots[0]) + " " + v(spots[1]))
    expect(a0.distance(spots[0]), "arrow start vs spot 1 (cm)").toBeLessThan(1.5)
    expect(a1.distance(spots[1]), "arrow end vs spot 2 (cm)").toBeLessThan(1.5)

    // ghost hands: exist, move along the stroke, and loop back to the start
    const hands = [findSceneObjectByName("GhostHand_Calf_L"), findSceneObjectByName("GhostHand_Calf_R")]
    for (const h of hands) expect(h && h.isEnabledInHierarchy, "ghost hand").toBe(true)
    const t = hands[0].getTransform()
    const samples: vec3[] = []
    for (let i = 0; i < 28; i++) {
      samples.push(t.getWorldPosition())
      await sleep(250) // 7 s window > one 4.5 s cycle
    }
    const toEnd = samples.map((p) => p.distance(a1))
    const toStart = samples.map((p) => p.distance(a0))
    let travel = 0
    for (let i = 1; i < samples.length; i++) travel += samples[i].distance(samples[i - 1])
    // first time near the end, then later near the start again = a loop
    let iEnd = -1
    for (let i = 0; i < toEnd.length; i++) if (toEnd[i] < toStart[i] && iEnd < 0 && toStart[i] > 6) iEnd = i
    let loopedBack = false
    if (iEnd >= 0) for (let i = iEnd + 1; i < toStart.length; i++) if (toStart[i] < toEnd[i] && toEnd[i] > 6) loopedBack = true
    log("C4: ghost hand path travel " + travel.toFixed(1) + " cm, reached end at sample " + iEnd + ", looped back " + loopedBack)
    expect(travel, "ghost hand travel over 7 s (cm)").toBeGreaterThan(10)
    expect(iEnd >= 0, "ghost hand reaches the arrow end").toBe(true)
    expect(loopedBack, "ghost hand returns to the start (loop)").toBe(true)
    log("C4: PASS")
  }
}
