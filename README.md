# 🐠 WonderFish — Color a Fish, Watch It Swim in 3D & Web AR

**Live Website Repository:** `https://github.com/susanthavfx-art/WonderFish`  
**GitHub Pages URL:** `https://susanthavfx-art.github.io/WonderFish/`

Built by **WonderLab AR** — a playful, kid-friendly **3D Digital Aquarium & Web AR** platform powered by **Three.js** + **Supabase (`digital-aquarium`)** with isolated **Tank Codes** for every party, classroom, and venue!

---

## 🌟 Pages Included

- **`index.html`** — **Home Page** (Play Magic Reef–inspired light & colorful kids showcase, 3D claymation artwork, pastel marquee, live embedded 3D Reef TV, free printable coloring pages)
- **`how-it-works.html`** — **How It Works** (`"One reef. Any screen."` sunshine banner + 4 screen setup modes + FAQ)
- **`pricing.html`** — **Pricing & Event Booking** (Free / Play Pass / Day Pass / Venue Custom + `USD`/`LKR` switcher + **Direct Supabase `client_inquiries` Booking Form**)
- **`our-story.html`** — **Our Story** (WonderLab AR story + kid-safety principles)
- **`tank-new.html`** — **Start Your Tank Launcher** (Create a private **Tank Code** for any party/event or join an existing code!)
- **`aquarium.html`** — **Fullscreen 3D Digital Aquarium** (`?tank=YOUR-CODE` isolated rooms, QR code overlay, PIN-protected room reset)
- **`scan.html`** — **Smartphone Paper Scanner + 4-Corner Vision + Live Camera Web AR** (`?tank=YOUR-CODE`)
- **`sheets.html`** — **Printable A4 Coloring Sheets & Virtual Crayon Studio**

---

## 🗄️ Connected Supabase Tables (`digital-aquarium`)

1. **`public.aquarium_fishes`** — Stores scanned fishes isolated by `room_code` (old repo uses `'default'`; WonderFish uses `'WONDER-REEF'` or each event's custom `Tank Code`).
2. **`public.aquarium_tanks`** — Stores custom event/party Tank Codes & Reef Titles.
3. **`public.client_inquiries`** — Stores all Pricing / Event Booking form submissions directly from `pricing.html` (viewable privately in **Supabase Dashboard → Table Editor → `client_inquiries`**).
