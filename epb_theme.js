/* ============================================================================
   Energy Price Board — shared runtime (2026)
   SOURCE FILE. apply_theme.py inlines it into every .html between the
   EPB-THEME markers; the page generators embed it too. No build step, no deps.

   Everything here degrades safely: a page that never calls a helper still
   gets the theme toggle, the keyboard shortcuts and the accordion.

   NOTE on animation: functional state is never left to a CSS transition.
   Anything that must end in a given state is driven by JS + setTimeout, so a
   browser that throttles animations still ends up with a usable page.
   ========================================================================= */
(function (window, document) {
  'use strict';

  var EPB = window.EPB || (window.EPB = {});

  /* Mark the document the moment this parses. Everything that only exists once
     JavaScript has run can then say so honestly in CSS instead of leaving a
     "Loading…" that never finishes. */
  try { document.documentElement.classList.add('epb-js'); } catch (e) {}

  /* ---------- constants ------------------------------------------------- */
  EPB.TERMS = ['15m', '1h', '1d', '3d', '10d'];
  EPB.VOLS = ['65k', '130k'];
  EPB.EST_TITLE = 'Estimated from market ratios, not a quoted price';
  EPB.STALE_TITLE = 'Last successful scrape is older than 3 hours';

  EPB.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- relative path base ---------------------------------------- */
  /* Root pages link favicon.svg, subdirectory pages link ../favicon.svg —
     that is the cheapest reliable way to learn how deep we are. */
  EPB.base = (function () {
    try {
      var l = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
      var h = l && l.getAttribute('href');
      if (h) {
        var i = h.lastIndexOf('/');
        if (i !== -1) return h.slice(0, i + 1);
        return '';
      }
    } catch (e) { /* fall through */ }
    /* No icon link on this page (the blog and features pages never had one), so
       work the depth out from the URL instead. Without this, a page in /blog/
       asks for /blog/result.json and silently gets a 404. */
    try {
      var segs = (location.pathname || '/').split('/').filter(Boolean);
      var depth = Math.max(0, segs.length - 1);   /* last segment is the file */
      return depth ? new Array(depth + 1).join('../') : '';
    } catch (e2) { return ''; }
  })();
  EPB.url = function (name) { return EPB.base + name; };

  /* ---------- data-contract helpers ------------------------------------- */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  EPB.isNum = isNum;
  EPB.fmt = function (n, d) { return isNum(n) ? n.toFixed(d === undefined ? 2 : d) : '—'; };
  EPB.isStale = function (p) { return !!(p && p.stale === true); };
  EPB.hasPrices = function (p) {
    if (!p) return false;
    if (typeof p.has_prices === 'boolean') return p.has_prices;
    for (var v = 0; v < EPB.VOLS.length; v++) {
      for (var t = 0; t < EPB.TERMS.length; t++) {
        if (isNum(p[EPB.VOLS[v] + '_' + EPB.TERMS[t] + '_price'])) return true;
      }
    }
    return false;
  };
  EPB.isEstimated = function (p, key) {
    return ((p && p.estimated_keys) || []).indexOf(key) !== -1;
  };
  EPB.isRankable = function (p) { return EPB.hasPrices(p) && !EPB.isStale(p); };
  /* Optional per-platform sentence from the scraper (aggregate.py always ships
     the field, empty when the scraper had nothing to say). */
  EPB.priceNote = function (p) {
    var n = p && p.price_note;
    return (typeof n === 'string' && n.trim()) ? n.trim() : '';
  };
  /* Small "i" next to a platform name; '' when there is no note, so callers can
     concatenate it unconditionally.

     The marker carries no text of its own. Pages drop it inside an <h1> and
     inside table cells, and a letter that lives in the markup turns the
     heading of the APITRX review into "APITRXi" for anything that reads the
     text rather than the pixels. The glyph is drawn by the stylesheet, the
     marker itself is hidden from assistive software, and the sentence it
     stands for follows it as visually hidden text — so the note is spoken in
     full instead of as one stray letter. */
  EPB.noteMark = function (p, label) {
    var n = EPB.priceNote(p);
    if (!n) return '';
    var t = EPB.esc(n);
    return '<span class="note-mark" aria-hidden="true" title="' + t + '"></span>' +
      '<span class="sr-only">' + EPB.esc('How ' + (label || 'this') + ' price is read: ') + t + '</span>';
  };
  EPB.staleLabel = function (p) {
    var m = null;
    if (isNum(p.age_min)) m = p.age_min;
    else if (p.ts) m = Math.floor((Date.now() - new Date(p.ts).getTime()) / 60000);
    if (m === null || !isFinite(m)) return 'stale';
    return m < 60 ? 'stale · ' + Math.round(m) + 'm' : 'stale · ' + Math.round(m / 60) + 'h';
  };
  EPB.esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ---------- freshness -------------------------------------------------- */
  EPB.minutesSince = function (iso) {
    if (!iso) return null;
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 60000));
  };
  EPB.relTime = function (iso) {
    var m = EPB.minutesSince(iso);
    if (m === null) return 'unknown';
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm ago';
    var d = Math.floor(h / 24);
    return d + 'd ' + (h % 24) + 'h ago';
  };

  /* Wire an element up as the live-freshness badge. Returns a setter. */
  EPB.freshness = function (el, label) {
    if (!el) return function () {};
    if (!el.querySelector('.epb-dot')) {
      el.classList.add('epb-live');
      el.innerHTML = '<span class="epb-dot" aria-hidden="true"></span><span class="epb-live-text"></span>';
    }
    var textEl = el.querySelector('.epb-live-text');
    var iso = null;
    function paint() {
      var m = EPB.minutesSince(iso);
      var txt = (label || 'updated') + ' ' + EPB.relTime(iso);
      textEl.textContent = txt;
      el.setAttribute('title', iso ? 'Last scan ' + new Date(iso).toUTCString() : 'No timestamp yet');
      el.classList.toggle('is-fresh', m !== null && m <= 45);
      el.classList.toggle('is-stale', m !== null && m > 180);
    }
    var timer = setInterval(paint, 15000);
    el.addEventListener('epb:stop', function () { clearInterval(timer); });
    return function (nextIso) { iso = nextIso; paint(); };
  };

  /* ---------- number updates -------------------------------------------- */
  /* Writes text and marks the node briefly when the value actually changed.
     The highlight is removed by a timer, never by a transition. */
  EPB.setText = function (el, text) {
    if (!el) return;
    var next = String(text);
    if (el.textContent === next) return;
    el.textContent = next;
    if (EPB.reduced) return;
    el.classList.remove('epb-flash');
    void el.offsetWidth;
    el.classList.add('epb-flash');
    clearTimeout(el._epbFlash);
    el._epbFlash = setTimeout(function () { el.classList.remove('epb-flash'); }, 800);
  };

  /* ---------- history + sparklines --------------------------------------- */
  var histCache = null, histPending = null;
  EPB.loadHistory = function () {
    if (histCache) return Promise.resolve(histCache);
    if (histPending) return histPending;
    histPending = fetch(EPB.url('history_7d.json'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { histCache = j || { services_data: {} }; return histCache; })
      .catch(function () { histCache = { services_data: {} }; return histCache; });
    return histPending;
  };

  /* [[ms, value], ...] with nulls dropped, oldest first */
  EPB.series = function (hist, pid, key) {
    var sd = (hist && hist.services_data) || {};
    var raw = (sd[pid] && sd[pid][key]) || null;
    if (!raw || !raw.length) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var e = raw[i];
      if (e && isNum(e[1])) out.push([e[0], e[1]]);
    }
    out.sort(function (a, b) { return a[0] - b[0]; });
    return out;
  };

  /* {pct, dir:'up'|'down'|'flat'} against the sample nearest 24h before the
     newest one. null when there is nothing honest to compare against. */
  EPB.delta24 = function (series) {
    if (!series || series.length < 2) return null;
    var last = series[series.length - 1];
    var target = last[0] - 86400000;
    var prev = null;
    /* Newest sample that is genuinely a day old. Walking back to whatever
       happens to be oldest would let a six-hour file report a 24-hour move,
       which is exactly the kind of number nobody should have to double-check. */
    for (var i = series.length - 2; i >= 0; i--) {
      if (series[i][0] <= target) { prev = series[i]; break; }
    }
    if (!prev) {
      /* Sampling gaps: accept the oldest point if it is within 10% of a day. */
      var oldest = series[0];
      if (last[0] - oldest[0] >= 86400000 * 0.9) prev = oldest; else return null;
    }
    if (prev === last) return null;
    var a = prev[1], b = last[1];
    if (!isNum(a) || !isNum(b) || a <= 0) return null;
    var pct = (b - a) / a * 100;
    return { pct: pct, dir: Math.abs(pct) < 0.5 ? 'flat' : (pct < 0 ? 'down' : 'up') };
  };

  /* A rise and a fall are comparatives: "2.5% dearer than 24 hours ago". A
     standstill is not, and pouring it into the same sentence produced
     "0.0% unchanged than 24h ago". The flat case therefore gets its own
     wording and its own face: a percentage nobody can act on is replaced by
     the one word that answers the question. The arrow, the bullet and the
     number are hidden from assistive software so the sentence is read once,
     as a sentence, instead of glyph by glyph. */
  EPB.deltaHtml = function (d) {
    if (!d) return '';
    var flat = d.dir === 'flat';
    var n = Math.abs(d.pct);
    var txt = n >= 10 ? Math.round(n) : n.toFixed(1);
    var sign = d.dir === 'down' ? '▼' : (d.dir === 'up' ? '▲' : '•');
    /* The pill said "flat" and nothing else, so the reader had no way to know
       flat over what — an hour, a week, since we started. The window is the
       whole point of the number, so it is printed next to every one of them. */
    var face = (flat ? 'flat' : txt + '%') + ' · 24h';
    var said = flat ? 'same price as a day ago'
                    : txt + '% ' + (d.dir === 'down' ? 'cheaper' : 'dearer') + ' than 24 hours ago';
    return '<span class="delta delta-' + d.dir + '" title="' + said.charAt(0).toUpperCase() + said.slice(1) +
      '"><span aria-hidden="true">' + sign + ' ' + face + '</span>' +
      '<span class="sr-only">' + said + '</span></span>';
  };

  /* Inline SVG sparkline. Returns '' for fewer than 3 points — callers just
     drop it in and nothing appears, exactly as specified.

     The vertical scale has a FLOOR of 6% of the price level. Without it the
     line is normalised to whatever range the window happens to contain, so a
     platform that moved half a percent all week draws the same mountains as
     one that doubled — the chart's shape then carries no information at all
     and, worse, reads as volatility that is not there. With the floor a quiet
     series draws quiet, and only a real move fills the box.

     A dashed guide marks where the series STARTED, so "above the line" means
     dearer than a week ago without needing the colour, and a round cap on the
     last point says which end is now. */
  EPB.sparkline = function (series, opts) {
    opts = opts || {};
    if (!series || series.length < 3) return '';
    var vals = [], i;
    for (i = 0; i < series.length; i++) vals.push(series[i][1]);
    if (vals.length > 60) {                       // thin out very dense series
      var step = vals.length / 60, thin = [];
      for (i = 0; i < 60; i++) thin.push(vals[Math.floor(i * step)]);
      thin.push(vals[vals.length - 1]);
      vals = thin;
    }
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var sum = 0;
    for (i = 0; i < vals.length; i++) sum += vals[i];
    var level = Math.abs(sum / vals.length);
    var W = 100, H = 30, pad = 3.5;
    var mid = (min + max) / 2;
    var span = Math.max(max - min, level * 0.06) || 1;
    var lo = mid - span / 2;
    function yOf(v) {
      return Math.round((H - pad - ((v - lo) / span) * (H - pad * 2)) * 100) / 100;
    }
    var pts = [];
    for (i = 0; i < vals.length; i++) {
      pts.push([Math.round((i / (vals.length - 1)) * W * 100) / 100, yOf(vals[i])]);
    }
    var d = 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join('L');
    var area = d + 'L' + W + ' ' + H + 'L0 ' + H + 'Z';
    var last = vals[vals.length - 1], first = vals[0];
    var dir = last < first ? 'is-down' : (last > first ? 'is-up' : '');
    var label = opts.label || '7-day price trend';
    var y0 = yOf(first);
    return '<svg class="spark ' + dir + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
      'role="img" aria-label="' + EPB.esc(label) + ': ' + EPB.fmt(min) + ' to ' + EPB.fmt(max) + ' TRX" focusable="false">' +
      (opts.area === false ? '' : '<path class="spark-area" d="' + area + '"/>') +
      '<path class="spark-guide" d="M0 ' + y0 + 'H' + W + '"/>' +
      '<path class="spark-line" d="' + d + '"/>' +
      '<path class="spark-end" d="M' + W + ' ' + pts[pts.length - 1][1] + 'h0"/></svg>';
  };

  /* ---------- theme ------------------------------------------------------ */
  var KEY = 'epb-theme';
  EPB.getTheme = function () {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  };
  EPB.setTheme = function (t, persist) {
    t = t === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    if (persist !== false) { try { localStorage.setItem(KEY, t); } catch (e) {} }
    var btns = document.querySelectorAll('.epb-toggle');
    for (var i = 0; i < btns.length; i++) {
      /* aria-pressed is the state of this button, not the offer it makes:
         the button turns the dark theme on, so it is pressed while the dark
         theme is on. The name stays put for the same reason a light switch
         is not relabelled when you flick it; the tooltip, which only a mouse
         ever sees, is the one that names the next step. */
      btns[i].setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
      btns[i].setAttribute('aria-label', 'Dark theme');
      btns[i].setAttribute('title', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }
    document.dispatchEvent(new CustomEvent('epb:theme', { detail: { theme: t } }));
  };

  var MOON = '<svg class="epb-i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var SUN = '<svg class="epb-i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7"/></svg>';

  function mountToggle() {
    var navs = document.querySelectorAll('nav.nav');
    for (var i = 0; i < navs.length; i++) {
      if (navs[i].querySelector('.epb-toggle')) continue;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'epb-toggle';
      b.innerHTML = MOON + SUN;
      b.addEventListener('click', function () {
        EPB.setTheme(EPB.getTheme() === 'light' ? 'dark' : 'light');
      });
      navs[i].appendChild(b);
    }
    EPB.setTheme(EPB.getTheme(), false);

    /* The link row scrolls horizontally on narrow screens; make sure the page
       you are on is the one you can see. */
    var links = document.querySelector('.nav-links');
    var current = links && links.querySelector('a.active, a[aria-current="page"]');
    if (links && current) {
      /* offsetLeft is measured against the positioned <nav>, not the scroller,
         so the two rects are what actually line up here. */
      var lr = links.getBoundingClientRect(), cr = current.getBoundingClientRect();
      links.scrollLeft = Math.max(0, links.scrollLeft + (cr.left - lr.left) - 12);
    }
  }

  /* Follow the OS while the visitor has not made a choice of their own. */
  try {
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: light)');
      var onChange = function (e) {
        var saved = null;
        try { saved = localStorage.getItem(KEY); } catch (err) {}
        if (saved !== 'light' && saved !== 'dark') EPB.setTheme(e.matches ? 'light' : 'dark', false);
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  } catch (e) {}

  /* ---------- accordion --------------------------------------------------- */
  /* Opens by writing an inline max-height and clearing it on a timer, so the
     panel is readable even where CSS transitions never run. */
  function panelOf(btn) {
    var n = btn.nextElementSibling;
    return (n && n.classList.contains('accordion-content')) ? n : null;
  }
  function openPanel(btn, panel) {
    clearTimeout(panel._epbT);
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('open');
    panel.classList.add('open');
    panel.style.maxHeight = panel.scrollHeight + 'px';
    panel._epbT = setTimeout(function () { panel.style.maxHeight = 'none'; }, EPB.reduced ? 0 : 200);
  }
  function closePanel(btn, panel) {
    clearTimeout(panel._epbT);
    panel.style.maxHeight = panel.scrollHeight + 'px';
    void panel.offsetHeight;
    panel.style.maxHeight = '0px';
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('open');
    panel.classList.remove('open');
    panel._epbT = setTimeout(function () { panel.hidden = true; panel.style.maxHeight = ''; }, EPB.reduced ? 0 : 200);
  }
  EPB.initAccordion = function (root) {
    var btns = (root || document).querySelectorAll('.accordion-trigger');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        if (btn._epbBound) return;
        btn._epbBound = true;
        var panel = panelOf(btn);
        if (!panel) return;
        if (!panel.querySelector('.accordion-inner')) {
          var inner = document.createElement('div');
          inner.className = 'accordion-inner';
          while (panel.firstChild) inner.appendChild(panel.firstChild);
          panel.appendChild(inner);
        }
        if (!panel.id) panel.id = 'acc-panel-' + (i + 1) + '-' + Math.random().toString(36).slice(2, 7);
        btn.setAttribute('aria-controls', panel.id);
        btn.setAttribute('type', 'button');
        var startOpen = btn.classList.contains('open') || panel.classList.contains('open');
        if (startOpen) openPanel(btn, panel);
        else { panel.hidden = true; panel.style.maxHeight = '0px'; btn.setAttribute('aria-expanded', 'false'); }
        btn.addEventListener('click', function () {
          var isOpen = btn.getAttribute('aria-expanded') === 'true';
          var all = (root || document).querySelectorAll('.accordion-trigger');
          for (var j = 0; j < all.length; j++) {
            var p = panelOf(all[j]);
            if (p && all[j] !== btn && all[j].getAttribute('aria-expanded') === 'true') closePanel(all[j], p);
          }
          if (isOpen) closePanel(btn, panel); else openPanel(btn, panel);
        });
      })(btns[i]);
    }
  };

  /* ---------- keyboard ---------------------------------------------------- */
  EPB.initKeyboard = function () {
    if (EPB._kb) return;
    EPB._kb = true;
    document.addEventListener('keydown', function (e) {
      var t = e.target || {};
      var tag = (t.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        var box = document.querySelector('[data-epb-search]') || document.querySelector('.search-box');
        if (box) { e.preventDefault(); box.focus(); box.select && box.select(); }
        return;
      }
      if (e.key === 'Escape') {
        if (typing && t.blur) { t.blur(); }
        document.dispatchEvent(new CustomEvent('epb:escape'));
      }
    });
  };

  /* ---------- conversion tracking ---------------------------------------- */
  /* The board's only revenue signal is "the visitor left for a platform".
     GA4 Enhanced Measurement does emit an outbound `click` event, but `click`
     also covers every other link on the page, so marking it as a key event
     would count navigation as conversion. We therefore emit our own named
     events, which CAN be marked as key events without polluting anything:

       platform_click  — left for one of the tracked energy platforms
       outbound_click  — left for any other external host

     Both carry platform_id / link_domain / placement, so GA4 can answer
     "which platform earns the clicks, from which page". Everything below is a
     no-op when neither gtag nor ym is on the page — nothing throws, nothing
     blocks the navigation. */

  EPB.placement = (function () {
    var p = (location.pathname || '').toLowerCase();
    if (/\/vs\//.test(p)) return 'vs_page';
    if (/\/platforms\//.test(p)) return 'platform_page';
    if (/\/blog\//.test(p)) return 'blog_article';
    if (/\/features\//.test(p)) return 'feature_page';
    if (/compare\.html$/.test(p)) return 'compare';
    if (/history\.html$/.test(p)) return 'history';
    if (/blog\.html$/.test(p)) return 'blog_index';
    if (/news\.html$/.test(p)) return 'news';
    if (/out-of-energy\.html$/.test(p)) return 'out_of_energy';
    if (/platform\.html$/.test(p)) return 'platform_legacy';
    if (/404\.html$/.test(p)) return 'not_found';
    if (p === '' || p === '/' || /index\.html$/.test(p)) return 'board';
    return 'other';
  })();

  /* Fire one event into whichever analytics libraries are present. */
  EPB.sendEvent = function (name, params) {
    params = params || {};
    try {
      if (typeof window.gtag === 'function') window.gtag('event', name, params);
    } catch (e) { /* analytics must never break the page */ }
    try {
      /* Metrika goals are flat names; the params ride along as the third arg. */
      var id = EPB.ymId();
      if (typeof window.ym === 'function' && id) window.ym(id, 'reachGoal', name, params);
    } catch (e) { /* ditto */ }
  };

  /* Counter id is read off the <noscript> tracking pixel that every page
     already carries, so it is never hardcoded in two places. */
  EPB.ymId = function () {
    if (EPB._ym !== undefined) return EPB._ym;
    EPB._ym = null;
    try {
      /* <noscript> is not parsed into a DOM subtree while scripting is on, so
         its markup is readable as plain text — cheaper than serialising the
         whole document. */
      var ns = document.getElementsByTagName('noscript');
      for (var i = 0; i < ns.length; i++) {
        var m = /mc\.yandex\.ru\/watch\/(\d+)/.exec(ns[i].textContent || '');
        if (m) { EPB._ym = m[1]; break; }
      }
    } catch (e) { /* leave null */ }
    return EPB._ym;
  };

  function hostOf(url) {
    try { return new URL(url, location.href).hostname.replace(/^www\./, ''); }
    catch (e) { return ''; }
  }

  /* A platform id is only ever taken from an explicit annotation: referral
     URLs often point at t.me/<bot>, so the hostname is not a reliable id. */
  function pidOf(el) {
    var n = el;
    while (n && n.getAttribute) {
      var v = n.getAttribute('data-epb-pid');
      if (v) return v;
      n = n.parentElement;
    }
    return '';
  }

  function reportExit(url, el, how) {
    var host = hostOf(url);
    if (!host || host === location.hostname.replace(/^www\./, '')) return;
    var pid = pidOf(el);
    var params = {
      link_domain: host,
      link_url: String(url).slice(0, 400),
      placement: EPB.placement,
      how: how
    };
    if (pid) {
      params.platform_id = pid;
      var nameEl = el && el.closest && el.closest('[data-epb-pname]');
      if (nameEl) params.platform_name = nameEl.getAttribute('data-epb-pname');
      EPB.sendEvent('platform_click', params);
    } else {
      EPB.sendEvent('outbound_click', params);
    }
  }

  EPB.initTracking = function () {
    if (EPB._trk) return;
    EPB._trk = true;
    function onClick(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var a = t.closest('a[href]');
      if (a) {
        var href = a.getAttribute('href') || '';
        if (/^(https?:)?\/\//i.test(href)) reportExit(a.href, a, 'link');
        return;
      }
      /* Whole-card clicks on the board open the referral URL via window.open,
         so there is no anchor to catch. Mirrors index.html's own handler. */
      var card = t.closest('[data-go]');
      if (card) reportExit(card.getAttribute('data-go'), card, 'card');
    }
    /* Capture phase: still counted if a handler stops propagation. */
    document.addEventListener('click', onClick, true);
    document.addEventListener('auxclick', function (e) {
      if (e.button === 1) onClick(e);      /* middle-click = open in new tab */
    }, true);
  };

  /* ---------- "cheapest right now" call to action -------------------------
     Any page can drop in
         <div class="cta-live" data-cta-cheapest="65k_1h"></div>
     and it becomes a live card naming the cheapest platform for that cell with
     a link to it. Articles used to end without anywhere to go, which is a waste
     of the only traffic that arrives ready to rent. If the board cannot be read
     the block removes itself rather than showing an empty promise. */
  /* One shared read of the board file, so the CTA, the spread rail and the 404
     card do not each ask for it. */
  var boardPending = null, boardCache = null;
  EPB.loadBoard = function () {
    if (boardCache) return Promise.resolve(boardCache);
    if (boardPending) return boardPending;
    boardPending = fetch(EPB.url('result.json'), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { boardCache = j; return j; });
    return boardPending;
  };

  EPB.initCheapestCta = function () {
    var hosts = document.querySelectorAll('[data-cta-cheapest]');
    if (!hosts.length) return;
    EPB.loadBoard()
      .then(function (data) {
        var list = (data && data.platforms) || [];
        hosts.forEach(function (host) {
          var key = host.getAttribute('data-cta-cheapest') || '65k_1h';
          if (!/_price$/.test(key)) key += '_price';
          var best = null;
          list.forEach(function (p) {
            if (!p || p.has_prices === false || p.stale === true) return;
            if ((p.estimated_keys || []).indexOf(key) !== -1) return;   /* never sell an estimate */
            var v = p[key];
            if (typeof v !== 'number' || !isFinite(v) || v <= 0) return;
            if (!best || v < best[key]) best = p;
          });
          if (!best) { host.remove(); return; }
          var name = best.platform_name || best.platform_id;
          var href = EPB.outUrl(best);
          var price = best[key].toFixed(2);
          var vol = key.indexOf('130k') === 0 ? '130,000' : '65,000';
          /* `sponsored` is a statement about money. It goes on the links that
             actually pay us and nowhere else, or the markup contradicts the
             disclosure printed underneath it. */
          var relOut = EPB.outRel(best);
          host.innerHTML =
            '<div class="cta-live-in">' +
              '<div class="cta-live-txt">' +
                '<span class="cta-live-lbl">Cheapest right now</span>' +
                '<span class="cta-live-num">' + price + ' TRX</span>' +
                '<span class="cta-live-sub">' + vol + ' energy for one hour, at ' +
                  EPB.esc(name) + '</span>' +
              '</div>' +
              (href
                ? '<a class="btn btn-primary" href="' + EPB.esc(href) + '" target="_blank" ' +
                  'rel="' + relOut + '" data-platform-id="' + EPB.esc(best.platform_id || '') +
                  '">Rent at ' + EPB.esc(name) + '</a>'
                /* No link we may send traffic through: the review page is the
                   honest destination, and it carries the same live price. */
                : '<a class="btn btn-primary" href="/platforms/' + EPB.esc(best.platform_id || '') +
                  '.html">' + EPB.esc(name) + ' prices and review</a>') +
            '</div>' +
            '<p class="cta-live-note">Prices come from our own scan, refreshed every 15 minutes. ' +
            (best.is_ours
              ? 'The platform at the top of this scan is our own shop. It got there on price, ' +
                'which is the only thing this board sorts by.'
              : 'Some outbound links are referral links: the platform pays us, you pay the same ' +
                'price, and the ranking is by price only.') + '</p>';
        });
      })
      .catch(function () { hosts.forEach(function (h) { h.remove(); }); });
  };

  /* ---------- how deep the archive really is ------------------------------
     The charts are labelled "7 days" by the file name, not by the data. Until
     the archive is that deep, say what it actually holds: a page that claims a
     week and draws eighteen hours teaches the reader not to trust the rest. */
  EPB.initHistoryDepth = function () {
    var nodes = document.querySelectorAll('[data-hist-range], [data-hist-depth]');
    if (!nodes.length) return;
    EPB.loadHistory().then(function (h) {
      var sd = (h && h.services_data) || {}, lo = Infinity, hi = 0;
      Object.keys(sd).forEach(function (k) {
        var s = sd[k] && sd[k]['65k_1h_price'];
        if (!s || !s.length) return;
        s.forEach(function (pt) {
          if (!pt || typeof pt[0] !== 'number') return;
          if (pt[0] < lo) lo = pt[0];
          if (pt[0] > hi) hi = pt[0];
        });
      });
      if (!hi || lo === Infinity) return;
      var hours = (hi - lo) / 3600000;
      var txt = hours < 48 ? Math.round(hours) + ' hours of data so far'
                           : Math.round(hours / 24) + ' days of data so far';
      document.querySelectorAll('[data-hist-range]').forEach(function (el) { el.textContent = txt; });
      document.querySelectorAll('[data-hist-depth]').forEach(function (el) {
        el.textContent = 'The archive is ' + txt.replace(' so far', '') +
          ' deep — the board started recording on ' +
          new Date(lo).toISOString().slice(0, 10) + '. Charts show everything collected, not a full week.';
      });
    });
  };

  /* ---------- platform monograms ------------------------------------------
     The board draws every platform as a monogram rather than a logo, so the
     monogram has to carry the identity a logo would. One letter did not: T
     stood for TronZap, TR Energy, TronMax, Tron Fee Energy Rental and our own
     tronfor.me, which is five rows of the same mark in one column.

     Two letters, taken the way a person would read the name: the initials of
     its parts when it has parts (TronZap -> TZ), otherwise its first two
     letters (Tronify -> TR). A trailing domain suffix is not a part of a
     name, so feee.io is FE and not FI. Where two platforms still land on the
     same pair, monogramMap lengthens both until they are apart — one pass
     over the list the board is about to draw, so the marks are unique for the
     set actually on screen. */
  function monoParts(name) {
    var n = String(name || '').trim();
    var dot = n.lastIndexOf('.');
    if (dot > 0 && /^[a-z]{2,8}$/.test(n.slice(dot + 1))) n = n.slice(0, dot);
    /* camelCase and TitleCase count as a word boundary. */
    n = n.replace(/([a-z])([A-Z])/g, '$1 $2');
    return n.split(/[^A-Za-z]+/).filter(Boolean);
  }
  EPB.monoCandidates = function (name) {
    var parts = monoParts(name);
    if (!parts.length) return ['?'];
    var flat = parts.join('');
    var out = [parts.length > 1 ? parts[0].charAt(0) + parts[1].charAt(0) : flat.slice(0, 2),
               flat.slice(0, 3)];
    if (flat.length > 2) out.push(flat.slice(0, 2) + flat.slice(-1));
    return out.map(function (c) { return c.toUpperCase(); });
  };
  EPB.monogram = function (name) { return EPB.monoCandidates(name)[0]; };
  /* A mark two platforms share is worse than no mark, so a clash walks down
     the candidates until it reaches one nobody has taken. Three letters is
     the ceiling: four do not fit the tile. */
  EPB.monogramMap = function (list) {
    var out = {}, taken = {}, i, j;
    for (i = 0; i < list.length; i++) {
      var pid = list[i].platform_id || '';
      var cands = EPB.monoCandidates(list[i].platform_name || pid);
      var m = cands[cands.length - 1];
      for (j = 0; j < cands.length; j++) {
        if (!taken[cands[j]]) { m = cands[j]; break; }
      }
      taken[m] = true;
      out[pid] = m;
    }
    return out;
  };
  /* A hue per platform, stable across reloads and never random: the same id
     always draws the same tile. Kept low in saturation by the CSS — this is a
     way of telling twenty tiles apart, not a palette. */
  EPB.hueFor = function (pid) {
    var h = 0, s = String(pid || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  };

  /* ---------- outbound links ----------------------------------------------
     One rule for the whole site: we link out to a platform only when the link
     is one we have an arrangement for, or when the shop is our own. A bare
     link to somebody else's site is free traffic we hand a competitor, and it
     is the one thing on this board that costs us money to show. Platforms
     without a link still get their row, their price and their review page.
     Callers that get '' must render no outbound link at all. */
  EPB.outUrl = function (p) {
    if (!p) return '';
    if (p.has_referral && p.referral_url) return p.referral_url;
    if (p.is_ours) return p.url || '';
    return '';
  };
  EPB.outRel = function (p) {
    return (p && p.has_referral && p.referral_url)
      ? 'sponsored nofollow noopener' : 'nofollow noopener';
  };

  /* ---------- referral disclosure ----------------------------------------
     Every page carries it, because the board takes referral money from some of
     the platforms it ranks. Injected here rather than pasted into sixty files,
     and skipped if a page already says it in its own words. */
  EPB.initDisclosure = function () {
    var bar = document.querySelector('.footer-bottom');
    if (!bar || /referral link/i.test(document.body.textContent || '')) return;
    var el = document.createElement('span');
    el.className = 'footer-disclosure';
    el.textContent = 'Some links to platforms are referral links. They cost you nothing, ' +
                     'and the ranking is by price only.';
    bar.appendChild(el);
  };

  /* TRON proposal #104, August 2025: 100 SUN per unit of energy burned. */
  var BURN_SUN = 100;              /* TRON proposal #104, August 2025 */
  function burnCost(energy) { return energy * BURN_SUN / 1000000; }

  /* ---------- what it costs against burning -------------------------------
     A board card without this answers "which of these is cheapest" but never
     "is any of this worth doing". The figure is derived from the price already
     printed on the card, so it can never disagree with it. */
  function energyOf(label) {
    var m = /(\d+(?:\.\d+)?)\s*k/i.exec(label || '');
    if (m) return parseFloat(m[1]) * 1000;
    var n = /(\d{4,})/.exec(label || '');
    return n ? parseFloat(n[1]) : 0;
  }
  function priceOf(node) {
    if (!node) return NaN;
    var t = (node.textContent || '').replace(/[^0-9.]/g, '');
    var v = parseFloat(t);
    return isFinite(v) ? v : NaN;
  }

  function annotateCard(card) {
    if (!card || card.classList.contains('nodata')) return;
    var box = card.querySelector('.plat-price.plat-best') ||
              card.querySelector('.plat-price.is-focus') ||
              card.querySelector('.plat-price');
    if (!box) return;
    var pv = box.querySelector('.pv');
    if (!pv || pv.classList.contains('na')) return;
    var price = priceOf(pv), energy = energyOf((box.querySelector('.pl') || {}).textContent);
    if (!isFinite(price) || price <= 0 || !energy) return;
    var burn = burnCost(energy);
    if (!burn) return;

    var pct = (burn - price) / burn * 100;
    var est = pv.classList.contains('est');
    var old = card.querySelector('.plat-save');
    var sig = price + '|' + energy;
    if (old && old.getAttribute('data-sig') === sig) return;
    if (old) old.remove();

    var row = document.createElement('div');
    row.className = 'plat-save' + (pct <= 0 ? ' is-none' : '');
    row.setAttribute('data-sig', sig);
    var width = Math.max(3, Math.min(100, Math.abs(pct)));
    row.innerHTML =
      '<span class="plat-save-bar" aria-hidden="true"><i style="width:' + width.toFixed(0) + '%"></i></span>' +
      '<span class="plat-save-txt">' + (est ? '≈ ' : '') +
        (pct > 0
          ? '<b>' + Math.round(pct) + '% less</b> than burning ' + burn.toFixed(2) + ' TRX'
          : '<b>' + Math.round(-pct) + '% more</b> than burning ' + burn.toFixed(2) + ' TRX') +
      '</span>';
    var prices = card.querySelector('.plat-prices');
    if (prices && prices.parentNode) prices.parentNode.insertBefore(row, prices.nextSibling);
  }

  EPB.initBurnCompare = function () {
    var grid = document.getElementById('platGrid');
    if (!grid) return;
    var queued = false;
    function run() {
      queued = false;
      var cards = grid.querySelectorAll('.plat-card');
      for (var i = 0; i < cards.length; i++) annotateCard(cards[i]);
    }
    run();
    if (!window.MutationObserver) return;
    /* The board re-renders the whole grid on every filter change and on every
       poll, so the annotation has to be re-applied rather than done once. */
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      if (window.requestAnimationFrame) window.requestAnimationFrame(run);
      else setTimeout(run, 0);
    }).observe(grid, { childList: true, subtree: true });
  };

  /* ---------- horizontal scrollers ----------------------------------------
     A table wider than its box has to say so, and has to stop saying so at the
     end of the run. The shadow is a class on the container, never a background
     that would slide away with the content. */
  EPB.initScrollers = function () {
    var sel = '.mtx-wrap,.heatmap-wrap,.table-scroll,.table-wrap';
    var nodes = document.querySelectorAll(sel);
    if (!nodes.length) return;

    function paint(el) {
      var over = el.scrollWidth - el.clientWidth;
      var can = over > 4;
      el.classList.toggle('is-scrollable', can);
      el.classList.remove('at-start', 'at-mid', 'at-end');
      if (can) {
        var x = el.scrollLeft;
        el.classList.add(x <= 2 ? 'at-start' : (x >= over - 2 ? 'at-end' : 'at-mid'));
      }
      var hint = el._epbHint;
      if (can && !hint && el.parentNode) {
        hint = document.createElement('p');
        hint.className = 'scroll-hint';
        hint.textContent = 'Scroll the table sideways for the longer rentals';
        el.parentNode.insertBefore(hint, el.nextSibling);
        el._epbHint = hint;
      }
      if (hint) hint.style.display = can ? '' : 'none';
    }

    for (var i = 0; i < nodes.length; i++) {
      (function (el) {
        el.classList.add('epb-scroller');
        el.addEventListener('scroll', function () { paint(el); }, { passive: true });
        if (window.ResizeObserver) new ResizeObserver(function () { paint(el); }).observe(el);
        if (window.MutationObserver) {
          var q = false;
          new MutationObserver(function () {
            if (q) return; q = true;
            setTimeout(function () { q = false; paint(el); }, 60);
          }).observe(el, { childList: true, subtree: true });
        }
        paint(el);
      })(nodes[i]);
    }
    window.addEventListener('resize', function () {
      for (var j = 0; j < nodes.length; j++) paint(nodes[j]);
    });
  };

  /* ---------- the heatmap, made of heat -----------------------------------
     The history page has a section called "Price heatmap" that had no heat in
     it. Each column is scaled on its own — 15 minutes and 10 days are not the
     same money — and the ramp is one hue at varying strength, so it reads the
     same to a red-green colour-blind eye and in greyscale. The ★ on the
     cheapest cell still carries the extreme as a shape. */
  function paintHeat(table) {
    var body = table.querySelector('tbody');
    if (!body) return;
    var rows = body.querySelectorAll('tr:not(.section-split)');
    var cols = {}, r, c, cells, val;
    for (r = 0; r < rows.length; r++) {
      if (rows[r].classList.contains('row-nodata')) continue;
      cells = rows[r].children;
      for (c = 1; c < cells.length; c++) {
        var span = cells[c].querySelector('.cell-price');
        if (!span || span.classList.contains('na')) continue;
        val = priceOf(span);
        if (!isFinite(val) || val <= 0) continue;
        (cols[c] || (cols[c] = [])).push(val);
      }
    }
    Object.keys(cols).forEach(function (k) {
      var a = cols[k];
      cols[k] = { min: Math.min.apply(null, a), max: Math.max.apply(null, a) };
    });
    for (r = 0; r < rows.length; r++) {
      cells = rows[r].children;
      for (c = 1; c < cells.length; c++) {
        var sp = cells[c].querySelector('.cell-price');
        if (!sp) { cells[c].classList.remove('heat'); continue; }
        var range = cols[c];
        var v = priceOf(sp);
        if (!range || !isFinite(v) || sp.classList.contains('na')) {
          cells[c].classList.remove('heat');
          cells[c].style.removeProperty('--h');
          continue;
        }
        /* Cheap glows. On a price board the thing the reader wants is the
           thing that should catch the eye, so intensity runs from the lowest
           quote in the column down to nothing at the highest. */
        var t = range.max > range.min ? (v - range.min) / (range.max - range.min) : 0;
        cells[c].classList.add('heat');
        cells[c].style.setProperty('--h', (1 - t).toFixed(3));
      }
    }
  }

  EPB.initHeat = function () {
    var tables = document.querySelectorAll('.heatmap');
    if (!tables.length) return;
    for (var i = 0; i < tables.length; i++) {
      (function (t) {
        var q = false;
        function run() { q = false; try { paintHeat(t); } catch (e) {} }
        run();
        if (!window.MutationObserver) return;
        new MutationObserver(function () {
          if (q) return; q = true; setTimeout(run, 30);
        }).observe(t, { childList: true, subtree: true });
      })(tables[i]);

      /* One legend per heatmap, so the ramp means something. */
      var wrap = tables[i].closest('.heatmap-wrap');
      var host = wrap && wrap.parentNode;
      if (host && !host.querySelector('.heat-key')) {
        var key = document.createElement('p');
        key.className = 'heat-key';
        key.innerHTML = '<span><b>cheapest</b></span>' +
          '<span class="heat-key-ramp" aria-hidden="true"></span>' +
          '<span>dearest</span>' +
          '<span>· shading runs down each column on its own, so the strongest cell in a column ' +
          'is the cheapest quote for that duration</span>';
        host.insertBefore(key, wrap.nextSibling);
      }
    }
  };

  /* ---------- Chart.js house style ----------------------------------------
     The canvases cannot inherit anything from the stylesheet, so the few
     defaults that decide whether a chart is legible are set here, from the
     same tokens everything else uses. Re-applied on a theme switch, because
     the pages rebuild their charts when the theme changes. */
  function tok(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  EPB.styleCharts = function () {
    var C = window.Chart;
    if (!C || !C.defaults) return;
    var d = C.defaults;
    try {
      d.font.family = "'Inter','Golos Text',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      d.font.size = 11;
      d.color = tok('--text-2', '#9aa4b8');
      d.borderColor = tok('--line', 'rgba(255,255,255,.07)');
      d.elements.point.radius = 2.5;
      d.elements.point.hoverRadius = 5;
      d.elements.point.hitRadius = 14;
      d.elements.line.borderWidth = 2;
      d.elements.line.tension = 0.25;
      d.plugins.legend.labels.usePointStyle = true;
      d.plugins.legend.labels.boxWidth = 8;
      d.plugins.legend.labels.padding = 14;
      var t = d.plugins.tooltip;
      t.backgroundColor = tok('--surface', '#14161f');
      t.borderColor = tok('--line-2', 'rgba(255,255,255,.11)');
      t.borderWidth = 1;
      t.titleColor = tok('--text', '#eef1f7');
      t.bodyColor = tok('--text-2', '#9aa4b8');
      t.padding = 10;
      t.cornerRadius = 10;
      t.usePointStyle = true;
      t.boxPadding = 5;
      t.displayColors = true;
    } catch (e) { /* a chart with default styling beats no chart */ }
  };

  /* ---------- notes that landed inside a heading --------------------------
     Pages print the note marker inside their <h1>, next to the platform name.
     The marker itself no longer carries a letter, but the sentence beside it
     would still be read as part of the heading — "APITRX How APITRX price is
     read: …" — and would still turn up in anything that takes the text of the
     page. It is moved to just after the heading, where it says the same thing
     about the same platform. Nothing visible moves: the label is a clipped
     1px box either way. */
  EPB.liftHeadingNotes = function (root) {
    var marks = (root || document).querySelectorAll('h1 .note-mark, h2 .note-mark, h3 .note-mark');
    for (var i = 0; i < marks.length; i++) {
      var label = marks[i].nextElementSibling;
      if (!label || !label.classList || !label.classList.contains('sr-only')) continue;
      var head = marks[i].closest && marks[i].closest('h1,h2,h3');
      if (!head || !head.parentNode) continue;
      head.parentNode.insertBefore(label, head.nextSibling);
    }
  };

  /* The platform review fills its heading in once the board file arrives,
     which is after this script has run, so the headings are watched rather
     than swept once. Moving the label out is itself a change to the heading;
     the next pass finds nothing left to move and it settles. */
  EPB.initHeadingNotes = function () {
    EPB.liftHeadingNotes(document);
    if (!window.MutationObserver) return;
    var heads = document.querySelectorAll('h1,h2,h3');
    if (!heads.length) return;
    var mo = new MutationObserver(function () { EPB.liftHeadingNotes(document); });
    for (var i = 0; i < heads.length; i++) mo.observe(heads[i], { childList: true, subtree: true });
  };

  /* ---------- 404 ---------------------------------------------------------
     "This page does not exist" is not an answer to the question the visitor
     arrived with. The one thing this site always has is a current price, so
     the error page carries the same live card the articles end with. */
  EPB.init404 = function () {
    if (EPB.placement !== 'not_found') return;
    if (document.querySelector('[data-cta-cheapest]')) return;
    var links = document.querySelector('.links');
    if (!links || !links.parentNode) return;
    var host = document.createElement('div');
    host.className = 'cta-live epb-404-live';
    host.setAttribute('data-cta-cheapest', '65k_1h');
    links.parentNode.insertBefore(host, links.nextSibling);
  };

  /* ---------- boot -------------------------------------------------------- */
  function boot() {
    mountToggle();
    EPB.styleCharts();
    document.addEventListener('epb:theme', EPB.styleCharts);
    EPB.initTracking();
    EPB.init404();
    EPB.initCheapestCta();
    EPB.initBurnCompare();
    EPB.initScrollers();
    EPB.initHeat();
    EPB.initDisclosure();
    EPB.initHistoryDepth();
    EPB.initHeadingNotes();
    EPB.initAccordion(document);
    EPB.initKeyboard();
    /* Any page with a main landmark gets a skip link. */
    var main = document.querySelector('main');
    if (main && !document.querySelector('.epb-skip')) {
      if (!main.id) main.id = 'main';
      var a = document.createElement('a');
      a.className = 'epb-skip';
      a.href = '#' + main.id;
      a.textContent = 'Skip to content';
      document.body.insertBefore(a, document.body.firstChild);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window, document);
