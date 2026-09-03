-- Spotter — exercise demonstration media.
--
-- GENERATED FILE. Source of truth is tools/map-demos.mjs; regenerate with:
--   node tools/map-demos.mjs run
--
-- Four columns on the catalog and one public bucket. Reference data, written by
-- the service role, read by every signed-in user through the "catalog readable"
-- policy that already exists — no new RLS.
--
-- demo_kind is 'image' for a single still and 'pair' when the source ships two
-- frames of the same movement; for a pair the SECOND frame lives in demo_poster,
-- which is otherwise the poster still of a video demo and is null for a single
-- image. The app cross-fades the two on a 1.6s cycle, and shows only the first
-- under prefers-reduced-motion.
--
-- demo_credit is the attribution line, built from the licence and author fields
-- the source ships alongside each image rather than written by hand. wger's
-- illustrations are CC-BY-SA, which requires that line to be shown; it is
-- rendered under the image in the Explain sheet, and Settings carries the
-- standing credit.
--
-- Idempotent: the columns are added only if missing, the bucket insert swallows
-- its own conflict, and the update is a no-op once the values match.

alter table public.exercise_catalog
  add column if not exists demo_url    text,
  add column if not exists demo_kind   text,
  add column if not exists demo_credit text,
  add column if not exists demo_poster text;

do $$ begin
  alter table public.exercise_catalog
    add constraint catalog_demo_kind_known check (demo_kind is null or demo_kind in ('image', 'pair', 'gif', 'video'));
exception when duplicate_object then null; end $$;

-- Public, like thumbs: these are illustrations, not anybody's data, and a signed
-- URL per image would be a round trip for every sheet that opens.
insert into storage.buckets (id, name, public) values ('demos', 'demos', true)
on conflict (id) do nothing;

update public.exercise_catalog as c
set demo_url = v.url, demo_kind = v.kind, demo_credit = v.credit,
    demo_poster = v.poster, updated_at = now()
from (values
  ('ab-wheel-rollout', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/ab-wheel-rollout.jpg', 'pair', 'Illustration: lhegedus, CC BY-SA 4.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/ab-wheel-rollout-2.jpg'),
  ('back-extension', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/back-extension.png', 'pair', 'Illustration: Everkinetic, wger.de, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/back-extension-2.png'),
  ('bench-press', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/bench-press.png', 'pair', 'Illustration: Everkinetic, sistab2, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/bench-press-2.png'),
  ('bird-dog', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/bird-dog.jpg', 'image', 'Illustration: Settebello, CC BY-SA 4.0 via wger', null),
  ('chin-up', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/chin-up.png', 'pair', 'Illustration: Everkinetic, BFad07, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/chin-up-2.png'),
  ('close-grip-bench-press', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/close-grip-bench-press.png', 'pair', 'Illustration: Everkinetic, wger.de, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/close-grip-bench-press-2.png'),
  ('crunch', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/crunch.png', 'pair', 'Illustration: wger.de, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/crunch-2.png'),
  ('deadlift', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/deadlift.jpeg', 'image', 'Illustration: philip, wger.de, CC BY-SA 4.0 via wger', null),
  ('devils-press', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/devils-press.jpg', 'image', 'Illustration: Settebello, CC BY-SA 4.0 via wger', null),
  ('dip', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/dip.png', 'image', 'Illustration: cshep442, BFad07, CC BY-SA 4.0 via wger', null),
  ('dumbbell-curl', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/dumbbell-curl.png', 'image', 'Illustration: Franpol, CC BY-SA 4.0 via wger', null),
  ('dumbbell-floor-press', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/dumbbell-floor-press.jpg', 'image', 'Illustration: admin, CC BY-SA 4.0 via wger', null),
  ('dumbbell-row', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/dumbbell-row.png', 'image', 'Illustration: Rottekongen, CC BY-SA 4.0 via wger', null),
  ('front-raise', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/front-raise.png', 'image', 'Illustration: philip, Manu, wikipedia, CC BY-SA 4.0 via wger', null),
  ('front-squat', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/front-squat.png', 'pair', 'Illustration: Everkinetic, sistab2, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/front-squat-2.png'),
  ('glute-bridge', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/glute-bridge.png', 'image', 'Illustration: tdprice12, CC BY-SA 4.0 via wger', null),
  ('goblet-squat', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/goblet-squat.jpeg', 'pair', 'Illustration: philip, ataraxie67, CC BY-SA 4.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/goblet-squat-2.jpeg'),
  ('good-morning', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/good-morning.png', 'pair', 'Illustration: Everkinetic, captive0592, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/good-morning-2.png'),
  ('hammer-curl', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/hammer-curl.png', 'pair', 'Illustration: Everkinetic, wger.de, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/hammer-curl-2.png'),
  ('high-knees', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/high-knees.png', 'image', 'Illustration from wger, CC BY-SA 4.0', null),
  ('hip-adduction', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/hip-adduction.webp', 'image', 'Illustration: flori, CC BY-SA 4.0 via wger', null),
  ('hip-circle', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/hip-circle.png', 'image', 'Illustration: Davidgj32, CC BY-SA 4.0 via wger', null),
  ('hip-flexor-stretch', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/hip-flexor-stretch.png', 'image', 'Illustration: Davidgj32, CC BY-SA 4.0 via wger', null),
  ('incline-dumbbell-press', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/incline-dumbbell-press.png', 'pair', 'Illustration: Everkinetic, wger.de, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/incline-dumbbell-press-2.jpg'),
  ('inverted-row', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/inverted-row.jpg', 'image', 'Illustration: Gavru, CC BY-SA 4.0 via wger', null),
  ('kettlebell-swing', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/kettlebell-swing.png', 'image', 'Illustration: clafal, CC BY-SA 4.0 via wger', null),
  ('lateral-raise', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/lateral-raise.png', 'pair', 'Illustration: Everkinetic, wger.de, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/lateral-raise-2.png'),
  ('leg-curl', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/leg-curl.png', 'pair', 'Illustration: Everkinetic, wger.de, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/leg-curl-2.png'),
  ('leg-extension', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/leg-extension.png', 'pair', 'Illustration: Franpol, BFad07, CC BY-SA 4.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/leg-extension-2.png'),
  ('leg-press', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/leg-press.webp', 'image', 'Illustration: BFad07, CC BY-SA 4.0 via wger', null),
  ('lunge', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/lunge.png', 'image', 'Illustration: Franpol, CC BY-SA 4.0 via wger', null),
  ('machine-chest-press', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/machine-chest-press.webp', 'image', 'Illustration: roneydya, wger.de, CC BY-SA 4.0 via wger', null),
  ('overhead-press', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/overhead-press.png', 'image', 'Illustration: nishant0712, CC BY-SA 4.0 via wger', null),
  ('overhead-tricep-extension', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/overhead-tricep-extension.gif', 'image', 'Illustration: benjamin.yildiz, CC BY-SA 4.0 via wger', null),
  ('pallof-press', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/pallof-press.png', 'image', 'Illustration: prevail90, CC BY-SA 4.0 via wger', null),
  ('pigeon-pose', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/pigeon-pose.png', 'image', 'Illustration: Davidgj32, CC BY-SA 4.0 via wger', null),
  ('pistol-squat', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/pistol-squat.jpg', 'pair', 'Illustration: wakanda90, minifigmaster125, CC BY-SA 4.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/pistol-squat-2.jpg'),
  ('plank', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/plank.png', 'pair', 'Illustration: utkb, YYCfit / BFad07, CC BY-SA 4.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/plank-2.png'),
  ('plank-shoulder-tap', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/plank-shoulder-tap.jpg', 'image', 'Illustration: clafal, CC BY-SA 4.0 via wger', null),
  ('plyo-push-up', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/plyo-push-up.jpg', 'image', 'Illustration: Settebello, CC BY-SA 4.0 via wger', null),
  ('preacher-curl', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/preacher-curl.png', 'pair', 'Illustration: Everkinetic, cgoob883, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/preacher-curl-2.png'),
  ('pull-up', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/pull-up.jpg', 'image', 'Illustration: Imobard, wger.de, CC BY-SA 4.0 via wger', null),
  ('push-press', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/push-press.jpg', 'image', 'Illustration: philip, sistab2, CC BY-SA 4.0 via wger', null),
  ('push-up', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/push-up.jpg', 'image', 'Illustration: Settebello, CC BY-SA 4.0 via wger', null),
  ('reverse-lunge', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/reverse-lunge.jfif', 'pair', 'Illustration: philip, CC BY-SA 4.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/reverse-lunge-2.jfif'),
  ('romanian-deadlift', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/romanian-deadlift.webp', 'image', 'Illustration: AlucardEvil40, CC BY-SA 4.0 via wger', null),
  ('russian-twist', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/russian-twist.png', 'image', 'Illustration: lion, CC BY-SA 4.0 via wger', null),
  ('seated-cable-row', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/seated-cable-row.png', 'pair', 'Illustration: Franpol, CC BY-SA 4.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/seated-cable-row-2.png'),
  ('side-bend', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/side-bend.jpg', 'image', 'Illustration from wger, CC BY-SA 4.0', null),
  ('straight-arm-pulldown', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/straight-arm-pulldown.png', 'image', 'Illustration: barry, CC BY-SA 4.0 via wger', null),
  ('sumo-deadlift', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/sumo-deadlift.webp', 'image', 'Illustration: magdy, CC BY-SA 4.0 via wger', null),
  ('tricep-pushdown', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/tricep-pushdown.jpg', 'image', 'Illustration: anto.kreegyr, CC BY-SA 4.0 via wger', null),
  ('walking-lunge', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/walking-lunge.png', 'pair', 'Illustration: Everkinetic, wger.de, CC BY-SA 3.0 via wger', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/walking-lunge-2.jpg'),
  ('wall-ball', 'https://mtzevoxxpsktmrbbuxva.supabase.co/storage/v1/object/public/demos/wall-ball.jpg', 'image', 'Illustration: philip, CC BY-SA 4.0 via wger', null)
) as v(id, url, kind, credit, poster)
where c.id = v.id and (
  c.demo_url is distinct from v.url or c.demo_kind is distinct from v.kind or
  c.demo_credit is distinct from v.credit or c.demo_poster is distinct from v.poster);
