/* ============================================================
   FixAsif Portfolio — Interactions
   Sections:
   1. Theme toggle (View Transitions API + clip-path wipe fallback)
   2. Navbar (scroll, mobile drawer, active link)
   3. Scroll reveal + staggered children
   4. Stat counters
   5. Hanging ID card — damped pendulum physics (mouse + touch)
   6. Contact form (Formspree, mailto fallback)
   7. Download CV
   ============================================================ */

(function () {
  'use strict';

  /* ==========================================================
     1. THEME TOGGLE
     ========================================================== */
  var themeToggle = document.getElementById('themeToggle');
  var themeIcon = document.getElementById('themeIcon');
  var themeWipe = document.getElementById('themeWipe');

  function getTheme() {
    try {
      return localStorage.getItem('theme') || 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeIcon) {
      themeIcon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
    }
  }

  applyTheme(getTheme());

  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : 'dark';

      var rect = themeToggle.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;

      function commit() {
        applyTheme(next);
        try { localStorage.setItem('theme', next); } catch (e) {}
      }

      if (document.startViewTransition) {
        var transition = document.startViewTransition(commit);
        transition.ready.then(function () {
          document.documentElement.animate(
            {
              clipPath: [
                'circle(0% at ' + cx + 'px ' + cy + 'px)',
                'circle(150% at ' + cx + 'px ' + cy + 'px)'
              ]
            },
            {
              duration: 520,
              easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
              pseudoElement: '::view-transition-new(root)'
            }
          );
        }).catch(function () { commit(); });
      } else if (themeWipe) {
        var radius = Math.hypot(
          Math.max(cx, window.innerWidth - cx),
          Math.max(cy, window.innerHeight - cy)
        ) * 1.05;

        themeWipe.style.pointerEvents = 'all';
        themeWipe.style.background = next === 'dark' ? '#0a0a0f' : '#eef1f8';
        themeWipe.style.transition = 'none';
        themeWipe.style.clipPath = 'circle(0px at ' + cx + 'px ' + cy + 'px)';

        void themeWipe.offsetWidth;

        themeWipe.style.transition = 'clip-path 0.55s cubic-bezier(0.4, 0, 0.2, 1)';
        themeWipe.style.clipPath = 'circle(' + radius + 'px at ' + cx + 'px ' + cy + 'px)';

        setTimeout(commit, 260);
        setTimeout(function () {
          themeWipe.style.transition = 'none';
          themeWipe.style.clipPath = 'circle(0px at ' + cx + 'px ' + cy + 'px)';
          void themeWipe.offsetWidth;
          themeWipe.style.pointerEvents = 'none';
          themeWipe.style.background = 'transparent';
          themeWipe.style.transition = 'clip-path 0.55s cubic-bezier(0.4, 0, 0.2, 1)';
          themeWipe.style.clipPath = 'circle(0px at ' + cx + 'px ' + cy + 'px)';
        }, 560);
        setTimeout(function () {
          themeWipe.style.transition = 'none';
          themeWipe.style.clipPath = 'none';
        }, 1200);
      } else {
        commit();
      }
    });
  }

  /* ==========================================================
     2. NAVBAR
     ========================================================== */
  var navbar = document.getElementById('navbar');
  var navLinks = document.getElementById('navLinks');
  var navHamburger = document.getElementById('navHamburger');

  function onScrollNav() {
    if (!navbar) return;
    if (window.scrollY > 40) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
  }
  window.addEventListener('scroll', onScrollNav, { passive: true });
  onScrollNav();

  if (navHamburger && navLinks) {
    navHamburger.addEventListener('click', function () {
      navHamburger.classList.toggle('active');
      navLinks.classList.toggle('open');
    });
  }

  document.querySelectorAll('.nav-link').forEach(function (link) {
    link.addEventListener('click', function () {
      if (navHamburger) navHamburger.classList.remove('active');
      if (navLinks) navLinks.classList.remove('open');
    });
  });

  var sections = document.querySelectorAll('section[id]');
  function updateActiveLink() {
    var pos = window.scrollY + window.innerHeight * 0.32;
    sections.forEach(function (section) {
      var link = document.querySelector('.nav-link[href="#' + section.id + '"]');
      if (!link) return;
      if (pos >= section.offsetTop && pos < section.offsetTop + section.offsetHeight) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }
  window.addEventListener('scroll', updateActiveLink, { passive: true });
  updateActiveLink();

  /* ==========================================================
     3. SCROLL REVEAL (with stagger inside each group)
     ========================================================== */
  var revealEls = document.querySelectorAll('.fade-up');

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var parent = el.parentElement;
        var siblings = parent ? Array.prototype.filter.call(
          parent.children,
          function (c) { return c.classList && c.classList.contains('fade-up'); }
        ) : [];
        var idx = siblings.indexOf(el);
        var delay = idx > 0 ? Math.min(idx * 90, 450) : 0;

        setTimeout(function () { el.classList.add('visible'); }, delay);
        observer.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

    revealEls.forEach(function (el) { observer.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('visible'); });
  }

  /* ==========================================================
     4. STAT COUNTERS
     ========================================================== */
  var counters = document.querySelectorAll('.stat-number[data-count]');

  function animateCounter(el) {
    var target = parseFloat(el.getAttribute('data-count')) || 0;
    var suffix = el.getAttribute('data-suffix') || '';
    var duration = 1400;
    var start = null;

    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = target + suffix;
    }
    requestAnimationFrame(step);
  }

  if (counters.length && 'IntersectionObserver' in window) {
    var counterObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(function (c) { counterObs.observe(c); });
  } else {
    counters.forEach(function (el) {
      el.textContent = (el.getAttribute('data-count') || '0') + (el.getAttribute('data-suffix') || '');
    });
  }

  /* ==========================================================
     5. HANGING ID CARD — DAMPED PENDULUM
     ----------------------------------------------------------
     Model: angular spring (pendulum). angle in radians.
       alpha = -STIFF * (angle - idleTarget) - DAMP * velocity
     plus a gravity term for a pendulum feel.
     ========================================================== */
  var idCard = document.getElementById('idCard');
  var stringEl = document.getElementById('stringEl');

  if (idCard) {
    /* ----- angular (swing) spring ----- */
    var STIFF = 46;         // angular stiffness
    var DAMP = 4.2;         // angular damping
    var GRAV = 1.5;         // pendulum gravity term
    var MAX_ANGLE = 0.5;    // ~29deg
    var IDLE_AMP = 0.04;
    var IDLE_PERIOD = 5200;

    /* ----- string (length) spring — gives the rubber-band bounce ----- */
    var STRING_H = 58;      // must match .id-card-string height in CSS
    var STR_K = 110;        // string stiffness
    var STR_C = 8.5;        // string damping
    var MAX_STRETCH = 95;

    var angle = 0, angVel = 0;
    var stringLen = STRING_H, strVel = 0;
    var idleOn = true, idleT = 0;
    var last = performance.now();

    var dragging = false;
    var rafId = null;
    var axis = null; // null | 'x' | 'y' (touch axis lock)
    var stretchTarget = 0;

    function setTransforms() {
      var scale = stringLen / STRING_H;
      var extra = stringLen - STRING_H;
      if (stringEl) {
        stringEl.style.transform = 'scaleY(' + scale.toFixed(4) + ')';
      }
      /* translate down by the stretch amount so the card stays glued to the
         string end; rotate about the top center for the swing */
      idCard.style.transform =
        'translateY(' + extra.toFixed(2) + 'px) rotate(' + angle.toFixed(4) + 'rad)';
    }

    function tick(now) {
      var dtMs = Math.min(now - last, 48);
      var dt = dtMs / 1000;
      last = now;

      /* ---- angular ---- */
      if (!dragging) {
        if (idleOn) {
          idleT += dtMs;
          var idleTarget = Math.sin((idleT / IDLE_PERIOD) * Math.PI * 2) * IDLE_AMP;
          var accel = -STIFF * (angle - idleTarget) - GRAV * Math.sin(angle) - DAMP * angVel;
          angVel += accel * dt;
        } else {
          var restoring = -STIFF * angle - GRAV * Math.sin(angle);
          angVel += (restoring - DAMP * angVel) * dt;
          if (Math.abs(angle) < 0.004 && Math.abs(angVel) < 0.012) {
            angle = 0; angVel = 0; idleOn = true; idleT = 0;
          }
        }
        angle += angVel * dt;
      }
      angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle));

      /* ---- string length spring (always runs => real bounce) ---- */
      var targetLen = STRING_H + stretchTarget;
      var strAccel = (targetLen - stringLen) * STR_K - strVel * STR_C;
      strVel += strAccel * dt;
      stringLen += strVel * dt;
      if (stringLen < STRING_H) {
        stringLen = STRING_H;
        if (strVel < 0) strVel = 0;
      }
      if (stringLen > STRING_H + MAX_STRETCH) {
        stringLen = STRING_H + MAX_STRETCH;
        if (strVel > 0) strVel = 0;
      }

      setTransforms();
      if (running) rafId = requestAnimationFrame(tick);
      else rafId = null;
    }

    /* ---------------------------------------------
       Pause the physics loop when the card is off-screen or the tab is hidden.
       A never-ending rAF loop writing transforms + shadows is a real battery
       and scroll-jank cost on phones.
       --------------------------------------------- */
    var running = true;

    function startLoop() {
      if (running && rafId !== null) return;
      running = true;
      last = performance.now();
      if (rafId === null) rafId = requestAnimationFrame(tick);
    }

    function stopLoop() {
      running = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    if ('IntersectionObserver' in window) {
      var visObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) startLoop();
          else stopLoop();
        });
      }, { threshold: 0 });
      visObs.observe(idCard);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopLoop();
      else startLoop();
    });

    /* desired string stretch, recomputed while dragging */
    var dragStartX = 0, dragStartY = 0;
    var angleAtStart = 0;
    var prevX = 0, prevT = 0;
    var lastPointerY = 0;

    function pointer(e) {
      if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
      return { x: e.clientX, y: e.clientY };
    }

    function beginDrag(e) {
      var p = pointer(e);
      dragging = true;
      idleOn = false;
      axis = null;
      dragStartX = p.x;
      dragStartY = p.y;
      lastPointerY = p.y;
      prevX = p.x;
      prevT = performance.now();
      angleAtStart = angle;
      angVel = 0;
      idCard.style.cursor = 'grabbing';
      window.addEventListener('mousemove', moveDrag);
      window.addEventListener('mouseup', endDrag);
      window.addEventListener('touchmove', moveDrag, { passive: false });
      window.addEventListener('touchend', endDrag);
      window.addEventListener('touchcancel', endDrag);
      if (e.cancelable && e.type === 'mousedown') e.preventDefault();
    }

    function moveDrag(e) {
      if (!dragging) return;
      var p = pointer(e);
      var dx = p.x - dragStartX;
      var dy = p.y - dragStartY;

      /* On touch: if the swipe is mostly vertical, release the card and let the
         page scroll normally. Horizontal drags manipulate the card. */
      if (axis === null && e.type === 'touchmove') {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axis === 'y') {
          dragging = false;
          idleOn = true;
          stretchTarget = 0;
          idCard.style.cursor = 'grab';
          detach();
          return;
        }
      } else if (axis === null) {
        axis = 'x';
      }

      lastPointerY = p.y;

      /* Correct direction: CSS rotate(+) turns clockwise, which moves the card's
         bottom LEFT. To make the bottom follow the pointer we negate dx. */
      angle = angleAtStart - dx * 0.005;

      /* Angular velocity for the release swing (previous sample). */
      var now = performance.now();
      var elapsed = now - prevT;
      if (elapsed > 8) {
        angVel = -((p.x - prevX) / elapsed) * 3.2;
        prevX = p.x; prevT = now;
      }

      /* Pull down (or pull sideways) to stretch the string; spring gives bounce. */
      var pullDown = Math.max(0, dy);
      var pullSide = Math.abs(dx) * 0.22;
      stretchTarget = Math.min(pullDown * 0.85 + pullSide, MAX_STRETCH);

      if (e.cancelable) e.preventDefault();
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      idCard.style.cursor = 'grab';
      angVel = Math.max(-3, Math.min(3, angVel));
      /* let the string snap back -> spring overshoots into a bounce */
      stretchTarget = 0;
      detach();
    }

    function detach() {
      window.removeEventListener('mousemove', moveDrag);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('touchmove', moveDrag);
      window.removeEventListener('touchend', endDrag);
      window.removeEventListener('touchcancel', endDrag);
    }

    idCard.addEventListener('mousedown', beginDrag);
    idCard.addEventListener('touchstart', beginDrag, { passive: true });

    /* animate skill bars once visible */
    if ('IntersectionObserver' in window) {
      var barObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('bars-in');
            barObs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.4 });
      barObs.observe(idCard);
    } else {
      idCard.classList.add('bars-in');
    }

    /* gentle opening nudge */
    setTimeout(function () { if (!dragging) { angVel = 0.8; stringLen = STRING_H + 10; } }, 900);

    setTransforms();
    rafId = requestAnimationFrame(tick);
  }

  /* ==========================================================
     6. CONTACT FORM
     ----------------------------------------------------------
     Default: Formspree. Set the real endpoint in index.html:
       action="https://formspree.io/f/YOUR_FORM_ID"
     If it still says YOUR_FORM_ID, we fall back to mailto:.
     ========================================================== */
  var contactForm = document.getElementById('contactForm');
  var formNote = document.getElementById('formNote');

  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();

      var name = (contactForm.querySelector('#name') || {}).value || '';
      var email = (contactForm.querySelector('#email') || {}).value || '';
      var message = (contactForm.querySelector('#message') || {}).value || '';
      var action = contactForm.getAttribute('action') || '';
      var btn = contactForm.querySelector('.btn-primary');
      var originalHTML = btn ? btn.innerHTML : '';
      var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRe.test(email)) {
        if (formNote) formNote.textContent = 'Please enter a valid email address.';
        return;
      }

      function success() {
        contactForm.reset();
        if (formNote) formNote.textContent = 'Message sent — thanks! I usually reply within a day.';
        if (btn) {
          btn.innerHTML = '<span>Sent!</span> <i class="fas fa-check"></i>';
          btn.style.background = 'linear-gradient(135deg, #10b981, #06b6d4)';
          setTimeout(function () {
            btn.innerHTML = originalHTML;
            btn.style.background = '';
          }, 2600);
        }
      }

      function mailtoFallback() {
        var subject = 'Portfolio Contact from ' + name;
        var body = 'Name: ' + name + '\nEmail: ' + email + '\n\nMessage:\n' + message;
        window.location.href = 'mailto:fixasif.connect@gmail.com' +
          '?subject=' + encodeURIComponent(subject) +
          '&body=' + encodeURIComponent(body);
        success();
      }

      if (!action || action.indexOf('YOUR_FORM_ID') !== -1) {
        mailtoFallback();
        return;
      }

      if (btn) btn.disabled = true;
      if (formNote) formNote.textContent = '';

      fetch(action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(contactForm)
      })
        .then(function (res) {
          if (res.ok) success();
          else mailtoFallback();
        })
        .catch(mailtoFallback)
        .finally(function () { if (btn) btn.disabled = false; });
    });
  }

  /* ==========================================================
     7. DOWNLOAD CV
     ----------------------------------------------------------
     Drop your PDF at assets/cv.pdf and this link will work.
     Until then it shows a note.
     ========================================================== */
  var downloadCV = document.getElementById('downloadCV');
  if (downloadCV) {
    downloadCV.addEventListener('click', function (e) {
      e.preventDefault();
      var a = document.createElement('a');
      a.href = 'assets/cv.pdf';
      a.download = 'Asif-CV.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  /* ==========================================================
     SMOOTH FIRST PAINT
     ========================================================== */
  document.body.style.opacity = '0';
  document.body.style.transition = 'opacity 0.6s ease';
  window.addEventListener('load', function () {
    requestAnimationFrame(function () { document.body.style.opacity = '1'; });
  });
  /* Safety: never leave the page invisible */
  setTimeout(function () { document.body.style.opacity = '1'; }, 1500);

})();