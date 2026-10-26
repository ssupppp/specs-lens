import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {nextFrame, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HandsOnLeafInteractor, ensureCalfGuide, getMain, log, v} from "./HandsOnTestKit"

/**
 * Criterion 6 — with a guide showing, a real SIK drag from the arrow-start handle along the
 * arrow turns it green; the opposite drag leaves it neutral.
 */
@component
export class HandsOnC6DirectionScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const main = getMain()
    const ix = new HandsOnLeafInteractor()
    await ensureCalfGuide(main, ix)
    const part = main.getChosenPartId() === "calf" ? "Calf" : "Calf"
    const handleName = "ArrowStart_" + part
    const dir = main.getArrowDirection()
    log("C6: arrow direction " + v(dir) + " start " + v(main.getArrowStart()) + " end " + v(main.getArrowEnd()))
    expect(main.isArrowGreen(), "neutral before drag").toBe(false)

    const right = await this.dragAndWatch(main, ix, handleName, dir.uniformScale(0.6), 1100)
    log("C6: along-arrow drag — saw green " + right.green + ", handle moved " + right.moved.toFixed(1) + " cm")
    expect(right.moved, "handle moved by the drag (cm)").toBeGreaterThan(4)
    expect(right.green, "arrow turned green on the right-way drag").toBe(true)

    await sleep(600) // release fades back to neutral
    expect(main.isArrowGreen(), "neutral after release").toBe(false)

    const wrong = await this.dragAndWatch(main, ix, handleName, dir.uniformScale(-0.6), 1100)
    log("C6: wrong-way drag — saw green " + wrong.green + ", handle moved " + wrong.moved.toFixed(1) + " cm")
    expect(wrong.moved, "handle moved by the wrong-way drag (cm)").toBeGreaterThan(4)
    expect(wrong.green, "arrow stayed neutral on the wrong-way drag").toBe(false)
    log("C6: PASS")
  }

  private async dragAndWatch(
    main: ReturnType<typeof getMain>,
    ix: HandsOnLeafInteractor,
    handleName: string,
    perUpdate: vec3,
    ms: number,
  ): Promise<{green: boolean; moved: number}> {
    const handle = findInteractableByName(handleName, undefined, true)
    if (!handle) throw new Error(handleName + " interactable not found / not enabled")
    const t = handle.getSceneObject().getTransform()
    const p0 = t.getWorldPosition()
    let green = false
    let moved = 0
    let done = false
    const drag = ix.drag(handle, perUpdate, ms).then(() => (done = true))
    while (!done) {
      if (main.isArrowGreen()) green = true
      moved = Math.max(moved, t.getWorldPosition().distance(p0))
      await nextFrame()
    }
    await drag
    return {green, moved}
  }
}
