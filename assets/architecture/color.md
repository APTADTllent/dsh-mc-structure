# 配色与材质

Minecraft 里颜色由方块决定。**配色错了，造型再准也难看。**

## 三色原则

| 角色 | 占比 | 用在哪 |
|---|---|---|
| **主色** | 60~70% | 大面积墙面 |
| **辅色** | 20~30% | 屋顶、勒脚、框架、腰线 |
| **点缀色** | 5~10% | 门窗框、装饰、小构件 |

**整个建筑不超过 4 种主材质**（不含玻璃、门这类功能块）。
颜色一多就乱，这是铁律。

## 明暗关系（比颜色本身更重要）

- **屋顶 > 墙**：屋顶一定比墙深。
- **地基 > 墙**：勒脚一定比墙深。
- **上浅下深** 对大多数风格都成立（中式、日式尤其）。
- 反过来（下浅上深）只在特定现代风格里用，容易头重脚轻。

**一句话：把建筑想成从下往上逐渐变浅，就不会错。**

## 稳妥的搭配（可直接抄）

| 风格 | 主色（墙） | 辅色（屋顶/勒脚） | 点缀 |
|---|---|---|---|
| 乡村木屋 | `oak_planks` | `dark_oak_planks` + `cobblestone` | `oak_log` 立柱 |
| 石造民居 | `stone_bricks` | `deepslate_tiles` | `dark_oak_planks` 门窗框 |
| 白墙灰瓦 | `smooth_quartz` / `white_concrete` | `deepslate_tiles` | `dark_oak_log` |
| 现代别墅 | `white_concrete` | `gray_concrete` | `glass` 大面 + `dark_oak` |
| 日式 | `white_concrete` + `oak_planks` | `dark_oak_planks` | `dark_oak_log` |
| 中式 | `white_terracotta` 墙 | `deepslate_tiles` 瓦 + `crimson_planks` 柱 | `gold_block` 极少 |
| 城堡 | `stone_bricks` | `deepslate_bricks` | `dark_oak` + 旗帜 |
| 沙漠 | `sandstone` / `smooth_sandstone` | `cut_sandstone` | `acacia_log` |
| 雪地 | `snow_block` + `spruce_planks` | `spruce_log` | `stone_bricks` |

## 材质混搭的技巧

- **同色系不同深浅**永远安全：`oak_planks` + `dark_oak_planks` + `spruce_planks`。
- **木 + 石**是最稳的组合，几乎不会翻车。
- **要慎用**：纯色混凝土大面积铺（太现代太素）、彩色羊毛/陶瓦（容易花）。
- **粗糙 + 光滑**对比很好看：石砖（粗糙）配平滑石英（光滑）。
- 想要"旧"的感觉：在墙脚随机混入少量苔石（`mossy_cobblestone`）、
  裂石砖（`cracked_stone_bricks`）——**少量、随机、集中在底部**。

## 别做这些

- ❌ 用 5 种以上颜色
- ❌ 屋顶比墙浅
- ❌ 大面积纯黑/纯白不加任何变化
- ❌ 相邻两个构件用几乎一样但不完全一样的方块（看起来像选错了）
- ❌ 玻璃用太少或太多（玻璃面积建议占立面的 20~35%）
