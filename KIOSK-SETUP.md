# 🖥️ WonderFish Kiosk Mode — Shops, Malls, Parties & Events

Kiosk mode turns the 3D tank into a clean, self-running display for a TV or projector.
Staff don't need to touch the laptop all day.

## Open the tank in kiosk mode

```
https://susanthavfx-art.github.io/WonderFish/aquarium.html?tank=YOUR-CODE&kiosk=1
```

- Replace `YOUR-CODE` with the venue's own Tank Code (e.g. `ODEL-XMAS`, `LEO-PARTY`).
  Give every shop / party its **own code**, so fish never mix.
- Or open the tank normally and click **🖥️ Kiosk** in the top bar.
- Tap the screen once → full screen + sound (browsers need one first tap for both).

## What kiosk mode does

| | |
|---|---|
| Clean screen | Top menu bar & hints hidden; the phone QR card stays big |
| Max 40 fish | When a new fish arrives and the tank is full, the oldest one swims away |
| Screen stays on | Wake Lock keeps the screen from sleeping (on https) |
| Cursor hidden | The mouse pointer disappears after 3 seconds |
| Camera locked | Kids can't drag the view sideways and leave it there |
| Fish card auto-closes | Tapping a fish shows its sheet for 8 seconds |
| Internet drops | Shows "⚠️ Internet නැහැ — reconnecting…", reconnects by itself and adds fish scanned while offline |
| Self-healing | Reloads by itself if the 3D view crashes / freezes, and does a fresh reload every 6 hours when nobody is scanning — **never while offline** |

## Exit kiosk mode (staff)

- Keyboard: **Ctrl + Shift + K**
- Touch screen: tap the **top-left corner 5 times quickly**

## Auto-start on a Windows laptop (recommended for shops)

1. Right-click the desktop → **New → Shortcut**
2. Location:
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required "https://susanthavfx-art.github.io/WonderFish/aquarium.html?tank=YOUR-CODE&kiosk=1"
   ```
3. Name it `WonderFish Tank`.
4. To start it automatically when the laptop turns on: press **Win + R**, type `shell:startup`,
   and copy the shortcut into that folder.

`--kiosk` opens Chrome full screen with no address bar, and `--autoplay-policy=...` allows sound
without the first tap. Close Chrome's kiosk window with **Alt + F4**.

### Windows settings for an all-day display

- **Settings → System → Power** → Screen and sleep: **Never** (when plugged in)
- Pause Windows Updates during event days
- Turn off notifications (Focus / Do not disturb)
- Keep the laptop plugged into power

## Venue checklist

- Laptop + HDMI cable + TV / projector
- **4G router / dongle** (Dialog / Mobitel / Airtel) — don't rely on mall Wi-Fi
- Printed coloring sheets + crayons
- QR stand (parents scan with their own phones — they need mobile data)

## Old fish are deleted automatically

Scanned fish (and their images) older than **2 days** are deleted every hour by the
Supabase Edge Function `cleanup-old-fish` (see `supabase/`). A tank showing those fish lets them
swim away by themselves. To change the age, set the `MAX_AGE_HOURS` function secret in Supabase.
