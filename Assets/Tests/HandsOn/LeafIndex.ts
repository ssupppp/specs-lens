import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {HandsOnC1OpenScenario} from "./HandsOnC1OpenScenario"
import {HandsOnC2TurnScenario} from "./HandsOnC2TurnScenario"
import {HandsOnC3SpotsScenario} from "./HandsOnC3SpotsScenario"
import {HandsOnC4CalfScenario} from "./HandsOnC4CalfScenario"
import {HandsOnC5SwitchOffScenario} from "./HandsOnC5SwitchOffScenario"
import {HandsOnC6DirectionScenario} from "./HandsOnC6DirectionScenario"

/**
 * LEAF scenario index for HandsOn: one scenario per done criterion in devpost/design-brief.md.
 */
@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {id: "handson-c1-open", typename: HandsOnC1OpenScenario.getTypeName()},
    {id: "handson-c2-turn", typename: HandsOnC2TurnScenario.getTypeName()},
    {id: "handson-c3-spots", typename: HandsOnC3SpotsScenario.getTypeName()},
    {id: "handson-c4-calf", typename: HandsOnC4CalfScenario.getTypeName()},
    {id: "handson-c5-switch-off", typename: HandsOnC5SwitchOffScenario.getTypeName()},
    {id: "handson-c6-direction", typename: HandsOnC6DirectionScenario.getTypeName()},
  ]
}
