import { makeQrPngDataUrl } from './qr.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// ============================================================================
// WONDERLAB AR • PLAY MAGIC REEF INSPIRED WEBSITE + SUPABASE ROOMS & BOOKINGS
// ============================================================================

const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function cleanRoomCode(raw) {
  const cleaned = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 28);
  return cleaned.length >= 2 ? cleaned : 'WONDER-REEF';
}

function randomTankCode(prefix = 'REEF') {
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}

const I18N = {
  en: {
    nav_home: 'Home',
    nav_how: 'How it works',
    nav_pricing: 'Pricing',
    nav_story: 'Our Story',
    nav_try: 'Try It Free',
    nav_scan: '📷 Scan Sheet',
    hero_eyebrow: '✨ A 3D & Web AR world made by them',
    hero_h1_1: 'A little scribble.',
    hero_h1_2: 'A sea of possibilities.',
    hero_sub:
      'Kids color a sea creature on paper. Snap a photo with any phone — watch it pop out in 3D Web AR and swim live in your shared aquarium!',
    hero_cta_primary: 'Bring a fish to life',
    hero_cta_secondary: 'See how it works',
    hero_note: '6 3D creatures free · Own Tank Code · No app needed',
    idea_kicker: 'THE WHOLE IDEA',
    idea_title: 'Every kid at the table colors a fish on paper, and the 3D reef fills up on the big screen.',
    idea_sub:
      'Try our live 3D reef right inside the TV below — drop fish food, summon a friendly shark, or scan the QR code with your phone!'
  },
  si: {
    nav_home: 'මුල් පිටුව',
    nav_how: 'ක්‍රියා කරන හැටි',
    nav_pricing: 'පැකේජ',
    nav_story: 'අපේ කතාව',
    nav_try: 'නොමිලේ අරින්න',
    nav_scan: '📷 Scan කරන්න',
    hero_eyebrow: '✨ දරුවන්ගේ අතින්ම හැදෙන සජීවී 3D ලෝකයක්',
    hero_h1_1: 'පුංචි පාට කිරීමක්.',
    hero_h1_2: 'සජීවී 3D සාගරයක්.',
    hero_sub:
      'ළමයි A4 කොළයක මාළුවෙක් පාට කරනවා. දුරකථනයෙන් ඡායාරූපයක් ගත් සැණින් Web AR වලිනුත්, විශාල TV හෝ Projector තිරයේ 3D වලිනුත් සජීවීව පීනනවා!',
    hero_cta_primary: 'මාළුවෙක්ට පණ දෙන්න',
    hero_cta_secondary: 'ක්‍රියා කරන හැටි බලන්න',
    hero_note: '3D මාළු 6 දෙනෙක් නොමිලේ · වෙනම Tank Code · App අවශ්‍ය නැත',
    idea_kicker: 'මූලික අදහස',
    idea_title: 'මේසයේ ඉන්න හැම ළමයෙක්ම මාළුවෙක් පාට කරනවා — විශාල තිරයේ 3D සාගරය සජීවීව පිරෙනවා.',
    idea_sub:
      'පහත TV තිරයේ පෙනෙන්නේ සජීවීව ක්‍රියා කරන සැබෑම 3D Aquarium එකයි! මාළුන්ට කෑම දාන්න, මෝරෙක් ගෙන්වන්න හෝ දුරකථනයෙන් QR කේතය Scan කර බලන්න.'
  }
};

function initStickyHeaderAndMobileMenu() {
  const header = document.getElementById('pmr-header');
  const onScroll = () => {
    header?.classList.toggle('scrolled', window.scrollY > 14);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const mobileBtn = document.getElementById('btn-mobile-menu');
  const drawer = document.getElementById('pmr-mobile-drawer');
  mobileBtn?.addEventListener('click', () => {
    drawer?.classList.toggle('open');
  });
}

function initLanguageSwitcher() {
  let lang = localStorage.getItem('wonderlab_site_lang') || 'en';
  const btn = document.getElementById('btn-lang-switch');

  const applyLang = () => {
    if (btn) btn.textContent = lang === 'en' ? '🌐 EN ▾' : '🌐 සිං ▾';
    const dict = I18N[lang];
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (dict && dict[key]) el.textContent = dict[key];
    });
  };

  applyLang();

  btn?.addEventListener('click', () => {
    lang = lang === 'en' ? 'si' : 'en';
    localStorage.setItem('wonderlab_site_lang', lang);
    applyLang();
  });
}

function initScrollRevealAnimations() {
  const els = document.querySelectorAll('.reveal-up');
  if (!els.length) return;

  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('in-view'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -30px 0px' }
  );

  els.forEach((el, idx) => {
    el.style.transitionDelay = `${(idx % 4) * 55}ms`;
    io.observe(el);
  });
}

function initLiveAquariumTvAndQr() {
  const qrImg = document.getElementById('pmr-qr-img');
  const qrUrlEl = document.getElementById('pmr-qr-url');
  if (qrImg) {
    const scanUrlObj = new URL('./scan.html', window.location.href);
    scanUrlObj.searchParams.set('tank', 'WONDER-REEF');
    const scanUrl = scanUrlObj.href;
    qrImg.src = makeQrPngDataUrl(scanUrl, 260, '#171715', '#ffffff');
    if (qrUrlEl) qrUrlEl.textContent = scanUrl.replace(/^https?:\/\//, '');
  }

  const iframe = document.getElementById('pmr-live-iframe');
  const postToTank = (type) => {
    iframe?.contentWindow?.postMessage({ type }, '*');
  };

  document.getElementById('btn-tv-feed')?.addEventListener('click', () => postToTank('aquarium:feed'));
  document.getElementById('btn-tv-shark')?.addEventListener('click', () => postToTank('aquarium:shark'));
  document.getElementById('btn-tv-labels')?.addEventListener('click', () => postToTank('aquarium:labels'));
}

function initTankNewLauncher() {
  const newCodeInp = document.getElementById('new-tank-code');
  const createForm = document.getElementById('create-tank-form');
  if (newCodeInp) {
    newCodeInp.value = randomTankCode('REEF');
  }

  document.getElementById('btn-reroll-code')?.addEventListener('click', () => {
    if (newCodeInp) newCodeInp.value = randomTankCode('REEF');
  });

  createForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-create-launch-tank');
    const errEl = document.getElementById('create-tank-error');
    const code = cleanRoomCode(newCodeInp?.value || randomTankCode('REEF'));
    const title = document.getElementById('new-tank-title')?.value?.trim() || '';
    const pin = document.getElementById('new-tank-pin')?.value?.trim() || '';
    const pin2 = document.getElementById('new-tank-pin2')?.value?.trim() || '';

    const showErr = (msg) => {
      if (!errEl) return alert(msg);
      errEl.textContent = msg;
      errEl.style.display = msg ? 'block' : 'none';
    };
    showErr('');

    if (!/^[0-9]{4,12}$/.test(pin) || pin === '1234') {
      showErr('PIN එක ඉලක්කම් 4–12ක් විය යුතුයි (1234 බැහැ). • PIN must be 4–12 digits (not 1234).');
      return;
    }
    if (pin !== pin2) {
      showErr('PIN දෙක සමාන නැහැ. • PINs do not match.');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = '🌊 Creating your reef...';
    }

    const resetBtn = () => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🌊 Launch My Private 3D Tank →';
      }
    };

    if (!sb) {
      showErr('Server එකට connect වෙන්න බැහැ. Internet එක check කරන්න.');
      resetBtn();
      return;
    }

    const { data, error } = await sb.rpc('create_tank_with_pin', {
      target_room: code,
      target_title: title,
      new_pin: pin
    });
    if (error || !data?.ok) {
      const codeErr = data?.error;
      showErr(
        codeErr === 'TANK_EXISTS'
          ? 'මේ Tank Code එක දැනටමත් පාවිච්චි වෙනවා. 🎲 New ඔබලා වෙන code එකක් ගන්න.'
          : codeErr === 'WEAK_PIN'
            ? 'PIN එක ඉලක්කම් 4–12ක් විය යුතුයි (1234 බැහැ).'
            : codeErr === 'INVALID_ROOM_CODE'
              ? 'Tank Code එක අකුරු / ඉලක්කම් 2–28ක් විය යුතුයි.'
              : 'Tank එක හදන්න බැරි වුණා. Internet එක check කරලා ආයෙ උත්සාහ කරන්න.'
      );
      resetBtn();
      return;
    }

    try {
      sessionStorage.setItem('wonderfish_active_room', code);
      // Same key as supabase-api.js rememberAdminPin(): lets the TV page Start the event in one tap
      sessionStorage.setItem(`wonderfish_admin_pin:${code}`, pin);
    } catch (_) {}

    window.location.href = `./aquarium.html?tank=${encodeURIComponent(code)}`;
  });

  const joinInp = document.getElementById('join-tank-code');
  document.getElementById('btn-join-screen')?.addEventListener('click', () => {
    const code = cleanRoomCode(joinInp?.value || 'WONDER-REEF');
    sessionStorage.setItem('wonderfish_active_room', code);
    window.location.href = `./aquarium.html?tank=${encodeURIComponent(code)}`;
  });

  document.getElementById('btn-join-scanner')?.addEventListener('click', () => {
    const code = cleanRoomCode(joinInp?.value || 'WONDER-REEF');
    sessionStorage.setItem('wonderfish_active_room', code);
    window.location.href = `./scan.html?tank=${encodeURIComponent(code)}`;
  });
}

function initSheetLightbox() {
  const modal = document.getElementById('pmr-lightbox');
  const img = document.getElementById('pmr-lb-img');
  const title = document.getElementById('pmr-lb-title');
  const dl = document.getElementById('pmr-lb-dl');
  const close = document.getElementById('pmr-lb-close');

  document.querySelectorAll('[data-sheet-preview]').forEach((el) => {
    el.addEventListener('click', () => {
      const src = el.getAttribute('data-sheet-preview');
      const name = el.getAttribute('data-sheet-title') || 'Coloring Sheet';
      if (img && src) img.src = src;
      if (title) title.textContent = `${name} · Printable A4 Sheet`;
      if (dl && src) {
        dl.href = src;
        dl.setAttribute('download', `${name.toLowerCase().replace(/\s+/g, '-')}-a4.png`);
      }
      modal?.classList.remove('hidden');
    });
  });

  close?.addEventListener('click', () => modal?.classList.add('hidden'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

function initFaqAccordion() {
  document.querySelectorAll('.pmr-faq-q').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.pmr-faq-item');
      if (!item) return;
      const open = item.classList.contains('open');
      document.querySelectorAll('.pmr-faq-item.open').forEach((o) => o.classList.remove('open'));
      if (!open) item.classList.add('open');
    });
  });
}

function initPricingCurrencySwitcher() {
  const sel = document.getElementById('currency-select');
  if (!sel) return;

  // Prices are NOT final yet — the pricing page shows "Coming soon" and the
  // currency selector is hidden (commented out in pricing.html), so this
  // function is currently a no-op. When prices are final: fill these in,
  // e.g. LKR: { play: 'Rs 1,500', day: 'Rs 3,000' }, and un-comment the selector.
  const prices = {
    USD: { play: '', day: '' },
    LKR: { play: '', day: '' },
    EUR: { play: '', day: '' }
  };

  sel.addEventListener('change', () => {
    const p = prices[sel.value] || prices.USD;
    if (!p.play || !p.day) return; // keep "Coming soon" until prices are set
    const elPlay = document.getElementById('price-val-play');
    const elDay = document.getElementById('price-val-day');
    if (elPlay) elPlay.innerHTML = `${p.play} <small>once</small>`;
    if (elDay) elDay.innerHTML = `${p.day} <small>once</small>`;
  });
}

function initSupabaseBookingForm() {
  const pkgSelect = document.getElementById('inq-pkg');
  document.querySelectorAll('[data-pick-pkg]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-pick-pkg');
      if (pkgSelect && val) pkgSelect.value = val;
      document.getElementById('inquiry-box')?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  const form = document.getElementById('pmr-inquiry-form');
  const toast = document.getElementById('pmr-inquiry-toast');
  const submitBtn = document.getElementById('btn-submit-inquiry');
  const waBtn = document.getElementById('btn-send-wa');

  const collectData = () => {
    const clientName = document.getElementById('inq-name')?.value?.trim() || '';
    const contactInfo = document.getElementById('inq-contact')?.value?.trim() || '';
    const organizationOrEvent = document.getElementById('inq-org')?.value?.trim() || '';
    const selectedPlan = document.getElementById('inq-pkg')?.value || 'Day & Party Pass (Birthday / School)';
    const preferredDate = document.getElementById('inq-date')?.value?.trim() || '';
    const rawCode = document.getElementById('inq-tank-code')?.value?.trim() || '';
    const requestedTankCode = rawCode ? cleanRoomCode(rawCode) : '';
    const notes = document.getElementById('inq-notes')?.value?.trim() || '';
    return {
      clientName,
      contactInfo,
      organizationOrEvent,
      selectedPlan,
      preferredDate,
      requestedTankCode,
      notes
    };
  };

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = collectData();
    if (!d.clientName) return;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Saving to WonderLab...';
    }

    try {
      if (!sb) throw new Error('Supabase client unavailable');
      const { error } = await sb.from('client_inquiries').insert({
        client_name: d.clientName.slice(0, 80),
        contact_info: d.contactInfo.slice(0, 120),
        organization_or_event: d.organizationOrEvent.slice(0, 120),
        selected_plan: d.selectedPlan.slice(0, 80),
        preferred_date: d.preferredDate.slice(0, 60),
        requested_tank_code: d.requestedTankCode,
        notes: d.notes.slice(0, 1000)
      });

      if (error) throw error;

      if (toast) {
        toast.style.background = '#dcfce7';
        toast.style.color = '#166534';
        toast.classList.remove('hidden');
        toast.innerHTML =
          `🎉 <strong>Thank you, ${d.clientName}!</strong> Your booking request has been saved directly to WonderLab AR` +
          (d.requestedTankCode ? ` (Requested Tank Code: <code>${d.requestedTankCode}</code>)` : '') +
          `. We will get in touch soon!`;
      }
      form.reset();
    } catch (err) {
      if (toast) {
        toast.style.background = '#fee2e2';
        toast.style.color = '#991b1b';
        toast.classList.remove('hidden');
        toast.textContent = '⚠️ Could not submit right now: ' + (err?.message || 'Please check connection.');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 Send Booking Request';
      }
    }
  });

  waBtn?.addEventListener('click', () => {
    const d = collectData();
    const msg =
      `Hello WonderLab AR! 🐠✨\n` +
      `I would love to book / inquire about WonderFish 3D Aquarium.\n\n` +
      `• Name: ${d.clientName || 'Host'}\n` +
      `• Contact: ${d.contactInfo || '-'}\n` +
      `• Event / Venue: ${d.organizationOrEvent || '-'}\n` +
      `• Plan: ${d.selectedPlan}\n` +
      (d.preferredDate ? `• Date: ${d.preferredDate}\n` : '') +
      (d.requestedTankCode ? `• Tank Code Idea: ${d.requestedTankCode}\n` : '') +
      `• Notes: ${d.notes || '-'}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  });
}

function initHeroMarketingVideo() {
  const video = document.getElementById('hero-marketing-video');
  if (!video) return;

  const soundBtn = document.getElementById('hero-video-sound');
  const playBtn = document.getElementById('hero-video-play');
  const LABELS = {
    en: { soundOff: 'Tap for sound', soundOn: 'Sound on', pause: 'Pause video', play: 'Play video' },
    si: { soundOff: 'ශබ්දය අහන්න', soundOn: 'ශබ්දය ඇත', pause: 'වීඩියෝව නවත්වන්න', play: 'වීඩියෝව ධාවනය කරන්න' }
  };
  const t = () => LABELS[localStorage.getItem('wonderlab_site_lang')] || LABELS.en;

  let userPaused = false;

  // Pick the right file for the screen. Browsers that ignore <source media="">
  // would otherwise always take the first (mobile) source, so correct it here.
  const SOURCES = {
    mobile: { src: './assets/marketing-video-mobile.mp4', poster: './assets/marketing-video-poster-mobile.jpg' },
    desktop: { src: './assets/Markating%20Video.mp4', poster: './assets/marketing-video-poster.jpg' }
  };
  const saveData = navigator.connection?.saveData === true;
  const isSmall = window.matchMedia?.('(max-width: 768px)').matches;
  const wanted = isSmall || saveData ? SOURCES.mobile : SOURCES.desktop;
  const wantedFile = wanted.src.split('/').pop();
  video.poster = wanted.poster;
  const current = decodeURI(video.currentSrc || '');
  if (current && !current.endsWith(decodeURI(wantedFile))) {
    video.src = wanted.src;
    video.load();
  } else if (!current) {
    video.querySelectorAll('source').forEach((s) => s.remove());
    video.src = wanted.src;
  }

  const render = () => {
    const L = t();
    if (soundBtn) {
      soundBtn.setAttribute('aria-pressed', String(!video.muted));
      soundBtn.querySelector('.hero-video-btn-icon').textContent = video.muted ? '🔇' : '🔊';
      soundBtn.querySelector('.hero-video-btn-label').textContent = video.muted ? L.soundOff : L.soundOn;
    }
    if (playBtn) {
      playBtn.querySelector('span').textContent = video.paused ? '▶' : '❚❚';
      playBtn.setAttribute('aria-label', video.paused ? L.play : L.pause);
    }
  };

  const tryPlay = () => {
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => render());
  };

  // Respect reduced-motion / data-saver users: show the poster, let them press play.
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || saveData) {
    video.removeAttribute('autoplay');
    video.pause();
    userPaused = true;
  }

  soundBtn?.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted) {
      video.volume = 1;
      if (video.paused) {
        userPaused = false;
        tryPlay();
      }
    }
    render();
  });

  playBtn?.addEventListener('click', () => {
    if (video.paused) {
      userPaused = false;
      tryPlay();
    } else {
      userPaused = true;
      video.pause();
    }
  });

  ['play', 'pause', 'volumechange'].forEach((ev) => video.addEventListener(ev, render));
  document.getElementById('btn-lang-switch')?.addEventListener('click', () => setTimeout(render, 0));

  // Save battery/data: pause while the hero is scrolled out of view.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (!userPaused) tryPlay();
          } else if (!video.paused) {
            video.pause();
          }
        });
      },
      { threshold: 0.2 }
    );
    io.observe(video);
  }

  render();
}

document.addEventListener('DOMContentLoaded', () => {
  initStickyHeaderAndMobileMenu();
  initLanguageSwitcher();
  initScrollRevealAnimations();
  initHeroMarketingVideo();
  initLiveAquariumTvAndQr();
  initTankNewLauncher();
  initSheetLightbox();
  initFaqAccordion();
  initPricingCurrencySwitcher();
  initSupabaseBookingForm();
});
