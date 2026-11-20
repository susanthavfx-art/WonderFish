// ============================================================================
// TV-side tank status: plan timer / scan quota chip, "event not started"
// banner with an inline PIN Start button, and shop branding on the QR card.
// ============================================================================
import {
  fetchTankStatus,
  adminStartEvent,
  rememberAdminPin,
  getRememberedAdminPin
} from './supabase-api.js';

const POLL_MS = 30000;

function fmtLeft(ms) {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
}

export function initTankStatusUI(room) {
  const banner = document.getElementById('tank-status-banner');
  const bannerText = document.getElementById('tank-status-text');
  const startForm = document.getElementById('tank-start-form');
  const startPin = document.getElementById('tank-start-pin');
  const startMsg = document.getElementById('tank-start-msg');
  const chip = document.getElementById('qr-plan-chip');
  const brandBox = document.getElementById('qr-brand');
  const brandLogo = document.getElementById('qr-brand-logo');
  const brandName = document.getElementById('qr-brand-name');
  const qrCard = document.getElementById('qr-card');

  let tank = null;
  let offsetMs = 0;
  let pollTimer = null;
  let refreshQueued = null;

  const remembered = getRememberedAdminPin(room);
  if (startPin && remembered) startPin.value = remembered;

  function applyBranding(t) {
    const hasLogo = !!t.brand_logo;
    const hasName = !!t.brand_name;
    if (brandBox) brandBox.classList.toggle('hidden', !hasLogo && !hasName);
    if (brandLogo) {
      if (hasLogo) {
        if (brandLogo.src !== t.brand_logo) brandLogo.src = t.brand_logo;
        brandLogo.classList.remove('hidden');
      } else {
        brandLogo.classList.add('hidden');
      }
    }
    if (brandName) brandName.textContent = hasName ? t.brand_name : '';
    if (qrCard) {
      if (/^#[0-9a-f]{6}$/i.test(t.brand_color || '')) {
        qrCard.style.setProperty('--brand-color', t.brand_color);
        qrCard.classList.add('has-brand-color');
      } else {
        qrCard.classList.remove('has-brand-color');
      }
    }
    const titleEl = document.getElementById('tank-title-label');
    if (titleEl && t.title && t.title !== `Tank ${t.room_code}`) {
      titleEl.textContent = `🐠 ${t.title}`;
    }
  }

  function render() {
    if (!tank) return;
    const nowServer = Date.now() + offsetMs;
    const ended = tank.event_ends_at && new Date(tank.event_ends_at).getTime() <= nowServer;
    let st = tank.state;
    if (st === 'live' && ended) st = 'ended';

    // Banner (only when kids cannot send fish)
    if (banner) {
      banner.classList.toggle('hidden', st === 'live');
      banner.dataset.state = st;
      if (bannerText) {
        bannerText.textContent =
          st === 'not_started'
            ? '⏸️ Event එක තාම පටන් අරන් නැහැ • Host: PIN එක ගහලා Start ඔබන්න'
            : st === 'ended'
              ? '⛔ මේ Tank session එක ඉවරයි • This session has ended'
              : st === 'full'
                ? '⛔ Scan limit එක පිරිලා • Scan limit reached'
                : '';
      }
      if (startForm) startForm.classList.toggle('hidden', st !== 'not_started');
    }

    // Small chip on the QR card for timed / limited plans
    if (chip) {
      const parts = [];
      if (tank.event_started_at && tank.event_ends_at && st === 'live') {
        parts.push(`⏳ ${fmtLeft(new Date(tank.event_ends_at).getTime() - nowServer)}`);
      }
      if (tank.scan_limit != null && tank.plan_code !== 'legacy') {
        parts.push(`🐠 ${tank.scans_used ?? 0}/${tank.scan_limit}`);
      }
      chip.textContent = parts.join(' • ');
      chip.classList.toggle('hidden', parts.length === 0);
    }

    if (st === 'live' && ended) queueRefresh(500);
  }

  async function refresh() {
    const t = await fetchTankStatus(room);
    if (!t) return; // offline or legacy DB: leave the UI as it is
    tank = t;
    if (t.server_now) offsetMs = new Date(t.server_now).getTime() - Date.now();
    applyBranding(t);
    render();
  }

  function queueRefresh(delay = 1500) {
    clearTimeout(refreshQueued);
    refreshQueued = setTimeout(refresh, delay);
  }

  startForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = startPin?.value?.trim() || '';
    if (!pin) {
      startPin?.focus();
      return;
    }
    const btn = startForm.querySelector('button');
    if (btn) btn.disabled = true;
    if (startMsg) startMsg.textContent = '';
    try {
      const res = await adminStartEvent(room, pin);
      rememberAdminPin(room, pin);
      tank = res.tank;
      if (tank?.server_now) offsetMs = new Date(tank.server_now).getTime() - Date.now();
      render();
    } catch (err) {
      if (startMsg) startMsg.textContent = err.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  refresh();
  pollTimer = setInterval(refresh, POLL_MS);
  setInterval(render, 1000);
  window.addEventListener('online', () => queueRefresh(800));

  return {
    refresh,
    noteFishArrived: () => queueRefresh(1200),
    get tank() {
      return tank;
    },
    stop: () => clearInterval(pollTimer)
  };
}
