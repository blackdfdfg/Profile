/* ============================================
   DOM REFERENCES
   ============================================ */
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const themeWipe = document.getElementById('themeWipe');
const navbar = document.getElementById('navbar');
const navLinks = document.getElementById('navLinks');
const navHamburger = document.getElementById('navHamburger');
const idCard = document.getElementById('idCard');
const contactForm = document.getElementById('contactForm');

/* ============================================
   THEME TOGGLE WITH WIPE ANIMATION (FIX 5)
   View Transitions API with clip-path fallback
   ============================================ */
function getTheme() {
  return localStorage.getItem('theme') || 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  if (themeIcon) {
    themeIcon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
  }
}

applyTheme(getTheme());

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';

    const rect = themeToggle.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    function doToggle() {
      applyTheme(next);
      localStorage.setItem('theme', next);
    }

    /* Try View Transitions API first */
    if (document.startViewTransition) {
      const transition = document.startViewTransition(() => {
        doToggle();
      });
      transition.ready.then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              'circle(0% at ' + cx + 'px ' + cy + 'px)',
              'circle(150% at ' + cx + 'px ' + cy + 'px)'
            ]
          },
          {
            duration: 500,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            pseudoElement: '::view-transition-new(root)'
          }
        );
      });
    } else {
      /* Fallback: CSS clip-path circle wipe from button position */
      var maxDim = Math.max(window.innerWidth, window.innerHeight);
      var radius = maxDim * 1.8;

      themeWipe.style.pointerEvents = 'all';
      themeWipe.style.background = next === 'dark' ? '#0a0a0f' : '#f5f5f7';
      themeWipe.style.transition = 'none';
      themeWipe.style.clipPath = 'circle(0px at ' + cx + 'px ' + cy + 'px)';

      void themeWipe.offsetWidth;

      themeWipe.style.transition = 'clip-path 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
      themeWipe.style.clipPath = 'circle(' + radius + 'px at ' + cx + 'px ' + cy + 'px)';

      setTimeout(function() {
        doToggle();
      }, 250);

      setTimeout(function() {
        themeWipe.style.transition = 'none';
        themeWipe.style.clipPath = 'circle(' + radius + 'px at ' + cx + 'px ' + cy + 'px)';
        void themeWipe.offsetWidth;
        themeWipe.style.transition = 'clip-path 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
        themeWipe.style.clipPath = 'circle(0px at ' + cx + 'px ' + cy + 'px)';
      }, 500);

      setTimeout(function() {
        themeWipe.style.pointerEvents = 'none';
        themeWipe.style.background = 'transparent';
        themeWipe.style.clipPath = 'none';
        themeWipe.style.transition = 'none';
      }, 1100);
    }
  });
}

/* ============================================
   NAVBAR SCROLL EFFECT
   ============================================ */
window.addEventListener('scroll', () => {
  if (window.scrollY > 50) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
});

/* ============================================
   MOBILE NAV TOGGLE
   ============================================ */
if (navHamburger) {
  navHamburger.addEventListener('click', () => {
    navHamburger.classList.toggle('active');
    navLinks.classList.toggle('open');
  });
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    navHamburger.classList.remove('active');
    navLinks.classList.remove('open');
  });
});

/* ============================================
   ACTIVE NAV LINK ON SCROLL
   ============================================ */
const sections = document.querySelectorAll('section[id]');
function updateActiveLink() {
  const scrollY = window.scrollY + 120;
  sections.forEach(section => {
    const top = section.offsetTop;
    const height = section.offsetHeight;
    const id = section.getAttribute('id');
    const link = document.querySelector(`.nav-link[href="#${id}"]`);
    if (link) {
      if (scrollY >= top && scrollY < top + height) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    }
  });
}
window.addEventListener('scroll', updateActiveLink);

/* ============================================
   SCROLL FADE-UP ANIMATION
   ============================================ */
const fadeEls = document.querySelectorAll('.fade-up');
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry, index) => {
    if (entry.isIntersecting) {
      setTimeout(() => {
        entry.target.classList.add('visible');
      }, index * 80);
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

fadeEls.forEach(el => observer.observe(el));

/* ============================================
   HANGING ID CARD — DAMPED HARMONIC OSCILLATOR
   ============================================ */
(function () {
  if (!idCard) return;

  const stringEl = idCard.parentElement.querySelector('.id-card-string');
  const REST_STRING_H = 60;

  /* Damped harmonic oscillator: stiffness, damping, mass */
  const STIFFNESS = 200;
  const DAMPING = 14;
  const MASS = 1;
  const MAX_ANGLE = 0.55;

  /* Idle sine swing */
  const IDLE_AMPLITUDE = 0.04;
  const IDLE_PERIOD = 4000;

  /* State */
  let angle = 0;
  let velocity = 0;
  let isDragging = false;
  let dragStartX = 0;
  let angleAtDragStart = 0;
  let lastTime = performance.now();
  let idleEnabled = true;
  let idleTime = 0;

  /* Track recent movement for velocity estimation */
  let prevDragX = 0;
  let prevDragTime = 0;

  function tick(now) {
    const dtMs = Math.min(now - lastTime, 50);
    const dt = dtMs / 1000;
    lastTime = now;

    if (!isDragging) {
      if (idleEnabled) {
        /* Deterministic sine idle swing — additive on top of spring */
        idleTime += dtMs;
        const idleTarget = Math.sin((idleTime / IDLE_PERIOD) * Math.PI * 2) * IDLE_AMPLITUDE;
        const displacement = angle - idleTarget;
        const springForce = -STIFFNESS * displacement;
        const dampingForce = -DAMPING * velocity;
        const acceleration = (springForce + dampingForce) / MASS;
        velocity += acceleration * dt;
        angle += velocity * dt;
      } else {
        /* Pure spring back to center */
        const springForce = -STIFFNESS * angle;
        const dampingForce = -DAMPING * velocity;
        const acceleration = (springForce + dampingForce) / MASS;
        velocity += acceleration * dt;
        angle += velocity * dt;

        /* Re-enable idle once settled */
        if (Math.abs(angle) < 0.005 && Math.abs(velocity) < 0.01) {
          angle = 0;
          velocity = 0;
          idleEnabled = true;
          idleTime = 0;
        }
      }
    }

    /* Clamp */
    angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle));

    /* Apply rotation */
    idCard.style.transform = 'rotate(' + angle + 'rad)';

    /* String stretch — based on horizontal drag distance */
    updateString();

    requestAnimationFrame(tick);
  }

  function updateString() {
    if (!stringEl) return;
    let stretch = 0;
    if (isDragging) {
      /* String stretches based on angular displacement (horizontal component) */
      const rect = idCard.getBoundingClientRect();
      const cardHeight = rect.height;
      const horizontalDisp = Math.abs(angle) * cardHeight * 0.5;
      stretch = Math.min(horizontalDisp * 0.35, 60);
    } else {
      /* Spring back with overshoot via velocity */
      stretch = Math.abs(velocity) * 18;
      stretch = Math.min(stretch, 40);
    }
    const totalH = REST_STRING_H + Math.max(0, stretch);
    stringEl.style.height = totalH + 'px';
    stringEl.style.transition = isDragging
      ? 'height 0.08s linear'
      : 'height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
  }

  function getClientXY(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function onDragStart(e) {
    isDragging = true;
    idleEnabled = false;
    const pos = getClientXY(e);
    dragStartX = pos.x;
    prevDragX = pos.x;
    prevDragTime = performance.now();
    angleAtDragStart = angle;
    velocity = 0;
    idCard.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!isDragging) return;
    const pos = getClientXY(e);
    const dx = pos.x - dragStartX;

    /* Direct mapping: drag right → positive dx → positive angle → bottom swings right */
    angle = angleAtDragStart + dx * 0.005;
    angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle));

    /* Track velocity for release momentum (use PREVIOUS position) */
    const now = performance.now();
    const elapsed = now - prevDragTime;
    if (elapsed > 5) {
      velocity = (pos.x - prevDragX) / elapsed * 3;
      prevDragX = pos.x;
      prevDragTime = now;
    }

    e.preventDefault();
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    idCard.style.cursor = 'grab';
    /* Clamp release velocity */
    velocity = Math.max(-2, Math.min(2, velocity));
  }

  /* Mouse events */
  idCard.addEventListener('mousedown', onDragStart);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);

  /* Touch events */
  idCard.addEventListener('touchstart', onDragStart, { passive: false });
  window.addEventListener('touchmove', onDragMove, { passive: false });
  window.addEventListener('touchend', onDragEnd);

  /* Initial gentle nudge */
  setTimeout(() => { velocity = 0.8; }, 1000);

  requestAnimationFrame(tick);
})();

/* ============================================
   CONTACT FORM HANDLER
   ============================================ */
if (contactForm) {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = contactForm.querySelector('#name').value;
    const email = contactForm.querySelector('#email').value;
    const message = contactForm.querySelector('#message').value;

    const mailtoLink = `mailto:fixasif.connect@gmail.com?subject=Portfolio Contact from ${encodeURIComponent(name)}&body=${encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`)}`;
    window.location.href = mailtoLink;

    contactForm.reset();

    const btn = contactForm.querySelector('.btn-primary');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<span>Message Sent!</span> <i class="fas fa-check"></i>';
    btn.style.background = 'linear-gradient(135deg, #10b981, #06b6d4)';
    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.style.background = '';
    }, 2500);
  });
}

/* ============================================
   SMOOTH REVEAL ON LOAD
   ============================================ */
window.addEventListener('load', () => {
  document.body.style.opacity = '0';
  document.body.style.transition = 'opacity 0.6s ease';
  requestAnimationFrame(() => {
    document.body.style.opacity = '1';
  });
});
