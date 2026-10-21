/**
 * HandsOnSpots — the soft dots that mark where each palm landed (world-locked).
 *
 * Owns: creating a ~2 cm dot per palm spot (fade in 150 ms), and fading all dots out
 * (300 ms) when the guide is turned off or replaced.
 * Must not: decide when spots are placed or cleared (HandsOnMain does).
 */
import {buildDiscMesh} from "./HandsOnLegGeometry"

const FADE_IN = 0.15
const FADE_OUT = 0.3
const LIFT_CM = 0.35

interface Dot {
  root: SceneObject
  mat: Material
  alpha: number
  leaving: boolean
  position: vec3
}

export class HandsOnSpots {
  private dots: Dot[] = []
  private readonly mesh: RenderMesh

  constructor(
    private readonly container: SceneObject,
    private readonly material: Material,
    private readonly color: vec3,
    diameterCm: number,
  ) {
    this.mesh = buildDiscMesh(diameterCm / 2).getMesh()
  }

  /** Spots currently placed (not fading out), world space, in placement order. */
  positions(): vec3[] {
    return this.dots.filter((d) => !d.leaving).map((d) => d.position)
  }

  count(): number {
    return this.positions().length
  }

  add(position: vec3, normal: vec3): void {
    const n = normal.length > 0.001 ? normal.normalize() : vec3.up()
    const so = global.scene.createSceneObject("PalmSpot_" + (this.count() + 1))
    so.setParent(this.container)
    const t = so.getTransform()
    t.setWorldPosition(position.add(n.uniformScale(LIFT_CM)))
    let rot = quat.lookAt(n, Math.abs(n.y) > 0.95 ? vec3.forward() : vec3.up())
    if (rot.multiplyVec3(vec3.forward()).dot(n) < 0) rot = rot.multiply(quat.angleAxis(Math.PI, vec3.up()))
    t.setWorldRotation(rot)
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = this.mesh
    const mat = this.material.clone()
    mat.mainPass.twoSided = true
    rmv.mainMaterial = mat
    const dot: Dot = {root: so, mat, alpha: 0, leaving: false, position}
    this.dots.push(dot)
    this.apply(dot)
  }

  /** Fade every dot out and remove it. */
  clear(): void {
    for (const d of this.dots) d.leaving = true
  }

  update(dt: number): void {
    for (const d of this.dots) {
      if (d.leaving) d.alpha = Math.max(0, d.alpha - dt / FADE_OUT)
      else d.alpha = Math.min(1, d.alpha + dt / FADE_IN)
      this.apply(d)
    }
    const gone = this.dots.filter((d) => d.leaving && d.alpha <= 0)
    for (const d of gone) d.root.destroy()
    if (gone.length > 0) this.dots = this.dots.filter((d) => !(d.leaving && d.alpha <= 0))
  }

  private apply(d: Dot): void {
    const c = this.color
    const k = d.alpha * 0.85
    d.mat.mainPass.baseColor = new vec4(c.x * k, c.y * k, c.z * k, 1)
  }
}
