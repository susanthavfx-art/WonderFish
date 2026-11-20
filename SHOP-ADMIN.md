# 🔐 WonderFish Tank Admin: PIN, shop logo & scan report

Admin page: **`admin.html?tank=YOUR-CODE`** (or the **⚙️ Admin** button on the TV tank).

## Two kinds of PIN

| PIN | Who has it | What it can do |
|---|---|---|
| **Tank PIN** (4–12 digits) | Shop manager / party host | ▶ Start Event, shop logo & name, scan report (print / CSV), reset tank, delete a fish, change the tank PIN |
| **Master PIN** (6–12 digits) | WonderLab owner only | Everything above for **every** tank, plus: change plan (Free / Play / Day / **Venue**), restart an ended session, list all tanks, change the master PIN |

- New tanks (`tank-new.html`) must choose their own PIN. `1234` is not allowed.
- Older tanks that never set a PIN still accept `1234`. The admin page shows a warning until a new PIN is saved.
- 8 wrong PINs lock that tank's PIN for 10 minutes.
- 25 wrong PINs within 15 minutes (across all tanks) lock the master PIN for 15 minutes.
- PINs are stored hashed (bcrypt) in private tables the browser cannot read.

## Plans

| Plan | Time after **Start** | Scans |
|---|---|---|
| Free | 30 min | 6 |
| Play Pass | 3 hours | 25 |
| Day & Party | 24 hours | 100 |
| **Venue (shops / malls)** | always on | unlimited |
| Legacy / Demo | always on (no Start needed) | unlimited |

Kids can only send fish after the host presses **▶ Start Event**. The button is on the TV banner and on the admin page.

A shop flow looks like this:
1. Create the tank with the shop's PIN.
2. Log in on `admin.html` with the **master PIN**.
3. Set the **Venue** plan.
4. Upload the logo.
5. Press Start.

## Shop logo on sheets and TV

- Upload in **Admin → Shop Branding**. Images are resized automatically, and a transparent PNG works best.
- **Coloring sheets:** open `sheets.html?tank=CODE`, or **🖨️ Branded Sheets** in admin.
  - Each sheet shows the logo, "Presented by …", and a QR code that opens **that tank's** scanner.
  - **🖨️ Print All** prints one A4 page per sea creature.
- **TV:** the logo and shop name appear on the QR card (bigger in kiosk mode).

## Scan report

- **Admin → Scan Report** shows:
  - today, the last 7/30/90/365 days, and the all-time total
  - a daily chart
  - busiest hours (Sri Lanka time)
  - the most popular sea creatures
- Export it with **🖨️ Print / PDF** (a clean white page with the shop logo) or **⬇️ CSV**.
- The counts live in `aquarium_scan_stats` and are **not** deleted by the 2-day fish cleanup.
- The report holds no names or photos, only counts.

## Database

Migration: `supabase/migrations/20261121000000_tank_admin_pins_branding_stats.sql`.
To set or reset the master PIN, run this in the Supabase SQL editor (never commit the PIN):

```sql
insert into public.wonderfish_owner_settings (id, master_pin_hash)
values (1, extensions.crypt('NEW-PIN', extensions.gen_salt('bf')))
on conflict (id) do update set master_pin_hash = excluded.master_pin_hash,
  failed_attempts = 0, locked_until = null;
```

Unlock a tank that hit the wrong-PIN limit:
`update public.aquarium_tank_secrets set failed_attempts = 0, locked_until = null where room_code = 'CODE';`
