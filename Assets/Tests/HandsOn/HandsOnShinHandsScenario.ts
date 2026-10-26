import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {showPartGuide} from "./HandsOnTestKit"

/** Shin ghost hands: placing a shin guide shows both posed hands near the arrow (criterion 4 covers the calf). */
@component
export class HandsOnShinHandsScenario extends Scenario {
  async run(): Promise<void> {
    await showPartGuide("shin", "Shin")
  }
}
