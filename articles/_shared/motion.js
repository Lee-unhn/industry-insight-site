/* ------------------------------------------------------------------
   motion.js — 全站共用動效（純原生 JS，不引入動畫函式庫）
   放在各篇 ECharts／MapLibre <script> 之後、頁面自己的 <script> 之前，
   一行引用即可；它會自己載入同目錄的 motion.css。

   做的事（全部只改 transform／opacity，不改任何數字、圖表資料）：
   1. 數字計數：[data-count] 元素進入視窗時從 0 滾到終值（千分位、小數位、
      正負號照原字串保留）；[data-count-auto] 容器內的數字自動包成計數元素。
   2. 捲動進場：[data-reveal] 與文章頁的區塊卡片，淡入＋上浮 12px，
      同一層兄弟元素 stagger 60ms。只有第一屏之外的元素才會先藏起來。
   3. 導覽列：捲動後加 .mo-scrolled（毛玻璃與底線由各頁 CSS 定義）；
      頁頂閱讀進度條。
   4. ECharts：每張圖開 cubicOut 進場動畫；在第一屏之外的圖，捲到時重播。
   5. MapLibre：等時圈（ring5/10/15）與路網圖層由內而外逐層淡入。
   減少動態（prefers-reduced-motion）：以上全部關閉，數字直接顯示終值。
   列印：beforeprint 時全部顯示終值、展開 <details>。
   ------------------------------------------------------------------ */
(function () {
  "use strict";
  if (window.__motionLoaded) return;
  window.__motionLoaded = true;

  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var RM = !!(mq && mq.matches);
  var HAS_IO = "IntersectionObserver" in window;
  var root = document.documentElement;
  root.classList.add(RM ? "mo-reduced" : "mo-on");

  // ---------- 載入 motion.css（同目錄） ----------
  (function injectCss() {
    var cur = document.currentScript;
    if (!cur || !cur.src || document.querySelector("[data-motion-css]")) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cur.src.replace(/motion\.js(\?.*)?$/, "motion.css");
    link.setAttribute("data-motion-css", "");
    (document.head || root).appendChild(link);
  })();

  // =====================================================================
  // 1. 數字計數
  // =====================================================================
  // 一個數字字串：可帶正負號、千分位、小數。
  var NUM_RE = /[+\-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[+\-−]?\d+(?:\.\d+)?/g;

  function parseToken(s) {
    var t = String(s).trim();
    var sign = "";
    if (/^[+\-−]/.test(t)) {
      sign = t.charAt(0);
      t = t.slice(1);
    }
    if (!/^\d[\d,]*(\.\d+)?$/.test(t)) return null;
    var dec = (t.split(".")[1] || "").length;
    var comma = t.indexOf(",") >= 0;
    var v = parseFloat(t.replace(/,/g, ""));
    if (!isFinite(v)) return null;
    return { sign: sign, abs: v, dec: dec, comma: comma, raw: String(s).trim() };
  }

  function fmt(v, tok) {
    var s = v.toFixed(tok.dec);
    if (tok.comma) {
      var p = s.split(".");
      p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      s = p.join(".");
    }
    return tok.sign + s;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  function easeOutExpo(t) {
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  var counters = []; // {el, tok, done}

  function finishCounter(c) {
    if (c.raf) cancelAnimationFrame(c.raf);
    c.el.textContent = c.tok.raw;
    c.done = true;
  }

  function runCounter(c, delay) {
    if (c.done || c.running) return;
    c.running = true;
    var dur = c.tok.abs >= 1000 ? 1400 : 1000;
    var ease = c.tok.abs >= 1000 ? easeOutExpo : easeOutCubic;
    var start = null;
    function step(ts) {
      if (start === null) start = ts + (delay || 0);
      var t = Math.max(0, Math.min(1, (ts - start) / dur));
      if (t >= 1) {
        finishCounter(c);
        return;
      }
      c.el.textContent = fmt(c.tok.abs * ease(t), c.tok);
      c.raf = requestAnimationFrame(step);
    }
    c.raf = requestAnimationFrame(step);
  }

  function prepCounter(el) {
    if (el.__moCount) return null;
    var raw = el.getAttribute("data-count-value") || el.textContent;
    var tok = parseToken(raw);
    if (!tok) return null;
    tok.raw = el.textContent.trim();
    el.__moCount = true;
    el.classList.add("mo-count");
    var c = { el: el, tok: tok, done: false };
    counters.push(c);
    if (RM) {
      c.done = true;
      return c;
    }
    // 固定寬度，數字變動時不推擠旁邊的字
    var w = el.getBoundingClientRect().width;
    if (w > 0) el.style.minWidth = Math.ceil(w) + "px";
    var r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) {
      // 第一屏：立刻從 0 開始
      el.textContent = fmt(0, tok);
      runCounter(c, Number(el.getAttribute("data-count-delay")) || 0);
    } else if (HAS_IO) {
      el.textContent = fmt(0, tok);
      countIO.observe(el);
    } else {
      c.done = true;
    }
    return c;
  }

  var countIO = HAS_IO
    ? new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            countIO.unobserve(e.target);
            for (var i = 0; i < counters.length; i++) {
              if (counters[i].el === e.target) {
                runCounter(counters[i], Number(e.target.getAttribute("data-count-delay")) || 0);
                break;
              }
            }
          });
        },
        { threshold: 0.4 }
      )
    : null;

  // 年份、代碼、單一位數、「5 分圈」這類不值得滾動的數字略過
  function worthCounting(tok, after) {
    if (!tok) return false;
    if (!tok.comma && tok.dec === 0 && tok.abs < 10) return false;
    if (!tok.comma && tok.dec === 0 && tok.abs >= 1900 && tok.abs <= 2100) return false;
    if (/^\s*(分|年|月|號|篇)/.test(after)) return false;
    return true;
  }

  // 容器內的文字數字自動包成 <span data-count>
  function autoWrap(container) {
    if (container.__moWrapped) return;
    container.__moWrapped = true;
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!p || p.closest("abbr, a, script, style, .mo-count, [data-no-count]")) return NodeFilter.FILTER_REJECT;
        return /\d/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      var frag = document.createDocumentFragment();
      var last = 0;
      var m;
      var changed = false;
      NUM_RE.lastIndex = 0;
      while ((m = NUM_RE.exec(text))) {
        var tok = parseToken(m[0]);
        var before = text.charAt(m.index - 1);
        if (/[A-Za-z0-9.]/.test(before)) continue; // 代碼的一部分
        if (!worthCounting(tok, text.slice(m.index + m[0].length))) continue;
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var span = document.createElement("span");
        span.setAttribute("data-count", "");
        span.textContent = m[0];
        frag.appendChild(span);
        last = m.index + m[0].length;
        changed = true;
      }
      if (!changed) return;
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function scanCounters(scope) {
    var s = scope || document;
    s.querySelectorAll("[data-count-auto]").forEach(autoWrap);
    s.querySelectorAll("[data-count]").forEach(prepCounter);
  }

  // =====================================================================
  // 2. 捲動進場
  // =====================================================================
  var REVEAL_AUTO =
    // 文章頁（articles/*/index.html）常見區塊
    "body > main > section, body > main > .card, body > .wrap > section, body > .wrap > .card, " +
    ".grid > .card, .charts > .card, .chart-grid > .card, section.keyfacts";

  var revealIO = HAS_IO && !RM
    ? new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            e.target.classList.add("mo-in");
            revealIO.unobserve(e.target);
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px -6% 0px" }
      )
    : null;

  function prepReveal(el, idx) {
    if (el.__moReveal) return;
    el.__moReveal = true;
    if (!revealIO) return;
    var r = el.getBoundingClientRect();
    // 第一屏內的元素不藏：頁面靜止狀態一定完整
    if (r.top < window.innerHeight * 0.92) return;
    el.style.setProperty("--mo-delay", Math.min(idx, 8) * 60 + "ms");
    el.classList.add("mo-reveal");
    revealIO.observe(el);
  }

  function scanReveal(scope) {
    var s = scope || document;
    var list = [];
    s.querySelectorAll("[data-reveal]").forEach(function (el) {
      list.push(el);
    });
    if (!document.querySelector("[data-motion-site]")) {
      s.querySelectorAll(REVEAL_AUTO).forEach(function (el) {
        if (list.indexOf(el) < 0 && !el.closest(".mo-reveal")) list.push(el);
      });
    }
    // 同一個父層的兄弟依序 stagger
    var groups = new Map();
    list.forEach(function (el) {
      var p = el.parentNode;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(el);
    });
    groups.forEach(function (els) {
      var i = 0;
      els.forEach(function (el) {
        if (!el.__moReveal) prepReveal(el, el.hasAttribute("data-reveal-solo") ? 0 : i++);
      });
    });
  }

  // =====================================================================
  // 3. 導覽列狀態＋閱讀進度條
  // =====================================================================
  var bar = null;
  var header = null;
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY || root.scrollTop;
      if (header) header.classList.toggle("mo-scrolled", y > 8);
      if (bar) {
        var max = Math.max(1, root.scrollHeight - window.innerHeight);
        bar.style.transform = "scaleX(" + Math.min(1, Math.max(0, y / max)).toFixed(4) + ")";
      }
    });
  }

  function setupChrome() {
    header = document.querySelector(".site-header, [data-motion-header]");
    var inFrame = false;
    try {
      inFrame = window.self !== window.top;
    } catch (e) {
      inFrame = true;
    }
    if (!inFrame && !document.querySelector(".mo-progress")) {
      bar = document.createElement("div");
      bar.className = "mo-progress";
      bar.setAttribute("aria-hidden", "true");
      document.body.appendChild(bar);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll();
  }

  // =====================================================================
  // 4. ECharts：cubicOut 進場；第一屏之外的圖捲到時重播
  // =====================================================================
  var chartSeq = 0;
  function patchEcharts(ec) {
    if (!ec || ec.__moPatched || typeof ec.init !== "function") return;
    ec.__moPatched = true;
    var origInit = ec.init;
    ec.init = function () {
      var chart = origInit.apply(this, arguments);
      var dom = arguments[0];
      var seq = chartSeq++;
      var origSet = chart.setOption;
      var calls = 0;
      var firstOpt = null;
      chart.setOption = function (opt) {
        calls++;
        if (opt && typeof opt === "object" && !Array.isArray(opt)) {
          if (RM) {
            opt.animation = false;
          } else if (calls === 1 && opt.animation !== false) {
            opt.animation = true;
            if (!opt.animationEasing) opt.animationEasing = "cubicOut";
            if (!opt.animationDuration) opt.animationDuration = 900;
            if (opt.animationDelay === undefined) opt.animationDelay = function (i) {
              return 120 + (seq % 4) * 80 + Math.min(i, 30) * 18;
            };
            if (!opt.animationEasingUpdate) opt.animationEasingUpdate = "cubicOut";
            firstOpt = opt;
          }
        }
        return origSet.apply(this, arguments);
      };
      // 第一屏之外：捲到時重播一次進場（期間若頁面自己又 setOption 過就不重播）
      if (!RM && HAS_IO && dom && dom.getBoundingClientRect) {
        var r = dom.getBoundingClientRect();
        if (r.top > window.innerHeight) {
          var io = new IntersectionObserver(
            function (entries) {
              if (!entries[0].isIntersecting) return;
              io.disconnect();
              if (calls !== 1 || !firstOpt || chart.isDisposed && chart.isDisposed()) return;
              try {
                chart.clear();
                origSet.call(chart, firstOpt, true);
              } catch (e) {
                /* 重播失敗就保持原圖 */
              }
            },
            { threshold: 0.25 }
          );
          io.observe(dom);
        }
      }
      return chart;
    };
  }

  // =====================================================================
  // 5. MapLibre：等時圈由內而外逐層淡入
  // =====================================================================
  var LAYER_ORDER = [
    { re: /^roads?-/, delay: 0 },
    { re: /^ring5-/, delay: 260 },
    { re: /^ring10-/, delay: 560 },
    { re: /^ring15-/, delay: 860 },
  ];
  function patchMaplibre(ml) {
    if (!ml || ml.__moPatched || typeof ml.Map !== "function") return;
    ml.__moPatched = true;
    if (RM) return;
    var Orig = ml.Map;
    var Patched;
    try {
      Patched = class extends Orig {
        constructor(opts) {
          var pending = [];
          try {
            var st = opts && opts.style;
            if (st && typeof st === "object" && Array.isArray(st.layers)) {
              st.layers.forEach(function (ly) {
                if (!ly || (ly.type !== "line" && ly.type !== "fill")) return;
                for (var i = 0; i < LAYER_ORDER.length; i++) {
                  if (LAYER_ORDER[i].re.test(ly.id)) {
                    var key = ly.type + "-opacity";
                    ly.paint = ly.paint || {};
                    var target = ly.paint[key] === undefined ? 1 : ly.paint[key];
                    if (typeof target !== "number") return; // 資料驅動的不動
                    ly.paint[key] = 0;
                    ly.paint[key + "-transition"] = { duration: 700, delay: 0 };
                    pending.push({ id: ly.id, key: key, target: target, delay: LAYER_ORDER[i].delay });
                    return;
                  }
                }
              });
            }
          } catch (e) {
            pending = [];
          }
          super(opts);
          var map = this;
          if (pending.length) {
            map.once("load", function () {
              pending.forEach(function (p) {
                setTimeout(function () {
                  try {
                    if (map.getLayer(p.id) && map.getPaintProperty(p.id, p.key) === 0) {
                      map.setPaintProperty(p.id, p.key, p.target);
                    }
                  } catch (e) {
                    /* 圖層被頁面移除就略過 */
                  }
                }, 150 + p.delay);
              });
            });
            // 保險：3 秒後還沒淡入（load 沒觸發）就直接設回原值
            setTimeout(function () {
              pending.forEach(function (p) {
                try {
                  if (map.getLayer(p.id) && map.getPaintProperty(p.id, p.key) === 0) {
                    map.setPaintProperty(p.id, p.key, p.target);
                  }
                } catch (e) {}
              });
            }, 3500);
          }
        }
      };
      ml.Map = Patched;
    } catch (e) {
      /* 不支援 class extends 的環境就不做 */
    }
  }

  // 已經載入的話直接 patch；還沒載入就攔截全域賦值
  function hookGlobal(name, patch) {
    if (window[name]) {
      patch(window[name]);
      return;
    }
    var val;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () {
          return val;
        },
        set: function (v) {
          val = v;
          try {
            patch(v);
          } catch (e) {}
        },
      });
    } catch (e) {}
  }
  hookGlobal("echarts", patchEcharts);
  hookGlobal("maplibregl", patchMaplibre);

  // =====================================================================
  // 列印：全部終值、展開摺疊
  // =====================================================================
  function finishAll() {
    counters.forEach(function (c) {
      finishCounter(c);
    });
    document.querySelectorAll(".mo-reveal").forEach(function (el) {
      el.classList.add("mo-in");
    });
  }
  var openedForPrint = [];
  window.addEventListener("beforeprint", function () {
    finishAll();
    document.querySelectorAll("details:not([open])").forEach(function (d) {
      d.setAttribute("open", "");
      openedForPrint.push(d);
    });
  });
  window.addEventListener("afterprint", function () {
    openedForPrint.forEach(function (d) {
      d.removeAttribute("open");
    });
    openedForPrint = [];
  });
  // 模擬列印（媒體查詢切到 print）時同樣處理
  var pq = window.matchMedia ? window.matchMedia("print") : null;
  if (pq && pq.addEventListener) {
    pq.addEventListener("change", function (e) {
      if (!e.matches) return;
      finishAll();
      document.querySelectorAll("details:not([open])").forEach(function (d) {
        d.setAttribute("open", "");
        openedForPrint.push(d);
      });
    });
  }
  if (mq && mq.addEventListener) {
    mq.addEventListener("change", function (e) {
      if (e.matches) finishAll();
    });
  }

  // =====================================================================
  // 啟動
  // =====================================================================
  function scanAll(scope) {
    scanCounters(scope);
    scanReveal(scope);
  }
  // =====================================================================
  // 事實句 → 數字＋短標籤
  // =====================================================================
  // 一條事實句拆成主數字／單位／標籤／補述（與站台 site/src/lib/factParts.ts
  // 同一套規則，改一邊要同步改另一邊）。數字取自原句，不改值。
  // evidence（選填）：[{label, value, unit}]，有的話用值去原句找對應數字、標籤用它的短標籤。
  var FACT_NUM_RE = /[+\-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[+\-−]?\d+(?:\.\d+)?/g;
  var FACT_UNITS = [
    "元/坪/月", "千元/年", "人次/天", "萬元/月", "人/天", "元/坪", "個月", "公尺",
    "人次", "千元", "萬元", "%", "家", "人", "戶", "元", "倍", "個", "處", "筆", "天"
  ];
  function factTokens(s) {
    var out = [];
    var m;
    FACT_NUM_RE.lastIndex = 0;
    while ((m = FACT_NUM_RE.exec(s))) {
      if (/[A-Za-z0-9.]/.test(s.charAt(m.index - 1))) continue;
      var t = m[0].replace(/^[+\-−]/, "");
      var pre = s.slice(0, m.index);
      var depth = (pre.match(/[（(]/g) || []).length - (pre.match(/[）)]/g) || []).length;
      out.push({
        text: m[0], start: m.index, end: m.index + m[0].length,
        abs: parseFloat(t.replace(/,/g, "")), dec: (t.split(".")[1] || "").length,
        comma: t.indexOf(",") >= 0, depth: depth
      });
    }
    return out;
  }
  function factUnitAt(after) {
    var lead = /^\s*/.exec(after)[0].length;
    var rest = after.slice(lead);
    for (var i = 0; i < FACT_UNITS.length; i++) {
      if (rest.indexOf(FACT_UNITS[i]) === 0) return { unit: FACT_UNITS[i], len: lead + FACT_UNITS[i].length };
    }
    return { unit: "", len: 0 };
  }
  function factCandidate(s, k) {
    if (k.depth > 0) return false;
    var after = s.slice(k.end);
    if (/^\s*(分|年|月|號|篇|歲|-)/.test(after)) return false;
    if (!k.comma && k.dec === 0 && k.abs < 10) return false;
    if (!k.comma && k.dec === 0 && k.abs >= 1900 && k.abs <= 2100) return false;
    return factUnitAt(after).unit !== "" || k.dec > 0;
  }
  function splitFact(fact, evidence, used) {
    var toks = factTokens(fact);
    var pick = null;
    var ev = null;
    evidence = evidence || [];
    used = used || {};
    for (var ti = 0; ti < toks.length && !ev; ti++) {
      for (var ei = 0; ei < evidence.length; ei++) {
        var step = Math.pow(10, -toks[ti].dec);
        if (!used[ei] && Math.abs(toks[ti].abs - Math.abs(evidence[ei].value)) <= step * 0.51 + 1e-9) {
          ev = evidence[ei];
          used[ei] = true;
          pick = toks[ti];
          break;
        }
      }
    }
    var clauseStart = 0;
    for (var i = 0; i <= fact.length && !pick && !ev; i++) {
      if (i === fact.length || /[，、；]/.test(fact.charAt(i))) {
        var inClause = toks.filter(function (t) {
          return t.start >= clauseStart && t.start < i && factCandidate(fact, t);
        });
        if (inClause.length) {
          var last = inClause[inClause.length - 1];
          pick = last;
          if (/～\s*$/.test(fact.slice(0, last.start))) {
            var prev = toks.filter(function (t) { return t.end <= last.start; }).pop();
            if (prev) pick = prev;
          }
        }
        clauseStart = i + 1;
      }
    }
    if (!pick) pick = toks.filter(function (t) { return t.depth === 0; })[0] || null;
    if (!pick) return { num: "", unit: "", label: fact, sub: "" };
    var rm = /^\s*～\s*(\d[\d,]*(?:\.\d+)?)/.exec(fact.slice(pick.end));
    var num = pick.text;
    var end = pick.end;
    if (rm) {
      end = pick.end + rm[0].length;
      num = fact.slice(pick.start, end).replace(/\s+/g, "");
    }
    var u = factUnitAt(fact.slice(end));
    var rest = fact.slice(end + u.len);
    var tailM = /^\s*([^，、；：（(\s0-9][^，、；：（(0-9]*?)(?=[，、；：（(]|$)/.exec(rest);
    var tail = u.unit && tailM ? tailM[1].trim() : "";
    if (tail) rest = rest.slice(tailM[0].length);
    var label = ev ? ev.label : fact
      .slice(0, pick.start)
      .replace(/[，、；：\s]+$/, "")
      .replace(/([\s，]為|的|是|共|約|有|還有|合計約)$/, "")
      .replace(/[，、；：\s]+$/, "")
      .trim() + tail;
    if (ev) label = ev.label;
    var sub = rest.replace(/^[，、；：\s]+/, "");
    var pm = /^[（(]([^）)]*)[）)][，、；]?\s*/.exec(sub);
    if (pm) sub = pm[1] + (sub.length > pm[0].length ? "；" + sub.slice(pm[0].length) : "");
    sub = sub.trim();
    if (!label) {
      label = sub;
      sub = "";
    }
    return { num: num, unit: u.unit || (ev ? ev.unit : ""), label: label, sub: sub };
  }

  function splitFacts(facts, evidence) {
    var used = {};
    return (facts || []).map(function (f) {
      return splitFact(f, evidence, used);
    });
  }

  window.Motion = {
    scan: scanAll,
    splitFact: splitFact,
    splitFacts: splitFacts,
    finishAll: finishAll,
    reduced: RM,
    /** 把元素的數字從目前值滾到新值（試算器用） */
    tween: function (el, toText, dur) {
      var to = parseToken(toText);
      if (!el) return;
      if (RM || !to) {
        el.textContent = toText;
        return;
      }
      var from = parseToken(el.textContent);
      var fromV = from ? (from.sign === "-" || from.sign === "−" ? -from.abs : from.abs) : 0;
      var toV = to.sign === "-" || to.sign === "−" ? -to.abs : to.abs;
      if (el.__moTween) cancelAnimationFrame(el.__moTween);
      var d = dur || 480;
      var start = null;
      function step(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / d);
        var v = fromV + (toV - fromV) * easeOutCubic(t);
        if (t >= 1) {
          el.textContent = toText;
          return;
        }
        var sign = v < 0 ? (to.sign === "−" ? "−" : "-") : to.sign === "+" ? "+" : "";
        el.textContent = fmt(Math.abs(v), { sign: sign, dec: to.dec, comma: to.comma });
        el.__moTween = requestAnimationFrame(step);
      }
      el.__moTween = requestAnimationFrame(step);
    },
  };

  function init() {
    setupChrome();
    scanAll(document);
    document.addEventListener("motion:scan", function (e) {
      scanAll(e.detail && e.detail.scope ? e.detail.scope : document);
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
