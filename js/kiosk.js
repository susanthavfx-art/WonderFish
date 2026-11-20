// =============================================================================
// WonderFish • Kiosk Mode for shops, malls, parties & events
// -----------------------------------------------------------------------------
// Open:  aquarium.html?tank=YOUR-CODE&kiosk=1   (or the 🖥️ button in the top bar)
// Exit:  Ctrl + Shift + K   •   or tap the top-left corner 5 times quickly
//
// What it does
//   • Clean screen: hides the top menu bar & hints, keeps the phone QR card big
//   • One tap -> full screen + sound (browsers need a first tap for both)
//   • Keeps the screen awake (Wake Lock) and hides the mouse cursor when idle
//   • Locks the camera (kids can't drag the view sideways and leave it there)
//   • Self-healing: re-syncs fish every few minutes, reconnects after Wi-Fi
//     drops, reloads itself if the 3D view crashes or freezes, and does a
//     fresh reload every few hours when nobody is scanning.
//     It never reloads while offline (that would show a browser error page).
// =============================================================================

const RESYNC_EVERY_MS = 3 * 60 * 1000;
const SCHEDULED_RELOAD_MS = 6 * 60 * 60 * 1000;
const QUIET_BEFORE_RELOAD_MS = 90 * 1000;
const WATCHDOG_EVERY_MS = 30 * 1000;
const CURSOR_HIDE_MS = 3000;
const INSPECT_AUTOCLOSE_MS = 8000;
const OFFLINE_BADGE_AFTER_MS = 10 * 1000;

let started = false;

export function isKioskRequested() {
  const v = new URLSearchParams(window.location.search).get('kiosk');
  return v === '1' || v === 'true' || v === 'yes';
}

export function initKioskMode(app) {
  if (started) return;
  started = true;

  // Keep kiosk=1 in the URL so any reload stays in kiosk mode
  const url = new URL(window.location.href);
  if (!isKioskRequested()) {
    url.searchParams.set('kiosk', '1');
    history.replaceState(null, '', url.href);
  }

  document.body.classList.add('kiosk-mode');

  // Close anything an operator may have left open
  ['studio-drawer', 'reset-tank-modal', 'room-switch-modal', 'fish-inspect-card'].forEach((id) =>
    document.getElementById(id)?.classList.add('hidden')
  );
  document.getElementById('qr-card')?.classList.remove('minimized');
  document.getElementById('top-hud')?.classList.remove('collapsed');

  // Lock the camera at the home view; taps still feed fish / open a fish card
  if (app.controls) {
    app.controls.reset?.();
    app.controls.enabled = false;
  }
  if (app.audio) app.audio.muted = false;

  setupStartHint(app);
  setupWakeLock();
  setupCursorHiding();
  setupInspectAutoClose();
  setupExitGestures();
  setupOfflineBadge(app);
  setupSelfHealing(app);
}

// -----------------------------------------------------------------------------
// First tap: full screen + unlock audio
// -----------------------------------------------------------------------------
function looksFullscreen() {
  if (document.fullscreenElement) return true;
  if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true;
  // Chrome started with --kiosk fills the screen without the Fullscreen API
  return (
    Math.abs(window.innerWidth - screen.width) < 4 && Math.abs(window.innerHeight - screen.height) < 4
  );
}

function setupStartHint(app) {
  const hint = document.createElement('div');
  hint.className = 'kiosk-start-hint';
  hint.innerHTML =
    '👆 Screen එක එක පාරක් touch කරන්න <span>Tap once for full screen + sound</span>';
  document.body.appendChild(hint);

  const refresh = () => hint.classList.toggle('visible', !looksFullscreen());
  refresh();
  document.addEventListener('fullscreenchange', refresh);
  window.addEventListener('resize', refresh);

  const onFirstGesture = () => {
    app.audio?.ensure?.();
    if (!looksFullscreen()) {
      document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    }
    requestWakeLock();
    setTimeout(refresh, 400);
  };
  window.addEventListener('pointerdown', onFirstGesture, { capture: true });
  window.addEventListener('keydown', onFirstGesture, { capture: true });
}

// -----------------------------------------------------------------------------
// Keep the screen on
// -----------------------------------------------------------------------------
let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch (_) {
    wakeLock = null; // not allowed yet (needs https / visible tab) — retried on next tap
  }
}

function setupWakeLock() {
  requestWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
}

// -----------------------------------------------------------------------------
// Hide the mouse cursor when idle
// -----------------------------------------------------------------------------
function setupCursorHiding() {
  let timer = null;
  const wake = () => {
    document.body.classList.remove('kiosk-hide-cursor');
    clearTimeout(timer);
    timer = setTimeout(() => document.body.classList.add('kiosk-hide-cursor'), CURSOR_HIDE_MS);
  };
  window.addEventListener('mousemove', wake, { passive: true });
  wake();
}

// -----------------------------------------------------------------------------
// Fish card closes itself so the screen stays clean
// -----------------------------------------------------------------------------
function setupInspectAutoClose() {
  const card = document.getElementById('fish-inspect-card');
  if (!card) return;
  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    if (!card.classList.contains('hidden')) {
      timer = setTimeout(() => card.classList.add('hidden'), INSPECT_AUTOCLOSE_MS);
    }
  }).observe(card, { attributes: true, attributeFilter: ['class'] });
}

// -----------------------------------------------------------------------------
// Staff exit: Ctrl+Shift+K or 5 quick taps on the top-left corner
// -----------------------------------------------------------------------------
function exitKiosk() {
  if (!window.confirm('Kiosk mode එකෙන් අයින් වෙන්නද? (Exit kiosk mode?)')) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('kiosk');
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  window.location.href = url.href;
}

function setupExitGestures() {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
      e.preventDefault();
      exitKiosk();
    }
  });

  const hotspot = document.createElement('div');
  hotspot.className = 'kiosk-exit-hotspot';
  hotspot.setAttribute('aria-hidden', 'true');
  document.body.appendChild(hotspot);

  let taps = [];
  hotspot.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const now = Date.now();
    taps = taps.filter((t) => now - t < 3000);
    taps.push(now);
    if (taps.length >= 5) {
      taps = [];
      exitKiosk();
    }
  });
}

// -----------------------------------------------------------------------------
// Small "no internet" badge so staff notice connection problems
// -----------------------------------------------------------------------------
function setupOfflineBadge(app) {
  const badge = document.createElement('div');
  badge.className = 'kiosk-offline-badge';
  badge.textContent = '⚠️ Internet නැහැ — reconnecting…';
  document.body.appendChild(badge);

  let downSince = null;
  setInterval(() => {
    const down = !app.realtimeOnline || navigator.onLine === false;
    if (!down) {
      downSince = null;
      badge.classList.remove('visible');
      return;
    }
    downSince = downSince || Date.now();
    badge.classList.toggle('visible', Date.now() - downSince > OFFLINE_BADGE_AFTER_MS);
  }, 2000);
}

// -----------------------------------------------------------------------------
// Self-healing
// -----------------------------------------------------------------------------
let reloadPending = false;

// Reload only when the site is reachable, otherwise the browser shows an error page
// and the tank would stay dead until someone touches the laptop.
async function safeReload(reason) {
  if (reloadPending) return;
  reloadPending = true;
  console.warn('[kiosk] reload requested:', reason);
  const tryReload = async () => {
    try {
      if (navigator.onLine !== false) {
        const res = await fetch(window.location.href, { method: 'HEAD', cache: 'no-store' });
        if (res.ok) {
          window.location.reload();
          return;
        }
      }
    } catch (_) {}
    setTimeout(tryReload, 60 * 1000);
  };
  tryReload();
}

function setupSelfHealing(app) {
  // 1. Periodic re-sync: catches fish missed during short outages + 2-day cleanup
  setInterval(() => {
    if (document.visibilityState === 'visible') app.resyncFishes?.();
  }, RESYNC_EVERY_MS);

  // 2. GPU / WebGL crash -> reload
  const canvas = app.renderer?.domElement;
  canvas?.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    setTimeout(() => safeReload('webgl context lost'), 3000);
  });

  // 3. Frozen render loop watchdog: no new frame for 3 checks in a row (~90s)
  //    (a single slow frame on a weak laptop must not trigger a reload loop)
  let lastFrame = -1;
  let stalls = 0;
  setInterval(() => {
    if (document.visibilityState !== 'visible') {
      lastFrame = -1;
      stalls = 0;
      return;
    }
    const frame = app.renderer?.info?.render?.frame ?? 0;
    stalls = lastFrame !== -1 && frame === lastFrame ? stalls + 1 : 0;
    lastFrame = frame;
    if (stalls >= 3) safeReload('render loop stalled');
  }, WATCHDOG_EVERY_MS);

  // 4. Lots of script errors in a short time -> reload
  let errorTimes = [];
  window.addEventListener('error', () => {
    const now = Date.now();
    errorTimes = errorTimes.filter((t) => now - t < 5 * 60 * 1000);
    errorTimes.push(now);
    if (errorTimes.length > 25) safeReload('too many errors');
  });

  // 5. Fresh start every few hours (frees memory), but never during a scan
  const startedAt = Date.now();
  setInterval(() => {
    if (Date.now() - startedAt < SCHEDULED_RELOAD_MS) return;
    const lastArrival = app.lastArrivalAt || 0;
    if (Date.now() - lastArrival > QUIET_BEFORE_RELOAD_MS) safeReload('scheduled refresh');
  }, 60 * 1000);
}
