/*
  贴图库 —— 把方块名映射到本机《我的世界》的真实贴图
  ====================================================

  方块名（minecraft:smooth_quartz）和贴图文件名【不是一对一】的：

    smooth_quartz   → quartz_block_bottom.png   平滑石英用的就是石英块底面那张图
    oak_stairs      → oak_planks.png            楼梯／半砖／墙都没有自己的贴图，借母方块的
    oak_slab        → oak_planks.png
    stone_wall      → stone.png
    oak_wood        → oak_log.png               六面树皮，借原木
    glass_pane      → glass.png

  所以匹配是一条链子，按"便宜的先用"排：

    1. 手工特例表      —— 上面那几个反直觉的，直接查表，O(1)
    2. 精确同名        —— stone_bricks → stone_bricks.png
    3. 剥词缀          —— _stairs / _slab / _wall / _fence / _door … 去掉再递归
    4. 加词缀          —— oak → oak_planks、stone → stone_block、x → x_side
    5. 模糊            —— 遍历全部名字算相似度（"实在找不到再一个一个读"就是这一步）
    6. 放弃            —— 返回 null，前端回退到内置色板

  整个索引只读【一个】目录列表，不逐个读图片内容 —— 名字就够了。

  缓存：贴图从 versions/<ver>/<ver>.jar 里抽一次，落在
        %USERPROFILE%\.dsh\mc-structure\textures\
*/
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, basename, extname, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXTRACT_SCRIPT = join(HERE, '..', 'scripts', 'extract-textures.ps1')

/* 缓存落在哪 —— 测试时用 DSH_MC_HOME 换到临时目录，别污染真实的那份 */
export const MC_HOME = process.env.DSH_MC_HOME || join(homedir(), '.dsh', 'mc-structure')
export const TEX_DIR = join(MC_HOME, 'textures')

/* 上哪找《我的世界》。按"最可能"排，命中一个就停 —— 不做全盘扫描。 */
const CANDIDATE_ROOTS = [
  process.env.DSH_MC_TEXTURES || '',
  join('D:', 'MCLDownload', 'Game', '.minecraft'),
  join('C:', 'MCLDownload', 'Game', '.minecraft'),
  join(homedir(), 'AppData', 'Roaming', '.minecraft'),
  join(homedir(), 'AppData', 'Local', '.minecraft'),
  join(homedir(), '.minecraft'),
  join('D:', '.minecraft'),
  join('C:', '.minecraft'),
].filter(Boolean)

/* ------------------------------------------------------------------ *
 *  特例表：名字对不上、但确实只能用某张图的
 * ------------------------------------------------------------------ */
const SPECIAL = {
  smooth_quartz: 'quartz_block_bottom',
  quartz_block: 'quartz_block_side',
  chiseled_quartz_block: 'chiseled_quartz_block',
  quartz_pillar: 'quartz_pillar',
  oak_wood: 'oak_log',
  spruce_wood: 'spruce_log',
  birch_wood: 'birch_log',
  jungle_wood: 'jungle_log',
  acacia_wood: 'acacia_log',
  dark_oak_wood: 'dark_oak_log',
  mangrove_wood: 'mangrove_log',
  cherry_wood: 'cherry_log',
  crimson_hyphae: 'crimson_stem',
  warped_hyphae: 'warped_stem',
  grass_block: 'grass_block_side',
  mycelium: 'mycelium_side',
  podzol: 'podzol_side',
  dirt_path: 'dirt_path_side',
  farmland: 'farmland',
  glass_pane: 'glass',
  iron_bars: 'iron_bars',
  smooth_stone: 'smooth_stone',
  smooth_sandstone: 'smooth_sandstone',
  smooth_red_sandstone: 'smooth_red_sandstone',
  smooth_basalt: 'smooth_basalt',
  note_block: 'note_block',
  hay_block: 'hay_block_side',
  bone_block: 'bone_block_side',
  /* 基岩版叫法 → Java 贴图名 */
  'wooden_door': 'oak_door',
  'wooden_slab': 'oak_planks',
  'wooden_stairs': 'oak_planks',
  /* 索引里没有 quartz_block.png（石英块是分面的），给它指个默认面 */
  'quartz': 'quartz_block_side',
}

/* 这些词缀代表"某种形状"，本体贴图要去掉它们再找 */
const SHAPE_SUFFIXES = [
  '_stairs', '_slab', '_wall', '_fence_gate', '_fence', '_trapdoor', '_door',
  '_button', '_pressure_plate', '_carpet', '_pane', '_sign', '_hanging_sign',
  '_chain', '_bars', '_gate', '_bed', '_banner', '_skull', '_head', '_candle',
  '_campfire', '_torch', '_lantern', '_rod', '_bulb',
]

/* 本体 + 这些后缀 = 常见贴图名（木头尤其明显） */
const FLAVOR_SUFFIXES = [
  '_planks', '_block', '_bricks', '_brick', '_tiles', '_tile',
  '_side', '_top', '_bottom', '_front', '_back', '_end', '_inner', '_outer',
  '_stem', '_log', '_wood', '_hyphae', '_leaves', '_sand', '_stone',
  '_terracotta', '_concrete', '_wool', '_glass', '_copper', '_cut',
]

/* 一级词缀不管用时，再拼一层"哪个面"：
   石英块就靠这个救的 —— 没有 quartz_block.png，只有 quartz_block_side.png */
const FACE_SUFFIXES = ['_side', '_top', '_bottom', '_front', '_end', '_inner', '_outer']

/* ------------------------------------------------------------------ *
 *  索引
 * ------------------------------------------------------------------ */
const IDX = {
  ready: false,
  tried: false,
  error: '',
  dir: TEX_DIR,
  source: '',
  files: [],            // ['stone.png', ...]
  byName: new Map(),    // 'stone' -> 'stone.png'
  byLower: new Map(),   // 小写索引，防大小写差异
  resolved: new Map(),  // 方块名 -> { file, how }
  stats: { exact: 0, special: 0, suffix: 0, fuzzy: 0, miss: 0 },
}

export function textureStats() {
  return {
    ready: IDX.ready,
    error: IDX.error,
    dir: IDX.dir,
    source: IDX.source,
    count: IDX.files.length,
    resolved: IDX.resolved.size,
    how: { ...IDX.stats },
  }
}

/** 从文件名数组建索引（纯函数，方便测） */
export function buildIndex(fileNames) {
  const byName = new Map()
  const byLower = new Map()
  for (const f of fileNames) {
    if (!/\.png$/i.test(f)) continue
    const base = f.replace(/\.png$/i, '')
    byName.set(base, f)
    byLower.set(base.toLowerCase(), f)
  }
  return { byName, byLower, files: fileNames.slice() }
}

/* ------------------------------------------------------------------ *
 *  相似度：最后一步兜底用的
 * ------------------------------------------------------------------ */
function score(a, b) {
  if (a === b) return 1000
  if (a.startsWith(b)) return 700 - (a.length - b.length)      /* a 比 b 多个尾巴 */
  if (b.startsWith(a)) return 650 - (b.length - a.length)
  if (a.includes(b)) return 500 - (a.length - b.length)
  if (b.includes(a)) return 480 - (b.length - a.length)
  /* 公共前缀占的比例 */
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  const ratio = n / Math.max(a.length, b.length)
  return Math.round(ratio * 400)
}

/* ------------------------------------------------------------------ *
 *  匹配链
 * ------------------------------------------------------------------ */
export function matchTexture(blockName, idx) {
  const index = idx || { byName: IDX.byName, byLower: IDX.byLower, files: IDX.files }
  const raw = String(blockName || '').trim()
  if (!raw) return null
  /* 去掉命名空间：minecraft:oak_stairs -> oak_stairs */
  let name = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw
  name = name.toLowerCase()

  const hit = (file, how) => ({ file, how, name, key: raw })

  /* 0. 空气之类直接判空 */
  if (name === 'air' || name === 'cave_air' || name === 'void_air') return null

  /* 1. 手工特例表（也接受带命名空间的键） */
  if (SPECIAL[name] !== undefined) {
    const t = SPECIAL[name]
    const f = index.byName.get(t) || index.byLower.get(t.toLowerCase())
    if (f) return hit(f, 'special')
  }

  /* 2. 精确同名 */
  if (index.byName.has(name)) return hit(index.byName.get(name), 'exact')
  if (index.byLower.has(name)) return hit(index.byLower.get(name), 'exact-lower')

  /* 2.5 单复数：方块叫 stone_brick_stairs，图叫 stone_bricks.png。
         少这一步，"石砖楼梯"会一路漂到 stone.png（石头）上去。 */
  const plural = name.endsWith('s') ? name.slice(0, -1) : name + 's'
  if (plural && (index.byName.has(plural) || index.byLower.has(plural))) {
    return hit(index.byName.get(plural) || index.byLower.get(plural), name.endsWith('s') ? 'singular' : 'plural')
  }

  /* 3. 剥形状词缀再递归（oak_stairs -> oak -> ...） */
  for (const suf of SHAPE_SUFFIXES) {
    if (name.endsWith(suf) && name.length > suf.length) {
      const stem = name.slice(0, -suf.length)
      const viaStem = matchTexture('minecraft:' + stem, index)
      if (viaStem) return hit(viaStem.file, 'suffix:' + suf)
      /* 木头类：oak -> oak_planks */
      for (const fl of FLAVOR_SUFFIXES) {
        const t = stem + fl
        const f = index.byName.get(t) || index.byLower.get(t.toLowerCase())
        if (f) return hit(f, 'suffix:' + suf + '+' + fl)
      }
    }
  }

  /* 4. 加词缀；一级不中再拼一层面（quartz -> quartz_block -> quartz_block_side） */
  for (const fl of FLAVOR_SUFFIXES) {
    const t = name + fl
    const f = index.byName.get(t) || index.byLower.get(t.toLowerCase())
    if (f) return hit(f, 'prefix+' + fl)
    for (const face of FACE_SUFFIXES) {
      const t2 = t + face
      const f2 = index.byName.get(t2) || index.byLower.get(t2.toLowerCase())
      if (f2) return hit(f2, 'prefix+' + fl + face)
    }
  }

  /* 5. 模糊：实在找不到就一个一个比 —— 但只用名字，不读文件 */
  let best = null, bestScore = 0
  for (const f of index.files) {
    if (!/\.png$/i.test(f)) continue
    const base = f.slice(0, -4).toLowerCase()
    const s = score(name, base)
    if (s > bestScore) { bestScore = s; best = f }
  }
  if (best && bestScore >= 300) return hit(best, 'fuzzy:' + bestScore)

  return null
}

/* ------------------------------------------------------------------ *
 *  找游戏目录 → 抽贴图 → 建索引
 * ------------------------------------------------------------------ */
function listPng(dir) {
  try {
    return readdirSync(dir).filter((f) => /\.png$/i.test(f))
  } catch {
    return []
  }
}

/** 在候选根里找出含方块贴图的位置。返回 {kind:'dir'|'jar', path} */
export function findSource(roots = CANDIDATE_ROOTS) {
  for (const root of roots) {
    if (!root || !existsSync(root)) continue

    /* a) 已经解压好的：<root>/assets/minecraft/textures/block */
    const flat = join(root, 'assets', 'minecraft', 'textures', 'block')
    if (existsSync(flat) && listPng(flat).length > 50) return { kind: 'dir', path: flat }
    const flat2 = join(root, 'assets', 'minecraft', 'textures', 'blocks')
    if (existsSync(flat2) && listPng(flat2).length > 50) return { kind: 'dir', path: flat2 }

    /* b) 版本 jar：<root>/versions/<ver>/<ver>.jar，挑最大的那个（最全） */
    const versions = join(root, 'versions')
    if (existsSync(versions)) {
      let best = null
      let bestSize = 0
      for (const v of readdirSync(versions)) {
        const vd = join(versions, v)
        let entries = []
        try { entries = readdirSync(vd).filter((f) => f.toLowerCase().endsWith('.jar')) } catch { continue }
        for (const j of entries) {
          try {
            const st = statSync(join(vd, j))
            if (st.size > bestSize) { bestSize = st.size; best = join(vd, j) }
          } catch { /* ignore */ }
        }
      }
      if (best) return { kind: 'jar', path: best }
    }

    /* c) 网易启动器会把资源另外放一份 */
    const alt = join(root, 'assets', 'minecraft', 'textures')
    if (existsSync(alt)) {
      const blocks = listPng(alt)
      if (blocks.length > 50) return { kind: 'dir', path: alt }
    }
  }
  return null
}

/** 用 PowerShell 从 jar 里抽 block 贴图（Node 自己没有 zip 支持） */
function extractFromJar(jar, outDir) {
  if (!existsSync(EXTRACT_SCRIPT)) throw new Error('找不到抽取脚本：' + EXTRACT_SCRIPT)
  const out = execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', EXTRACT_SCRIPT,
    '-Jar', jar,
    '-Out', outDir,
  ], { encoding: 'utf8', timeout: 120000, windowsHide: true })
  return String(out || '').trim()
}

/**
 * 幂等：贴图已就绪就立刻返回。
 * full=true 时忽略缓存重建（设置面板里"重新扫描"用）。
 */
export function ensureTextures(full = false) {
  if (IDX.ready && !full) return textureStats()
  if (IDX.tried && !full) return textureStats()
  IDX.tried = true
  IDX.error = ''

  try {
    /* 缓存已经够用就不动 */
    if (!full) {
      const cached = listPng(TEX_DIR)
      if (cached.length > 400) {
        const built = buildIndex(cached)
        IDX.files = built.files
        IDX.byName = built.byName
        IDX.byLower = built.byLower
        IDX.ready = true
        IDX.source = 'cache'
        return textureStats()
      }
    }

    const src = findSource()
    if (!src) {
      IDX.error = '没找到《我的世界》的贴图。要么游戏没装，要么装在别处 —— ' +
        '可以设环境变量 DSH_MC_TEXTURES 直接指向 assets/minecraft/textures/block 目录。'
      return textureStats()
    }
    IDX.source = src.path

    if (src.kind === 'dir') {
      const files = listPng(src.path)
      const built = buildIndex(files)
      IDX.files = built.files
      IDX.byName = built.byName
      IDX.byLower = built.byLower
      IDX.dir = src.path          /* 直接用原目录，不复制 */
      IDX.ready = true
      return textureStats()
    }

    /* jar：抽到缓存 */
    mkdirSync(TEX_DIR, { recursive: true })
    const log = extractFromJar(src.path, TEX_DIR)
    const files = listPng(TEX_DIR)
    if (files.length < 50) {
      IDX.error = '从 jar 里没抽到几张图，可能这个 jar 不带贴图。' + (log ? ' 脚本说：' + log.slice(0, 200) : '')
      return textureStats()
    }
    const built = buildIndex(files)
    IDX.files = built.files
    IDX.byName = built.byName
    IDX.byLower = built.byLower
    IDX.dir = TEX_DIR
    IDX.ready = true
    return textureStats()
  } catch (e) {
    IDX.error = String((e && e.message) || e).slice(0, 300)
    return textureStats()
  }
}

/** 查一个方块用哪张图（带缓存 + 统计） */
export function lookupTexture(blockName) {
  const key = String(blockName || '')
  if (IDX.resolved.has(key)) return IDX.resolved.get(key)
  if (!IDX.ready) {
    const r = { file: null, how: 'not-ready', key }
    IDX.resolved.set(key, r)
    return r
  }
  const m = matchTexture(key)
  const r = m ? { file: m.file, how: m.how, key } : { file: null, how: 'miss', key }
  if (r.file) {
    const bucket = r.how.startsWith('exact') ? 'exact'
      : r.how === 'special' ? 'special'
        : r.how.startsWith('suffix') || r.how.startsWith('prefix') ? 'suffix'
          : 'fuzzy'
    IDX.stats[bucket]++
  } else {
    IDX.stats.miss++
  }
  IDX.resolved.set(key, r)
  return r
}

export function textureFile(file) {
  if (!file) return ''
  return join(IDX.dir, basename(file))
}

/** 给一整套调色板做匹配报告，用来诊断"哪些方块没配上" */
export function resolveAll(blockNames) {
  ensureTextures()
  const rows = []
  for (const n of blockNames || []) {
    const r = lookupTexture(n)
    rows.push({ block: n, file: r.file, how: r.how })
  }
  return { stats: textureStats(), rows }
}

export const __test = {
  SPECIAL, SHAPE_SUFFIXES, FLAVOR_SUFFIXES,
  score, buildIndex, CANDIDATE_ROOTS,
}
