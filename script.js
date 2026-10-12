/* FixAsif · interactions */
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s) { return document.querySelector(s); };

  /* 1. Rotating role typing */
  var roles = ["X Automation", "Discord Automation", "Portfolio Design", "X Content Creation", "Community Management"];
  var roleEl = $("#typedRole");
  if (roleEl) {
    if (reduce) roleEl.textContent = roles[0];
    else {
      var ri = 0, ci = 0, del = false;
      (function tick() {
        var w = roles[ri];
        roleEl.textContent = w.slice(0, ci);
        if (!del && ci < w.length) { ci++; setTimeout(tick, 75); }
        else if (!del) { del = true; setTimeout(tick, 1600); }
        else if (ci > 0) { ci--; setTimeout(tick, 35); }
        else { del = false; ri = (ri + 1) % roles.length; setTimeout(tick, 300); }
      })();
    }
  }

  /* 2. About me terminal typing */
  var about = [
    ["p", "> "], ["c", "whoami\n"],
    ["", "Asif, aka FixAsif.\n"],
    ["", "X content creator and community manager.\n"],
    ["", "I automate X and Discord so you save hours,\n"],
    ["", "and I design glassy portfolio websites.\n"],
    ["p", "> "], ["c", "status\n"],
    ["m", "● open for collabs, DM me on X"]
  ];
  var term = $("#aboutType");
  if (term) {
    var caret = document.createElement("span"); caret.className = "tcar";
    if (reduce) {
      about.forEach(function (s) { var e = document.createElement("span"); if (s[0]) e.className = s[0]; e.textContent = s[1]; term.appendChild(e); });
      term.appendChild(caret);
    } else {
      var si = 0, ch = 0, cur = null;
      term.appendChild(caret);
      var typeNext = function () {
        if (si >= about.length) return;
        var seg = about[si];
        if (!cur) { cur = document.createElement("span"); if (seg[0]) cur.className = seg[0]; term.insertBefore(cur, caret); }
        cur.textContent = seg[1].slice(0, ++ch);
        var c = seg[1][ch - 1];
        if (ch >= seg[1].length) { si++; ch = 0; cur = null; }
        var d = c === "\n" ? 380 : (c === "," || c === "." ? 160 : 22 + Math.random() * 38);
        setTimeout(typeNext, d);
      };
      setTimeout(typeNext, 900);
    }
  }

  /* 3. Reveal on scroll */
  var els = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    els.forEach(function (e, i) { e.style.transitionDelay = (i % 4) * 70 + "ms"; io.observe(e); });
  } else els.forEach(function (e) { e.classList.add("in"); });

  /* 4. Nav */
  var nav = $("#nav"), burger = $("#burger"), links = $("#navLinks");
  var onScroll = function () { nav.classList.toggle("scrolled", window.scrollY > 30); };
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  burger.addEventListener("click", function () { burger.classList.toggle("open"); links.classList.toggle("open"); });
  links.addEventListener("click", function (e) { if (e.target.closest("a")) { burger.classList.remove("open"); links.classList.remove("open"); } });

  /* 5. Cursor glow + glass light */
  var glow = $(".cursor-glow"), fine = window.matchMedia("(pointer: fine)").matches;
  if (fine && !reduce) {
    var gx = innerWidth / 2, gy = innerHeight / 2, tx = gx, ty = gy, raf = null;
    var loop = function () { gx += (tx - gx) * 0.12; gy += (ty - gy) * 0.12; glow.style.transform = "translate(" + gx + "px," + gy + "px)"; raf = Math.abs(tx - gx) + Math.abs(ty - gy) > 0.5 ? requestAnimationFrame(loop) : null; };
    document.addEventListener("pointermove", function (e) {
      tx = e.clientX; ty = e.clientY; if (!raf) raf = requestAnimationFrame(loop);
      var g = e.target.closest && e.target.closest(".glass");
      if (g) { var r = g.getBoundingClientRect(); g.style.setProperty("--mx", (e.clientX - r.left) + "px"); g.style.setProperty("--my", (e.clientY - r.top) + "px"); }
    }, { passive: true });
  }

  /* 6. ID card 3D tilt */
  var card = $("#idcard"), area = $(".hero-right");
  if (card && fine && !reduce) {
    area.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      card.classList.add("tilting");
      card.style.transform = "rotateY(" + (x * 18) + "deg) rotateX(" + (-y * 14) + "deg)";
      card.style.setProperty("--sx", (50 + x * 100) + "%");
    });
    area.addEventListener("pointerleave", function () { card.classList.remove("tilting"); card.style.transform = ""; });
  }

  /* 7. Copy email */
  var toastT, toast = function (m) { var t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2200); };
  $("#copyMail").addEventListener("click", function () {
    var mail = "fixasif.connect@gmail.com";
    if (navigator.clipboard) navigator.clipboard.writeText(mail).then(function () { toast("Email copied ✓"); }, function () { location.href = "mailto:" + mail; });
    else location.href = "mailto:" + mail;
  });

  $("#yr").textContent = new Date().getFullYear();
})();
