/**
 * HandsOnGuideUI — every piece of text in HandsOn (passive view).
 *
 * Owns three floating, camera-facing surfaces:
 *  - Hint: one line of step text ("Place your palm where the stroke starts" ...), crossfades
 *    between texts over 300 ms.
 *  - Choices: a row of pinchable UIKit Buttons ("Calf · Shin · Sole", plus "Off" when asked).
 *    Fade in 150 ms; hovered chip brightens ~50% -> 100%; the picked chip flashes and the row
 *    fades out over 300 ms.
 *  - Technique label: a pinchable UIKit Button showing e.g. "Calf knead · medium".
 * Public API (called by HandsOnMain): configureChoices(), showHint(), hideHint(), showChoices(),
 *   hideChoices(), showLabel(), hideLabel(), plus getters. Events: onChoice(id), onLabelPinched.
 * Must not: hold step/guide state or decide anything — it renders what it is told and reports
 *   pinches.
 * Size: three small surfaces plus the shared type-scale block; split a surface out if it grows.
 */
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexAlign, FlexAlignSelf, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

// ── Typography: the single source of truth for text size + weight ────────────
// `Component.Text.size` is the em-square height (em cm = size / 43.886), calibrated
// for the SnapOS system font at z = -110 cm. Pick a role, never a raw number.
const FONT_SIZE_SCALE = 1.0

type TextRole = "Title1" | "Title2" | "HeadlineXL" | "Headline1" | "Headline2" | "Subheadline" | "Button" | "Callout" | "Body" | "Caption"

const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Title1: {size: 105, weight: 700},
  Title2: {size: 93, weight: 700},
  HeadlineXL: {size: 62, weight: 700},
  Headline1: {size: 54, weight: 700},
  Headline2: {size: 48, weight: 700},
  Subheadline: {size: 41, weight: 700},
  Button: {size: 39, weight: 500},
  Callout: {size: 39, weight: 700},
  Body: {size: 39, weight: 500},
  Caption: {size: 38, weight: 500},
}

function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}

function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

const LAYOUT_Z_LIFT = 0.02
const BUTTON_LABEL_Z = 0.08
/** Approximate glyph advance at size 39, cm per character (Body/Button roles). */
const CM_PER_CHAR_AT_39 = 0.5

export interface ChoiceOption {
  id: string
  name: string
}

interface TextBlock {
  root: SceneObject
  text: Text
  alpha: number
  target: number
}

interface Chip {
  id: string
  so: SceneObject
  button: Button
  item: FlexItem
  text: Text
  hover: number
  hoverTarget: number
  inRow: boolean
}

@component
export class HandsOnGuideUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">HandsOnGuideUI – hint, part choices, technique label</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input("vec3", "{0.86, 0.94, 1.0}")
  @hint("Text colour — keep it light (soft white / pale blue): black is invisible on Specs")
  @widget(new ColorWidget())
  textColor: vec3

  @input
  @hint("Text is sized as if read at this distance, cm (bigger = larger text; the leg is ~55 cm away)")
  @widget(new SliderWidget(40, 110, 1))
  viewingDistanceCm: number = 100

  @input
  @hint("Width of each part choice chip, cm")
  @widget(new SliderWidget(3, 8, 0.1))
  choiceWidthCm: number = 4.6

  @input
  @hint("Height of the choice chips and the technique label, cm")
  @widget(new SliderWidget(2, 5, 0.1))
  chipHeightCm: number = 2.8

  @input
  @hint("Gap between choice chips, cm")
  @widget(new SliderWidget(0, 2, 0.1))
  choiceGapCm: number = 0.6

  @input
  @hint("Brightness of a choice chip when not aimed at (aimed = 1)")
  @widget(new SliderWidget(0.2, 1, 0.05))
  idleChipBrightness: number = 0.55
  @ui.group_end

  private readonly choiceEvent = new Event<string>()
  private readonly labelEvent = new Event<void>()

  private built = false
  private camTransform: Transform | null = null
  private firstFrameDone = false

  // hint (two slots crossfade)
  private hints: TextBlock[] = []
  private activeHint = -1
  private hintText = ""

  // choices
  private choicesRoot: SceneObject
  private choicesFlex: FlexLayout
  private flexReady = false
  private chips: Chip[] = []
  private choicesAlpha = 0
  private choicesTarget = 0
  private choicesWanted = false
  private choicesAccepting = false
  private wantedIds: string[] = []
  private flashId = ""
  private flashTime = 0

  // technique label
  private labelRoot: SceneObject
  private labelButton: Button
  private labelTextComp: Text
  private labelAlpha = 0
  private labelTarget = 0
  private labelWanted = false
  private labelText = ""
  private labelShownText = ""
  private labelPos: vec3 = vec3.zero()
  private labelHover = 0
  private labelHoverTarget = 0
  private labelWidthCm = 12

  get onChoice(): PublicApi<string> {
    return this.choiceEvent.publicApi()
  }

  get onLabelPinched(): PublicApi<void> {
    return this.labelEvent.publicApi()
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      this.camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /**
   * Build the choice row (every option that can ever appear) and the label. Call once, from
   * the caller's OnStart. `longestLabel` sizes the technique label button.
   */
  configureChoices(options: ChoiceOption[], longestLabel: string): void {
    if (this.built) return
    this.built = true
    this.hints.push(this.buildTextBlock("StartHintA", "Body", 34))
    this.hints.push(this.buildTextBlock("StartHintB", "Body", 34))
    this.buildChoices(options)
    this.buildLabel(longestLabel)
  }

  // ── hint ──

  /** Show `text` at `worldPos`; a different previous text crossfades out. */
  showHint(text: string, worldPos: vec3): void {
    if (!this.built) return
    const cur = this.activeHint >= 0 ? this.hints[this.activeHint] : null
    if (cur && this.hintText === text && cur.target > 0) {
      cur.root.getTransform().setWorldPosition(worldPos)
      return
    }
    if (cur) cur.target = 0
    this.activeHint = (this.activeHint + 1) % this.hints.length
    const b = this.hints[this.activeHint]
    b.text.text = text
    b.root.getTransform().setWorldPosition(worldPos)
    b.target = 1
    b.root.enabled = true
    this.hintText = text
  }

  hideHint(): void {
    if (this.activeHint >= 0) this.hints[this.activeHint].target = 0
    this.activeHint = -1
    this.hintText = ""
  }

  /** Text of the hint currently shown ("" when hidden). */
  getHintText(): string {
    return this.hintText
  }

  isHintVisible(): boolean {
    return this.hintText !== ""
  }

  // ── choices ──

  /** Show the chips whose ids are listed (in that order of the catalog) at `worldPos`. */
  showChoices(ids: string[], worldPos: vec3): void {
    if (!this.built) return
    this.wantedIds = ids.slice()
    this.choicesWanted = true
    this.choicesAccepting = true
    this.flashId = ""
    this.choicesRoot.getTransform().setWorldPosition(worldPos)
    this.choicesRoot.enabled = true
    this.choicesTarget = 1
    this.syncRow()
  }

  /** Fade the row out (300 ms). If `pickedId` is given, that chip flashes first. */
  hideChoices(pickedId: string = ""): void {
    this.choicesWanted = false
    this.choicesAccepting = false
    this.flashId = pickedId
    this.flashTime = 0
    this.choicesTarget = 0
  }

  areChoicesVisible(): boolean {
    return this.choicesWanted
  }

  /** Ids of the chips currently offered ([] when hidden). */
  getChoiceIds(): string[] {
    return this.choicesWanted ? this.wantedIds.slice() : []
  }

  /** Width of the chip row for `count` chips, cm (for keeping it inside the view). */
  getChoiceRowWidthCm(count: number): number {
    return count * this.choiceWidthCm + Math.max(0, count - 1) * this.choiceGapCm
  }

  /** Width of the technique label button, cm. */
  getLabelWidthCm(): number {
    return this.labelWidthCm
  }

  getChoiceWorldPosition(): vec3 {
    return this.choicesRoot ? this.choicesRoot.getTransform().getWorldPosition() : vec3.zero()
  }

  // ── technique label ──

  showLabel(text: string, worldPos: vec3): void {
    if (!this.built) return
    this.labelWanted = true
    this.labelText = text
    this.labelPos = worldPos
    this.labelRoot.enabled = true
    if (this.labelAlpha <= 0.001 || this.labelShownText === text) {
      this.applyLabelContent()
      this.labelTarget = 1
    } else {
      this.labelTarget = 0 // fade the old text out first; onUpdate swaps and fades back in
    }
  }

  hideLabel(): void {
    this.labelWanted = false
    this.labelText = ""
    this.labelTarget = 0
  }

  getLabelText(): string {
    return this.labelText
  }

  isLabelVisible(): boolean {
    return this.labelWanted
  }

  getLabelWorldPosition(): vec3 {
    return this.labelPos
  }

  // ── per frame ──

  private onUpdate(): void {
    if (!this.built) return
    const dt = getDeltaTime()

    // UIKit elements initialise on OnStart, so they are created enabled and hidden here.
    if (!this.firstFrameDone) {
      this.firstFrameDone = true
      if (!this.choicesWanted) this.choicesRoot.enabled = false
      if (!this.labelWanted) this.labelRoot.enabled = false
    }

    for (const b of this.hints) {
      if (b.alpha !== b.target) {
        b.alpha = b.target > b.alpha ? Math.min(b.target, b.alpha + dt / 0.3) : Math.max(b.target, b.alpha - dt / 0.3)
        this.applyTextAlpha(b.text, b.alpha)
        if (b.alpha <= 0 && b.target <= 0) b.root.enabled = false
      }
      if (b.root.enabled) this.faceCamera(b.root)
    }

    this.updateChoices(dt)
    this.updateLabel(dt)
  }

  private updateChoices(dt: number): void {
    if (!this.choicesRoot.enabled) return
    if (this.flashId !== "") this.flashTime += dt
    const holdForFlash = this.flashId !== "" && this.flashTime < 0.12
    if (!holdForFlash) {
      const rate = this.choicesTarget > this.choicesAlpha ? dt / 0.15 : dt / 0.3
      this.choicesAlpha = this.choicesTarget > this.choicesAlpha ? Math.min(1, this.choicesAlpha + rate) : Math.max(0, this.choicesAlpha - rate)
    }
    for (const c of this.chips) {
      c.hover = c.hoverTarget > c.hover ? Math.min(1, c.hover + dt / 0.15) : Math.max(0, c.hover - dt / 0.15)
      const flashing = c.id === this.flashId
      const bright = flashing ? 1 : this.idleChipBrightness + (1 - this.idleChipBrightness) * c.hover
      const a = this.choicesAlpha * bright
      this.applyTextAlpha(c.text, a)
      c.button.opacity = this.choicesAlpha * (flashing ? 1 : 0.5 + 0.5 * bright)
      const s = flashing && holdForFlash ? 1.08 : 1
      c.so.getTransform().setLocalScale(new vec3(s, s, s))
    }
    this.faceCamera(this.choicesRoot)
    if (!this.choicesWanted && this.choicesAlpha <= 0) {
      this.choicesRoot.enabled = false
      this.flashId = ""
      for (const c of this.chips) c.hover = c.hoverTarget = 0
    }
  }

  private updateLabel(dt: number): void {
    if (!this.labelRoot.enabled) return
    const rate = dt / 0.3
    this.labelAlpha = this.labelTarget > this.labelAlpha ? Math.min(1, this.labelAlpha + rate) : Math.max(0, this.labelAlpha - rate)
    if (this.labelWanted && this.labelAlpha <= 0 && this.labelShownText !== this.labelText) {
      this.applyLabelContent()
      this.labelTarget = 1
    }
    this.labelHover = this.labelHoverTarget > this.labelHover ? Math.min(1, this.labelHover + dt / 0.15) : Math.max(0, this.labelHover - dt / 0.15)
    this.applyTextAlpha(this.labelTextComp, this.labelAlpha * (0.85 + 0.15 * this.labelHover))
    this.labelButton.opacity = this.labelAlpha * (0.6 + 0.4 * this.labelHover)
    this.faceCamera(this.labelRoot)
    if (!this.labelWanted && this.labelAlpha <= 0) this.labelRoot.enabled = false
  }

  private applyLabelContent(): void {
    this.labelTextComp.text = this.labelText
    this.labelShownText = this.labelText
    this.labelRoot.getTransform().setWorldPosition(this.labelPos)
  }

  /** Keep the row's FlexLayout items in step with the ids wanted (e.g. add/remove "Off"). */
  private syncRow(): void {
    if (!this.flexReady) return
    const add: FlexItem[] = []
    const remove: FlexItem[] = []
    for (const c of this.chips) {
      const want = this.wantedIds.indexOf(c.id) >= 0
      if (want && !c.inRow) add.push(c.item)
      if (!want && c.inRow) remove.push(c.item)
      c.inRow = want
      c.so.enabled = want
    }
    if (remove.length > 0) this.choicesFlex.removeItems(remove)
    if (add.length > 0) {
      this.choicesFlex.addItems(add)
      // keep catalog order (e.g. "Off" last)
      const ordered = this.chips.filter((c) => c.inRow).map((c) => c.item)
      this.choicesFlex.reorderItems(ordered)
    }
  }

  // ── builders ──

  private buildChoices(options: ChoiceOption[]): void {
    this.choicesRoot = this.obj(this.sceneObject, "Choices")
    this.choicesRoot.createComponent("Component.Canvas")
    const content = this.obj(this.choicesRoot, "Content")
    const flex = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    this.choicesFlex = flex
    const rowW = options.length * this.choiceWidthCm + (options.length - 1) * this.choiceGapCm + 1
    const h = this.chipHeightCm
    flex.onInitialized.add(() => {
      flex.width = rowW
      flex.height = h
      flex.direction = FlexDirection.Row
      flex.justifyContent = FlexJustify.Center
      flex.alignItems = FlexAlign.Center
      flex.columnGap = this.choiceGapCm
    })
    for (const opt of options) {
      const so = this.obj(content, "Choice_" + opt.name)
      this.liftInZ(so, LAYOUT_Z_LIFT)
      const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
      item.overrideWidth = this.choiceWidthCm
      item.overrideHeight = h
      item.flexGrow = 0
      item.flexShrink = 0
      const button = so.createComponent(Button.getTypeName()) as Button
      const w = this.choiceWidthCm
      button.size = new vec3(w, h, 1)
      button.onInitialized.add(() => (button.size = new vec3(w, h, 1)))
      const text = this.addButtonLabel(so, opt.name, w - 0.5, "Button")
      const chip: Chip = {id: opt.id, so, button, item, text, hover: 0, hoverTarget: 0, inRow: true}
      button.onHoverEnter.add(() => (chip.hoverTarget = 1))
      button.onHoverExit.add(() => (chip.hoverTarget = 0))
      button.onTriggerUp.add(() => this.onChipPinched(chip))
      this.applyTextAlpha(text, 0)
      button.opacity = 0
      this.chips.push(chip)
    }
    // Register the chips once the layout is initialised (addItems throws before that).
    flex.onInitialized.add(() => {
      flex.addItems(this.chips.map((c) => c.item))
      this.flexReady = true
      if (this.choicesWanted) this.syncRow()
    })
  }

  private onChipPinched(chip: Chip): void {
    if (!this.choicesAccepting || this.wantedIds.indexOf(chip.id) < 0) return
    this.hideChoices(chip.id)
    this.choiceEvent.invoke(chip.id)
  }

  private buildLabel(longestLabel: string): void {
    this.labelRoot = this.obj(this.sceneObject, "TechniqueLabel")
    this.labelRoot.createComponent("Component.Canvas")
    const so = this.obj(this.labelRoot, "TechniqueLabelButton")
    const textW = longestLabel.length * CM_PER_CHAR_AT_39 * (roleSize("Body", this.viewingDistanceCm) / 39)
    const w = textW + 2.0
    this.labelWidthCm = w
    const h = this.chipHeightCm
    const button = so.createComponent(Button.getTypeName()) as Button
    button.size = new vec3(w, h, 1)
    button.onInitialized.add(() => (button.size = new vec3(w, h, 1)))
    this.labelButton = button
    this.labelTextComp = this.addButtonLabel(so, "", w - 0.5, "Body")
    button.onHoverEnter.add(() => (this.labelHoverTarget = 1))
    button.onHoverExit.add(() => (this.labelHoverTarget = 0))
    button.onTriggerUp.add(() => {
      if (this.labelWanted && this.labelAlpha > 0.2) this.labelEvent.invoke()
    })
    this.applyTextAlpha(this.labelTextComp, 0)
    button.opacity = 0
  }

  /** One hint text block: Canvas + FlexLayout column with a single stretched text item. */
  private buildTextBlock(name: string, role: TextRole, widthCm: number): TextBlock {
    const root = this.obj(this.sceneObject, name)
    root.createComponent("Component.Canvas")
    const content = this.obj(root, "Content")
    const flex = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    const rowH = 3
    flex.onInitialized.add(() => {
      flex.width = widthCm
      flex.height = rowH
      flex.direction = FlexDirection.Column
      flex.justifyContent = FlexJustify.Center
      flex.alignItems = FlexAlign.Stretch
    })
    const child = this.obj(content, "Item")
    this.liftInZ(child, LAYOUT_Z_LIFT)
    const item = child.createComponent(FlexItem.getTypeName()) as FlexItem
    item.overrideWidth = widthCm
    item.overrideHeight = rowH
    item.flexShrink = 0
    item.alignSelf = FlexAlignSelf.Stretch
    const t = child.createComponent("Component.Text") as Text
    t.text = ""
    t.depthTest = true
    applyTextRole(t, role, this.viewingDistanceCm)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-0.5, 0.5, -0.5, 0.5)
    flex.onInitialized.add(() => flex.addItems([item]))
    const block: TextBlock = {root, text: t, alpha: 0, target: 0}
    this.applyTextAlpha(t, 0)
    return block
  }

  /** Raw label on a Button face, lifted forward so the face doesn't clip its glyphs. */
  private addButtonLabel(parent: SceneObject, text: string, widthCm: number, role: TextRole): Text {
    const so = this.obj(parent, "ButtonLabel")
    so.getTransform().setLocalPosition(new vec3(0, 0, BUTTON_LABEL_Z))
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, role, this.viewingDistanceCm)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -1.2, 1.2)
    return t
  }

  private applyTextAlpha(t: Text, alpha: number): void {
    const c = this.textColor ?? new vec3(0.86, 0.94, 1.0)
    t.textFill.color = new vec4(c.x, c.y, c.z, alpha)
  }

  private faceCamera(root: SceneObject): void {
    if (!this.camTransform) return
    const t = root.getTransform()
    const toCam = this.camTransform.getWorldPosition().sub(t.getWorldPosition())
    if (toCam.length < 0.001) return
    const fwd = toCam.normalize()
    let rot = quat.lookAt(fwd, vec3.up())
    // lookAt convention guard: the text's +Z (readable side) must point at the camera
    if (rot.multiplyVec3(vec3.forward()).dot(fwd) < 0) rot = rot.multiply(quat.angleAxis(Math.PI, vec3.up()))
    t.setWorldRotation(rot)
  }

  private obj(parent: SceneObject, name: string): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    return so
  }

  private liftInZ(so: SceneObject, zOffset: number): void {
    const t = so.getTransform()
    const p = t.getLocalPosition()
    t.setLocalPosition(new vec3(p.x, p.y, p.z + zOffset))
  }
}
