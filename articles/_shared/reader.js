/* ------------------------------------------------------------------
   reader.js — 白話閱讀層（純原生 JS，無依賴）
   (a) 自動把頁面文字中出現的術語包成 <abbr class="term">，
       點／hover／focus 顯示白話 tooltip；手機可點；Esc 關閉；一次只開一個。
   (b) 把「方法說明」與「誠實揭露」包成 <details class="method">（HTML 端已改標籤，
       這裡只補：確保各篇原本用 <h2>方法說明</h2> 的殘留頁面也能運作）。
   (d) 資料出處：讀本篇 ./data.json 的 provenance（機構／資料集／年度／網址），
       在「怎麼算的」區塊尾端加一張「資料出處」表；沒有該欄就安靜略過。
   (c) 重點數字契約：讀 ../_shared/verdicts.json，若有本篇 slug 就在 <h1> 下方插入
       <section class="keyfacts">（headline + 三條 facts + note + 固定說明）；
       沒有該檔或該 slug 就安靜略過。
   只在 h1-h4 / p / li / th / td / class 含 "sub" 或 "note" 的元素內找術語；
   不動 canvas / svg / script；同一術語每個區塊只標記第一次。
   ------------------------------------------------------------------ */
(function () {
  "use strict";

  var TERM_BLOCK_SELECTOR = 'h1,h2,h3,h4,p,li,th,td,[class*="sub"],[class*="note"]';
  var SKIP_ANCESTOR_SELECTOR = "script,style,svg,canvas,button,abbr.term";

  var glossaryPromise = null;
  var termRegex = null;
  var termKeysSorted = null;

  function loadGlossary() {
    if (glossaryPromise) return glossaryPromise;
    glossaryPromise = fetch("../_shared/glossary.json")
      .then(function (res) {
        if (!res.ok) throw new Error("glossary.json " + res.status);
        return res.json();
      })
      .catch(function () {
        return {};
      });
    return glossaryPromise;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildRegex(glossary) {
    var keys = Object.keys(glossary).filter(function (k) {
      return k && k.length > 0;
    });
    // 長字串優先比對，避免短詞先吃掉長詞的一部分（例：「每坪」要贏「坪」）。
    keys.sort(function (a, b) { return b.length - a.length; });
    termKeysSorted = keys;
    if (!keys.length) return null;
    return new RegExp("(" + keys.map(escapeRegExp).join("|") + ")", "g");
  }

  function wrapTermsInBlock(el, glossary) {
    if (!termRegex) return;
    if (el.closest(SKIP_ANCESTOR_SELECTOR)) return;
    var seen = Object.create(null);
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest(SKIP_ANCESTOR_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach(function (node) {
      var text = node.nodeValue;
      termRegex.lastIndex = 0;
      var match;
      var last = 0;
      var frag = null;
      while ((match = termRegex.exec(text))) {
        var term = match[1];
        if (seen[term]) continue; // 同一區塊只標第一次
        seen[term] = true;
        if (!frag) frag = document.createDocumentFragment();
        frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        var abbr = document.createElement("abbr");
        abbr.className = "term";
        abbr.tabIndex = 0;
        abbr.setAttribute("aria-expanded", "false");
        abbr.dataset.term = term;
        abbr.textContent = term;
        frag.appendChild(abbr);
        last = match.index + term.length;
      }
      if (frag) {
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    });
  }

  function scanAll(root, glossary) {
    if (!termRegex) return;
    var candidates = [];
    if (root.nodeType === 1 && root.matches && root.matches(TERM_BLOCK_SELECTOR)) {
      candidates.push(root);
    }
    if (root.querySelectorAll) {
      root.querySelectorAll(TERM_BLOCK_SELECTOR).forEach(function (el) {
        candidates.push(el);
      });
    }
    candidates.forEach(function (el) {
      if (el.dataset.termScanned) return;
      el.dataset.termScanned = "1";
      wrapTermsInBlock(el, glossary);
    });
  }

  // ---------------------------------------------------------------
  // Tooltip（單一共用元件，click / hover / focus 都會叫用；Esc 關閉；一次只開一個）
  // ---------------------------------------------------------------
  var tooltipEl = null;
  var openAbbr = null;

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.id = "term-tooltip";
    tooltipEl.setAttribute("role", "tooltip");
    tooltipEl.hidden = true;
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function tipContentFor(term, glossary) {
    var entry = glossary[term];
    if (!entry) return null;
    var html = "";
    html += entry.plain ? entry.plain : "";
    if (entry.extra) html += '<span class="tip-extra">' + entry.extra + "</span>";
    return html;
  }

  function positionTooltip(abbr) {
    var tip = ensureTooltip();
    var rect = abbr.getBoundingClientRect();
    // 先量測（暫時放在視窗內、不可見的地方不會影響 layout，因為是 position:fixed）
    var tipRect = tip.getBoundingClientRect();
    var margin = 8;
    var top = rect.bottom + 8;
    if (top + tipRect.height > window.innerHeight - margin) {
      top = rect.top - tipRect.height - 8;
      if (top < margin) top = margin;
    }
    var left = rect.left;
    var maxLeft = window.innerWidth - tipRect.width - margin;
    if (left > maxLeft) left = Math.max(margin, maxLeft);
    if (left < margin) left = margin;
    tip.style.top = top + "px";
    tip.style.left = left + "px";
  }

  function showTooltip(abbr, glossary) {
    var content = tipContentFor(abbr.dataset.term, glossary);
    if (!content) return;
    if (openAbbr && openAbbr !== abbr) hideTooltip();
    var tip = ensureTooltip();
    tip.innerHTML = content;
    tip.hidden = false;
    openAbbr = abbr;
    abbr.setAttribute("aria-expanded", "true");
    positionTooltip(abbr);
  }

  function hideTooltip() {
    if (!openAbbr) return;
    openAbbr.setAttribute("aria-expanded", "false");
    openAbbr = null;
    if (tooltipEl) tooltipEl.hidden = true;
  }

  function setupTooltipEvents(glossary) {
    document.addEventListener(
      "click",
      function (e) {
        var abbr = e.target.closest && e.target.closest("abbr.term");
        if (abbr) {
          e.stopPropagation();
          if (openAbbr === abbr) {
            hideTooltip();
          } else {
            showTooltip(abbr, glossary);
          }
          return;
        }
        if (!e.target.closest || !e.target.closest("#term-tooltip")) hideTooltip();
      },
      true
    );

    document.addEventListener("mouseover", function (e) {
      var abbr = e.target.closest && e.target.closest("abbr.term");
      if (abbr) showTooltip(abbr, glossary);
    });
    document.addEventListener("mouseout", function (e) {
      var abbr = e.target.closest && e.target.closest("abbr.term");
      if (abbr && (!e.relatedTarget || !abbr.contains(e.relatedTarget))) hideTooltip();
    });

    document.addEventListener("focusin", function (e) {
      var abbr = e.target.closest && e.target.closest("abbr.term");
      if (abbr) showTooltip(abbr, glossary);
    });
    document.addEventListener("focusout", function (e) {
      var abbr = e.target.closest && e.target.closest("abbr.term");
      if (abbr) hideTooltip();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openAbbr) {
        var a = openAbbr;
        hideTooltip();
        a.blur();
      }
    });

    window.addEventListener("resize", function () {
      if (openAbbr) positionTooltip(openAbbr);
    });
    window.addEventListener(
      "scroll",
      function () {
        if (openAbbr) positionTooltip(openAbbr);
      },
      true
    );
  }

  // ---------------------------------------------------------------
  // 方法說明 / 誠實揭露：保底轉換（正常情況下 index.html 已直接用
  // <details class="method">，這裡只處理殘留 <section class="method"> 的頁面）
  // ---------------------------------------------------------------
  function ensureMethodDetails() {
    document.querySelectorAll("section.method, .card.method").forEach(function (sec) {
      if (sec.tagName === "DETAILS") return;
      var details = document.createElement("details");
      details.className = sec.className;
      var summary = document.createElement("summary");
      summary.textContent = "怎麼算的（方法與資料限制）";
      details.appendChild(summary);
      var h2 = sec.querySelector(":scope > h2");
      if (h2) h2.remove();
      while (sec.firstChild) details.appendChild(sec.firstChild);
      sec.replaceWith(details);
    });
  }

  // ---------------------------------------------------------------
  // 重點數字契約
  // ---------------------------------------------------------------
  function currentSlug() {
    var parts = window.location.pathname.split("/").filter(function (p) {
      return p && p !== "index.html";
    });
    return parts.length ? parts[parts.length - 1] : "";
  }

  // 固定說明：與 site/src/config.ts 的 DATA_ONLY_NOTE 同一句，改字兩邊一起改。
  var DATA_ONLY_NOTE =
    "本站只整理公開資料與計算方法，不對任何地點或業種下結論；每個數字怎麼算的、出處在哪，都寫在『怎麼算的』。";

  function renderKeyFacts(v) {
    var h1 = document.querySelector("h1");
    if (!h1) return;
    var section = document.createElement("section");
    section.className = "keyfacts";

    var title = document.createElement("div");
    title.className = "keyfacts-title";
    title.textContent = "重點數字";
    section.appendChild(title);

    var headline = document.createElement("p");
    headline.className = "keyfacts-headline";
    headline.textContent = v.headline || "";
    section.appendChild(headline);

    if (Array.isArray(v.facts) && v.facts.length) {
      // 每條事實排成「數字＋短標籤」：數字取自原句，不改值
      var ul = document.createElement("ul");
      ul.className = "keyfacts-list kf-grid";
      v.facts.slice(0, 3).forEach(function (r) {
        var p = splitFact(r);
        var li = document.createElement("li");
        li.title = r;
        var num = document.createElement("span");
        num.className = "kf-num";
        if (p.num) {
          var n = document.createElement("span");
          n.setAttribute("data-count", "");
          n.textContent = p.num;
          num.appendChild(n);
        }
        if (p.unit) {
          var u = document.createElement("small");
          u.className = "kf-unit";
          u.textContent = p.unit;
          num.appendChild(u);
        }
        var lab = document.createElement("span");
        lab.className = "kf-label";
        lab.textContent = p.label + (p.sub ? "．" + p.sub : "");
        li.appendChild(num);
        li.appendChild(lab);
        ul.appendChild(li);
      });
      section.appendChild(ul);
    }

    if (v.note) {
      var note = document.createElement("p");
      note.className = "keyfacts-note";
      note.textContent = "資料限制：" + v.note;
      section.appendChild(note);
    }

    var disclaimer = document.createElement("p");
    disclaimer.className = "keyfacts-disclaimer";
    disclaimer.textContent = DATA_ONLY_NOTE;
    section.appendChild(disclaimer);

    h1.insertAdjacentElement("afterend", section);
    // 通知 motion.js 掃描新插入的數字（沒載 motion.js 時無作用）
    try {
      document.dispatchEvent(new CustomEvent("motion:scan", { detail: { scope: section } }));
    } catch (e) {}
  }

  // 一條事實句拆成主數字／單位／標籤／補述：規則放在 motion.js（Motion.splitFact，
  // 與站台 site/src/lib/factParts.ts 同一套）；沒載 motion.js 時整句當標籤。
  function splitFact(fact) {
    if (window.Motion && typeof window.Motion.splitFact === "function") return window.Motion.splitFact(fact);
    return { num: "", unit: "", label: fact, sub: "" };
  }

  function setupKeyFacts() {
    var slug = currentSlug();
    if (!slug) return;
    fetch("../_shared/verdicts.json")
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        // 兩種包法都吃：頂層 {slug: …} 或 {version, verdicts: {slug: …}}
        var table = data && data.verdicts && typeof data.verdicts === "object" ? data.verdicts : data;
        var rec = null;
        if (Array.isArray(table)) {
          for (var i = 0; i < table.length; i++) {
            if (table[i] && table[i].slug === slug) { rec = table[i]; break; }
          }
        } else if (table) {
          rec = table[slug] || null;
        }
        if (!rec) return; // 沒有該檔或該 slug，安靜略過
        renderKeyFacts(rec);
      })
      .catch(function () {
        /* 沒有 verdicts.json 就安靜略過 */
      });
  }

  // ---------------------------------------------------------------
  // 資料出處表（data.json#provenance → 「怎麼算的」區塊尾端）
  // ---------------------------------------------------------------
  function safeUrl(u) {
    return /^https?:\/\//i.test(u || "") ? u : "";
  }

  function renderProvenance(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    var host = document.querySelector("details.method") || document.querySelector(".method");
    if (!host || host.querySelector(".provenance")) return;
    var wrap = document.createElement("div");
    wrap.className = "provenance";
    var h = document.createElement("h3");
    h.className = "provenance-title";
    h.textContent = "資料出處";
    wrap.appendChild(h);
    var scroller = document.createElement("div");
    scroller.className = "provenance-scroll";
    var table = document.createElement("table");
    table.className = "provenance-table";
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    ["機構", "資料集", "年度／版本", "網址"].forEach(function (t) {
      var th = document.createElement("th");
      th.textContent = t;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      [r.agency || "", r.dataset || "", r.year || ""].forEach(function (t) {
        var td = document.createElement("td");
        td.textContent = t;
        tr.appendChild(td);
      });
      var tdu = document.createElement("td");
      var url = safeUrl(r.url);
      if (url) {
        var a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = url;
        tdu.appendChild(a);
      } else {
        tdu.textContent = "—";
      }
      tr.appendChild(tdu);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroller.appendChild(table);
    wrap.appendChild(scroller);
    host.appendChild(wrap);
  }

  function setupProvenance() {
    fetch("./data.json")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (d) {
        if (d && d.provenance) renderProvenance(d.provenance);
      })
      .catch(function () {
        /* 沒有 data.json 就安靜略過 */
      });
  }

  // ---------------------------------------------------------------
  // 啟動：初次掃描 + MutationObserver 追蹤各篇非同步塞入的內容
  // ---------------------------------------------------------------
  function init() {
    ensureMethodDetails();
    setupKeyFacts();
    setupProvenance();

    loadGlossary().then(function (glossary) {
      termRegex = buildRegex(glossary);
      if (!termRegex) return;

      setupTooltipEvents(glossary);
      scanAll(document.body, glossary);

      var scanTimer = null;
      var observer = new MutationObserver(function () {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(function () {
          ensureMethodDetails();
          scanAll(document.body, glossary);
        }, 150);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // 保底：各篇資料是 fetch 後才灌進 DOM，MutationObserver 理論上會追到，
      // 但加一個延遲重掃當保險，避免極端時序漏標。
      setTimeout(function () {
        scanAll(document.body, glossary);
      }, 1500);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
