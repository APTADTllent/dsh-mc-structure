/*
  dsh-mc-structure —— 宿主半
  ==========================

  职责：
    · 结构文件的内存状态（当前打开/新建的那一个）
    · 给浏览器半提供数据与编辑接口（/mc/*）
    · 给 DeepSeek 提供工具：打开、新建、查看、放方块、填区域、替换、导出、查建筑学指导

  为什么解析和界面要分开：结构文件动辄几十万个方块，
  让浏览器拿整棵 NBT 树没有意义 —— 只传「尺寸 + 调色板 + 游程压缩后的索引」。
*/

import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname, basename, resolve, dirname, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  parseStructure, buildStructure, emptyStructure,
  getBlock, setBlock, fillBox, replaceBlocks, countBlocks, layerSummary,
  findBlockLayers, layerMap,
  encodeIndicesRLE, decodeIndicesRLE, inBounds,
} from './mcstructure.js'

import {
  ensureTextures, lookupTexture, textureFile, textureStats,
  resolveAll, findSource, TEX_DIR,
} from './textures.js'

export const name = 'mc-structure'
export const inject = ['webServer', 'tools']

const VERSION = '0.1.0'
const PREFIX = '/mc'
const HERE = dirname(fileURLToPath(import.meta.url))

/* 允许读写的根：桌面。结构文件基本都在这儿，限制一下免得模型到处乱写。 */
const ROOT = join(homedir(), 'Desktop')

/* 建筑美学数据集 */
const GUIDE_DIR = join(HERE, '..', 'assets', 'architecture')

const STATE = {
  struct: null,
  path: '',
  label: '',
  openedAt: 0,
  edits: 0,
}

/* ============================ 小工具 ============================ */

function safeResolve(p) {
  if (typeof p !== 'string' || !p.trim()) return null
  let full
  try { full = resolve(p) } catch { return null }
  const root = resolve(ROOT)
  if (full !== root && !full.toLowerCase().startsWith((root + sep).toLowerCase())) return null
  return full
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readJson(req) {
  if (req && typeof req[Symbol.asyncIterator] === 'function') {
    const chunks = []
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)))
    const t = Buffer.concat(chunks).toString('utf8')
    if (!t.trim()) return {}
    try { return JSON.parse(t) } catch { return {} }
  }
  return {}
}

/* 取 URL 上的查询参数。
   坑：URLSearchParams.get() 取不到时给的是 null 不是 undefined，
   而 Number(null) === 0 —— 之前就是这样把一个设置悄悄清零的。所以这里统一成 undefined。 */
function queryOf(req, name) {
  try {
    const u = new URL(String((req && req.url) || '/'), 'http://placeholder')
    const v = u.searchParams.get(name)
    return v === null ? undefined : v
  } catch {
    return undefined
  }
}

const parseStates = (v) => {
  if (!v) return {}
  if (typeof v === 'object') return v
  try { const o = JSON.parse(String(v)); return (o && typeof o === 'object') ? o : {} } catch { return {} }
}

/* ============================ 结构状态 ============================ */

function requireStruct() {
  if (!STATE.struct) throw new Error('还没有打开或新建任何结构')
  return STATE.struct
}

/** 传给浏览器的最小数据集 */
function structPayload() {
  const s = STATE.struct
  if (!s) return { ok: false, reason: 'empty' }

  /* 贴图：把调色板里每个方块名映射到一张真实的 PNG。
     没配上的这里就不出现，前端自动回退到内置色板 —— 
     宁可它是纯色，也不要瞎贴一张"最像的"。 */
  const textures = {}
  try {
    ensureTextures()
    for (const p of s.palette) {
      const hit = lookupTexture(p.name)
      if (hit.file) textures[p.name] = hit.file
    }
  } catch { /* 贴图出问题不该拖垮"看结构"这件事 */ }

  return {
    ok: true,
    label: STATE.label,
    path: STATE.path,
    size: s.size,
    palette: s.palette.map((p, i) => ({ i, name: p.name, states: p.states || {} })),
    rle: encodeIndicesRLE(s.indices),
    cells: s.indices.length,
    edits: STATE.edits,
    textures,
    texStats: textureStats(),
  }
}

function infoText(struct) {
  const [sx, sy, sz] = struct.size
  const counts = countBlocks(struct)
  const total = sx * sy * sz
  const solid = counts.filter(([k]) => !k.startsWith('minecraft:air')).reduce((a, [, n]) => a + n, 0)

  /* 按方块名聚合再报：countBlocks 是精确到 states 的（替换方块要用），
     但给模型看的时候，"smooth_quartz × 1393" 比
     "smooth_quartz {\"pillar_axis\":\"y\"} × 1393" 清楚得多。 */
  const byName = new Map()
  for (const [k, n] of counts) {
    const name = k.split(' ')[0]
    byName.set(name, (byName.get(name) || 0) + n)
  }
  const top = [...byName.entries()].sort((a, b) => b[1] - a[1])

  const lines = [
    `结构：${STATE.label || '(未命名)'}${STATE.path ? '  ' + STATE.path : ''}`,
    `尺寸：X=${sx} Y=${sy} Z=${sz}（共 ${total} 格，实心 ${solid} 格，空气 ${total - solid} 格）`,
    `调色板：${struct.palette.length} 种方块`,
    '',
    '用得最多的方块：',
    ...top.slice(0, 12).map(([k, n]) => `  ${k} × ${n}`),
  ]
  const ls = layerSummary(struct)
  lines.push('', `逐层摘要（共 ${ls.length} 层，y=0 是最底层）：`)
  if (ls.length <= 64) {
    for (const l of ls) {
      lines.push(`  y=${String(l.y).padStart(3)}  ${String(l.kinds).padStart(2)} 种   ${l.top.join('  ')}`)
    }
  } else {
    /* 层数太多就只列"主要方块发生变化"的那几层，否则一次几百行太浪费 */
    let prev = ''
    for (const l of ls) {
      const sig = l.top[0] || ''
      if (sig !== prev) {
        lines.push(`  y=${String(l.y).padStart(3)}  ${String(l.kinds).padStart(2)} 种   ${l.top.join('  ')}`)
        prev = sig
      }
    }
    lines.push(`  （共 ${ls.length} 层，中间重复的层已省略）`)
  }
  return lines.join('\n')
}

/* ============================ 建筑美学数据集 ============================ */

const GUIDE_TOPICS = {
  index: 'index.md',
  proportion: 'proportion.md',
  roof: 'roof.md',
  wall: 'wall.md',
  color: 'color.md',
  parts: 'parts.md',
  style: 'style.md',
  mistakes: 'mistakes.md',
}

function guideText(topic) {
  const key = String(topic || 'index').trim().toLowerCase()
  const file = GUIDE_TOPICS[key]
  if (!file) {
    return `没有「${topic}」这个主题。可选：${Object.keys(GUIDE_TOPICS).join(' / ')}`
  }
  const p = join(GUIDE_DIR, file)
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return `数据集文件还没生成（${file}）。先用 index 看目录。`
  }
}

/* ============================ 工具集（给 DeepSeek） ============================ */

const TEXT_OUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { ok: { type: 'boolean', required: true }, text: { type: 'string', required: true } },
  },
  render: (_args, value) => [{ type: 'text', text: String(value && value.text ? value.text : '(无输出)') }],
}

const textTool = (name, description, parameters, fn) => defineTool({
  name,
  description,
  parameters: parameters || {},
  output: TEXT_OUT,
  isConcurrencySafe: () => false,
  async execute(args, exec) {
    try {
      const text = await fn(args || {}, exec)
      return { ok: true, text: String(text) }
    } catch (error) {
      return { ok: false, text: '出错：' + String((error && error.message) || error) }
    }
  },
})

function registerTools(ctx) {
  /* 记下真实注册出去的名字，日志从这份清单生成 ——
     手写名字列表已经漏过一次（mc_new_structure），不能再漂。 */
  const made = []
  const reg = (tool) => { made.push(tool.name); ctx.tools.register(tool) }

  reg(textTool(
    'mc_open_structure',
    '打开一个《我的世界》基岩版结构文件（.mcstructure），之后就能查看和编辑它。参数是文件路径。',
    { path: { type: 'string', description: '结构文件的完整路径，例如 C:\\Users\\Lenovo\\Desktop\\大楼.mcstructure', required: true } },
    async (args) => {
      const full = safeResolve(args.path)
      if (!full) throw new Error(`路径不合法或不在桌面目录下：${args.path}`)
      const buf = await readFile(full)
      const struct = parseStructure(buf)
      STATE.struct = struct
      STATE.path = full
      STATE.label = basename(full, extname(full))
      STATE.openedAt = Date.now()
      STATE.edits = 0
      console.log(`[mc-structure] 打开了 ${full}（${struct.size.join('×')}）`)
      return infoText(struct)
    },
  ))

  reg(textTool(
    'mc_new_structure',
    '新建一个空白结构（画布），之后可以在里面放方块。尺寸单位是方块数，Y 是高度。',
    {
      size_x: { type: 'integer', description: 'X 方向格数（1-256）', required: true },
      size_y: { type: 'integer', description: 'Y 方向格数/高度（1-256）', required: true },
      size_z: { type: 'integer', description: 'Z 方向格数（1-256）', required: true },
    },
    async (args) => {
      const clamp = (v) => Math.max(1, Math.min(256, Math.round(Number(v) || 1)))
      const [x, y, z] = [clamp(args.size_x), clamp(args.size_y), clamp(args.size_z)]
      STATE.struct = emptyStructure(x, y, z)
      STATE.path = ''
      STATE.label = `新建 ${x}×${y}×${z}`
      STATE.openedAt = Date.now()
      STATE.edits = 0
      return `已新建空白画布：X=${x} Y=${y} Z=${z}（坐标从 0 开始，Y=0 是最底层）\n里面目前全是空气，可以放方块了。`
    },
  ))

  reg(textTool(
    'mc_structure_info',
    '查看当前结构的信息：尺寸、各方块数量、分层情况。改之前先看，改之后再看，用来确认效果。',
    {},
    async () => infoText(requireStruct()),
  ))

  reg(textTool(
    'mc_set_block',
    '在指定坐标放一个方块（会覆盖原来那个）。方块名用基岩版 id，例如 minecraft:stone、minecraft:oak_planks、minecraft:glass。也支持模组方块名。',
    {
      x: { type: 'integer', description: 'X 坐标', required: true },
      y: { type: 'integer', description: 'Y 坐标（0 是最底层）', required: true },
      z: { type: 'integer', description: 'Z 坐标', required: true },
      block: { type: 'string', description: '方块 id，如 minecraft:stone', required: true },
      states: { type: 'string', description: '可选的方块状态，JSON 字符串，如 {"pillar_axis":"y"}' },
    },
    async (args) => {
      const s = requireStruct()
      if (!inBounds(s, args.x, args.y, args.z)) {
        throw new Error(`坐标 (${args.x},${args.y},${args.z}) 超出范围。当前尺寸 X=0..${s.size[0] - 1} Y=0..${s.size[1] - 1} Z=0..${s.size[2] - 1}`)
      }
      const before = getBlock(s, args.x, args.y, args.z)
      setBlock(s, args.x, args.y, args.z, args.block, parseStates(args.states))
      STATE.edits++
      return `(${args.x},${args.y},${args.z}) 由 ${before ? before.name : '空'} 换成 ${args.block}`
    },
  ))

  reg(textTool(
    'mc_fill_region',
    '把一个长方体区域全部填成同一种方块。用来铺地板、砌墙、浇地基最省事。两点坐标顺序无所谓，会自动取范围内的所有格子。',
    {
      x1: { type: 'integer', required: true }, y1: { type: 'integer', required: true }, z1: { type: 'integer', required: true },
      x2: { type: 'integer', required: true }, y2: { type: 'integer', required: true }, z2: { type: 'integer', required: true },
      block: { type: 'string', description: '方块 id', required: true },
      states: { type: 'string', description: '可选的方块状态 JSON' },
    },
    async (args) => {
      const s = requireStruct()
      const n = fillBox(s, args.x1, args.y1, args.z1, args.x2, args.y2, args.z2, args.block, parseStates(args.states))
      STATE.edits++
      return `已把 (${args.x1},${args.y1},${args.z1}) 到 (${args.x2},${args.y2},${args.z2}) 之间的 ${n} 格填成 ${args.block}`
    },
  ))

  reg(textTool(
    'mc_replace_blocks',
    '把结构里所有某种方块替换成另一种。可以限定范围。改造旧房子时最常用（比如把木板全换成石砖）。',
    {
      from: { type: 'string', description: '要被替换掉的方块 id', required: true },
      to: { type: 'string', description: '替换成什么方块 id', required: true },
      to_states: { type: 'string', description: '可选的目标方块状态 JSON' },
      region: { type: 'string', description: '可选范围，JSON 数组 [x1,y1,z1,x2,y2,z2]；不填就是整个结构' },
    },
    async (args) => {
      const s = requireStruct()
      let region
      if (args.region) {
        try {
          const r = JSON.parse(args.region)
          if (Array.isArray(r) && r.length === 6) region = r.map(Number)
        } catch { /* 忽略，用整个结构 */ }
      }
      const n = replaceBlocks(s, args.from, args.to, parseStates(args.to_states), region)
      STATE.edits++
      return `把 ${n} 个 ${args.from} 换成了 ${args.to}${region ? `（范围 ${region.join(',')}）` : ''}`
    },
  ))

  reg(textTool(
    'mc_export_structure',
    '把当前结构导出成 .mcstructure 文件。路径要在桌面目录下。会覆盖同名文件。',
    { path: { type: 'string', description: '导出到的完整路径，例如 C:\\Users\\Lenovo\\Desktop\\我的作品.mcstructure', required: true } },
    async (args) => {
      const s = requireStruct()
      let full = safeResolve(args.path)
      if (!full) throw new Error(`路径不合法或不在桌面目录下：${args.path}`)
      if (extname(full).toLowerCase() !== '.mcstructure') full += '.mcstructure'
      const bytes = buildStructure(s)
      await writeFile(full, bytes)
      STATE.path = full
      STATE.label = basename(full, extname(full))
      console.log(`[mc-structure] 导出到 ${full}（${bytes.length} 字节）`)
      return `已导出 ${bytes.length} 字节到：${full}\n（用同一个文件再打开一次可以验证内容对不对）`
    },
  ))

  reg(textTool(
    'mc_find_blocks',
    '查某个方块分布在哪些层、每层多少格。**改结构之前先用它定位**：想知道屋顶在第几层、墙是哪几层，就查它的主要方块。',
    { block: { type: 'string', description: '方块 id，如 minecraft:smooth_quartz', required: true } },
    async (args) => {
      const s = requireStruct()
      const r = findBlockLayers(s, args.block)
      if (r.total === 0) return `结构里没有 ${args.block}。（方块名要和调色板里完全一致，可以先看 mc_structure_info）`
      const lines = [`${args.block} 共 ${r.total} 格，分布在这些层：`]
      for (const l of r.layers) lines.push(`  y=${l.y}  ${l.n} 格`)
      const ys = r.layers.map((l) => l.y)
      lines.push(`  层范围：y=${Math.min(...ys)} ~ ${Math.max(...ys)}`)
      return lines.join('\n')
    },
  ))

  reg(textTool(
    'mc_layer_map',
    '把某一层画成平面图（俯视），用来"看"这层的布局。每格一个字符，输出里会给出字符对应哪个方块。',
    { y: { type: 'integer', description: '要看哪一层（y 坐标）', required: true } },
    async (args) => {
      const s = requireStruct()
      const map = layerMap(s, Math.round(args.y))
      if (!map) throw new Error(`y=${args.y} 超范围。当前高度 Y=0..${s.size[1] - 1}`)
      return [`y=${args.y} 的平面图（从上往下看，行是 z、列是 x）：`, '', ...map.rows, '', '图例：', ...map.legend.map((l) => '  ' + l)].join('\n')
    },
  ))

  reg(textTool(
    'mc_build_guide',
    '建筑师指导手册。搭房子之前先读一读，里面有比例、屋顶、墙体开窗、配色、常见构件、风格参考和避坑清单。topic 可选：index / proportion / roof / wall / color / parts / style / mistakes',
    { topic: { type: 'string', description: '主题，默认 index（目录）' } },
    async (args) => guideText(args.topic),
  ))

  console.log('[mc-structure] 工具已注册（' + made.length + ' 个）：' + made.join(' / '))
}

/* ============================ 路由（给浏览器半） ============================ */

function registerRoutes(ctx, webServer) {
  const route = (path, handler, label) => ctx.effect(
    () => webServer.register({ kind: 'exact', path: `${PREFIX}${path}`, handler }),
    `mc-structure: ${label}`,
  )

  /* 目录浏览 */
  route('/files', async (req, res) => {
    try {
      const body = await readJson(req)
      const dir = safeResolve(body.dir || ROOT) || ROOT
      const entries = await readdir(dir, { withFileTypes: true })
      const folders = [], files = []
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) folders.push({ name: e.name, path: full })
        else if (extname(e.name).toLowerCase() === '.mcstructure') {
          let size = 0
          try { size = (await stat(full)).size } catch { /* ignore */ }
          files.push({ name: e.name, path: full, size })
        }
      }
      folders.sort((a, b) => a.name.localeCompare(b.name))
      files.sort((a, b) => a.name.localeCompare(b.name))
      sendJson(res, 200, { ok: true, dir, root: ROOT, folders, files })
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /* 打开 */
  route('/open', async (req, res) => {
    try {
      const body = await readJson(req)
      const full = safeResolve(body.path)
      if (!full) throw new Error('路径不合法或不在桌面目录下')
      const struct = parseStructure(await readFile(full))
      STATE.struct = struct
      STATE.path = full
      STATE.label = basename(full, extname(full))
      STATE.openedAt = Date.now()
      STATE.edits = 0
      console.log(`[mc-structure] 打开 ${full}（${struct.size.join('×')}）`)
      sendJson(res, 200, structPayload())
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /* 新建 */
  route('/new', async (req, res) => {
    try {
      const body = await readJson(req)
      const clamp = (v) => Math.max(1, Math.min(256, Math.round(Number(v) || 1)))
      const [x, y, z] = [clamp(body.x), clamp(body.y), clamp(body.z)]
      STATE.struct = emptyStructure(x, y, z, body.block || 'minecraft:air')
      STATE.path = ''
      STATE.label = `新建 ${x}×${y}×${z}`
      STATE.openedAt = Date.now()
      STATE.edits = 0
      sendJson(res, 200, structPayload())
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /* 当前结构数据 */
  route('/data', async (req, res) => {
    sendJson(res, 200, structPayload())
  })

  /* 改一格 */
  route('/set', async (req, res) => {
    try {
      const b = await readJson(req)
      const s = requireStruct()
      if (!inBounds(s, b.x, b.y, b.z)) throw new Error('坐标越界')
      setBlock(s, b.x, b.y, b.z, b.block, parseStates(b.states))
      STATE.edits++
      sendJson(res, 200, { ok: true, edits: STATE.edits })
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /* 区域填充 */
  route('/fill', async (req, res) => {
    try {
      const b = await readJson(req)
      const s = requireStruct()
      const n = fillBox(s, b.x1, b.y1, b.z1, b.x2, b.y2, b.z2, b.block, parseStates(b.states))
      STATE.edits++
      sendJson(res, 200, { ok: true, filled: n, edits: STATE.edits })
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /* 替换 */
  route('/replace', async (req, res) => {
    try {
      const b = await readJson(req)
      const s = requireStruct()
      const n = replaceBlocks(s, b.from, b.to, parseStates(b.toStates), b.region || null)
      STATE.edits++
      sendJson(res, 200, { ok: true, replaced: n, edits: STATE.edits })
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /* 导出 */
  route('/export', async (req, res) => {
    try {
      const b = await readJson(req)
      const s = requireStruct()
      let full = safeResolve(b.path)
      if (!full) throw new Error('路径不合法或不在桌面目录下')
      if (extname(full).toLowerCase() !== '.mcstructure') full += '.mcstructure'
      const bytes = buildStructure(s)
      await writeFile(full, bytes)
      STATE.path = full
      STATE.label = basename(full, extname(full))
      sendJson(res, 200, { ok: true, path: full, bytes: bytes.length })
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /* 统计信息 */
  route('/info', async (req, res) => {
    try {
      const s = requireStruct()
      sendJson(res, 200, {
        ok: true,
        text: infoText(s),
        counts: countBlocks(s).slice(0, 60),
        layers: layerSummary(s),
      })
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /* 浏览器半的诊断上报。
     2026-09-21：有人点"创建"一直转圈，而服务端每个端点实测都 <60ms —— 
     手上没有浏览器的控制台，只能让界面自己把话带过来。 */
  route('/log', async (req, res) => {
    try {
      const body = await readJson(req)
      const tag = String(body.tag || '?').slice(0, 60)
      const detail = String(body.detail || '').slice(0, 600)
      console.log(`[mc-structure] 浏览器说 ${tag}：${detail}`)
      if (body.ua) console.log(`[mc-structure]   UA：${String(body.ua).slice(0, 140)}`)
      sendJson(res, 200, { ok: true })
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /* 贴图本身。?name=minecraft:stone_bricks 或者 ?file=stone_bricks.png */
  route('/tex', async (req, res) => {
    try {
      const q = queryOf(req, 'name') || queryOf(req, 'file') || ''
      ensureTextures()
      const hit = lookupTexture(q)
      const file = hit.file || (/\.png$/i.test(q) && existsSync(join(TEX_DIR, basename(q))) ? basename(q) : '')
      if (!file) {
        sendJson(res, 404, { ok: false, error: '这个方块没配上贴图：' + q, how: hit.how })
        return
      }
      const buf = await readFile(textureFile(file))
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': buf.length,
        /* 贴图不会变，让浏览器放心缓存，省得每格都来问一遍 */
        'cache-control': 'public, max-age=86400',
      })
      res.end(buf)
    } catch (error) {
      sendJson(res, 404, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /* 贴图匹配报告：哪些方块配上了、走的哪一档、哪些只能回退色板 */
  route('/texinfo', async (req, res) => {
    try {
      const body = await readJson(req)
      const s = STATE.struct
      const names = Array.isArray(body.blocks) && body.blocks.length
        ? body.blocks.map(String)
        : (s ? s.palette.map((p) => p.name) : [])
      ensureTextures(!!body.rescan)
      const report = resolveAll(names)
      sendJson(res, 200, {
        ok: true,
        source: findSource(),
        dir: TEX_DIR,
        rows: report.rows,
        stats: report.stats,
      })
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /* 逐层剥开要用的一层数据：?y=N
     注意不是 layerMap() —— 那个返回的是给模型"看"的字符画。
     前端要的是调色板索引，而且要能上色，所以这里给 RLE 压缩过的索引数组。 */
  route('/layer', async (req, res) => {
    try {
      const s = requireStruct()
      const body = await readJson(req)
      const qy = queryOf(req, 'y')
      const raw = qy !== undefined ? qy : body.y
      const [sx, sy, sz] = s.size
      const y = Math.max(0, Math.min(sy - 1, Math.round(Number(raw) || 0)))

      /* 把这一层从三维里摘出来，排成 z 行 x 列。
         注意基岩版的顺序是 ZYX（z 最快、y 其次、x 最慢）——
         固定 y 之后，同一列里 z 是连续的，跨一列要跳 sy*sz 个。
         照"一层一层"的旧顺序写会取错方块（那种顺序游戏也不认）。 */
      const flat = new Int32Array(sx * sz)
      for (let x = 0; x < sx; x++) {
        const base = sz * (y + sy * x)
        for (let z = 0; z < sz; z++) flat[z * sx + x] = s.indices[base + z]
      }

      sendJson(res, 200, {
        ok: true,
        y,
        maxY: sy - 1,
        size: s.size,
        w: sx,
        h: sz,
        cells: flat.length,
        rle: encodeIndicesRLE(flat),
      })
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String((error && error.message) || error) })
    }
  })
}

/* ============================ 挂载 ============================ */

export function apply(ctx) {
  const webServer = ctx.webServer ?? (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
  if (webServer && typeof webServer.register === 'function') {
    registerRoutes(ctx, webServer)
    console.log(`[mc-structure] v${VERSION} 路由已挂载（可访问根目录：${ROOT}）`)

    /* 贴图第一次要从版本 jar 里抽出来（约两秒），别卡在"第一次打开结构"那一刻。
       延后一点做，而且失败了也不吭声 —— 大不了回退到内置色板。 */
    setTimeout(() => {
      try {
        const st = ensureTextures()
        if (st.ready) {
          console.log(`[mc-structure] 贴图就绪：${st.count} 张（来自 ${st.source}）`)
        } else {
          console.log(`[mc-structure] 没找到贴图，六视图用内置色板：${st.error}`)
        }
      } catch (e) {
        console.log('[mc-structure] 贴图预热失败：' + String((e && e.message) || e))
      }
    }, 2500)
  } else {
    console.error('[mc-structure] webServer 不可用，界面无法挂载')
  }

  if (ctx.tools && typeof ctx.tools.register === 'function') {
    registerTools(ctx)
  } else {
    console.error('[mc-structure] tools 服务不可用，DeepSeek 改方块的工具没注册')
  }
}

export const __test = {
  safeResolve, structPayload, infoText, guideText, GUIDE_TOPICS, findBlockLayers, layerMap,
  getState: () => STATE,
  setState: (s) => { STATE.struct = s; STATE.edits = 0 },
  ROOT,
}
