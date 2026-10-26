/**
 * HandsOnLegGeometry — procedural geometry for HandsOn (plain TS, no scene access).
 *
 * Owns: the stand-in lower leg + foot shape (parametric surfaces), projection of any
 * point onto that surface, the stroke path between two palm spots, and MeshBuilder
 * meshes for the leg, cushion, stroke arrow, dots and ghost hands.
 * Everything is in the Leg SceneObject's local space (cm), natural resting pose:
 *   +X = along the leg, knee -> ankle   +Y = front of the leg (shin, faces up)   +Z = inner side
 * Must not: create SceneObjects or read scene state — callers own placement.
 * Size: one cohesive geometry kit (shape, projection, path and mesh builders share the vector
 * helpers); split the hand/cushion builders into their own file if it grows further.
 */

export type V3 = [number, number, number]

// ── tiny vector helpers (plain arrays keep mesh generation allocation-light) ──
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const len = (a: V3): number => Math.sqrt(dot(a, a))
export const norm = (a: V3): V3 => {
  const l = len(a)
  return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 0]
}
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const toVec3 = (a: V3): vec3 => new vec3(a[0], a[1], a[2])
export const fromVec3 = (v: vec3): V3 => [v.x, v.y, v.z]

const DEG = Math.PI / 180
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const smooth = (x: number) => x * x * (3 - 2 * x)

function lerpTable(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0]
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
      return ys[i - 1] + (ys[i] - ys[i - 1]) * smooth(t)
    }
  }
  return ys[ys.length - 1]
}

/** Signed power used by superellipse cross-sections. */
const spow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p)

export interface LegShapeParams {
  shankLengthCm: number // knee to ankle joint
  kneeRadiusCm: number
  ankleRadiusCm: number
  calfBulgeCm: number
  footLengthCm: number // heel to big-toe tip
  plantarflexDeg: number // relaxed foot: toes tilt away from the knee
}

export type Region = "leg" | "foot"

export interface SurfaceSample {
  p: V3
  n: V3
  region: Region
  /** leg: cm from knee; foot: cm from heel */
  a: number
  /** leg: degrees around (0 front, 90 inner, 180 back); foot: degrees around the long axis (-90 sole, 90 top) */
  b: number
}

/** Toe layout in "standard foot" units (25 cm foot): across, start, length, radius, height, splay. */
const TOES = [
  {w: 2.85, u0: 17.0, len: 6.8, r: 1.2, h: 1.25, splay: 2},
  {w: 0.75, u0: 17.6, len: 6.2, r: 0.82, h: 0.95, splay: -2},
  {w: -0.95, u0: 17.5, len: 5.4, r: 0.78, h: 0.9, splay: -5},
  {w: -2.5, u0: 17.2, len: 4.6, r: 0.74, h: 0.85, splay: -8},
  {w: -3.75, u0: 16.6, len: 3.8, r: 0.68, h: 0.8, splay: -12},
]

/**
 * Parametric lower leg + foot in a natural resting pose (lying on the calf, toes up).
 * The foot is a heel-to-ball body with an inner arch, plus five separate toes.
 */
export class LegShape {
  readonly kneeX: number
  readonly ankle: V3
  // foot frame (Leg-local): N = sole normal (out of the sole), T = heel->toes, M = across (inner)
  readonly footN: V3
  readonly footT: V3
  readonly footM: V3
  readonly heelSole: V3
  /** Length of the foot body (heel to the base of the toes), cm. */
  readonly bodyLen: number
  private readonly k: number

  private static readonly U = [0, 1.5, 4, 7, 10, 13, 16, 18.5, 20]
  private static readonly W = [2.0, 2.9, 3.2, 3.3, 3.5, 3.9, 4.5, 4.6, 4.3] // half widths
  private static readonly H = [5.5, 7.5, 8.2, 7.6, 6.2, 4.9, 3.8, 3.0, 2.4] // top height above the sole
  private static readonly BODY_STD = 20

  constructor(readonly params: LegShapeParams) {
    this.kneeX = -params.shankLengthCm / 2 - 1.5
    this.ankle = [this.kneeX + params.shankLengthCm, 0, 0]
    this.k = params.footLengthCm / 25
    this.bodyLen = LegShape.BODY_STD * this.k
    // Neutral: toes point up (+Y, the shin side), sole faces away from the knee (+X).
    const pf = params.plantarflexDeg * DEG
    this.footT = [Math.sin(pf), Math.cos(pf), 0]
    this.footN = [Math.cos(pf), -Math.sin(pf), 0]
    this.footM = [0, 0, 1]
    this.heelSole = add(add(this.ankle, scale(this.footN, 6.5)), scale(this.footT, -4.5))
  }

  // ── lower leg ──
  legRadius(a: number, thetaDeg: number): number {
    const p = this.params
    const L = p.shankLengthCm
    const s = clamp(a / L, 0, 1)
    const th = thetaDeg * DEG
    let r = p.kneeRadiusCm + (p.ankleRadiusCm - p.kneeRadiusCm) * Math.pow(s, 1.25)
    // calf muscle toward the back / inner back, upper third of the shank
    const back = Math.max(0, Math.cos(th - 160 * DEG))
    r += p.calfBulgeCm * Math.exp(-Math.pow((s - 0.33) / 0.2, 2)) * back * back
    // a little wider side to side, ankle bones near the bottom
    const side = Math.sin(th)
    r *= 1 + 0.07 * side * side
    r += 0.55 * Math.exp(-Math.pow((s - 0.97) / 0.045, 2)) * Math.pow(Math.abs(side), 6)
    // rounded caps: knee end (a < 0) and ankle end (a > L, hidden inside the foot)
    if (a < 0) r *= Math.sqrt(Math.max(0, 1 - Math.pow(a / 4.0, 2)))
    if (a > L) r *= Math.sqrt(Math.max(0, 1 - Math.pow((a - L) / 3.0, 2)))
    return r
  }

  legPoint(a: number, thetaDeg: number): V3 {
    const r = this.legRadius(a, thetaDeg)
    const th = thetaDeg * DEG
    return [this.kneeX + a, r * Math.cos(th), r * Math.sin(th)]
  }

  legAxis(a: number): V3 {
    return [this.kneeX + clamp(a, 0, this.params.shankLengthCm), 0, 0]
  }

  legSample(a: number, thetaDeg: number): SurfaceSample {
    const p = this.legPoint(a, thetaDeg)
    const da = sub(this.legPoint(a + 0.05, thetaDeg), this.legPoint(a - 0.05, thetaDeg))
    const db = sub(this.legPoint(a, thetaDeg + 0.5), this.legPoint(a, thetaDeg - 0.5))
    let n = norm(cross(db, da))
    const ref = sub(p, this.legAxis(a))
    if (len(n) < 0.5) n = norm(ref)
    else if (dot(n, ref) < 0) n = scale(n, -1)
    return {p, n, region: "leg", a, b: thetaDeg}
  }

  // ── foot ──
  private footDims(u: number): {w: number; h: number} {
    const std = clamp(u, 0, this.bodyLen) / this.k
    return {w: lerpTable(LegShape.U, LegShape.W, std), h: lerpTable(LegShape.U, LegShape.H, std)}
  }

  /** Point in the foot frame: u along the sole from the heel, w across (+ inner), h height above the sole. */
  footPoint(u: number, w: number, h: number): V3 {
    return add(add(add(this.heelSole, scale(this.footT, u)), scale(this.footM, w)), scale(this.footN, -h))
  }

  /** Foot body surface at u (cm from heel) and angle psi (rad; -pi/2 = sole centre, +pi/2 = top). */
  footRingPoint(u: number, psi: number): V3 {
    const B = this.bodyLen
    const d = this.footDims(u)
    let capS = 1
    if (u < 0) capS = Math.sqrt(Math.max(0, 1 - Math.pow(u / 2.2, 2)))
    if (u > B) capS = Math.sqrt(Math.max(0, 1 - Math.pow((u - B) / 1.4, 2)))
    const c = Math.cos(psi)
    const s = Math.sin(psi)
    const w = d.w * capS * spow(c, 2 / 2.6)
    let h = d.h / 2 + (d.h / 2) * capS * spow(s, s >= 0 ? 2 / 2.6 : 2 / 4.5) // flatter sole
    if (s < 0) {
      // inner arch: the sole lifts on the inner side through the middle of the foot
      const std = clamp(u, 0, B) / this.k
      const arch = 1.5 * Math.exp(-Math.pow((std - 10.5) / 3.6, 2))
      const inner = smooth(clamp((c + 0.3) / 1.3, 0, 1))
      h += arch * inner * -s
    }
    return this.footPoint(u, w, h)
  }

  footCenter(u: number): V3 {
    const uu = clamp(u, -2.2, this.bodyLen + 1.4)
    return this.footPoint(uu, 0, this.footDims(uu).h / 2)
  }

  footSample(u: number, psiDeg: number): SurfaceSample {
    const psi = psiDeg * DEG
    const p = this.footRingPoint(u, psi)
    const du = sub(this.footRingPoint(u + 0.05, psi), this.footRingPoint(u - 0.05, psi))
    const dp = sub(this.footRingPoint(u, psi + 0.01), this.footRingPoint(u, psi - 0.01))
    let n = norm(cross(du, dp))
    const ref = sub(p, this.footCenter(u))
    if (len(n) < 0.5) n = norm(ref)
    else if (dot(n, ref) < 0) n = scale(n, -1)
    return {p, n, region: "foot", a: u, b: psiDeg}
  }

  /** Surface sample from (region, a, b) coordinates — used for suggested/demo spots. */
  sampleAt(region: Region, a: number, b: number): SurfaceSample {
    return region === "foot" ? this.footSample(a, b) : this.legSample(a, b)
  }

  /** Nearest point on the leg/foot surface (toes are treated as part of the foot body). */
  project(p: V3): SurfaceSample {
    const L = this.params.shankLengthCm
    const a = clamp(p[0] - this.kneeX, -3.5, L + 1.0)
    const th = Math.atan2(p[2], p[1]) / DEG
    const leg = this.legSample(a, th)

    const rel = sub(p, this.heelSole)
    const u = clamp(dot(rel, this.footT), -2.0, this.bodyLen + 1.2)
    const c = this.footCenter(u)
    const r = sub(p, c)
    const d = this.footDims(u)
    const psi = Math.atan2(-dot(r, this.footN) / Math.max(0.5, d.h / 2), dot(r, this.footM) / d.w) / DEG
    const foot = this.footSample(u, psi)

    return len(sub(leg.p, p)) <= len(sub(foot.p, p)) ? leg : foot
  }

  /** Points around the surface ring at a sample's position (for "clear the leg" height checks). */
  ringAround(sample: SurfaceSample): V3[] {
    const out: V3[] = []
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * 360
      out.push(sample.region === "foot" ? this.footRingPoint(sample.a, ang * DEG) : this.legPoint(sample.a, ang))
    }
    return out
  }

  /** Toe spine (foot frame -> Leg-local) for toe i at t in [0, 1]. */
  toeSpinePoint(i: number, t: number): V3 {
    const toe = TOES[i]
    const k = this.k
    const sp = toe.splay * DEG
    const u = (toe.u0 + toe.len * t * Math.cos(sp)) * k
    const w = toe.w + toe.len * t * Math.sin(sp)
    const h = toe.h - 0.35 * toe.r * t * t // toes curl gently toward the sole
    return this.footPoint(u, w, h)
  }

  toeRadius(i: number): number {
    return TOES[i].r
  }
}

// ── stroke path between two palm spots ──────────────────────────────────────

export interface PathPoint {
  p: V3
  n: V3
  /** unit direction of travel */
  t: V3
}

/** Surface path from the first palm spot to the second (Leg-local), sampled by arc length. */
export class StrokePath {
  readonly pts: V3[] = []
  readonly nrm: V3[] = []
  readonly cum: number[] = []
  readonly length: number

  constructor(
    readonly shape: LegShape,
    startLocal: V3,
    endLocal: V3,
    samples: number = 48,
  ) {
    const s0 = shape.project(startLocal)
    const s1 = shape.project(endLocal)
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      let smp: SurfaceSample
      if (s0.region === "leg" && s1.region === "leg") {
        // stay on the leg surface: interpolate along the leg and around it (shortest way)
        let db = s1.b - s0.b
        while (db > 180) db -= 360
        while (db < -180) db += 360
        smp = shape.legSample(s0.a + (s1.a - s0.a) * t, s0.b + db * t)
      } else {
        smp = shape.project(lerp3(s0.p, s1.p, t))
      }
      this.pts.push(smp.p)
      this.nrm.push(smp.n)
    }
    let total = 0
    this.cum.push(0)
    for (let i = 1; i < this.pts.length; i++) {
      total += len(sub(this.pts[i], this.pts[i - 1]))
      this.cum.push(total)
    }
    this.length = Math.max(total, 0.001)
  }

  /** Point at arc-length fraction s in [0, 1]. */
  at(s: number): PathPoint {
    const target = clamp(s, 0, 1) * this.length
    let i = 1
    while (i < this.cum.length - 1 && this.cum[i] < target) i++
    const seg = Math.max(1e-6, this.cum[i] - this.cum[i - 1])
    const f = clamp((target - this.cum[i - 1]) / seg, 0, 1)
    const p = lerp3(this.pts[i - 1], this.pts[i], f)
    const n = norm(lerp3(this.nrm[i - 1], this.nrm[i], f))
    let t = norm(sub(this.pts[i], this.pts[i - 1]))
    if (len(t) < 0.5) t = norm(sub(this.pts[this.pts.length - 1], this.pts[0]))
    return {p, n, t}
  }

  /** Surface point offset `acrossCm` to the right of the path (seen from outside), lifted `liftCm` off the skin. */
  offset(s: number, acrossCm: number, liftCm: number): PathPoint & {right: V3} {
    const base = this.at(s)
    const right = norm(cross(base.t, base.n))
    const q = this.shape.project(add(base.p, scale(right, acrossCm)))
    return {p: add(q.p, scale(q.n, liftCm)), n: q.n, t: base.t, right}
  }
}

// ── mesh accumulation ─────────────────────────────────────────────────────────

export type RGBA = [number, number, number, number]

export class MeshAccumulator {
  readonly data: number[] = []
  readonly indices: number[] = []
  count = 0
  private readonly pos: V3[] = []
  private readonly nrm: V3[] = []

  addVertex(p: V3, n: V3, c: RGBA): number {
    this.data.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], c[3])
    this.pos.push(p)
    this.nrm.push(n)
    return this.count++
  }

  /** Adds a triangle wound counter-clockwise as seen from its vertices' normal side. */
  addTri(a: number, b: number, c: number): void {
    const pa = this.pos[a]
    const g = cross(sub(this.pos[b], pa), sub(this.pos[c], pa))
    if (len(g) < 1e-10) return // degenerate (poles)
    const nAvg = add(add(this.nrm[a], this.nrm[b]), this.nrm[c])
    if (dot(g, nAvg) >= 0) this.indices.push(a, b, c)
    else this.indices.push(a, c, b)
  }

  /**
   * Adds a grid surface. rows[i][j] = point; normals by central differences, oriented
   * by `outward(i, p)`. `closed` wraps columns.
   */
  addGrid(rows: V3[][], closed: boolean, outward: (i: number, p: V3) => V3, colorAt: (i: number, j: number) => RGBA): number[][] {
    const R = rows.length
    const C = rows[0].length
    const ids: number[][] = []
    for (let i = 0; i < R; i++) {
      const rowIds: number[] = []
      for (let j = 0; j < C; j++) {
        const p = rows[i][j]
        const ip = rows[Math.min(R - 1, i + 1)][j]
        const im = rows[Math.max(0, i - 1)][j]
        const jp = closed ? rows[i][(j + 1) % C] : rows[i][Math.min(C - 1, j + 1)]
        const jm = closed ? rows[i][(j - 1 + C) % C] : rows[i][Math.max(0, j - 1)]
        let n = norm(cross(sub(ip, im), sub(jp, jm)))
        const ref = outward(i, p)
        if (len(n) < 0.5) n = norm(ref)
        else if (dot(n, ref) < 0) n = scale(n, -1)
        rowIds.push(this.addVertex(p, n, colorAt(i, j)))
      }
      ids.push(rowIds)
    }
    const cols = closed ? C : C - 1
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < cols; j++) {
        const j2 = (j + 1) % C
        const a = ids[i][j],
          b = ids[i + 1][j],
          c = ids[i + 1][j2],
          d = ids[i][j2]
        this.addTri(a, b, c)
        this.addTri(a, c, d)
      }
    }
    return ids
  }

  build(): MeshBuilder {
    const mb = new MeshBuilder([
      {name: "position", components: 3},
      {name: "normal", components: 3, normalized: true},
      {name: "color", components: 4},
    ])
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    mb.appendVerticesInterleaved(this.data)
    mb.appendIndices(this.indices)
    mb.updateMesh()
    return mb
  }
}

const WHITE: RGBA = [1, 1, 1, 1]

// ── leg + foot ───────────────────────────────────────────────────────────────

export function buildLegMesh(shape: LegShape): MeshBuilder {
  const acc = new MeshAccumulator()
  const L = shape.params.shankLengthCm
  // shank rings: knee cap (a<0) .. ankle cap (a>L)
  const aVals: number[] = []
  for (let k = 0; k <= 8; k++) aVals.push(-4 + 4 * Math.sin((k / 8) * Math.PI * 0.5))
  for (let a = 1; a < L; a += 1) aVals.push(a)
  for (let k = 0; k <= 8; k++) aVals.push(L + 3 * Math.sin((k / 8) * Math.PI * 0.5))
  const thetaSteps = 48
  const rows: V3[][] = aVals.map((a) => {
    const ring: V3[] = []
    for (let j = 0; j < thetaSteps; j++) ring.push(shape.legPoint(a, (j / thetaSteps) * 360))
    return ring
  })
  acc.addGrid(rows, true, (i, p) => {
    const a = aVals[i]
    if (a <= -3.9) return [-1, 0, 0]
    if (a >= L + 2.9) return [1, 0, 0]
    return sub(p, shape.legAxis(a))
  }, () => WHITE)

  // foot body: heel to the base of the toes, rounded caps both ends
  const B = shape.bodyLen
  const uVals: number[] = []
  for (let k = 0; k <= 7; k++) uVals.push(-2.2 + 2.2 * Math.sin((k / 7) * Math.PI * 0.5))
  for (let u = 0.5; u < B; u += 0.5) uVals.push(u)
  for (let k = 0; k <= 6; k++) uVals.push(B + 1.4 * Math.sin((k / 6) * Math.PI * 0.5))
  const psiSteps = 44
  const frows: V3[][] = uVals.map((u) => {
    const ring: V3[] = []
    for (let j = 0; j < psiSteps; j++) ring.push(shape.footRingPoint(u, (j / psiSteps) * Math.PI * 2))
    return ring
  })
  acc.addGrid(frows, true, (i, p) => {
    const u = uVals[i]
    if (u <= -2.15) return scale(shape.footT, -1)
    if (u >= B + 1.35) return shape.footT
    return sub(p, shape.footCenter(u))
  }, () => WHITE)

  // five toes, each a capsule (rounded tip; base buried in the foot body)
  for (let i = 0; i < 5; i++) addToe(acc, shape, i)
  return acc.build()
}

function addToe(acc: MeshAccumulator, shape: LegShape, i: number): void {
  const r = shape.toeRadius(i)
  const N = 8
  const C = 16
  const centers: V3[] = []
  const radii: number[] = []
  const tangentAt = (t: number) => norm(sub(shape.toeSpinePoint(i, Math.min(1, t + 0.05)), shape.toeSpinePoint(i, Math.max(0, t - 0.05))))
  // base cap (inside the foot, but keeps the solid closed)
  const t0 = tangentAt(0)
  for (let k = 3; k >= 1; k--) {
    const ang = (k / 3) * Math.PI * 0.5
    centers.push(add(shape.toeSpinePoint(i, 0), scale(t0, -r * Math.sin(ang))))
    radii.push(r * Math.cos(ang))
  }
  for (let k = 0; k <= N; k++) {
    const t = k / N
    centers.push(shape.toeSpinePoint(i, t))
    radii.push(r * (1 - 0.12 * t))
  }
  const t1 = tangentAt(1)
  const rTip = r * 0.88
  for (let k = 1; k <= 4; k++) {
    const ang = (k / 4) * Math.PI * 0.5
    centers.push(add(shape.toeSpinePoint(i, 1), scale(t1, rTip * Math.sin(ang))))
    radii.push(rTip * Math.cos(ang))
  }
  const rows: V3[][] = centers.map((c, idx) => {
    const tt = clamp((idx - 3) / N, 0, 1)
    const tan = tangentAt(tt)
    const side = norm(sub(shape.footM, scale(tan, dot(shape.footM, tan))))
    const up = norm(cross(tan, side))
    const ring: V3[] = []
    for (let j = 0; j < C; j++) {
      const a = (j / C) * Math.PI * 2
      ring.push(add(c, add(scale(side, Math.cos(a) * radii[idx]), scale(up, Math.sin(a) * radii[idx] * 0.85))))
    }
    return ring
  })
  acc.addGrid(rows, true, (idx, p) => {
    if (idx === 0) return scale(t0, -1)
    if (idx === rows.length - 1) return t1
    return sub(p, centers[idx])
  }, () => WHITE)
}

/** Low rounded cushion (superellipse box), centred on the origin. */
export function buildCushionMesh(widthCm: number, heightCm: number, depthCm: number): MeshBuilder {
  const acc = new MeshAccumulator()
  const hx = widthCm / 2,
    hy = heightCm / 2,
    hz = depthCm / 2
  const rows: V3[][] = []
  const R = 28,
    C = 56
  const pE = 2 / 6 // squareness
  const pY = 2 / 3.2
  for (let i = 0; i <= R; i++) {
    const v = -Math.PI / 2 + (i / R) * Math.PI
    const ring: V3[] = []
    for (let j = 0; j < C; j++) {
      const u = (j / C) * Math.PI * 2
      const cv = spow(Math.cos(v), pY)
      ring.push([hx * cv * spow(Math.cos(u), pE), hy * spow(Math.sin(v), pY), hz * cv * spow(Math.sin(u), pE)])
    }
    rows.push(ring)
  }
  acc.addGrid(rows, true, (i, p) => (i === 0 ? [0, -1, 0] : i === R ? [0, 1, 0] : p), () => WHITE)
  return acc.build()
}

// ── stroke arrow ─────────────────────────────────────────────────────────────

export interface ArrowMesh {
  builder: MeshBuilder
  /** Path parameter (0 tail .. 1 head) for every vertex, for the shimmer. */
  vertexS: number[]
  /** Interleaved base data (pos+normal) per vertex, so colors can be rewritten. */
  baseData: number[]
}

/** Arrow lying on the surface along `path`, `widthCm` wide at the head. */
export function buildArrowMesh(path: StrokePath, widthCm: number, liftCm: number): ArrowMesh {
  const acc = new MeshAccumulator()
  const vertexS: number[] = []
  const shaftHalf = widthCm * 0.27
  const headHalf = widthCm * 0.5
  // keep the head a sensible length on short strokes
  const headStart = clamp(1 - 4.5 / path.length, 0.55, 0.85)
  const N = 44
  const rowsS: number[] = []
  for (let k = 0; k <= N; k++) rowsS.push((k / N) * headStart)
  rowsS.push(headStart) // duplicate row: shaft -> head step
  for (let k = 1; k <= 10; k++) rowsS.push(headStart + (k / 10) * (1 - headStart))
  let prevL = -1,
    prevR = -1
  for (let r = 0; r < rowsS.length; r++) {
    const s = rowsS[r]
    const isHeadRow = r > N
    let half = isHeadRow ? headHalf * (1 - (s - headStart) / (1 - headStart)) : shaftHalf
    if (!isHeadRow && s < 0.03) half = shaftHalf * (0.5 + 0.5 * (s / 0.03)) // soft tail
    const half2 = Math.max(half, 0.02)
    const L = path.offset(s, -half2, liftCm)
    const R = path.offset(s, half2, liftCm)
    const il = acc.addVertex(L.p, L.n, WHITE)
    const ir = acc.addVertex(R.p, R.n, WHITE)
    vertexS.push(s, s)
    if (prevL >= 0 && r !== N + 1) {
      acc.addTri(prevL, il, ir)
      acc.addTri(prevL, ir, prevR)
    }
    prevL = il
    prevR = ir
  }
  const baseData: number[] = []
  for (let v = 0; v < acc.count; v++) {
    for (let k = 0; k < 6; k++) baseData.push(acc.data[v * 10 + k])
  }
  return {builder: acc.build(), vertexS, baseData}
}

/** Soft round dot in the local XY plane, facing +Z (bright centre, fading rim). */
export function buildDiscMesh(radiusCm: number): MeshBuilder {
  const acc = new MeshAccumulator()
  const c = acc.addVertex([0, 0, 0], [0, 0, 1], [1, 1, 1, 1])
  const segs = 32
  const ring: number[] = []
  const ring2: number[] = []
  for (let j = 0; j < segs; j++) {
    const a = (j / segs) * Math.PI * 2
    ring.push(acc.addVertex([Math.cos(a) * radiusCm * 0.7, Math.sin(a) * radiusCm * 0.7, 0], [0, 0, 1], [1, 1, 1, 1]))
  }
  for (let j = 0; j < segs; j++) {
    const a = (j / segs) * Math.PI * 2
    ring2.push(acc.addVertex([Math.cos(a) * radiusCm, Math.sin(a) * radiusCm, 0], [0, 0, 1], [0.2, 0.2, 0.2, 1]))
  }
  for (let j = 0; j < segs; j++) {
    const j2 = (j + 1) % segs
    acc.addTri(c, ring[j], ring[j2])
    acc.addTri(ring[j], ring2[j], ring2[j2])
    acc.addTri(ring[j], ring2[j2], ring[j2])
  }
  return acc.build()
}
