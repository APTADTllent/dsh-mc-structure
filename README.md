# dsh-mc-structure

> 《我的世界》结构文件工作台 · A Minecraft structure-file workbench for DSH (DeepSeek Harness).
>
> 读写基岩版 `.mcstructure`、六视图渲染、任意方块放置与替换，
> 并内置一套建筑美学数据集，让大模型搭出来的房子不只是「能住」。

---

## 安装

### 一条命令（推荐）

```bash
dsh plugin add https://github.com/APTADTllent/dsh-mc-structure.git
```

DSH 会把这个仓库拉进 profile 的 `node_modules` 并注册好。装完重启 DSH 即可。

### 手动安装（备用）

如果上面那条命令不可用，手动来也是三步：

**1. 放进 DSH profile 的 `node_modules`**

把本目录整个复制过去：

```
<DSH_HOME>/profiles/web/node_modules/dsh-mc-structure
```

`<DSH_HOME>` 通常是 `~/.dsh`（Windows 上是 `C:\Users\<你>\.dsh`）。
复制完确认 `<DSH_HOME>/profiles/web/node_modules/dsh-mc-structure/package.json` 存在。

**2. 在补丁文件里注册**

编辑 `<DSH_HOME>/profiles/web/cordis.patch.yml`，加一段：

```yaml
- insert:
    - id: mc-structure
      name: 'dsh-mc-structure'
```

**3. 重启 DSH**

改完补丁必须重启才生效。重启后在对话里说「打开某个 .mcstructure」，
或者直接让它建一个结构，就能确认装好了。

### ⚠️ 最容易踩的坑

补丁行里的 `name` 必须是**裸包名**，且该包要能被 Node **从本 profile 解析到** ——
即 `profiles/web/node_modules/dsh-mc-structure/package.json` 必须真实存在。

**解析失败会被静默跳过**（`pkgMeta = null`），症状是「工具没出现」，
但**不报任何错**。装了却没反应，先查这里。

### 贴图（可选）

原版贴图由 `lib/zip.js` 直接从客户端 jar 里解出来，**纯 JavaScript（只用 Node 内置
`zlib`），不需要 PowerShell，也不再起任何子进程**——Windows 以外的平台同样能用。

`scripts/` 下另有一个 Windows PowerShell 脚本：

- `dump-textures.ps1` — 导出贴图清单
- `extract-textures.ps1` — 已经不在运行时路径上，仅保留给新旧实现做逐字节对比测试
  （见 `plugin/test-zip-extract.mjs`），不再需要人手调用

没提取过贴图也能用，只是六视图渲染会退化成纯色块，功能不受影响。

---

## 关于进程调用与网络（安全评审说明）

**本插件不调用任何外部程序，不起任何子进程。**

| 项目 | 状态 |
|---|---|
| 起 PowerShell 子进程解包贴图 | **已移除**（2026-09-30）。贴图改由 `lib/zip.js` 用 Node 内置 `zlib` 在进程内解包 |

如果你看到的评审报告里还有「执行 shell 命令」的条目，那是旧版本。自查方法：
在 `lib/` 里搜 `node:child_process`、`execFileSync`、`execSync`、`spawn` —— 现在都应为 0 处。

**外联域名**：源码里出现的 HTTP 地址只有一个文档链接
（`https://wiki.bedrock.dev/nbt/mcstructure`，写在注释里，不发起请求）。
**这个插件在运行时完全不联网。**

**没有硬编码密钥，没有 `eval` / `new Function`，没有递归删除，没有任何遥测或数据外发。**

---

## 它能做什么

| 工具 | 作用 |
|---|---|
| `mc_open_structure` | 打开一个 `.mcstructure`，之后就能查看和编辑 |
| `mc_new_structure` | 新建空白画布（最大 256×256×256） |
| `mc_structure_info` | 看尺寸、各方块数量、分层情况 |
| `mc_find_blocks` | 查某个方块分布在哪些层、每层多少格 |
| `mc_layer_map` | 把某一层画成平面图（俯视），每格一个字符 |
| `mc_set_block` | 在指定坐标放一个方块 |
| `mc_fill_region` | 长方体区域批量填充（铺地板、砌墙最省事） |
| `mc_replace_blocks` | 把某种方块全换成另一种（可限定范围） |
| `mc_export_structure` | 导出成 `.mcstructure`，能直接导进游戏 |
| `mc_build_guide` | 建筑指导手册：比例、屋顶、墙体开窗、配色、构件、风格、避坑 |

`mc_build_guide` 的 `topic` 可选：
`index` / `proportion` / `roof` / `wall` / `color` / `parts` / `style` / `mistakes`。

---

## 内置建筑美学数据集

`assets/architecture/` 下是八份结构化文档，`mc_build_guide` 直接把它们喂给模型：

| 文件 | 内容 |
|---|---|
| `index.md` | 总目录与使用方式 |
| `proportion.md` | 比例与尺度（层高、开间、进深） |
| `roof.md` | 屋顶形式（坡屋顶、攒尖、歇山…） |
| `wall.md` | 墙体与开窗节奏 |
| `color.md` | 配色与材质搭配 |
| `parts.md` | 常见构件（檐口、勒脚、栏杆、烟囱…） |
| `style.md` | 风格参考（中式、欧式、现代…） |
| `mistakes.md` | 避坑清单（新手最常搭错的那些） |

这是这个插件跟「随便堆方块」的区别所在。

---

## 坐标顺序：一个曾经翻过车的地方

基岩版 `.mcstructure` 的方块数组是 **ZYX 顺序**，索引公式是：

```js
index = z + sizeZ * (y + sizeY * x)
```

注意这三个轴的嵌套关系很容易记反。早先这里写成了 XZY
（`x + sizeX * (z + sizeZ * y)`），症状是**生成的结构在游戏里平躺在地上**
（底边朝前而不是朝下），但文件本身完全合法、游戏也照常读得进去 —— 所以很难发现。

现在的实现已按上面对齐，并用真实游戏导出的结构文件验证过。

---

## 用法教程

```
打开桌面上的白房子.mcstructure，告诉我它每层都用了什么方块
```

```
新建一个 24×12×20 的画布，铺一层石砖地基，用橡木原木立四根柱子，
屋顶做成坡屋顶，屋檐往外挑两格
```

```
把结构里所有 minecraft:oak_planks 换成 minecraft:spruce_planks
```

搭之前可以让模型先调 `mc_build_guide`。导出的 `.mcstructure`
放到存档的 `structures/` 目录下（或用结构方块加载）就能用。

---

## 依赖与限制

### 依赖

| 用途 | 需要什么 |
|---|---|
| 基本功能 | **无外部依赖** —— `lib/` 是纯 ESM JavaScript，只用 Node 内置模块 |
| 六视图上色（可选） | 《我的世界》客户端 jar；贴图由 `lib/zip.js` 在进程内提取，不需要额外工具 |
| 贴图提取脚本 | **无** —— 纯 JS，跨平台 |

### 限制

- **面向基岩版结构文件**（`.mcstructure`）。画布上限 256×256×256。
- **运行时完全不联网**，不做任何网络请求。
- **贴图提取不再依赖 Windows**（2026-09-30 起改纯 JS 解包）。没找到客户端 jar 或者
  jar 里没有原版贴图时，六视图渲染退化成纯色块，编辑与导出功能不受影响。
  jar 内条目上限：单条解压 16 MB、单次累计 256 MB，超出会被跳过并记一条警告。
- **导出的结构要你自己放进游戏**：本插件只负责生成文件，
  不会自动安装进存档，也不修改游戏目录。
- **不校验方块 ID 是否真实存在**：放进去的方块名如果拼错，
  文件仍然能导出，但游戏里可能显示成空气。建议用游戏里真实存在的 ID。

---

## 开发

```
lib/
  index.js         10 个工具的注册与实现
  client.js        浏览器半：六视图渲染、交互
  mcstructure.js   .mcstructure 读写（ZYX 索引）
  nbt.js           NBT 编解码
  textures.js      贴图加载与缓存
assets/architecture/   建筑美学数据集（8 份）
scripts/               Windows 贴图提取脚本
```

---

## 发布信息（维护者看）

**建议设置的 GitHub Topics**（插件市场靠其中之一识别）：

```
dsh-plugin          ← 必须
dsh
deepseek-harness
cordis-plugin
minecraft
mcstructure
nbt
bedrock
architecture
viewer
```

**插件标识**：本包的 `package.json` 里已声明客户端平台，满足「插件标识」要求：

```json
"dsh": { "client": { "platform": "web" } }
```

因为它有一个浏览器半（六视图渲染）。

---

## License

MIT
