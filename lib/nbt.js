/*
  基岩版 NBT 读写（小端序）
  ========================

  为什么自己写而不是用现成库：
    · 客户端 bundle 只能用 DSH 白名单里的包，宿主半也不想平白多一个依赖
    · 结构文件要「读进来 → 改几个方块 → 原样写回去」，
      保存字段的原始类型比"猜"重要得多

  内部表示：带类型的树。每个值都是 { t: TAG, v: 值 }
    · Compound  { t:10, v: { 名字: 节点 } }
    · List      { t:9, it: 元素类型, v: [节点] }
    · 标量      { t:类型, v: number | bigint | string }
  这样往返是无损的 —— 不需要靠字段名去猜"这个 Int 还是 Byte"。
*/

export const TAG = {
  End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6,
  ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12,
}

const td = new TextDecoder('utf-8')
const te = new TextEncoder()

/* ============================ 读 ============================ */

export function readNbt(buf) {
  let off = 0
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  const readName = () => {
    const n = dv.getUint16(off, true); off += 2
    const s = td.decode(buf.subarray(off, off + n)); off += n
    return s
  }

  function readPayload(t) {
    switch (t) {
      case TAG.Byte: { const v = dv.getInt8(off); off += 1; return { t, v } }
      case TAG.Short: { const v = dv.getInt16(off, true); off += 2; return { t, v } }
      case TAG.Int: { const v = dv.getInt32(off, true); off += 4; return { t, v } }
      case TAG.Long: { const v = dv.getBigInt64(off, true); off += 8; return { t, v } }
      case TAG.Float: { const v = dv.getFloat32(off, true); off += 4; return { t, v } }
      case TAG.Double: { const v = dv.getFloat64(off, true); off += 8; return { t, v } }
      case TAG.ByteArray: {
        const n = dv.getInt32(off, true); off += 4
        const v = buf.subarray(off, off + n); off += n
        return { t, v }
      }
      case TAG.String: return { t, v: readName() }
      case TAG.List: {
        const it = dv.getUint8(off); off += 1
        const n = dv.getInt32(off, true); off += 4
        const v = []
        for (let i = 0; i < n; i++) v.push(readPayload(it))
        return { t, it, v }
      }
      case TAG.Compound: {
        const v = {}
        const order = []
        for (;;) {
          const ct = dv.getUint8(off); off += 1
          if (ct === TAG.End) break
          const name = readName()
          v[name] = readPayload(ct)
          order.push(name)
        }
        return { t, v, order }
      }
      case TAG.IntArray: {
        const n = dv.getInt32(off, true); off += 4
        const v = []
        for (let i = 0; i < n; i++) { v.push(dv.getInt32(off, true)); off += 4 }
        return { t, v }
      }
      case TAG.LongArray: {
        const n = dv.getInt32(off, true); off += 4
        const v = []
        for (let i = 0; i < n; i++) { v.push(dv.getBigInt64(off, true)); off += 8 }
        return { t, v }
      }
      default: throw new Error(`不认识的 TAG 类型 ${t} @ ${off}`)
    }
  }

  const rootType = dv.getUint8(off); off += 1
  if (rootType !== TAG.Compound) throw new Error(`根节点不是 Compound（实际 ${rootType}）`)
  const name = readName()
  const value = readPayload(TAG.Compound)
  return { name, value, bytesRead: off }
}

/* ============================ 写 ============================ */

/**
 * 写一个以 Compound 为根的 NBT。
 * @param rootNode 必须是 Compound 节点（{t:10, v:{...}}）—— 也就是 readNbt 返回的 .value
 * @param rootName 根名字，.mcstructure 里是空串
 */
export function writeNbt(rootNode, rootName = '') {
  if (!rootNode || rootNode.t !== TAG.Compound) {
    throw new Error(`writeNbt 需要一个 Compound 节点，收到 ${rootNode ? rootNode.t : rootNode}`)
  }
  const chunks = []
  let len = 0
  const push = (b) => { chunks.push(b); len += b.length }

  const u8 = (n) => push(Buffer.from([n & 0xff]))
  const i16 = (n) => { const b = Buffer.allocUnsafe(2); b.writeInt16LE(n, 0); push(b) }
  const i32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeInt32LE(n, 0); push(b) }
  const i64 = (n) => { const b = Buffer.allocUnsafe(8); b.writeBigInt64LE(BigInt(n), 0); push(b) }
  const f32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeFloatLE(n, 0); push(b) }
  const f64 = (n) => { const b = Buffer.allocUnsafe(8); b.writeDoubleLE(n, 0); push(b) }
  const str = (s) => { const b = te.encode(String(s)); i16(b.length); push(Buffer.from(b)) }

  function writePayload(node) {
    const t = node.t
    switch (t) {
      case TAG.Byte: u8(node.v); break
      case TAG.Short: i16(node.v); break
      case TAG.Int: i32(node.v); break
      case TAG.Long: i64(node.v); break
      case TAG.Float: f32(node.v); break
      case TAG.Double: f64(node.v); break
      case TAG.ByteArray: {
        const b = node.v
        i32(b.length); push(Buffer.from(b)); break
      }
      case TAG.String: str(node.v); break
      case TAG.List: {
        const items = node.v || []
        const it = node.it !== undefined ? node.it : (items[0] ? items[0].t : TAG.End)
        u8(it); i32(items.length)
        for (const item of items) writePayload(item)
        break
      }
      case TAG.Compound: {
        /* ⚠ 必须按解析时记下的顺序写，不能用 Object.keys()。
           JS 对象会把「整数样式的字符串键」自动按数值升序重排 ——
           而 block_position_data 的键正好就是 "0"、"1267" 这种。
           用 Object.keys 写出去，键顺序就变了，文件字节和原文件对不上。 */
        const keys = node.order && node.order.length ? node.order : Object.keys(node.v || {})
        for (const k of keys) {
          const child = node.v[k]
          if (!child) continue          // 被删掉的键（比如改方块后清附加数据）
          u8(child.t); str(k); writePayload(child)
        }
        u8(TAG.End)
        break
      }
      case TAG.IntArray: {
        i32(node.v.length)
        for (const n of node.v) i32(n)
        break
      }
      case TAG.LongArray: {
        i32(node.v.length)
        for (const n of node.v) i64(n)
        break
      }
      default: throw new Error(`写不了 TAG 类型 ${t}`)
    }
  }

  u8(TAG.Compound)
  str(rootName)
  writePayload(rootNode)
  return Buffer.concat(chunks, len)
}

/* ============================ 取值小工具 ============================ */

export const get = (compound, key) => (compound && compound.v ? compound.v[key] : undefined)
export const getNum = (compound, key, fallback = 0) => {
  const n = get(compound, key)
  return n && typeof n.v === 'number' ? n.v : (typeof n?.v === 'bigint' ? Number(n.v) : fallback)
}
export const getStr = (compound, key, fallback = '') => {
  const n = get(compound, key)
  return n && typeof n.v === 'string' ? n.v : fallback
}
export const asList = (compound, key) => {
  const n = get(compound, key)
  return n && Array.isArray(n.v) ? n.v : []
}
export const num = (v, t = TAG.Int) => ({ t, v })
export const strNode = (v) => ({ t: TAG.String, v: String(v) })
export const list = (items, it) => ({ t: TAG.List, it: it !== undefined ? it : (items[0] ? items[0].t : TAG.End), v: items })
export const compound = (obj) => ({ t: TAG.Compound, v: obj || {} })
