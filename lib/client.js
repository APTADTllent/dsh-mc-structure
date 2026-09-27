/*
  dsh-mc-structure —— 浏览器半
  ============================

  六视图用的是【正投影】而不是 3D 透视：
    每个方向只看最靠前的那一层方块，得到的就是立面图 —— 工程图那种。
    好处是不用深度排序、几十万方块也能秒出，而且看结构比例最直观。

  配色没办法用真实材质（拿不到材质包），所以按方块名推断颜色：
    显式表 → 关键词规则 → 哈希兜底。模组方块也能有个稳定颜色。
*/

window.__ModuleLoader__.load({
  id: "dsh-mc-structure",
  factory: function (require) {
    var React = require("react");
    var H = React.createElement;
    var API = "";

    /* ============================ 颜色 ============================ */

    var HUES = {
      white: "#e9ecec", light_gray: "#9aa0a6", gray: "#5f666d", black: "#22262b",
      brown: "#7a5230", red: "#b3352c", orange: "#e0762a", yellow: "#e8c33a",
      lime: "#7fc23a", green: "#3f7a2e", cyan: "#2e8f8f", light_blue: "#5aa9e6",
      blue: "#2f5fb3", purple: "#7b3fb3", magenta: "#c04fa8", pink: "#e292b0",
    };

    /* 常见的直接写死，剩下的靠关键词推 */
    var EXACT = {
      "minecraft:air": null, "minecraft:cave_air": null, "minecraft:void_air": null,
      "minecraft:water": "#3a6ea5", "minecraft:flowing_water": "#3a6ea5",
      "minecraft:lava": "#e2621b", "minecraft:flowing_lava": "#e2621b",
      "minecraft:glass": "#bfe3e8", "minecraft:stone": "#7d7d7d",
      "minecraft:cobblestone": "#6f6f6f", "minecraft:stone_bricks": "#7a7a7a",
      "minecraft:smooth_stone": "#9c9c9c", "minecraft:deepslate": "#4d4d52",
      "minecraft:deepslate_tiles": "#37383c", "minecraft:deepslate_bricks": "#43444a",
      "minecraft:oak_planks": "#b08a52", "minecraft:spruce_planks": "#745a37",
      "minecraft:birch_planks": "#d7c99a", "minecraft:dark_oak_planks": "#4b3218",
      "minecraft:oak_log": "#6b5334", "minecraft:dark_oak_log": "#3b2a15",
      "minecraft:smooth_quartz": "#e6e2da", "minecraft:quartz_block": "#e8e4dc",
      "minecraft:sandstone": "#dbcb9a", "minecraft:smooth_sandstone": "#e0d3a4",
      "minecraft:sand": "#dbcb9a", "minecraft:dirt": "#79553a",
      "minecraft:grass_block": "#5d9b3f", "minecraft:moss_block": "#5a7d34",
      "minecraft:snow_block": "#eef3f5", "minecraft:ice": "#9cc9e8",
      "minecraft:glowstone": "#f2d17a", "minecraft:sea_lantern": "#cfe6df",
      "minecraft:gold_block": "#f3d13c", "minecraft:iron_block": "#d8d8d8",
      "minecraft:diamond_block": "#57d6cf", "minecraft:emerald_block": "#3fd15c",
      "minecraft:redstone_block": "#b0231a", "minecraft:lapis_block": "#2a4f9c",
      "minecraft:copper_block": "#c1714a", "minecraft:netherite_block": "#40383a",
      "minecraft:bedrock": "#4a4a4a", "minecraft:obsidian": "#1a1024",
      "minecraft:structure_block": null, "minecraft:structure_void": null,
      "minecraft:light_block": null, "minecraft:barrier": null,
    };

    var RULES = [
      [/air$|structure_void|barrier|light_block|structure_block/, null],
      [/water|bubble_column/, "#3a6ea5"],
      [/lava|magma/, "#e2621b"],
      [/glass|pane$/, "#bfe3e8"],
      [/leaves|grass|moss|vine|lily|fern|azalea|kelp|seagrass/, "#4f8f36"],
      [/snow|powder_snow/, "#eef3f5"],
      [/ice|frost/, "#9cc9e8"],
      [/quartz|white_/, "#e6e2da"],
      [/sand|sandstone/, "#dbcb9a"],
      [/dirt|mud|podzol|farmland|path/, "#79553a"],
      [/log$|_log|wood$|_wood|hyphae/, "#6b5334"],
      [/planks|plank/, "#b08a52"],
      [/deepslate|blackstone|basalt|obsidian|netherite/, "#43444a"],
      [/stone|brick|cobble|andesite|diorite|granite|tuff|gravel|concrete_powder/, "#7d7d7d"],
      [/diamond|prismarine|cyan/, "#57d6cf"],
      [/emerald|lime|verdant/, "#3fd15c"],
      [/redstone|red_|crimson|nether_wart_block/, "#b0231a"],
      [/gold|yellow/, "#f3d13c"],
      [/iron|silver|light_gray/, "#c9c9c9"],
      [/copper|orange|acacia|terracotta/, "#c1714a"],
      [/lapis|blue/, "#2f5fb3"],
      [/purple|amethyst|magenta|purple/, "#7b3fb3"],
      [/pink|cherry/, "#e292b0"],
      [/wool|carpet|bed$|_bed/, "#b9b9b9"],
      [/lamp|lantern|torch|glow|froglight|shroomlight|sea_lantern/, "#f2d17a"],
      [/planks?$/, "#b08a52"],
    ];

    function hashHue(s) {
      var h = 0;
      for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      return Math.abs(h) % 360;
    }

    var colorCache = {};
    function blockColor(name) {
      if (name in colorCache) return colorCache[name];
      var c = null;
      if (Object.prototype.hasOwnProperty.call(EXACT, name)) c = EXACT[name];
      if (c === undefined) c = null;
      if (c === null && !Object.prototype.hasOwnProperty.call(EXACT, name)) {
        var tail = String(name).split(":").pop();
        for (var i = 0; i < RULES.length; i++) {
          if (RULES[i][0].test(tail)) { c = RULES[i][1]; break; }
        }
        if (c === null) {
          for (var k in HUES) { if (tail.indexOf(k) >= 0) { c = HUES[k]; break; } }
        }
        if (!c) c = "hsl(" + hashHue(name) + ",42%,52%)";
      }
      colorCache[name] = c;
      return c;
    }

    /* ============================ 六视图 ============================ */

    /* 每个视图：u/v 是屏幕坐标，depth 越大越靠前（正投影下只保留最靠前的） */
    function makeViews(sx, sy, sz) {
      return [
        { key: "front", label: "前视图 (+Z)", w: sx, h: sy,
          u: function (x) { return x }, v: function (x, y) { return sy - 1 - y }, d: function (x, y, z) { return z } },
        { key: "back", label: "后视图 (−Z)", w: sx, h: sy,
          u: function (x) { return sx - 1 - x }, v: function (x, y) { return sy - 1 - y }, d: function (x, y, z) { return -z } },
        { key: "right", label: "右视图 (+X)", w: sz, h: sy,
          u: function (x, y, z) { return z }, v: function (x, y) { return sy - 1 - y }, d: function (x) { return x } },
        { key: "left", label: "左视图 (−X)", w: sz, h: sy,
          u: function (x, y, z) { return sz - 1 - z }, v: function (x, y) { return sy - 1 - y }, d: function (x) { return -x } },
        { key: "top", label: "顶视图 (+Y)", w: sx, h: sz,
          u: function (x) { return x }, v: function (x, y, z) { return z }, d: function (x, y) { return y } },
        { key: "bottom", label: "底视图 (−Y)", w: sx, h: sz,
          u: function (x) { return x }, v: function (x, y, z) { return sz - 1 - z }, d: function (x, y) { return -y } },
      ];
    }

    /* ============================ 贴图 ============================ */
    /* 方块贴图从宿主半取（/mc/tex?name=...），同名只加载一次，
       失败就永久回退到内置色板 —— 少一张图不该让整个界面出不来。

       注意这里是"用到才加载"：一个结构的调色板通常十几二十种方块，
       不会把上千张图全拉下来。这也是为什么不需要提前遍历游戏目录。 */
    var TEX = { byName: {} }

    function texFor(name) {
      var t = TEX.byName[name]
      return (t && t.ok && t.img) ? t.img : null
    }

    /** 把这套贴图加载好；全部有结果了（成功或失败）就回调一次 */
    function loadTextures(textures, onReady) {
      var names = Object.keys(textures || {})
      var pending = 0
      var fired = false
      function settle() {
        if (fired || pending > 0) return
        fired = true
        if (onReady) onReady()
      }
      for (var i = 0; i < names.length; i++) {
        (function (n) {
          if (TEX.byName[n]) return                 /* 已经加载过或已经失败过 */
          var rec = { img: null, ok: false, failed: false }
          TEX.byName[n] = rec
          pending++
          var im = new Image()
          rec.img = im
          im.onload = function () { rec.ok = true; pending--; settle() }
          im.onerror = function () { rec.failed = true; pending--; settle() }
          im.src = API + "/mc/tex?name=" + encodeURIComponent(n)
        })(names[i])
      }
      settle()
      return pending
    }

    /** 游程解压（和宿主半 encodeIndicesRLE 配对） */
    function decodeRLE(rle, length) {
      var out = new Int32Array(length)
      var at = 0
      for (var i = 0; i < rle.length; i += 2) {
        var v = rle[i], n = rle[i + 1]
        for (var k = 0; k < n && at < out.length; k++) out[at++] = v
      }
      return out
    }

    /** 画单独一层 —— "剥开"视图。
     *  空气【不画】，留出背景色，看起来才是真的被剥掉了一层。 */
    function drawLayer(L, paletteColors, paletteTextures, opts) {
      var o = opts || {}
      var cap = o.cap || 640
      var cell = Math.max(3, Math.min(o.maxCell || 28, Math.floor(cap / Math.max(1, L.w, L.h))))
      var cv = document.createElement("canvas")
      cv.width = L.w * cell + 1
      cv.height = L.h * cell + 1
      var g = cv.getContext("2d")
      g.fillStyle = "#0b0d12"
      g.fillRect(0, 0, cv.width, cv.height)

      var idx = decodeRLE(L.rle, L.cells)
      for (var z = 0; z < L.h; z++) {
        for (var x = 0; x < L.w; x++) {
          var pi = idx[z * L.w + x]
          if (pi <= 0) continue                     /* 空气：不画，留背景 */
          var tex = paletteTextures && paletteTextures[pi]
          if (tex && typeof g.drawImage === "function") {
            g.drawImage(tex, x * cell, z * cell, cell, cell)
          } else {
            g.fillStyle = (paletteColors && paletteColors[pi]) || "#3a3f4b"
            g.fillRect(x * cell, z * cell, cell, cell)
          }
        }
      }
      if (cell >= 6) {
        g.strokeStyle = "rgba(255,255,255,.08)"
        g.lineWidth = 1
        for (var gx = 0; gx <= L.w; gx++) {
          g.beginPath(); g.moveTo(gx * cell + .5, 0); g.lineTo(gx * cell + .5, cv.height); g.stroke()
        }
        for (var gz = 0; gz <= L.h; gz++) {
          g.beginPath(); g.moveTo(0, gz * cell + .5); g.lineTo(cv.width, gz * cell + .5); g.stroke()
        }
      }
      return cv
    }

    /** 正投影渲染：每个像素只留最靠前的那个方块
     *
     *  【空气默认不参与遮挡】—— 这一点踩过坑：
     *  8×8 小屋的地基比墙外扩一格，于是"轮廓外那一圈空气"成了最靠前的体素，
     *  前后左右四个视图全变成一片黑，整栋房子被空气挡在后面。
     *  所以默认只让真正的方块参战；勾上"标出空洞"才把空气画成暗色，
     *  那时看到的才是"立面上哪些位置是空的"。
     *
     *  另外相邻方块不同时描一条暗边，否则同色墙体糊成一片，看不出门窗位置。 */
    function renderView(struct, view, paletteColors, gridOn, drawAir, paletteTextures) {
      var cv = document.createElement("canvas");
      /* 每格几像素得跟着尺寸收：256 格 × 8px 就是 2049×2049 一张，
         六张加起来 96MB canvas，标签页会直接卡死甚至崩。
         单张最长边压到 ~900px 以内。 */
      var cell = Math.max(1, Math.min(8, Math.floor(900 / Math.max(1, view.w, view.h))));
      cv.width = Math.max(1, view.w) * cell + 1;
      cv.height = Math.max(1, view.h) * cell + 1;
      var g = cv.getContext("2d");
      g.fillStyle = "#12141a";
      g.fillRect(0, 0, cv.width, cv.height);

      var sx = struct.size[0], sy = struct.size[1], sz = struct.size[2];
      var depth = new Float32Array(view.w * view.h).fill(-Infinity);
      var idxAt = new Int32Array(view.w * view.h).fill(-1);
      var seen = new Uint8Array(view.w * view.h);

      for (var y = 0; y < sy; y++) {
        for (var z = 0; z < sz; z++) {
          for (var x = 0; x < sx; x++) {
            /* 基岩版的下标顺序是 ZYX（z 最快），跟官方文档一致。
               这里必须和 mcstructure.js 的 posIndex 用同一个公式，
               不然预览和导出会对不上。 */
            var i = z + sz * (y + sy * x);
            var pi = struct.indices[i];
            if (pi < 0) continue;
            /* 空气默认整个跳过：它不该挡住后面的墙。
               只有明确要看"哪些格子是空的"时才让它参与。 */
            var col = paletteColors[pi];
            if (!col && !drawAir) continue;
            var u = view.u(x, y, z), v = view.v(x, y, z), d = view.d(x, y, z);
            if (u < 0 || v < 0 || u >= view.w || v >= view.h) continue;
            var k = v * view.w + u;
            if (d > depth[k]) { depth[k] = d; idxAt[k] = pi; seen[k] = 1; }
          }
        }
      }

      var HOLE = "#0d0f14";
      for (var kk = 0; kk < idxAt.length; kk++) {
        if (!seen[kk]) continue;
        var p2 = idxAt[kk];
        var uu = kk % view.w, vv = (kk / view.w) | 0;
        /* 有真实贴图就贴上去，没有就退回纯色 —— 两者混着用也看不出来突兀 */
        var tex = paletteTextures && paletteTextures[p2];
        if (tex && typeof g.drawImage === "function") {
          g.drawImage(tex, uu * cell, vv * cell, cell, cell);
        } else {
          g.fillStyle = paletteColors[p2] || HOLE;
          g.fillRect(uu * cell, vv * cell, cell, cell);
        }
      }

      /* 相邻不同方块之间描边 —— 这一条让"白墙 + 窗"能看出结构 */
      g.fillStyle = "rgba(0,0,0,.45)";
      for (var yy2 = 0; yy2 < view.h; yy2++) {
        for (var xx2 = 0; xx2 < view.w; xx2++) {
          var k2 = yy2 * view.w + xx2;
          if (!seen[k2]) continue;
          var right = (xx2 + 1 < view.w) ? idxAt[k2 + 1] : -1;
          var down = (yy2 + 1 < view.h) ? idxAt[k2 + view.w] : -1;
          if (right !== idxAt[k2]) g.fillRect((xx2 + 1) * cell - 1, yy2 * cell, 1, cell);
          if (down !== idxAt[k2]) g.fillRect(xx2 * cell, (yy2 + 1) * cell - 1, cell, 1);
        }
      }

      if (gridOn && view.w <= 64 && view.h <= 64) {
        g.strokeStyle = "rgba(255,255,255,.07)";
        g.lineWidth = 1;
        for (var gx = 0; gx <= view.w; gx++) { g.beginPath(); g.moveTo(gx * cell + .5, 0); g.lineTo(gx * cell + .5, cv.height); g.stroke(); }
        for (var gy = 0; gy <= view.h; gy++) { g.beginPath(); g.moveTo(0, gy * cell + .5); g.lineTo(cv.width, gy * cell + .5); g.stroke(); }
      }
      return cv;
    }

    /* ============================ 样式 ============================ */

    var CSS = [
      ".mc-fab{position:fixed;right:16px;bottom:156px;z-index:60;display:flex;flex-direction:column;gap:8px}",
      ".mc-fab button{width:40px;height:40px;border-radius:50%;border:1px solid rgba(128,128,128,.3);background:var(--dsw-alias-bg-base,#fff);color:inherit;cursor:pointer;font-size:17px;line-height:1;box-shadow:0 2px 10px rgba(0,0,0,.18);padding:0}",
      ".mc-fab button:hover{border-color:#7fb069}",
      ".mc-mask{position:fixed;inset:0;z-index:70;background:rgba(10,12,16,.72);display:flex;align-items:center;justify-content:center;padding:24px}",
      ".mc-win{width:min(1180px,96vw);height:min(860px,92vh);background:var(--dsw-alias-bg-base,#15171c);color:inherit;border:1px solid rgba(128,128,128,.35);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5)}",
      ".mc-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(128,128,128,.25);flex-wrap:wrap}",
      ".mc-bar .t{font-weight:600;margin-right:auto}",
      ".mc-btn{padding:5px 12px;border-radius:7px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;cursor:pointer;font-size:13px}",
      ".mc-btn:hover{border-color:#7fb069}",
      ".mc-btn.p{background:#3f7a2e;border-color:#3f7a2e;color:#fff}",
      ".mc-body{flex:1;overflow:auto;padding:14px}",
      ".mc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}",
      ".mc-cell{border:1px solid rgba(128,128,128,.25);border-radius:9px;padding:8px;overflow:auto;background:rgba(0,0,0,.15)}",
      ".mc-cell .lab{font-size:12px;opacity:.75;margin-bottom:6px}",
      ".mc-cell canvas{display:block;max-width:100%;image-rendering:pixelated}",
      ".mc-layerhost{display:flex;justify-content:center;align-items:flex-start;padding:2px 0 8px;overflow:auto;max-height:100%}",
      ".mc-layerhost canvas{display:block;max-width:100%;image-rendering:pixelated;border-radius:4px;box-shadow:0 2px 12px rgba(0,0,0,.45)}",
      ".mc-empty{opacity:.6;text-align:center;padding:60px 0;font-size:14px;line-height:2}",
      ".mc-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}",
      ".mc-row input{background:rgba(0,0,0,.25);border:1px solid rgba(128,128,128,.35);border-radius:6px;color:inherit;padding:5px 9px;font-size:13px;width:70px}",
      ".mc-row input.wide{width:340px}",
      ".mc-list{max-height:280px;overflow:auto;border:1px solid rgba(128,128,128,.25);border-radius:8px}",
      ".mc-list div{padding:6px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid rgba(128,128,128,.12)}",
      ".mc-list div:hover{background:rgba(127,176,105,.18)}",
      ".mc-msg{padding:6px 10px;border-radius:6px;font-size:13px;background:rgba(0,0,0,.25)}",
      ".mc-msg.err{background:rgba(190,40,40,.25)}",
      ".mc-hint{font-size:12px;opacity:.65;line-height:1.7}",
    ].join("")

    function injectCss() {
      if (document.querySelector("style[data-mc-structure]")) return
      var el = document.createElement("style")
      el.dataset.mcStructure = "1"
      el.textContent = CSS
      document.head.appendChild(el)
    }

    /* ============================ 面板 ============================ */

    function McPanel(props) {
      var dataSt = React.useState(null)
      var data = dataSt[0], setData = dataSt[1]
      var listSt = React.useState(null)
      var listing = listSt[0], setListing = listSt[1]
      var msgSt = React.useState("")
      var msg = msgSt[0], setMsg = msgSt[1]
      var errSt = React.useState(false)
      var isErr = errSt[0], setIsErr = errSt[1]
      var tabSt = React.useState("views")
      var tab = tabSt[0], setTab = tabSt[1]
      var sizeSt = React.useState({ x: 16, y: 12, z: 16 })
      var size = sizeSt[0], setSize = sizeSt[1]
      var pathSt = React.useState("")
      var outPath = pathSt[0], setOutPath = pathSt[1]
      var gridSt = React.useState(true)
      var gridOn = gridSt[0], setGridOn = gridSt[1]
      /* 默认【把空气当透明】：看到的就是建筑本身。
         勾上这个才把空气也画成暗色 —— 那时看的是"立面上哪些位置是空的"。
         （旧版默认反过来，结果地基只要比墙宽出一格，四个立面就全黑了。） */
      var holeSt = React.useState(false)
      var showHoles = holeSt[0], setShowHoles = holeSt[1]

      var viewsRef = React.useRef(null)
      /* 贴图加载完就把这个 +1，用来触发六视图重画（图是异步到的） */
      var texSt = React.useState(0)
      var texEpoch = texSt[0], setTexEpoch = texSt[1]
      /* 逐层视图当前看的是第几层 */
      var layerSt = React.useState(0)
      var layerY = layerSt[0], setLayerY = layerSt[1]

      function say(t, bad) { setMsg(String(t)); setIsErr(!!bad) }

      async function call(path, body) {
        /* 2026-09-21：有人点"创建"点了半天一直转圈，而服务端实测 50ms 就返回了。
           抓不到原因，起码别让它永远转 —— 加超时 + 把响应体原样拿回来看。 */
        var ctl = null, timer = null
        try {
          var opts = {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body || {}),
          }
          try {
            if (typeof AbortController === "function") {
              ctl = new AbortController()
              opts.signal = ctl.signal
              timer = setTimeout(function () { try { ctl.abort() } catch (e) { } }, 15000)
            }
          } catch (e) { ctl = null }
          var r = await fetch(API + "/mc/" + path, opts)
          var txt = await r.text()
          try { return JSON.parse(txt) } catch (e) {
            return { ok: false, error: "服务端回的不是 JSON（HTTP " + r.status + "）：" + String(txt).slice(0, 160) }
          }
        } catch (e) {
          var why = (e && e.name === "AbortError") ? "请求超时：15 秒没等到响应" : String((e && e.message) || e)
          return { ok: false, error: why, timedOut: !!(e && e.name === "AbortError") }
        } finally {
          if (timer) { try { clearTimeout(timer) } catch (e) { } }
        }
      }

      /* 把一条诊断送出去 —— 界面上出问题时，光看浏览器控制台是抓瞎的。
         两条路都发：
           · /mc/log           自己的路由，但要 DSH 重启过才在（live 重载不会重新 import 模块代码）
           · /wechat-ui/report wechat-ui 的现成上报口，本机一般都装着，马上能用
         哪个通了算哪个，都不通也不影响界面。 */
      function diag(tag, detail) {
        var payload = { tag: tag, detail: String(detail || "").slice(0, 600), ua: String((typeof navigator !== "undefined" && navigator && navigator.userAgent) || "").slice(0, 120) }
        try {
          fetch(API + "/mc/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(function () { })
        } catch (e) { }
        try {
          fetch(API + "/wechat-ui/report", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "mc-structure/" + tag, message: payload.detail, extra: { ua: payload.ua } }),
          }).catch(function () { })
        } catch (e) { }
      }

      /* 依次戳一遍所有端点，把结果摆出来，同时打进宿主半日志 */
      async function doSelfCheck() {
        say("自检中…")
        var rows = []
        var t0 = Date.now()
        var v = await call("files", {})
        rows.push("files: " + (v && v.ok ? "OK " + (Date.now() - t0) + "ms（文件 " + ((v.files && v.files.length) || 0) + " / 目录 " + ((v.folders && v.folders.length) || 0) + "）" : "FAIL " + ((v && v.error) || "?")))
        t0 = Date.now()
        var i = await call("info", {})
        rows.push("info: " + (i && i.ok ? "OK " + (Date.now() - t0) + "ms" : "FAIL " + ((i && i.error) || "?")))
        t0 = Date.now()
        var n = await call("new", { x: 16, y: 12, z: 16 })
        rows.push("new: " + (n && n.ok ? "OK " + (Date.now() - t0) + "ms → " + (n.size || []).join("×") : "FAIL " + ((n && n.error) || "?")))
        if (n && n.ok) applyData(n)
        var line = rows.join(" | ")
        say(line, /FAIL/.test(line))
        diag("selfcheck", line)
      }

      function applyData(d) {
        if (!d || !d.ok) { say(d && d.error ? d.error : "没有打开任何结构", true); setData(null); return }
        setData(d)
        if (!outPath && d.label) setOutPath(d.label + "-改.mcstructure")
      }

      async function doList(dir) {
        var r = await call("files", { dir: dir || undefined })
        if (r.ok) setListing(r); else say(r.error, true)
      }
      async function doOpen(p) {
        say("打开中…")
        applyData(await call("open", { path: p }))
        setTab("views")
      }
      async function doNew() {
        say("新建中…")
        var t0 = Date.now()
        var d = await call("new", { x: size.x, y: size.y, z: size.z })
        applyData(d)
        if (d && d.ok) {
          var took = Date.now() - t0
          say("建好了 " + (d.size || []).join("×") + "（服务端 " + took + "ms）")
          diag("new-ok", took + "ms " + (d.size || []).join("×"))
        } else {
          diag("new-fail", (d && d.error) || "unknown")
        }
        setTab("views")
      }
      async function doExport() {
        say("导出中…")
        var r = await call("export", { path: outPath })
        say(r.ok ? "已导出：" + r.path + "（" + r.bytes + " 字节）" : ("导出失败：" + r.error), !r.ok)
      }

      /* 结构一变就把用到的贴图加载一遍。
         同名只加载一次；加载完（不管成没成）再让六视图重画一次。 */
      React.useEffect(function () {
        if (!data || !data.ok) return
        loadTextures(data.textures, function () {
          setTexEpoch(function (n) { return n + 1 })
        })
      }, [data])

      /* 换结构时回到最底层，免得停在上一个结构的半空中 */
      React.useEffect(function () { setLayerY(0) }, [data])

      /* 画六视图 */
      React.useEffect(function () {
        var host = viewsRef.current
        if (!host || !data || !data.ok) return
        host.innerHTML = ""
        var paletteColors = data.palette.map(function (p) { return blockColor(p.name) })
        var paletteTextures = data.palette.map(function (p) { return texFor(p.name) })
        var struct = {
          size: data.size,
          indices: (function () {
            var out = new Int32Array(data.cells)
            var at = 0
            for (var i = 0; i < data.rle.length; i += 2) {
              for (var k = 0; k < data.rle[i + 1] && at < out.length; k++) out[at++] = data.rle[i]
            }
            return out
          })(),
        }
        var views = makeViews(data.size[0], data.size[1], data.size[2])
        var grid = document.createElement("div")
        grid.className = "mc-grid"
        host.appendChild(grid)

        /* 一个视图动辄几十万次 fillRect（256³ 光循环就一亿次）。
           以前六个一口气画完，主线程被占满 —— 表现就是"页面卡住不动"，
           连鼠标都拖不动。改成每个视图之间让出一次：
           页面始终活着，图一个个冒出来，卡也卡得有反馈。 */
        var cancelled = false
        var at = 0
        var raf = (typeof window !== "undefined" && window.requestAnimationFrame)
          ? function (f) { return window.requestAnimationFrame(f) }
          : function (f) { return setTimeout(f, 16) }

        function drawOne() {
          if (cancelled) return
          var v = views[at]
          var cell = document.createElement("div")
          cell.className = "mc-cell"
          var lab = document.createElement("div")
          lab.className = "lab"
          lab.textContent = v.label + "  " + v.w + "×" + v.h
          cell.appendChild(lab)
          try {
            cell.appendChild(renderView(struct, v, paletteColors, gridOn, showHoles, paletteTextures))
          } catch (e) {
            var w = document.createElement("div"); w.className = "mc-msg err"; w.textContent = String(e.message || e)
            cell.appendChild(w)
          }
          grid.appendChild(cell)
          at++
          if (at < views.length) raf(drawOne)
        }
        drawOne()

        return function () { cancelled = true }
      }, [data, gridOn, showHoles, texEpoch])

      /* ---------- 逐层剥开 ---------- */
      var layerRef = React.useRef(null)
      var layerDataSt = React.useState(null)
      var layerData = layerDataSt[0], setLayerData = layerDataSt[1]
      var layerErrSt = React.useState("")
      var layerErr = layerErrSt[0], setLayerErr = layerErrSt[1]

      /* 当前层的索引数据 —— 换层或换结构就重新拉一次 */
      React.useEffect(function () {
        if (!data || !data.ok) return
        var alive = true
        setLayerErr("")
        fetch(API + "/mc/layer?y=" + layerY, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }).then(function (r) { return r.json() })
          .then(function (j) {
            if (!alive) return
            if (j && j.ok) setLayerData(j)
            else setLayerErr((j && j.error) || "读不到这一层")
          })
          .catch(function (e) { if (alive) setLayerErr(String((e && e.message) || e)) })
        return function () { alive = false }
      }, [data, layerY])

      /* 把那一层画出来 */
      React.useEffect(function () {
        var host = layerRef.current
        if (!host || !layerData || !layerData.ok || !data || !data.ok) return
        host.innerHTML = ""
        try {
          var colors2 = data.palette.map(function (p) { return blockColor(p.name) })
          var texs2 = data.palette.map(function (p) { return texFor(p.name) })
          host.appendChild(drawLayer(layerData, colors2, texs2, { cap: 620, maxCell: 26 }))
        } catch (e) {
          var w2 = document.createElement("div"); w2.className = "mc-msg err"; w2.textContent = String((e && e.message) || e)
          host.appendChild(w2)
        }
      }, [layerData, texEpoch, data])

      /* 键盘 ↑↓ 换层 —— 一层层剥的时候手不用离开方向键 */
      React.useEffect(function () {
        if (tab !== "layers" || !data || !data.ok) return
        var maxY = data.size[1] - 1
        function onKey(e) {
          if (e.key === "ArrowUp") {
            setLayerY(function (y) { return Math.min(maxY, y + 1) })
            e.preventDefault()
          } else if (e.key === "ArrowDown") {
            setLayerY(function (y) { return Math.max(0, y - 1) })
            e.preventDefault()
          }
        }
        window.addEventListener("keydown", onKey)
        return function () { window.removeEventListener("keydown", onKey) }
      }, [tab, data])

      /* 打开面板时自动列一次目录 */
      React.useEffect(function () { if (!listing) doList() }, [])

      var styles = { display: tab === "views" ? "block" : "none" }

      return H("div", { className: "mc-mask", onClick: function (e) { if (e.target === e.currentTarget) props.onClose() } },
        H("div", { className: "mc-win" },
          H("div", { className: "mc-bar" },
            H("span", { className: "t" }, "⛏ 结构工作台" + (data && data.ok ? " · " + data.label + " [" + data.size.join("×") + "]" : "")),
            H("button", { className: "mc-btn" + (tab === "files" ? " p" : ""), onClick: function () { setTab("files"); doList(listing ? listing.dir : undefined) } }, "打开文件"),
            H("button", { className: "mc-btn" + (tab === "new" ? " p" : ""), onClick: function () { setTab("new") } }, "新建画布"),
            H("button", { className: "mc-btn" + (tab === "views" ? " p" : ""), onClick: function () { setTab("views") } }, "六视图"),
            H("button", { className: "mc-btn" + (tab === "layers" ? " p" : ""), onClick: function () { setTab("layers") } }, "逐层剥开"),
            H("button", { className: "mc-btn" + (tab === "export" ? " p" : ""), onClick: function () { setTab("export") } }, "导出"),
            H("button", { className: "mc-btn", onClick: props.onClose }, "关闭")),

          H("div", { className: "mc-body" },
            msg ? H("div", { className: "mc-msg" + (isErr ? " err" : ""), style: { marginBottom: 10 } }, msg) : null,

            /* ---- 六视图 ---- */
            H("div", { style: styles },
              data && data.ok
                ? H("div", null,
                    H("div", { className: "mc-row" },
                      H("label", { className: "mc-hint" },
                        H("input", { type: "checkbox", checked: gridOn, onChange: function (e) { setGridOn(e.target.checked) } }),
                        " 网格"),
                      H("label", { className: "mc-hint" },
                        H("input", { type: "checkbox", checked: showHoles, onChange: function (e) { setShowHoles(e.target.checked) } }),
                        " 标出空洞（把空的格子画成暗色，用来看立面上哪儿是空的）"),
                      H("span", { className: "mc-hint" }, data.cells + " 格 · 编辑 " + (data.edits || 0) + " 次")),
                    H("div", { ref: viewsRef }))
                : H("div", { className: "mc-empty" },
                    "还没有打开结构。",
                    H("br"), "点上面的「打开文件」选一个 .mcstructure，或者「新建画布」。")),

            /* ---- 逐层剥开 ---- */
            H("div", { style: { display: tab === "layers" ? "block" : "none" } },
              data && data.ok
                ? H("div", null,
                    H("div", { className: "mc-row" },
                      H("button", {
                        className: "mc-btn",
                        onClick: function () { setLayerY(Math.max(0, layerY - 1)) },
                      }, "▼ 下一层"),
                      H("input", {
                        type: "range", min: 0, max: data.size[1] - 1, value: layerY,
                        style: { flex: 1, minWidth: 140 },
                        onChange: function (e) { setLayerY(Number(e.target.value)) },
                      }),
                      H("button", {
                        className: "mc-btn",
                        onClick: function () { setLayerY(Math.min(data.size[1] - 1, layerY + 1)) },
                      }, "▲ 上一层"),
                      H("span", { className: "mc-hint" }, "y = " + layerY + " / " + (data.size[1] - 1))),
                    layerErr ? H("div", { className: "mc-msg err", style: { marginBottom: 8 } }, layerErr) : null,
                    H("div", { className: "mc-hint", style: { marginBottom: 8 } },
                      "空气是镂空的：一层层往下拖，就是从屋顶往下剥。键盘 ↑ ↓ 也能换层。"),
                    H("div", { ref: layerRef, className: "mc-layerhost" }))
                : H("div", { className: "mc-empty" }, "还没有打开结构。")),

            /* ---- 文件浏览 ---- */
            H("div", { style: { display: tab === "files" ? "block" : "none" } },
              H("div", { className: "mc-row" },
                H("span", { className: "mc-hint" }, listing ? listing.dir : ""),
                listing && listing.dir !== listing.root
                  ? H("button", { className: "mc-btn", onClick: function () { doList(listing.dir.replace(/[\\/][^\\/]+$/, "")) } }, "↑ 上一层")
                  : null),
              listing
                ? H("div", { className: "mc-list" },
                    listing.folders.map(function (f) {
                      return H("div", { key: f.path, onClick: function () { doList(f.path) } }, "📁 " + f.name)
                    }),
                    listing.files.map(function (f) {
                      return H("div", { key: f.path, onClick: function () { doOpen(f.path) } },
                        "🧱 " + f.name + "   (" + Math.round(f.size / 1024) + " KB)")
                    }))
                : H("div", { className: "mc-hint" }, "读取中…")),

            /* ---- 新建 ---- */
            H("div", { style: { display: tab === "new" ? "block" : "none" } },
              H("div", { className: "mc-row" },
                H("span", null, "X"), H("input", { type: "number", value: size.x, min: 1, max: 256, onChange: function (e) { setSize(Object.assign({}, size, { x: Number(e.target.value) })) } }),
                H("span", null, "Y（高）"), H("input", { type: "number", value: size.y, min: 1, max: 256, onChange: function (e) { setSize(Object.assign({}, size, { y: Number(e.target.value) })) } }),
                H("span", null, "Z"), H("input", { type: "number", value: size.z, min: 1, max: 256, onChange: function (e) { setSize(Object.assign({}, size, { z: Number(e.target.value) })) } }),
                H("button", { className: "mc-btn p", onClick: doNew }, "创建"),
                H("button", {
                  className: "mc-btn", onClick: doSelfCheck,
                  title: "依次戳一遍所有接口，结果会写进 DSH 日志，方便排查",
                }, "自检")),
              H("div", { className: "mc-hint" },
                "Y 是高度，y=0 是最底层。上限 256。" + H("br") +
                "建好之后可以让 DeepSeek 帮你搭 —— 直接跟它说「在 (0,0,0) 到 (15,0,15) 铺一层石砖」这种话。")),

            /* ---- 导出 ---- */
            H("div", { style: { display: tab === "export" ? "block" : "none" } },
              H("div", { className: "mc-row" },
                H("input", { className: "wide", value: outPath, onChange: function (e) { setOutPath(e.target.value) }, placeholder: "文件名，如 我的小屋.mcstructure" }),
                H("button", { className: "mc-btn p", onClick: doExport }, "导出到桌面")),
              H("div", { className: "mc-hint" },
                "导出到桌面目录下（只能是桌面及其子目录）。" + H("br") +
                "路径不写目录就是桌面根目录；同名文件会被覆盖。")))))
    }

    /* ============================ 浮动按钮 ============================ */

    function Launcher() {
      var openSt = React.useState(false)
      var open = openSt[0], setOpen = openSt[1]
      return H("div", null,
        H("div", { className: "mc-fab" },
          H("button", { title: "结构工作台（.mcstructure）", onClick: function () { setOpen(!open) } }, "⛏")),
        open ? H(McPanel, { onClose: function () { setOpen(false) } }) : null)
    }

    /* ============================ 错误边界 ============================ */

    class McGate extends React.Component {
      constructor(p) { super(p); this.state = { err: null } }
      static getDerivedStateFromError(err) { return { err: err } }
      componentDidCatch(err) { try { console.error("[mc-structure] 界面出错，已隔离：", err) } catch (e) { } }
      render() {
        if (this.state.err) {
          return H("div", { className: "mc-msg err", style: { position: "fixed", right: 16, bottom: 156, zIndex: 61, maxWidth: 280 } },
            "⚠ 结构工作台界面出错了，已隔离（DSH 其余功能正常）",
            H("div", { style: { marginTop: 4, opacity: .7, fontSize: 12 } }, String((this.state.err && this.state.err.message) || this.state.err)))
        }
        return this.props.children
      }
    }

    function SafeLauncher(props) { return H(McGate, null, H(Launcher, props)) }

    /* ============================ 挂载 ============================ */

    function apply(ctx) {
      injectCss()
      var slots = ctx.get("slots")
      if (!slots) {
        console.error("[mc-structure] slots 不可用，界面没挂上")
        return
      }
      slots.inject("shell.overlay", function () {
        return slots.register({ name: "shell.overlay", id: "mc-structure-launcher", order: 61 }, SafeLauncher)
      })
      console.log("[mc-structure] 界面已挂载（右下角 ⛏ 按钮）")
    }

    return {
      name: "mc-structure",
      inject: ["slots"],
      apply: apply,
      /* 给离线测试用：颜色推断和六视图渲染是纯逻辑，脱离浏览器也能验 */
      __test: { blockColor, makeViews, renderView, drawLayer, decodeRLE, loadTextures, McPanel: McPanel, Launcher: Launcher },
    }
  },
})
