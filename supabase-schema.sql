-- ============================================================================
-- SUPABASE SCHEMA FOR WONDERFISH • 3D DIGITAL AQUARIUM & WEB AR
-- Connected Project: digital-aquarium (tjvmncxnnurseyqheblp)
-- Includes: Multi-Room Tank Codes, Named Tanks, Room PIN Reset & Client Inquiries
-- NOTE: later changes (plans, per-tank PINs, branding, scan stats, cleanup) are in
--       supabase/migrations/*.sql. Run those after this file. See SHOP-ADMIN.md.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aquarium_fishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) <= 40),
  species text NOT NULL CHECK (char_length(species) BETWEEN 1 AND 32 AND species ~ '^[a-z0-9_-]+$'),
  texture_url text NOT NULL,
  swim_seed integer NOT NULL DEFAULT floor(random() * 100000)::int,
  room_code text NOT NULL DEFAULT 'default' CHECK (char_length(room_code) BETWEEN 1 AND 32 AND room_code ~ '^[A-Za-z0-9_-]+$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aquarium_fishes_room_created
  ON public.aquarium_fishes (room_code, created_at DESC);

ALTER TABLE public.aquarium_fishes ENABLE ROW LEVEL SECURITY;

-- Named Tanks / Party & Event Rooms
CREATE TABLE IF NOT EXISTS public.aquarium_tanks (
  room_code text PRIMARY KEY CHECK (char_length(room_code) BETWEEN 2 AND 32 AND room_code ~ '^[A-Za-z0-9_-]+$'),
  title text NOT NULL DEFAULT 'WonderFish Reef' CHECK (char_length(title) <= 80),
  host_name text NOT NULL DEFAULT '' CHECK (char_length(host_name) <= 60),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aquarium_tanks ENABLE ROW LEVEL SECURITY;

-- Client Inquiries / Pricing & Event Bookings
CREATE TABLE IF NOT EXISTS public.client_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 80),
  contact_info text NOT NULL DEFAULT '' CHECK (char_length(contact_info) <= 120),
  organization_or_event text NOT NULL DEFAULT '' CHECK (char_length(organization_or_event) <= 120),
  selected_plan text NOT NULL DEFAULT 'Day & Party Pass' CHECK (char_length(selected_plan) <= 80),
  preferred_date text NOT NULL DEFAULT '' CHECK (char_length(preferred_date) <= 60),
  requested_tank_code text NOT NULL DEFAULT '' CHECK (char_length(requested_tank_code) <= 32),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_inquiries ENABLE ROW LEVEL SECURITY;

-- Room-Scoped PIN Reset RPC (Default PIN: '1234')
CREATE OR REPLACE FUNCTION public.reset_aquarium_room(target_room text, admin_pin text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF admin_pin IS DISTINCT FROM '1234' THEN
    RAISE EXCEPTION 'Invalid Admin PIN';
  END IF;

  DELETE FROM public.aquarium_fishes WHERE upper(room_code) = upper(coalesce(target_room, 'WONDER-REEF'));
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
