/* Fix X Agent, picture guide tabs + install link fallback */
(function () {
  var STORE = "https://chromewebstore.google.com/detail/aflcefboffcaidnhpdpipkgolabifnfe";
  function fixLinks() {
    document.querySelectorAll("[data-ext-link]").forEach(function (a) {
      var h = a.getAttribute("href");
      if (!h || h === "#") a.setAttribute("href", STORE);
    });
  }
  fixLinks(); setTimeout(fixLinks, 1500); setTimeout(fixLinks, 5000);
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-ext-link]");
    if (a && (!a.getAttribute("href") || a.getAttribute("href") === "#")) a.setAttribute("href", STORE);
  }, true);

  function show(tab) {
    document.querySelectorAll("[data-gtab]").forEach(function (b) {
      var on = b.dataset.gtab === tab; b.classList.toggle("active", on); b.setAttribute("aria-selected", on);
    });
    document.querySelectorAll("[data-gpanel]").forEach(function (p) { p.hidden = p.dataset.gpanel !== tab; });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-gtab]");
    if (b) { show(b.dataset.gtab); return; }
    var l = e.target.closest && e.target.closest("[data-guide-tab]");
    if (l) show(l.dataset.guideTab);
  });

  // Zoom a guide picture
  var zoom = document.createElement("div"); zoom.className = "gzoom"; zoom.hidden = true;
  zoom.innerHTML = '<button class="gzoom-x" aria-label="Close"><i class="fa-solid fa-xmark"></i></button><img alt="">';
  document.body.appendChild(zoom);
  document.addEventListener("click", function (e) {
    var img = e.target.closest && e.target.closest(".gshot img");
    if (img) { zoom.querySelector("img").src = img.src; zoom.hidden = false; document.body.style.overflow = "hidden"; return; }
    if (!zoom.hidden && e.target.closest(".gzoom")) { zoom.hidden = true; document.body.style.overflow = ""; }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !zoom.hidden) { zoom.hidden = true; document.body.style.overflow = ""; } });

  // Hide the mobile bar while the user is on the dashboard
  function bar() { var m = document.querySelector(".mbar"); if (m) m.hidden = location.hash.indexOf("#/dashboard") === 0; }
  window.addEventListener("hashchange", bar); bar();
})();
