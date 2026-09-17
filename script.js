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
    const maxDim = Math.max(window.innerWidth, window.innerHeight);
    const radius = maxDim * 2;

    /* Phase 1: Expand circle from button with new theme color */
    themeWipe.style.pointerEvents = 'all';
    themeWipe.style.background = next === 'dark' ? '#0a0a0f' : '#f0f0f5';
    themeWipe.style.transition = 'none';
    themeWipe.style.clipPath = `circle(0px at ${cx}px ${cy}px)`;

    /* Force reflow */
    void themeWipe.offsetWidth;

    themeWipe.style.transition = 'clip-path 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
    themeWipe.style.clipPath = `circle(${radius}px at ${cx}px ${cy}px)`;

    /* Phase 2: Switch theme when circle covers screen */
    setTimeout(() => {
      applyTheme(next);
      localStorage.setItem('theme', next);
    }, 300);

    /* Phase 3: Shrink circle from opposite corner to reveal */
    setTimeout(() => {
      const revealX = next === 'dark' ? window.innerWidth : 0;
      const revealY = next === 'dark' ? 0 : window.innerHeight;
      themeWipe.style.transition = 'none';
      themeWipe.style.clipPath = `circle(${radius}px at ${cx}px ${cy}px)`;

      void themeWipe.offsetWidth;

      themeWipe.style.transition = 'clip-path 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
      themeWipe.style.clipPath = `circle(0px at ${revealX}px ${revealY}px)`;
    }, 500);

    /* Phase 4: Clean up */
    setTimeout(() => {
      themeWipe.style.pointerEvents = 'none';
      themeWipe.style.background = 'transparent';
      themeWipe.style.clipPath = 'none';
      themeWipe.style.transition = 'none';
    }, 1200);
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
   HANGING ID CARD — SPRING PHYSICS (FIX 1+2)
   ============================================ */
(function () {
  if (!idCard) return;

  const stringEl = idCard.parentElement.querySelector('.id-card-string');
  const wrapper = idCard.parentElement;
  const restStringH = 60;

  /* Spring physics state */
  let angle = 0;
  let angularVelocity = 0;
  const stiffness = 0.015;
  const damping = 0.92;
  const maxAngle = 0.55;

  let isDragging = false;
  let dragStartX = 0;
  let dragAngle = 0;
  let lastTime = performance.now();

  /* Controlled idle swing */
  let idleEnabled = true;
  let idleTime = 0;
  const idleAmplitude = 0.06;
  const idleSpeed = 0.0008;

  function tick(now) {
    const rawDt = (now - lastTime) / 16.667;
    const dt = Math.min(rawDt, 3);
    lastTime = now;

    if (isDragging) {
      /* During drag, just follow the finger/mouse */
    } else if (idleEnabled) {
      /* Controlled gentle idle swing */
      idleTime += dt * 16.667;
      const idleAngle = Math.sin(idleTime * idleSpeed) * idleAmplitude;
      /* Blend idle with spring physics */
      const springForce = -stiffness * (angle - idleAngle);
      angularVelocity += springForce * dt;
      angularVelocity *= Math.pow(damping, dt);
      angle += angularVelocity * dt;
    } else {
      /* Pure spring physics — returns to center */
      const springForce = -stiffness * angle;
      angularVelocity += springForce * dt;
      angularVelocity *= Math.pow(damping, dt);
      angle += angularVelocity * dt;
    }

    /* Clamp */
    angle = Math.max(-maxAngle, Math.min(maxAngle, angle));

    /* Apply rotation */
    idCard.style.transform = `rotate(${angle}rad) translateY(0)`;

    /* Elastic string stretch based on displacement */
    if (stringEl) {
      const displacement = Math.abs(angle);
      const stretch = displacement * 80;
      const bounce = isDragging ? stretch : stretch * Math.abs(angularVelocity) * 8;
      const totalH = restStringH + Math.max(0, bounce);
      stringEl.style.height = totalH + 'px';
      stringEl.style.transition = isDragging ? 'height 0.1s ease-out' : 'height 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

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
    dragAngle = angle;
    angularVelocity = 0;
    idCard.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!isDragging) return;
    const pos = getClientXY(e);
    const dx = pos.x - dragStartX;
    /* Direct 1:1 mapping — drag right = tilt right (positive angle = bottom right) */
    angle = dragAngle + dx * 0.005;
    angle = Math.max(-maxAngle, Math.min(maxAngle, angle));
    e.preventDefault();
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    idCard.style.cursor = 'grab';
    /* Give a small velocity based on current angle for natural spring-back */
    angularVelocity = angle * 0.3;
    /* Re-enable idle swing after spring settles */
    setTimeout(() => {
      if (Math.abs(angle) < 0.01 && Math.abs(angularVelocity) < 0.001) {
        idleEnabled = true;
        idleTime = 0;
      }
    }, 2000);
  }

  idCard.addEventListener('mousedown', onDragStart);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);

  idCard.addEventListener('touchstart', onDragStart, { passive: false });
  window.addEventListener('touchmove', onDragMove, { passive: false });
  window.addEventListener('touchend', onDragEnd);

  /* Initial gentle nudge */
  setTimeout(() => {
    angularVelocity = 0.012;
  }, 1000);
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
