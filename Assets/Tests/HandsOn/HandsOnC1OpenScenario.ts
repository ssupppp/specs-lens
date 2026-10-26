import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, findSceneObjectsByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HandsOnLeafInteractor, START_HINT, atStart, camTransform, getMain, log, resetToStart, v} from "./HandsOnTestKit"

/**
 * Criterion 1 — on open: leg face down on the bed 60-70 cm away, below the eyes where the user
 * looks (the preview camera looks ~55 deg down); "Calf · Shin · Sole" and the "Pick the part"
 * hint above it, clear of the foot. Observes state only (run right after a preview refresh for
 * the true "Lens opens" state; otherwise it resets to the start with real pinches first).
 */
@component
export class HandsOnC1OpenScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const main = getMain()
    if (!atStart(main)) {
      log("C1: Lens not at start state; resetting with real input")
      await resetToStart(main, new HandsOnLeafInteractor())
    }

    const cam = camTransform()
    const camPos = cam.getWorldPosition()
    const look = cam.back.normalize()

    const leg = findSceneObjectByName("Leg")
    expect(leg, "Leg object").toBeTruthy()
    const rmv = leg.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
    const legMin = rmv.worldAabbMin()
    const legMax = rmv.worldAabbMax()
    const legCenter = legMin.add(legMax).uniformScale(0.5)
    const rel = legCenter.sub(camPos)
    const dist = rel.length
    const offGaze = (Math.acos(Math.max(-1, Math.min(1, rel.normalize().dot(look)))) * 180) / Math.PI
    const below = camPos.y - legCenter.y
    log("C1: cam " + v(camPos) + " legCenter " + v(legCenter) + " dist=" + dist.toFixed(1) + " offGaze=" + offGaze.toFixed(1) + " below=" + below.toFixed(1))

    expect(dist, "leg distance from the eyes (cm)").toBeGreaterThan(55)
    expect(dist, "leg distance from the eyes (cm)").toBeLessThan(80)
    expect(offGaze, "leg angle off the gaze (deg)").toBeLessThan(15)
    expect(below, "leg below eye level, seen from above (cm)").toBeGreaterThan(35)

    // face down: the back of the calf faces up
    expect(main.getLegPose()).toBe("faceDown")
    const calfUp = main.legModel.surfaceToWorld("leg", 20, 180).normal.y
    log("C1: calf normal y=" + calfUp.toFixed(2))
    expect(calfUp, "calf faces up").toBeGreaterThan(0.7)

    // part choices up front
    expect(main.areChoicesVisible(), "choices at open").toBe(true)
    expect(main.getChoiceOptions().join(" · ")).toBe("Calf · Shin · Sole")

    // hint text + where it sits
    expect(main.getHintText()).toBe(START_HINT)
    expect(main.isHintVisible()).toBe(true)
    let hintText: Text | null = null
    for (const name of ["StartHintA", "StartHintB"]) {
      const root = findSceneObjectsByName(name)[0]
      if (!root || !root.isEnabledInHierarchy) continue
      const item = findSceneObjectByName("Item", root)
      const t = item ? (item.getComponent("Component.Text") as Text) : null
      if (t && t.text === START_HINT) hintText = t
    }
    expect(hintText, "enabled hint Text showing the start hint").toBeTruthy()
    const hMin = hintText.worldAabbMin()
    const hMax = hintText.worldAabbMax()
    log("C1: hint aabb " + v(hMin) + " .. " + v(hMax))

    // top of the shank around its middle (the hint should sit above it)
    const lm = main.legModel
    const shank = lm.shankLengthCm
    let shankTop = -1e9
    for (let a = shank * 0.3; a <= shank * 0.7; a += 2) {
      for (let b = 0; b < 360; b += 20) shankTop = Math.max(shankTop, lm.surfaceToWorld("leg", a, b).position.y)
    }
    // foot bounds from its surface
    let fMin = new vec3(1e9, 1e9, 1e9)
    let fMax = new vec3(-1e9, -1e9, -1e9)
    for (let a = 0; a <= lm.footLengthCm; a += 1.5) {
      for (let b = -180; b < 180; b += 20) {
        const p = lm.surfaceToWorld("foot", a, b).position
        fMin = vec3.min(fMin, p)
        fMax = vec3.max(fMax, p)
      }
    }
    log("C1: shankTop y=" + shankTop.toFixed(1) + " foot aabb " + v(fMin) + " .. " + v(fMax))
    expect(hMin.y, "hint bottom vs shank top").toBeGreaterThan(shankTop)
    const overlapsFoot =
      hMin.x < fMax.x && hMax.x > fMin.x && hMin.y < fMax.y && hMax.y > fMin.y && hMin.z < fMax.z && hMax.z > fMin.z
    expect(overlapsFoot, "hint box overlaps foot box").toBe(false)
    // clearance between the two boxes along whichever axis separates them most
    const gap = Math.max(fMin.x - hMax.x, hMin.x - fMax.x, fMin.y - hMax.y, hMin.y - fMax.y, fMin.z - hMax.z, hMin.z - fMax.z)
    log("C1: hint-to-foot clearance " + gap.toFixed(1) + " cm")
    expect(gap, "hint-to-foot clearance (cm)").toBeGreaterThan(3)
    log("C1: PASS")
  }
}
