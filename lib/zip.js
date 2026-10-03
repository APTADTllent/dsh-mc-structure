/*
  最小 zip 读取器 —— 只做一件事：从 Minecraft 版本 jar 里把方块贴图抽出来
  ====================================================================

  为什么自己写而不用 PowerShell：
    旧实现是起一个 PowerShell 子进程，借 .NET 的 System.IO.Compression 解包
    （脚本见 scripts/extract-textures.ps1，现已退役）。功能没问题，但有两个代价：
      1. 静态安全扫描会把「起子进程」记成一条能力告警（capability reach），
         每个装插件的人都要重新审一遍这条调用；
      2. Windows-only，别的平台用不了。
    Node 自带 zlib，raw DEFLATE 就是 inflateRawSync，够用了 —— 于是整个插件
    从此不 spawn 任何进程（所以本文件里也刻意不出现那个 API 的名字，免得
    静态扫描把说明文字当成调用）。

  只读不写、只认两种压缩方式（0 存储 / 8 deflate），遇到别的一律跳过。
  不解析 ZIP64：jar 小于 4GB 时不出现。

  安全上做的取舍（这里的输入是【本机游戏目录里的 jar】，不是网络来的文件，
  但仍然按不可信处理）：
    · 只落 basename(name)，jar 内部写 "..\\..\\x.png" 也只会落成一个普通文件名
    · 只收调用方 test() 认可的名字（本插件用扩展名 .png 收口）
    · 单条解压上限 MAX_ENTRY_BYTES，总量上限 MAX_TOTAL_BYTES（防解压炸弹）
    · 条目数上限 MAX_ENTRIES、声明解压体积上限 MAX_DECLARED_TOTAL
*/
import { openSync, readSync, closeSync, fstatSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

const MAX_ENTRY_BYTES = 16 * 1024 * 1024       /* 单条解压上限 */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024      /* 本次写盘总量上限 */
const MAX_ENTRIES = 2048                       /* 最多处理这么多条匹配项 */
const MAX_DECLARED_TOTAL = 512 * 1024 * 1024   /* 中央目录【声明】的解压总量上限 */
const EOCD_MIN = 22
const EOCD_MAX = EOCD_MIN + 0xffff

/** 只读打开文件的一小块；越界或读不满都返回 null */
function readRange(fd, start, len) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(len) || start < 0 || len < 0) return null
  const buf = Buffer.allocUnsafe(len)
  try {
    return readSync(fd, buf, 0, len, start) === len ? buf : null
  } catch {
    return null
  }
}

/** 定位中央目录。EOCD 在文件尾部，且注释最长 65535，所以从尾部往前找。 */
function findEndOfCentralDirectory(fd, size) {
  const span = Math.min(size, EOCD_MAX)
  const tail = readRange(fd, size - span, span)
  if (!tail) return null

  for (let i = span - EOCD_MIN; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== SIG_EOCD) continue
    const commentLen = tail.readUInt16LE(i + 20)
    /* 命中的必须是真 EOCD：注释长度要和它在文件里的位置对得上 */
    if (i + EOCD_MIN + commentLen !== span) continue
    return {
      entryCount: tail.readUInt16LE(i + 10),
      cdSize: tail.readUInt32LE(i + 12),
      cdOffset: tail.readUInt32LE(i + 16),
    }
  }
  return null
}

/**
 * 从 zip/jar 里按名字抽条目。
 *
 * @param {string} zipPath
 * @param {{ outDir: string, test: (name: string) => boolean }} opts
 *        test 收到 zip 内部的完整条目名（用 / 分隔）
 * @returns {{ ok: boolean, error?: string, written: string[], files: number,
 *             bytes: number, scanned: number, warnings: string[] }}
 */
export function extractZipEntries(zipPath, { outDir, test }) {
  const written = []
  const warnings = []
  let files = 0
  let bytes = 0
  let scanned = 0
  let fd = null

  const fail = (error) => ({ ok: false, error, written, files, bytes, scanned, warnings })

  try {
    try {
      fd = openSync(zipPath, 'r')
    } catch (e) {
      return fail('打不开文件：' + String((e && e.message) || e))
    }

    const size = fstatSync(fd).size
    if (size < EOCD_MIN) return fail('不是 zip：文件太小')

    const eocd = findEndOfCentralDirectory(fd, size)
    if (!eocd) return fail('不是 zip：找不到中央目录（EOCD）')
    if (eocd.cdSize < 4 || eocd.cdOffset + eocd.cdSize > size) {
      return fail('中央目录越界，文件可能被截断')
    }

    const cd = readRange(fd, eocd.cdOffset, eocd.cdSize)
    if (!cd) return fail('中央目录读不出来')

    mkdirSync(outDir, { recursive: true })

    let pos = 0
    let declaredTotal = 0
    while (pos + 46 <= cd.length) {
      if (cd.readUInt32LE(pos) !== SIG_CENTRAL) break

      const method = cd.readUInt16LE(pos + 10)
      const compSize = cd.readUInt32LE(pos + 20)
      const rawSize = cd.readUInt32LE(pos + 24)
      const nameLen = cd.readUInt16LE(pos + 28)
      const extraLen = cd.readUInt16LE(pos + 30)
      const commentLen = cd.readUInt16LE(pos + 32)
      const localOffset = cd.readUInt32LE(pos + 42)
      const name = cd.toString('utf8', pos + 46, pos + 46 + nameLen)
      pos += 46 + nameLen + extraLen + commentLen

      if (!test(name)) continue
      scanned++
      if (scanned > MAX_ENTRIES) {
        warnings.push(`匹配条目超过 ${MAX_ENTRIES} 个，剩下的没看`)
        break
      }
      if (method !== 0 && method !== 8) {
        warnings.push(`跳过（压缩方式 ${method} 不支持）：${name}`)
        continue
      }
      if (rawSize > MAX_ENTRY_BYTES) {
        warnings.push(`跳过（单条超过上限）：${name}`)
        continue
      }
      declaredTotal += rawSize
      if (declaredTotal > MAX_DECLARED_TOTAL) {
        warnings.push('中央目录声明的解压总量超过上限，停止')
        break
      }

      /* 本地头固定 30 字节，后面跟自己的 name/extra；长度可能和中央目录不同 */
      const lh = readRange(fd, localOffset, 30)
      if (!lh || lh.readUInt32LE(0) !== SIG_LOCAL) {
        warnings.push(`本地头无效，跳过：${name}`)
        continue
      }
      const dataStart = localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28)

      const payload = readRange(fd, dataStart, compSize)
      if (!payload) {
        warnings.push(`数据读不出来，跳过：${name}`)
        continue
      }

      let data
      try {
        data = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: MAX_ENTRY_BYTES })
      } catch (e) {
        warnings.push(`解压失败，跳过：${name}（${String((e && e.message) || e)}）`)
        continue
      }

      if (bytes + data.length > MAX_TOTAL_BYTES) {
        warnings.push(`累计解压超过 ${MAX_TOTAL_BYTES / 1024 / 1024}MB，停止`)
        break
      }

      /* 只取 basename：jar 里写着 ../.. 也只会落成一个普通文件名 */
      writeFileSync(join(outDir, basename(name)), data)
      written.push(basename(name))
      files++
      bytes += data.length
    }

    return { ok: true, written, files, bytes, scanned, warnings }
  } finally {
    if (fd !== null) {
      try { closeSync(fd) } catch { /* ignore */ }
    }
  }
}
