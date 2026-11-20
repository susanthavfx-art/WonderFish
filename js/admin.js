import {
  normalizeRoomCode,
  getActiveRoomCode,
  buildPageUrlWithRoom,
  rememberAdminPin,
  getRememberedAdminPin,
  forgetAdminPin,
  adminLogin,
  adminStartEvent,
  adminChangePin,
  adminSetBranding,
  adminTankReport,
  adminSetTankPlan,
  adminListTanks,
  adminChangeMasterPin,
  fetchTankStatus
} from './supabase-api.js';

// Light-weight species labels (avoids loading three.js on this page)
const SPECIES_LABELS = {
  clownfish: '🐠 Clownfish',
  angelfish: '🐟 Angelfish',
  bluetang: '🐟 Blue Reef Fish',
  seahorse: '🪸 Seahorse',
  starfish: '⭐ Sea Star',
  crab: '🦀 Crab',
  turtle: '🐢 Turtle',
  shark: '🦈 Shark',
  octopus: '🐙 Octopus',
  jellyfish: '🪼 Jellyfish',
  whale: '🐋 Whale',
  dolphin: '🐬 Dolphin'
};
const speciesLabel = (id) => SPECIES_LABELS[id] || `🐠 ${String(id || 'unknown').replace(/[-_]/g, ' ')}`;

const PLAN_LABELS = {
  free: 'Free (30 min)',
  play: 'Play Pass (3h)',
  day: 'Day & Party (24h)',
  venue: 'Venue · Shops',
  legacy: 'Legacy / Demo'
};
const STATE_LABELS = {
  live: '🟢 Live — fish එවන්න පුළුවන්',
  not_started: '⏸️ තාම Start කරලා නැහැ',
  ended: '⛔ Session එක ඉවරයි',
  full: '⛔ Scan limit එක පිරිලා'
};

const $ = (id) => document.getElementById(id);

const state = {
  room: '',
  pin: '',
  role: 'owner',
  tank: null,
  clockOffsetMs: 0,
  report: null,
  logoDataUrl: ''
};

let countdownTimer = null;
let refreshTimer = null;

function toast(msg) {
  const el = $('admin-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function showMsg(id, text, ok = true) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `admin-msg ${ok ? 'ok' : 'err'}`;
}

function hideMsg(id) {
  $(id)?.classList.add('hidden');
}

function fmtDuration(ms) {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
}

function hourLabel(h) {
  const suffix = h < 12 ? 'am' : 'pm';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${suffix}`;
}

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------
async function login(room, pin, { silent = false } = {}) {
  const btn = $('btn-login');
  const errEl = $('login-error');
  errEl?.classList.add('hidden');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Checking...';
  }
  try {
    const res = await adminLogin(room, pin);
    state.room = normalizeRoomCode(room);
    state.pin = pin;
    state.role = res.role;
    rememberAdminPin(state.room, pin);
    try { sessionStorage.setItem('wonderfish_active_room', state.room); } catch (_) {}
    const url = new URL(window.location.href);
    url.searchParams.set('tank', state.room);
    history.replaceState(null, '', url);

    $('login-view').classList.add('hidden');
    $('dash-view').classList.remove('hidden');
    $('btn-logout').classList.remove('hidden');
    $('pin-warning').classList.toggle('hidden', !res.default_pin);
    $('owner-card').classList.toggle('hidden', res.role !== 'master');
    $('status-role').textContent = res.role === 'master' ? '👑 WonderLab master' : '🏪 Shop admin';

    applyTank(res.tank);
    fillBrandForm(res.tank);
    loadReport();
    if (res.role === 'master') loadTankList();

    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshStatus, 30000);
  } catch (err) {
    if (!silent && errEl) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
    forgetAdminPin(room);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Login →';
    }
  }
}

function logout() {
  forgetAdminPin(state.room);
  state.pin = '';
  clearInterval(refreshTimer);
  clearInterval(countdownTimer);
  $('dash-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
  $('btn-logout').classList.add('hidden');
  $('login-pin').value = '';
  $('login-room').value = state.room;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function applyTank(tank) {
  if (!tank) return;
  state.tank = tank;
  if (tank.server_now) {
    state.clockOffsetMs = new Date(tank.server_now).getTime() - Date.now();
  }

  $('status-room').textContent = `🔑 ${tank.room_code}`;
  $('status-title').textContent = tank.title || `Tank ${tank.room_code}`;
  $('status-plan').textContent = PLAN_LABELS[tank.plan_code] || tank.plan_code;
  const stateEl = $('status-state');
  stateEl.textContent = STATE_LABELS[tank.state] || tank.state;
  stateEl.className = `admin-pill state-${tank.state}`;

  const logo = $('status-logo');
  if (tank.brand_logo) {
    logo.src = tank.brand_logo;
    logo.classList.remove('hidden');
  } else {
    logo.classList.add('hidden');
  }

  const limit = tank.scan_limit == null ? '∞' : tank.scan_limit;
  $('status-scans').textContent = `${tank.scans_used ?? 0} / ${limit}`;

  const startBtn = $('btn-start-event');
  const canStart = tank.state === 'not_started' || (tank.state === 'ended' && state.role === 'master');
  startBtn.classList.toggle('hidden', !canStart);
  startBtn.textContent =
    tank.state === 'ended'
      ? '🔁 Session එක ආයෙ Start කරන්න (master)'
      : tank.duration_minutes
        ? `▶ Start Event (${tank.duration_minutes >= 60 ? `${tank.duration_minutes / 60}h` : `${tank.duration_minutes} min`})`
        : '▶ Start Event';

  const tv = buildPageUrlWithRoom('./aquarium.html', tank.room_code);
  const kiosk = new URL(tv);
  kiosk.searchParams.set('kiosk', '1');
  $('link-tv').href = tv;
  $('nav-tv').href = tv;
  $('link-kiosk').href = kiosk.href;
  $('link-sheets').href = buildPageUrlWithRoom('./sheets.html', tank.room_code);

  const planSel = $('plan-select');
  if (planSel && PLAN_LABELS[tank.plan_code]) planSel.value = tank.plan_code;

  clearInterval(countdownTimer);
  tickCountdown();
  countdownTimer = setInterval(tickCountdown, 1000);
}

function tickCountdown() {
  const t = state.tank;
  const el = $('status-time');
  if (!t || !el) return;
  if (t.plan_code === 'legacy' || (t.event_started_at && !t.event_ends_at)) {
    el.textContent = '∞ Always on';
    return;
  }
  if (!t.event_started_at) {
    el.textContent = t.duration_minutes ? `${t.duration_minutes} min (Start කළාම)` : '—';
    return;
  }
  const left = new Date(t.event_ends_at).getTime() - (Date.now() + state.clockOffsetMs);
  el.textContent = left > 0 ? fmtDuration(left) : 'ඉවරයි';
  if (left <= 0 && t.state === 'live') {
    refreshStatus();
  }
}

async function refreshStatus() {
  if (!state.room) return;
  const tank = await fetchTankStatus(state.room);
  if (tank) applyTank(tank);
}

async function startEvent() {
  const btn = $('btn-start-event');
  btn.disabled = true;
  try {
    const res = await adminStartEvent(state.room, state.pin);
    applyTank(res.tank);
    toast('▶ Event එක පටන් ගත්තා! දැන් ළමයින්ට scan කරන්න පුළුවන්.');
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
async function loadReport() {
  const days = Number($('report-days').value) || 30;
  try {
    const rep = await adminTankReport(state.room, state.pin, days);
    state.report = rep;
    renderReport(rep);
  } catch (err) {
    $('chart-days').innerHTML = `<div class="admin-empty">${err.message}</div>`;
  }
}

function renderBars(container, items, { labelFn, showEvery = 1 }) {
  container.innerHTML = '';
  const max = Math.max(1, ...items.map((i) => i.value));
  items.forEach((item, idx) => {
    const bar = document.createElement('div');
    bar.className = 'admin-bar';
    bar.title = `${item.title}: ${item.value}`;
    const num = document.createElement('div');
    num.className = 'admin-bar-num';
    num.textContent = item.value > 0 ? item.value : '';
    const fill = document.createElement('div');
    fill.className = `admin-bar-fill${item.value === 0 ? ' zero' : ''}`;
    fill.style.height = `${Math.max(2, (item.value / max) * 100 * 0.78)}%`;
    const lbl = document.createElement('div');
    lbl.className = 'admin-bar-lbl';
    lbl.textContent = idx % showEvery === 0 ? labelFn(item) : '';
    bar.append(num, fill, lbl);
    container.appendChild(bar);
  });
}

function renderReport(rep) {
  const tank = rep.tank || state.tank || {};
  const shop = tank.brand_name || tank.title || tank.room_code;
  $('report-title').textContent = `${shop} · Scan Report`;
  $('report-print-shop').textContent = shop;
  const pLogo = $('report-print-logo');
  if (tank.brand_logo) {
    pLogo.src = tank.brand_logo;
    pLogo.classList.remove('hidden');
  } else {
    pLogo.classList.add('hidden');
  }

  const days = rep.by_day || [];
  const first = days[0]?.day;
  const last = days[days.length - 1]?.day;
  $('report-range-label').textContent = `🔑 ${tank.room_code} · ${first || ''} → ${last || ''} · ලංකා වේලාව`;
  $('rep-today').textContent = rep.today ?? 0;
  $('rep-range').textContent = rep.total_range ?? 0;
  $('rep-range-name').textContent = `දින ${rep.days}`;
  $('rep-all').textContent = rep.total_all_time ?? 0;

  const hours = rep.by_hour || [];
  const peak = hours.reduce((best, h) => (h.scans > (best?.scans || 0) ? h : best), null);
  $('rep-peak').textContent = peak ? `${hourLabel(peak.hour)}–${hourLabel((peak.hour + 1) % 24)}` : '—';

  renderBars($('chart-days'), days.map((d) => ({ value: d.scans, title: d.day, day: d.day })), {
    labelFn: (i) => i.day.slice(5).replace('-', '/'),
    showEvery: days.length > 31 ? 7 : days.length > 14 ? 3 : 1
  });
  renderBars($('chart-hours'), hours.map((h) => ({ value: h.scans, title: hourLabel(h.hour), hour: h.hour })), {
    labelFn: (i) => hourLabel(i.hour),
    showEvery: 2
  });

  const sp = $('chart-species');
  sp.innerHTML = '';
  const species = rep.by_species || [];
  if (!species.length) {
    sp.innerHTML = '<div class="admin-empty">තාම scans නැහැ. ළමයි scan කරනකොට මෙතන ගණන් පෙන්වයි.</div>';
  }
  const maxS = Math.max(1, ...species.map((s) => s.scans));
  for (const s of species) {
    const row = document.createElement('div');
    row.className = 'admin-species-row';
    const name = document.createElement('span');
    name.textContent = speciesLabel(s.species);
    const track = document.createElement('div');
    track.className = 'admin-species-track';
    const fill = document.createElement('div');
    fill.className = 'admin-species-fill';
    fill.style.width = `${(s.scans / maxS) * 100}%`;
    track.appendChild(fill);
    const num = document.createElement('strong');
    num.textContent = s.scans;
    row.append(name, track, num);
    sp.appendChild(row);
  }
}

function downloadCsv() {
  const rep = state.report;
  if (!rep) return;
  const lines = [
    ['WonderFish Scan Report'],
    ['Tank', rep.tank?.room_code || state.room],
    ['Shop', rep.tank?.brand_name || rep.tank?.title || ''],
    ['Timezone', rep.timezone],
    ['Total (all time)', rep.total_all_time],
    [`Total (last ${rep.days} days)`, rep.total_range],
    [],
    ['Date', 'Scans'],
    ...(rep.by_day || []).map((d) => [d.day, d.scans]),
    [],
    ['Hour', 'Scans'],
    ...(rep.by_hour || []).map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.scans]),
    [],
    ['Species', 'Scans'],
    ...(rep.by_species || []).map((s) => [s.species, s.scans])
  ];
  const csv = lines
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `WonderFish-Report-${state.room}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------
function fillBrandForm(tank) {
  if (!tank) return;
  $('brand-title').value = tank.title && tank.title !== `Tank ${tank.room_code}` ? tank.title : '';
  $('brand-name').value = tank.brand_name || '';
  const hasColor = /^#[0-9a-f]{6}$/i.test(tank.brand_color || '');
  $('brand-color-on').checked = hasColor;
  if (hasColor) $('brand-color').value = tank.brand_color;
  setLogoPreview(tank.brand_logo || '');
}

function setLogoPreview(dataUrl) {
  state.logoDataUrl = dataUrl || '';
  const img = $('brand-logo-preview');
  const empty = $('brand-logo-empty');
  if (state.logoDataUrl) {
    img.src = state.logoDataUrl;
    img.classList.remove('hidden');
    empty.classList.add('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
    empty.classList.remove('hidden');
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image එක කියවන්න බැහැ.'));
    };
    img.src = url;
  });
}

// Resize the logo so it is small enough to store with the tank (< ~280KB)
async function logoFileToDataUrl(file) {
  const img = await loadImage(file);
  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
  for (const maxSide of [512, 400, 320, 240]) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!keepAlpha) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = keepAlpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86);
    if (dataUrl.length < 380000) return dataUrl;
  }
  throw new Error('Logo එක ලොකු වැඩියි. පොඩි image එකක් තෝරන්න.');
}

async function saveBranding(e) {
  e.preventDefault();
  hideMsg('brand-msg');
  const btn = $('btn-brand-save');
  btn.disabled = true;
  try {
    const res = await adminSetBranding(state.room, state.pin, {
      title: $('brand-title').value.trim(),
      brandName: $('brand-name').value.trim(),
      brandLogo: state.logoDataUrl,
      brandColor: $('brand-color-on').checked ? $('brand-color').value : ''
    });
    applyTank(res.tank);
    renderReport({ ...(state.report || {}), tank: res.tank });
    showMsg('brand-msg', '✅ Save වුණා! Coloring sheets සහ TV එක ඊළඟ reload එකේදී අලුත් logo එක පෙන්වයි.');
  } catch (err) {
    showMsg('brand-msg', err.message, false);
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// PINs & owner tools
// ---------------------------------------------------------------------------
async function changePin(e) {
  e.preventDefault();
  hideMsg('pin-msg');
  const a = $('pin-new').value.trim();
  const b = $('pin-confirm').value.trim();
  if (a !== b) {
    showMsg('pin-msg', 'PIN දෙක සමාන නැහැ. • PINs do not match.', false);
    return;
  }
  try {
    await adminChangePin(state.room, state.pin, a);
    if (state.role !== 'master') {
      state.pin = a;
      rememberAdminPin(state.room, a);
    }
    $('pin-new').value = '';
    $('pin-confirm').value = '';
    $('pin-warning').classList.add('hidden');
    showMsg('pin-msg', '✅ අලුත් PIN එක save වුණා. Shop manager ට විතරක් දෙන්න.');
  } catch (err) {
    showMsg('pin-msg', err.message, false);
  }
}

async function applyPlan(e) {
  e.preventDefault();
  hideMsg('plan-msg');
  const plan = $('plan-select').value;
  const restart = $('plan-restart').checked;
  try {
    const res = await adminSetTankPlan(state.room, state.pin, plan, restart);
    applyTank(res.tank);
    showMsg('plan-msg', `✅ ${state.room} → ${PLAN_LABELS[plan]}${restart ? ' (timer reset)' : ''}`);
    loadTankList();
  } catch (err) {
    showMsg('plan-msg', err.message, false);
  }
}

async function loadTankList() {
  const tbody = $('tanks-tbody');
  if (!tbody) return;
  try {
    const res = await adminListTanks(state.pin);
    tbody.innerHTML = '';
    for (const t of res.tanks || []) {
      const tr = document.createElement('tr');
      const cells = [
        t.room_code,
        t.brand_name || t.title || '',
        PLAN_LABELS[t.plan_code] || t.plan_code,
        t.custom_pin ? '✅ own' : '⚠️ 1234',
        t.scans_7d,
        t.scans_all
      ];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      const td = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-btn';
      btn.textContent = t.room_code === state.room ? '● Open' : 'Open →';
      btn.disabled = t.room_code === state.room;
      btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        login(t.room_code, state.pin);
      });
      td.appendChild(btn);
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7">${err.message}</td></tr>`;
  }
}

async function changeMasterPin(e) {
  e.preventDefault();
  hideMsg('master-pin-msg');
  const a = $('master-pin-new').value.trim();
  const b = $('master-pin-confirm').value.trim();
  if (a !== b) {
    showMsg('master-pin-msg', 'PIN දෙක සමාන නැහැ.', false);
    return;
  }
  try {
    await adminChangeMasterPin(state.pin, a);
    state.pin = a;
    rememberAdminPin(state.room, a);
    $('master-pin-new').value = '';
    $('master-pin-confirm').value = '';
    showMsg('master-pin-msg', '✅ Master PIN එක වෙනස් වුණා. ආරක්ෂිතව තියාගන්න!');
  } catch (err) {
    showMsg('master-pin-msg', err.message, false);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function init() {
  const params = new URLSearchParams(window.location.search);
  const initialRoom = params.get('tank') || params.get('room') ? getActiveRoomCode() : '';
  if (initialRoom) $('login-room').value = initialRoom;

  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    login($('login-room').value, $('login-pin').value);
  });
  $('btn-logout').addEventListener('click', logout);
  $('btn-start-event').addEventListener('click', startEvent);
  $('btn-refresh').addEventListener('click', () => {
    refreshStatus();
    loadReport();
    if (state.role === 'master') loadTankList();
  });
  $('btn-copy-scan').addEventListener('click', () => {
    const link = buildPageUrlWithRoom('./scan.html', state.room);
    navigator.clipboard?.writeText(link).then(
      () => toast('📋 Scanner link copy වුණා'),
      () => prompt('Scanner link:', link)
    );
  });
  $('report-days').addEventListener('change', loadReport);
  $('btn-report-csv').addEventListener('click', downloadCsv);
  $('btn-report-print').addEventListener('click', () => window.print());

  $('brand-form').addEventListener('submit', saveBranding);
  $('brand-logo-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setLogoPreview(await logoFileToDataUrl(file));
      showMsg('brand-msg', 'Logo එක ready. "Branding Save කරන්න" ඔබන්න.');
    } catch (err) {
      showMsg('brand-msg', err.message, false);
    }
  });
  $('btn-logo-remove').addEventListener('click', () => setLogoPreview(''));

  $('pin-form').addEventListener('submit', changePin);
  $('plan-form').addEventListener('submit', applyPlan);
  $('master-pin-form').addEventListener('submit', changeMasterPin);

  // Auto-login when this tab already verified the PIN (e.g. coming from the TV page)
  if (initialRoom) {
    const remembered = getRememberedAdminPin(initialRoom);
    if (remembered) login(initialRoom, remembered, { silent: true });
  }
}

init();
