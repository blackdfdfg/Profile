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
   THEME TOGGLE WITH WIPE ANIMATION
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
    const radius = maxDim * 1.5;

    themeWipe.classList.add('active');
    themeWipe.style.clipPath = `circle(0px at ${cx}px ${cy}px)`;
    themeWipe.style.background = next === 'dark' ? '#0a0a0f' : '#f0f0f5';
    themeWipe.style.transition = 'clip-path 0.7s cubic-bezier(0.23, 1, 0.32, 1)';

    requestAnimationFrame(() => {
      themeWipe.style.clipPath = `circle(${radius}px at ${cx}px ${cy}px)`;
    });

    setTimeout(() => {
      applyTheme(next);
      localStorage.setItem('theme', next);
    }, 350);

    setTimeout(() => {
      themeWipe.classList.remove('active');
      themeWipe.style.transition = 'clip-path 0.5s cubic-bezier(0.23, 1, 0.32, 1)';
      themeWipe.style.clipPath = `circle(${radius}px at ${cx}px ${cy}px)`;
      requestAnimationFrame(() => {
        themeWipe.style.clipPath = `circle(0px at ${cx}px ${cy}px)`;
      });
    }, 500);

    setTimeout(() => {
      themeWipe.style.background = 'transparent';
    }, 1100);
  });
}

/* ============================================
   NAVBAR SCROLL EFFECT
   ============================================ */
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const st = window.scrollY;
  if (st > 50) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
  lastScroll = st;
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
   HANGING ID CARD — PHYSICS-BASED SWING & DRAG
   ============================================ */
(function () {
  if (!idCard) return;

  let angle = 0;
  let angularVelocity = 0;
  const damping = 0.985;
  const gravity = 0.0004;
  let isDragging = false;
  let dragStartX = 0;
  let dragAngle = 0;
  let animFrame = null;
  let lastTime = performance.now();

  function tick(now) {
    const dt = Math.min((now - lastTime) / 16.667, 3);
    lastTime = now;

    if (!isDragging) {
      const force = -gravity * Math.sin(angle) * dt;
      angularVelocity += force;
      angularVelocity *= Math.pow(damping, dt);
      angle += angularVelocity * dt;
    }

    idCard.style.transform = `rotate(${angle}rad)`;
    animFrame = requestAnimationFrame(tick);
  }

  animFrame = requestAnimationFrame(tick);

  function getClientX(e) {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
    return e.clientX;
  }

  function onDragStart(e) {
    isDragging = true;
    dragStartX = getClientX(e);
    dragAngle = angle;
    angularVelocity = 0;
    idCard.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!isDragging) return;
    const dx = getClientX(e) - dragStartX;
    angle = dragAngle + dx * 0.006;
    angle = Math.max(-0.6, Math.min(0.6, angle));
    e.preventDefault();
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    idCard.style.cursor = 'grab';
  }

  idCard.addEventListener('mousedown', onDragStart);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);

  idCard.addEventListener('touchstart', onDragStart, { passive: false });
  window.addEventListener('touchmove', onDragMove, { passive: false });
  window.addEventListener('touchend', onDragEnd);

  /* Auto swing on load */
  setTimeout(() => {
    angularVelocity = 0.025;
  }, 800);

  /* Mouse proximity effect */
  document.addEventListener('mousemove', (e) => {
    if (isDragging) return;
    const rect = idCard.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 300) {
      const push = (300 - dist) / 300;
      const targetAngle = dx * 0.0003 * push;
      angle += (targetAngle - angle) * 0.03;
    }
  });
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
