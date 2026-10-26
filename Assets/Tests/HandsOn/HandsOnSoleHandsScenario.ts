import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {showPartGuide} from "./HandsOnTestKit"

/** Sole ghost hands: placing a sole guide shows both posed hands near the arrow (criterion 4 covers the calf). */
@component
export class HandsOnSoleHandsScenario extends Scenario {
  async run(): Promise<void> {
    await showPartGuide("sole", "Sole")
  }
}
