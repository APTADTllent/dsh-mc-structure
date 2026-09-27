/*
  .mcstructure 解析与生成（基岩版结构文件）
  ========================================

  格式（已验证）：
    根 Compound
      format_version : Int = 1
      size           : List<Int> = [X, Y, Z]
      structure : Compound
        block_indices : List<List<Int>>   两个列表：主索引 / 层索引
        palette : Compound
          default : Compound
            block_palette : List<Compound>  每项 { name:String, states:Compound, version:Int }
            block_position_data : Compound  键是索引字符串，存箱子内容之类的附加数据
        entities : List
      structure_world_origin : List<Int>

  坐标顺序（以官方文档为准）：index = z + sizeZ * (y + sizeY * x)
    也就是 **ZYX**：z 最快，然后 y，最后 x。
    2×3×4（X×Y×Z）的结构，那 24 个值的坐标依次是
      0 0 0 / 0 0 1 / 0 0 2 / 0 0 3 / 0 1 0 / … / 1 2 3
    来源：https://wiki.bedrock.dev/nbt/mcstructure 的 Block Indices 一节 ——
      "Each sublist proceeds in ZYX order from the bottom north-west corner"

    ★ 这里踩过大坑：最初按"一层一层存"的直觉写成了
      index = x + sizeX * (z + sizeZ * y)（x 最快、y 最慢）。
      "自证"时用的是自己写的读写器 —— 自己写、自己读，当然自洽，
      六视图预览看着也完全正常。但游戏是按 ZYX 读的，
      结果导出的结构在游戏里整个【躺倒】（高度被当成了深度），
      正是"底边朝前、应该朝下"那个样子。
      教训：自研格式的坐标顺序不能自证，必须对着官方文档核对。

  导出策略：不重建整棵树，只替换「size / block_indices / block_palette」这几棵子树，
  其余字段（模组方块状态、entities、未知字段）原样带走 —— 这样才不会把别人的数据弄丢。
*/

import {
  TAG, readNbt, writeNbt, get, getNum, getStr, asList, num, list, compound, strNode,
} from './nbt.js'

/* ---------- NBT Compound <-> 普通 JS 对象（只给 states 这种小字典用） ---------- */

function nbtToPlain(node) {
  if (!node) return {}
  const out = {}
  for (const [k, v] of Object.entries(node.v || {})) {
    if (v.t === TAG.String) out[k] = v.v
    else if (typeof v.v === 'bigint') out[k] = Number(v.v)
    else out[k] = v.v
  }
  return out
}

function plainToNbt(obj, hints) {
  const v = {}
  for (const [k, val] of Object.entries(obj || {})) {
    if (typeof val === 'string') v[k] = strNode(val)
    else if (typeof val === 'boolean') v[k] = num(val ? 1 : 0, TAG.Byte)
    else {
      // 数值类型沿用上次已知的类型，避免 Byte/Int 来回变
      const t = (hints && hints[k]) || TAG.Int
      v[k] = num(Number(val) || 0, t)
    }
  }
  return compound(v)
}

function statesTypeHints(node) {
  const h = {}
  for (const [k, v] of Object.entries((node && node.v) || {})) h[k] = v.t
  return h
}

/* ============================ 解析 ============================ */

export function parseStructure(buf) {
  const { value: root } = readNbt(buf)
  const size = asList(root, 'size').map((n) => Number(n.v))
  if (size.length !== 3) throw new Error('size 不是 3 个整数，可能不是 .mcstructure')

  const st = get(root, 'structure')
  if (!st) throw new Error('缺少 structure 字段')

  const paletteRoot = get(get(st, 'palette'), 'default')
  const blockPalette = asList(paletteRoot, 'block_palette')
  const palette = blockPalette.map((node) => ({
    name: getStr(node, 'name'),
    states: nbtToPlain(get(node, 'states')),
    version: getNum(node, 'version'),
    _rawNode: node,
    _stateHints: statesTypeHints(get(node, 'states')),
  }))

  const bi = asList(st, 'block_indices')
  const main = (bi[0] && Array.isArray(bi[0].v)) ? bi[0].v.map((n) => Number(n.v)) : []
  const layers = (bi[1] && Array.isArray(bi[1].v)) ? bi[1].v.map((n) => Number(n.v)) : []

  const [sx, sy, sz] = size
  const need = sx * sy * sz
  if (main.length !== need) throw new Error(`索引数量不对：${main.length} ≠ ${sx}×${sy}×${sz}=${need}`)

  return {
    size,
    palette,
    indices: Int32Array.from(main),
    layerIndices: layers,
    origin: asList(root, 'structure_world_origin').map((n) => Number(n.v)),
    formatVersion: getNum(root, 'format_version', 1),
    dirtyPositions: new Set(),   // 被改过的方块位置（导出时要清掉它们的附加数据）
    _root: root,
  }
}

/* ============================ 坐标 ============================ */

/**
 * 方块坐标 → 扁平数组下标。
 *
 * 基岩版用的是 **ZYX** 顺序：z 最快，其次 y，最后 x。
 * 别再改回"一层一层存"那种写法了 —— 那个顺序游戏不认，导出会躺倒。
 * 详见文件头的说明。
 */
export const posIndex = (struct, x, y, z) => {
  const [, sy, sz] = struct.size
  return z + sz * (y + sy * x)
}
export const inBounds = (struct, x, y, z) => {
  const [sx, sy, sz] = struct.size
  return x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz
}

export function getBlock(struct, x, y, z) {
  if (!inBounds(struct, x, y, z)) return null
  const i = struct.indices[posIndex(struct, x, y, z)]
  if (i < 0 || i >= struct.palette.length) return null
  return struct.palette[i]
}

/** 找一个 (name, states) 完全匹配的调色板条目；没有就追加 */
export function paletteIndexOf(struct, name, states) {
  const want = JSON.stringify(states || {})
  for (let i = 0; i < struct.palette.length; i++) {
    const p = struct.palette[i]
    if (p.name === name && JSON.stringify(p.states || {}) === want) return i
  }
  struct.palette.push({
    name, states: states || {}, version: struct.palette[0]?.version ?? 0,
    _rawNode: null, _stateHints: {},
  })
  return struct.palette.length - 1
}

export function setBlock(struct, x, y, z, name, states) {
  if (!inBounds(struct, x, y, z)) return false
  const i = paletteIndexOf(struct, name, states)
  const at = posIndex(struct, x, y, z)
  struct.indices[at] = i
  struct.dirtyPositions.add(at)
  return true
}

/* ============================ 批量操作（工具集用） ============================ */

export function fillBox(struct, x1, y1, z1, x2, y2, z2, name, states) {
  const [ax, bx] = [Math.min(x1, x2), Math.max(x1, x2)]
  const [ay, by] = [Math.min(y1, y2), Math.max(y1, y2)]
  const [az, bz] = [Math.min(z1, z2), Math.max(z1, z2)]
  let n = 0
  for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) {
    if (setBlock(struct, x, y, z, name, states)) n++
  }
  return n
}

export function replaceBlocks(struct, fromName, toName, toStates, region) {
  let n = 0
  const [sx, sy, sz] = struct.size
  const r = region || [0, 0, 0, sx - 1, sy - 1, sz - 1]
  for (let y = r[1]; y <= r[4]; y++) for (let z = r[2]; z <= r[5]; z++) for (let x = r[0]; x <= r[3]; x++) {
    const b = getBlock(struct, x, y, z)
    if (b && b.name === fromName) { if (setBlock(struct, x, y, z, toName, toStates)) n++ }
  }
  return n
}

/** 方块统计：整体或某一层 */
export function countBlocks(struct, y) {
  const counts = new Map()
  const [sx, sy, sz] = struct.size
  const ys = (y === undefined) ? [0, sy - 1] : [y, y]
  for (let yy = ys[0]; yy <= ys[1]; yy++) {
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const b = getBlock(struct, x, yy, z)
      if (!b) continue
      const key = b.name + (Object.keys(b.states || {}).length ? ' ' + JSON.stringify(b.states) : '')
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

/** 每一层的方块种类数 —— 用来判断"这层是不是干净的楼板"
 *  top 里的方块名按【名字】聚合（不带 states）—— 给模型看的时候
 *  "smooth_quartz×150" 比 "smooth_quartz {"pillar_axis":"y"}×150" 清楚得多 */
export function layerSummary(struct, topN = 3) {
  const [, sy] = struct.size
  const out = []
  for (let y = 0; y < sy; y++) {
    const c = countBlocks(struct, y)
    const byName = new Map()
    for (const [k, n] of c) {
      const name = k.split(' ')[0]
      byName.set(name, (byName.get(name) || 0) + n)
    }
    const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
    out.push({ y, kinds: byName.size, top: top.map(([k, n]) => `${k}×${n}`) })
  }
  return out
}

/** 找某个方块分布在哪些层、每层多少格 —— 模型定位"屋顶在哪层"就靠这个 */
export function findBlockLayers(struct, name) {
  const [sx, sy, sz] = struct.size
  const layers = []
  let total = 0
  for (let y = 0; y < sy; y++) {
    let n = 0
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const b = getBlock(struct, x, y, z)
        if (b && b.name === name) n++
      }
    }
    if (n > 0) { layers.push({ y, n }); total += n }
  }
  return { total, layers }
}

/** 某一层的平面分布（俯视），每格一个字符 —— 给模型"看"布局用 */
export function layerMap(struct, y, maxSide = 64) {
  const [sx, , sz] = struct.size
  if (y < 0 || y >= struct.size[1]) return null
  const names = new Map()
  const rows = []
  for (let z = 0; z < Math.min(sz, maxSide); z++) {
    let row = ''
    for (let x = 0; x < Math.min(sx, maxSide); x++) {
      const b = getBlock(struct, x, y, z)
      const name = b ? b.name : 'minecraft:air'
      if (!names.has(name)) names.set(name, ' .123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'[names.size] || '?')
      row += names.get(name)
    }
    rows.push(row)
  }
  return { rows, legend: [...names.entries()].map(([n, ch]) => `${ch} = ${n}`) }
}

/* ============================ 新建画布 ============================ */

export function emptyStructure(sx, sy, sz, fillName = 'minecraft:air') {
  const palette = [{
    name: fillName, states: {}, version: 0, _rawNode: null, _stateHints: {},
  }]
  return {
    size: [sx, sy, sz],
    palette,
    indices: new Int32Array(sx * sy * sz),   // 全 0 = 调色板第 0 项
    layerIndices: [],
    origin: [0, 0, 0],
    formatVersion: 1,
    dirtyPositions: new Set(),
    _root: null,
  }
}

/* ============================ 导出 ============================ */

export function buildStructure(struct) {
  const [sx, sy, sz] = struct.size
  const biList = [
    list(Array.from(struct.indices, (v) => num(v))),
    list(struct.layerIndices.length ? struct.layerIndices.map((v) => num(v)) : new Array(sx * sy * sz).fill(0).map(() => num(-1))),
  ]
  const blockPalette = list(struct.palette.map((p) => {
    // 没改过的条目直接用原始节点，类型/字段一个都不动
    if (p._rawNode && !p._changed) return p._rawNode
    return compound({
      name: strNode(p.name),
      states: plainToNbt(p.states, p._stateHints),
      version: num(p.version || 0),
    })
  }))

  let root = struct._root
  if (root) {
    // 只替换必要的子树，其它字段原样带走
    root.v.size = list(struct.size.map((v) => num(v)))
    const st = get(root, 'structure')
    st.v.block_indices = list(biList)
    const def = get(get(st, 'palette'), 'default')
    def.v.block_palette = blockPalette
    // 被改过的位置，附加数据（箱子内容之类）必须清掉，否则会错位到别的方块上
    const bpd = get(def, 'block_position_data')
    if (bpd && struct.dirtyPositions.size) {
      for (const at of struct.dirtyPositions) delete bpd.v[String(at)]
    }
    return writeNbt(root)
  }

  // 没有原始树（新建画布）→ 从模板构造
  return writeNbt(compound({
    format_version: num(struct.formatVersion || 1),
    size: list(struct.size.map((v) => num(v))),
    structure: compound({
      block_indices: list(biList),
      entities: list([], TAG.Compound),
      palette: compound({
        default: compound({
          block_palette: blockPalette,
          block_position_data: compound({}),
        }),
      }),
    }),
    structure_world_origin: list([0, 0, 0].map((v) => num(v))),
  }))
}

/* ============================ 传给浏览器用的紧凑表示 ============================ */

/** 游程编码：大片空气/石头能压得很狠 */
export function encodeIndicesRLE(indices) {
  const out = []
  let prev = indices[0]
  let run = 1
  for (let i = 1; i < indices.length; i++) {
    const v = indices[i]
    if (v === prev) { run++ } else { out.push(prev, run); prev = v; run = 1 }
  }
  out.push(prev, run)
  return out
}

export function decodeIndicesRLE(rle, length) {
  const out = new Int32Array(length)
  let at = 0
  for (let i = 0; i < rle.length; i += 2) {
    const v = rle[i], n = rle[i + 1]
    for (let k = 0; k < n && at < length; k++) out[at++] = v
  }
  return out
}
