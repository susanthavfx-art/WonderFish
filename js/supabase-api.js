import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { SPECIES_LIST } from './creatures.js';

// window.supabase is loaded from ./vendor/supabase.js
export const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export const DEFAULT_ROOM_CODE = 'WONDER-REEF';
const ROOM_STORAGE_KEY = 'wonderfish_active_room';

let liveChannel = null;
let subscribedRoom = null;
let channelReady = false;
let cachedCallbacks = null;

export function normalizeRoomCode(raw) {
  const cleaned = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 28);
  return cleaned.length >= 2 ? cleaned : DEFAULT_ROOM_CODE;
}

export function generateRandomRoomCode(prefix = 'REEF') {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${digits}`;
}

export function getActiveRoomCode() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('tank') || params.get('room');
    if (fromUrl) {
      const code = normalizeRoomCode(fromUrl);
      sessionStorage.setItem(ROOM_STORAGE_KEY, code);
      return code;
    }
    const stored = sessionStorage.getItem(ROOM_STORAGE_KEY);
    if (stored) {
      return normalizeRoomCode(stored);
    }
  } catch (_) {}
  return DEFAULT_ROOM_CODE;
}

export function setActiveRoomCode(newCode) {
  const code = normalizeRoomCode(newCode);
  try {
    sessionStorage.setItem(ROOM_STORAGE_KEY, code);
  } catch (_) {}
  if (liveChannel && subscribedRoom && subscribedRoom !== code && supabaseClient) {
    try {
      supabaseClient.removeChannel(liveChannel);
    } catch (_) {}
    liveChannel = null;
    channelReady = false;
    subscribedRoom = null;
    if (cachedCallbacks) {
      initLiveChannel(cachedCallbacks, code);
    }
  }
  return code;
}

export function buildPageUrlWithRoom(relPath, roomCode = getActiveRoomCode()) {
  const url = new URL(relPath, window.location.href);
  url.searchParams.set('tank', normalizeRoomCode(roomCode));
  return url.href;
}

function mapRowToFish(row) {
  return {
    id: row.id,
    name: row.name || 'Explorer',
    species: row.species || 'clownfish',
    textureUrl: row.texture_url,
    swimSeed: row.swim_seed || 12345,
    roomCode: row.room_code || DEFAULT_ROOM_CODE,
    createdAt: row.created_at || new Date().toISOString()
  };
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

// Create or fetch metadata for a named Tank Code (e.g. "Leo's 6th Birthday Reef")
export async function registerOrFetchTank(roomCode, title = '', hostName = '') {
  if (!supabaseClient) return { roomCode: normalizeRoomCode(roomCode), title: title || 'WonderFish Reef' };
  const code = normalizeRoomCode(roomCode);

  if (title && title.trim()) {
    await supabaseClient.from('aquarium_tanks').upsert(
      {
        room_code: code,
        title: title.trim().slice(0, 80),
        host_name: (hostName || '').trim().slice(0, 60)
      },
      { onConflict: 'room_code', ignoreDuplicates: false }
    );
  }

  const { data } = await supabaseClient
    .from('aquarium_tanks')
    .select('*')
    .eq('room_code', code)
    .maybeSingle();

  return {
    roomCode: code,
    title: data?.title || title || `Tank ${code}`,
    hostName: data?.host_name || hostName || ''
  };
}

// Ensure a room-isolated Realtime channel is open for broadcasts + Postgres change events
export function initLiveChannel(callbacks = {}, explicitRoom = null) {
  if (!supabaseClient) return null;
  const room = normalizeRoomCode(explicitRoom || getActiveRoomCode());

  if (Object.keys(callbacks).length > 0) {
    cachedCallbacks = callbacks;
  }

  if (liveChannel && subscribedRoom === room) {
    return liveChannel;
  }

  if (liveChannel) {
    try {
      supabaseClient.removeChannel(liveChannel);
    } catch (_) {}
    liveChannel = null;
    channelReady = false;
  }

  subscribedRoom = room;
  const { onFishAdded, onFishDeleted, onTankCleared, onTankEvent, onStatusChange } =
    cachedCallbacks || callbacks;

  liveChannel = supabaseClient.channel(`aquarium-live-${room}`, {
    config: { broadcast: { self: true } }
  });

  if (onFishAdded) {
    liveChannel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'aquarium_fishes' },
      (payload) => {
        if (payload?.new && normalizeRoomCode(payload.new.room_code) === room) {
          onFishAdded(mapRowToFish(payload.new));
        }
      }
    );

    liveChannel.on('broadcast', { event: 'fish_added' }, ({ payload }) => {
      if (payload?.fish && normalizeRoomCode(payload.fish.roomCode || room) === room) {
        onFishAdded(payload.fish);
      }
    });
  }

  if (onFishDeleted) {
    liveChannel.on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'aquarium_fishes' },
      (payload) => {
        if (payload?.old?.id) {
          onFishDeleted(payload.old.id);
        }
      }
    );

    liveChannel.on('broadcast', { event: 'fish_deleted' }, ({ payload }) => {
      if (payload?.id) onFishDeleted(payload.id);
    });
  }

  if (onTankCleared) {
    liveChannel.on('broadcast', { event: 'tank_cleared' }, ({ payload }) => {
      onTankCleared(payload || {});
    });
  }

  if (onTankEvent) {
    liveChannel.on('broadcast', { event: 'tank_event' }, ({ payload }) => {
      if (payload) onTankEvent(payload);
    });
  }

  const thisChannel = liveChannel;
  thisChannel.subscribe((status) => {
    // Ignore late status events from a channel we already replaced (reconnect)
    if (thisChannel !== liveChannel) return;
    channelReady = status === 'SUBSCRIBED';
    if (onStatusChange) onStatusChange(channelReady, status);
  });

  return liveChannel;
}

// Tear down and re-open the realtime channel for the current room.
// Used by the tank to recover after Wi-Fi drops / laptop sleep / long idle.
export function reconnectLiveChannel() {
  if (!supabaseClient || !cachedCallbacks) return null;
  const room = subscribedRoom || getActiveRoomCode();
  if (liveChannel) {
    const old = liveChannel;
    liveChannel = null;
    channelReady = false;
    subscribedRoom = null;
    try {
      supabaseClient.removeChannel(old);
    } catch (_) {}
  }
  return initLiveChannel(cachedCallbacks, room);
}

// Fetch the NEWEST fishes (default 40) ONLY for the active Tank Code,
// returned oldest -> newest so they can be spawned in arrival order.
// Returns null on a network / API error (so callers can tell "error" from "empty").
export async function fetchRecentFishes(explicitRoom = null, limit = 40) {
  if (!supabaseClient) return null;
  const room = normalizeRoomCode(explicitRoom || getActiveRoomCode());

  const { data, error } = await supabaseClient
    .from('aquarium_fishes')
    .select('*')
    .eq('room_code', room)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('Supabase fetch error:', error.message);
    return null;
  }
  return (data || []).map(mapRowToFish).reverse();
}

// Backwards-compatible helper: always returns an array
export async function fetchInitialFishes(explicitRoom = null, limit = 40) {
  return (await fetchRecentFishes(explicitRoom, limit)) || [];
}

// Upload scanned UV texture PNG to Supabase Storage & insert fish into active Tank Code
export async function submitFishToSupabase({ name, species, textureDataUrl, roomCode = null }) {
  if (!supabaseClient) throw new Error('Supabase client not initialized');
  const room = normalizeRoomCode(roomCode || getActiveRoomCode());

  const knownIds = SPECIES_LIST.map((s) => s.id);
  const rawSp = String(species || '').trim().toLowerCase();
  const cleanSpecies =
    knownIds.includes(rawSp) || /^[a-z0-9_-]{1,32}$/.test(rawSp) ? rawSp : 'clownfish';
  const cleanName = String(name || 'Explorer').trim().slice(0, 32) || 'Explorer';

  const blob = dataUrlToBlob(textureDataUrl);
  const rand = Math.random().toString(36).slice(2, 10);
  const filePath = `scans/${room}/${Date.now()}-${rand}.png`;

  const { error: uploadErr } = await supabaseClient.storage
    .from('fish-textures')
    .upload(filePath, blob, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false
    });

  if (uploadErr) {
    throw new Error(`Storage upload failed: ${uploadErr.message}`);
  }

  const { data: pubData } = supabaseClient.storage.from('fish-textures').getPublicUrl(filePath);
  const textureUrl = pubData.publicUrl;

  const { data: row, error: insertErr } = await supabaseClient
    .from('aquarium_fishes')
    .insert({
      name: cleanName,
      species: cleanSpecies,
      texture_url: textureUrl,
      room_code: room
    })
    .select()
    .single();

  if (insertErr) {
    const code = extractTankErrorCode(insertErr.message);
    const err = new Error(code ? friendlyTankError(code) : `Database insert failed: ${insertErr.message}`);
    err.code = code || 'INSERT_FAILED';
    throw err;
  }

  const fish = mapRowToFish(row);

  try {
    const ch = initLiveChannel({}, room);
    if (!channelReady) {
      await new Promise((r) => setTimeout(r, 350));
    }
    if (ch) {
      await ch.send({
        type: 'broadcast',
        event: 'fish_added',
        payload: { fish }
      });
    }
  } catch (_) {}

  return fish;
}

// Room-Scoped PIN Reset: Clears ONLY the active Tank Code without touching any other client's tank!
export async function resetAllFishesInSupabase(adminPin, hideDemo = true, explicitRoom = null) {
  if (!supabaseClient) throw new Error('Supabase client not initialized');
  const room = normalizeRoomCode(explicitRoom || getActiveRoomCode());

  const data = await callAdminRpc('admin_reset_tank', {
    target_room: room,
    admin_pin: String(adminPin || '').trim()
  });

  try {
    const ch = initLiveChannel({}, room);
    if (channelReady && ch) {
      await ch.send({
        type: 'broadcast',
        event: 'tank_cleared',
        payload: { hideDemo, roomCode: room }
      });
    }
  } catch (_) {}

  return data;
}

// PIN-protected Single Fish Delete
export async function deleteSingleFishInSupabase(fishId, adminPin) {
  if (!supabaseClient) throw new Error('Supabase client not initialized');
  const room = getActiveRoomCode();

  const data = await callAdminRpc('admin_delete_fish', {
    target_room: room,
    admin_pin: String(adminPin || '').trim(),
    target_id: fishId
  });

  try {
    const ch = initLiveChannel({}, room);
    if (channelReady && ch) {
      await ch.send({
        type: 'broadcast',
        event: 'fish_deleted',
        payload: { id: fishId }
      });
    }
  } catch (_) {}

  return data;
}

// Broadcast interactive tank event (shark visit / drop food) scoped to active Tank Code!
export async function broadcastTankEvent(action) {
  try {
    const room = getActiveRoomCode();
    const ch = initLiveChannel({}, room);
    if (!channelReady) {
      await new Promise((r) => setTimeout(r, 400));
    }
    await ch?.send({
      type: 'broadcast',
      event: 'tank_event',
      payload: { action, roomCode: room }
    });
  } catch (_) {}
}

// Save Website Pricing / Event Booking Form directly into Supabase public.client_inquiries!
export async function submitClientInquiryToSupabase({
  clientName,
  contactInfo = '',
  organizationOrEvent = '',
  selectedPlan = 'Day & Party Pass',
  preferredDate = '',
  requestedTankCode = '',
  notes = ''
}) {
  if (!supabaseClient) throw new Error('Supabase client not initialized');
  const cleanName = String(clientName || '').trim().slice(0, 80);
  if (!cleanName) throw new Error('Please enter your name');

  const { error } = await supabaseClient.from('client_inquiries').insert({
    client_name: cleanName,
    contact_info: String(contactInfo || '').trim().slice(0, 120),
    organization_or_event: String(organizationOrEvent || '').trim().slice(0, 120),
    selected_plan: String(selectedPlan || 'Day & Party Pass').trim().slice(0, 80),
    preferred_date: String(preferredDate || '').trim().slice(0, 60),
    requested_tank_code: requestedTankCode ? normalizeRoomCode(requestedTankCode) : '',
    notes: String(notes || '').trim().slice(0, 1000)
  });

  if (error) {
    throw new Error(error.message || 'Could not save inquiry');
  }
  return true;
}


// ============================================================================
// PER-TANK ADMIN (PIN) API — see supabase/migrations/*_tank_admin_pins_*.sql
// Every admin RPC returns { ok: true, ... } or { ok: false, error: CODE }.
// ============================================================================

const TANK_ERROR_TEXT = {
  BAD_PIN: 'PIN අංකය වැරදියි. • Wrong PIN.',
  PIN_LOCKED: 'වැරදි PIN ගොඩක් ගැහුවා. විනාඩි 10කින් ආයෙ උත්සාහ කරන්න. • Too many wrong PINs — try again in 10 minutes.',
  TANK_NOT_FOUND: 'මේ Tank Code එක හොයාගන්න බැහැ. • Tank Code not found.',
  TANK_EXISTS: 'මේ Tank Code එක දැනටමත් පාවිච්චි වෙනවා. වෙන code එකක් තෝරන්න. • This Tank Code is already taken.',
  WEAK_PIN: 'PIN එක ඉලක්කම් 4–12ක් විය යුතුයි (1234 බැහැ). • PIN must be 4–12 digits (not 1234).',
  MASTER_ONLY: 'මේක කරන්න පුළුවන් WonderLab Master PIN එකෙන් විතරයි. • Only the WonderLab master PIN can do this.',
  EVENT_ENDED: 'මේ session එක ඉවරයි. අලුතින් පටන් ගන්න WonderLab අමතන්න. • This session has ended — contact WonderLab to renew.',
  BAD_LOGO: 'Logo එක PNG / JPG / WEBP විය යුතුයි, 280KB ට අඩු. • Logo must be PNG/JPG/WEBP under 280KB.',
  INVALID_PLAN: 'Plan එක වැරදියි. • Invalid plan.',
  INVALID_ROOM_CODE: 'Tank Code එක අකුරු/ඉලක්කම් 2–28ක් විය යුතුයි. • Tank Code must be 2–28 letters/numbers.',
  TANK_NOT_STARTED: 'Host තවම Event එක Start කරලා නැහැ. ටිකක් ඉන්න! • The host has not started this event yet.',
  TANK_EVENT_ENDED: 'මේ Tank session එක ඉවරයි. • This tank session has ended.',
  FISH_LIMIT_REACHED: 'මේ Tank එකේ scan limit එක පිරිලා. • This tank has reached its scan limit.',
  PIN_UPGRADE_REQUIRED: 'Page එක reload කරන්න. • Please reload the page.',
  NETWORK: 'Internet connection එක check කරන්න. • Check the internet connection.'
};

export function friendlyTankError(code) {
  return TANK_ERROR_TEXT[code] || TANK_ERROR_TEXT.NETWORK;
}

function extractTankErrorCode(message) {
  const m = String(message || '').match(/\b(TANK_NOT_STARTED|TANK_EVENT_ENDED|FISH_LIMIT_REACHED|INVALID_ROOM_CODE|PIN_UPGRADE_REQUIRED)\b/);
  return m ? m[1] : null;
}

export class TankAdminError extends Error {
  constructor(code) {
    super(friendlyTankError(code));
    this.code = code;
  }
}

async function callAdminRpc(fn, params) {
  if (!supabaseClient) throw new TankAdminError('NETWORK');
  let res;
  try {
    res = await supabaseClient.rpc(fn, params);
  } catch (_) {
    throw new TankAdminError('NETWORK');
  }
  if (res.error) {
    throw new TankAdminError(extractTankErrorCode(res.error.message) || 'NETWORK');
  }
  const data = res.data;
  if (!data || data.ok === false) {
    throw new TankAdminError(data?.error || 'NETWORK');
  }
  return data;
}

// Remember a verified PIN for this browser tab only (cleared when the tab closes)
const PIN_KEY = (room) => `wonderfish_admin_pin:${normalizeRoomCode(room)}`;
export function rememberAdminPin(room, pin) {
  try { sessionStorage.setItem(PIN_KEY(room), String(pin || '')); } catch (_) {}
}
export function getRememberedAdminPin(room) {
  try { return sessionStorage.getItem(PIN_KEY(room)) || ''; } catch (_) { return ''; }
}
export function forgetAdminPin(room) {
  try { sessionStorage.removeItem(PIN_KEY(room)); } catch (_) {}
}

// Public status: plan, timer, scans used, branding. Returns null if unknown / offline.
export async function fetchTankStatus(room = getActiveRoomCode()) {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient.rpc('get_tank_status', { target_room: normalizeRoomCode(room) });
    if (error) return null;
    return data || null;
  } catch (_) {
    return null;
  }
}

export const createTankWithPin = (room, title, pin) =>
  callAdminRpc('create_tank_with_pin', { target_room: room, target_title: title || '', new_pin: String(pin || '').trim() });

export const adminLogin = (room, pin) =>
  callAdminRpc('admin_login', { target_room: room, admin_pin: String(pin || '').trim() });

export const adminStartEvent = (room, pin) =>
  callAdminRpc('admin_start_event', { target_room: room, admin_pin: String(pin || '').trim() });

export const adminChangePin = (room, pin, newPin) =>
  callAdminRpc('admin_change_pin', { target_room: room, admin_pin: String(pin || '').trim(), new_pin: String(newPin || '').trim() });

export const adminSetBranding = (room, pin, { title = '', brandName = '', brandLogo = '', brandColor = '' } = {}) =>
  callAdminRpc('admin_set_branding', {
    target_room: room,
    admin_pin: String(pin || '').trim(),
    new_title: title,
    new_brand_name: brandName,
    new_brand_logo: brandLogo,
    new_brand_color: brandColor
  });

export const adminTankReport = (room, pin, days = 30) =>
  callAdminRpc('admin_tank_report', { target_room: room, admin_pin: String(pin || '').trim(), days });

export const adminSetTankPlan = (room, pin, plan, restart = false) =>
  callAdminRpc('admin_set_tank_plan', { target_room: room, admin_pin: String(pin || '').trim(), new_plan: plan, restart });

export const adminListTanks = (pin) =>
  callAdminRpc('admin_list_tanks', { admin_pin: String(pin || '').trim() });

export const adminChangeMasterPin = (pin, newPin) =>
  callAdminRpc('admin_change_master_pin', { admin_pin: String(pin || '').trim(), new_pin: String(newPin || '').trim() });
