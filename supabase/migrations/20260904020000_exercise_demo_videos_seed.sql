-- Spotter — curated demonstration clips, seeded.
--
-- GENERATED FILE. Source of truth is tools/demo-videos.mjs plus the committed
-- snapshots in tools/demo-videos/; regenerate with:
--   node tools/demo-videos.mjs run
--
-- Every row is a clip from a creator on the allow-list in tools/demo-sources.json,
-- attached to a canonical exercise_catalog id offline. Nothing here was chosen by
-- YouTube search, and reading a row at request time costs no quota.
--
-- Snapshot sizes this run: rp 188, fbb 399, catalyst 614, crossfit 271, tnation 165, musclewiki 117, bbcom 99, nippard 32, nippard-program 0.
-- How each row was matched: exact name or alias 410, catalog phrase with only
-- neutral words left over 53, owner-confirmed in tools/demo-videos-review.json 57,
-- hand-pasted 0. 168 of 224 catalog ids have at least one clip.
--
-- Idempotent, and it converges: the insert upserts on (key, video_id), and the
-- delete after each block drops every row that source used to own and this run
-- did not produce. The prune is by (key, video_id) rather than by video_id alone
-- so a clip that moved from one exercise to another leaves no ghost behind.

-- rp (Renaissance Periodization), tier 1: 64 rows across 64 exercises.
insert into public.exercise_demo_videos
  (key, video_id, title, channel, channel_id, source, tier, secs, rank, method)
values
  ('back-squat', 'i7J5h7BJ07g', 'High Bar Squat', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 10, 0, 'exact'),
  ('barbell-curl', 'JnLFSFurrqQ', 'Barbell Curl Normal Grip', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 14, 0, 'confirmed'),
  ('bent-over-row', '6FZHJGzMFEc', 'Barbell Bent Over Row', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 15, 0, 'exact'),
  ('cable-crunch', '6GMKPQVERzw', 'Rope Crunch', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 10, 0, 'exact'),
  ('cable-fly', '4mfLHnFL0Uw', 'Cable Flye', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 12, 0, 'exact'),
  ('cable-pull-through', 'pv8e6OSyETE', 'Cable Pull Through', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('chest-fly', 'JFm8KbhjibM', 'Flat Dumbbell Flye', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 17, 0, 'exact'),
  ('chest-supported-row', '0UBRfiO4zDs', 'Chest Supported Row', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 17, 0, 'exact'),
  ('chin-up', '9JC1EwqezGY', 'Underhand Pullup', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 10, 0, 'exact'),
  ('close-grip-bench-press', 'FiQUzPtS90E', 'Narrow Grip Bench Press', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 13, 0, 'exact'),
  ('deadlift', 'AweC3UaM14o', 'Deadlift', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 12, 0, 'exact'),
  ('deficit-deadlift', 'X-uKkAukJVA', 'Deficit Deadlift', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('diamond-push-up', 'Lz1aFtuNvEQ', 'Narrow Pushup', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 13, 0, 'exact'),
  ('dip', '4LA1kF7yCGo', 'Dip', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('dumbbell-bench-press', 'YQ2s_Y7g5Qk', 'Flat Dumbbell Bench Press', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('dumbbell-curl', 'iixND1P2lik', 'Alternating Dumbbell Curl', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 15, 0, 'exact'),
  ('dumbbell-shoulder-press', 'Raemd3qWgJc', 'Standing Dumbbell Shoulder Press', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('face-pull', '-MODnZdnmAQ', 'Cable Rope Facepull', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 12, 0, 'exact'),
  ('front-raise', 'hRJ6tR5-if0', 'Dumbbell Front Raise', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 12, 0, 'exact'),
  ('front-squat', 'HHxNbhP16UE', 'Front Squat', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 9, 0, 'exact'),
  ('glute-ham-raise', 'SBGYSfoqyfU', 'Glute Ham Raise', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 8, 0, 'exact'),
  ('hack-squat', 'rYgNArpwE7E', 'Hack Squat', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 14, 0, 'exact'),
  ('hammer-curl', 'XOEL4MgekYE', 'Hammer Curl', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 14, 0, 'exact'),
  ('hanging-knee-raise', 'RD_A-Z15ER4', 'Hanging Knee Raise', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 9, 0, 'exact'),
  ('hanging-leg-raise', '7FwGZ8qY5OU', 'Hanging Straight Leg Raise', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 9, 0, 'confirmed'),
  ('hip-thrust', 'EF7jXP17DPE', 'Barbell Hip Thrust', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('incline-dumbbell-curl', 'aTYlqC_JacQ', 'Incline Dumbbell Curl', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 17, 0, 'exact'),
  ('incline-dumbbell-fly', '8oR5hBwbIBc', 'Incline Dumbbell Flye', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 18, 0, 'exact'),
  ('incline-dumbbell-press', '5CECBjd7HLQ', 'Incline Dumbbell Press', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 12, 0, 'exact'),
  ('inverted-row', 'KOaCM1HMwU0', 'Inverted Row', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 13, 0, 'exact'),
  ('lat-pulldown', 'YCKPD4BSD2E', 'Wide Grip Pulldown', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 15, 0, 'exact'),
  ('lateral-raise', 'OuG1smZTsQQ', 'Lateral Raise', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('leg-curl', 'Orxowest56U', 'Seated Leg Curl', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('leg-extension', 'm0FOpMEgero', 'Leg Extension', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('leg-press', 'yZmx_Ac3880', 'Leg Press', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('machine-chest-press', 'NwzUje3z0qY', 'Machine Chest Press', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('machine-row', 'gg5hwJuv6KI', 'Hammer High Row', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 17, 0, 'confirmed'),
  ('machine-shoulder-press', 'WvLMauqrnK8', 'Machine Shoulder Press', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 13, 0, 'exact'),
  ('overhead-press', 'G2qpTG1Eh40', 'Standing Barbell Shoulder Press', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('overhead-tricep-extension', '1u18yJELsh0', 'Cable Overhead Triceps Extension', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 12, 0, 'exact'),
  ('pec-deck', 'O-OBCfyh9Fw', 'Pec Deck Flye', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 13, 0, 'exact'),
  ('preacher-curl', 'Ja6ZlIDONac', 'Machine Preacher Curl', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 17, 0, 'confirmed'),
  ('pull-over', 'jQjWlIwG4sI', 'Dumbbell Pullover', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 15, 0, 'exact'),
  ('pull-up', 'GRgWPT9XSQQ', 'Wide Grip Pullup', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 8, 0, 'exact'),
  ('push-up', 'mm6_WcoCVTA', 'Pushup', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('rear-delt-fly', '5YK4bgzXDp0', 'Machine Reverse Flye', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 14, 0, 'confirmed'),
  ('reverse-lunge', 'TQfhY5oJ_Sc', 'Reverse Lunge', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('seated-cable-row', 'UCXxvVItLoM', 'Seated Cable Row', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 18, 0, 'exact'),
  ('shrug', 'M_MjF5Nm_h4', 'Barbell Shrug', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 11, 0, 'exact'),
  ('single-leg-glute-bridge', 'lzDgRRuBdqY', 'Single Leg Hip Thrust', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 10, 0, 'exact'),
  ('skull-crusher', 'l3rHYPtMUo8', 'Barbell Skullcrusher', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 14, 0, 'exact'),
  ('spider-curl', 'ke2shAeQ0O8', 'Dumbbell Spider Curl', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 15, 0, 'exact'),
  ('split-squat', 'jNihW0WDIL4', 'Split Squat', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 9, 0, 'exact'),
  ('stiff-leg-deadlift', 'CN_7cz3P-1U', 'Stiff Legged Deadlift', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 15, 0, 'exact'),
  ('straight-arm-pulldown', 'G9uNaXGTJ4w', 'Straight Arm Pulldown', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 12, 0, 'exact'),
  ('sumo-deadlift', 'pfSMst14EFk', 'Sumo Deadlift', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 10, 0, 'exact'),
  ('sumo-squat', '4eDJa5MnAmY', 'Sumo Squat', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 15, 0, 'exact'),
  ('t-bar-row', 'yPis7nlbqdY', 'T Bar Row', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 16, 0, 'exact'),
  ('trap-bar-deadlift', 'v709aJKv-gM', 'Trap Bar Deadlift', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 10, 0, 'exact'),
  ('tricep-pushdown', '-xa-6cQaZKY', 'Rope Pushdown', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 12, 0, 'exact'),
  ('upright-row', 'um3VVzqunPU', 'Barbell Upright Row', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 10, 0, 'exact'),
  ('v-up', 'BIOM5eSsJ_8', 'V-Up', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 9, 0, 'exact'),
  ('walking-lunge', '_meXEWq5MOQ', 'Barbell Walking Lunge', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 9, 0, 'confirmed'),
  ('wrist-curl', 'iQ4JjOK73PE', 'Dumbbell Standing Wrist Curl', 'Renaissance Periodization', 'UCfQgsKhHjSyRLOp9mnffqVg', 'rp', 1, 12, 0, 'exact')
on conflict (key, video_id) do update set
  title = excluded.title, channel = excluded.channel, channel_id = excluded.channel_id,
  source = excluded.source, tier = excluded.tier, secs = excluded.secs,
  rank = excluded.rank, method = excluded.method;

delete from public.exercise_demo_videos
 where source = 'rp' and (key, video_id) not in (
  ('back-squat','i7J5h7BJ07g'), ('barbell-curl','JnLFSFurrqQ'), ('bent-over-row','6FZHJGzMFEc'), ('cable-crunch','6GMKPQVERzw'), ('cable-fly','4mfLHnFL0Uw'), ('cable-pull-through','pv8e6OSyETE'), ('chest-fly','JFm8KbhjibM'), ('chest-supported-row','0UBRfiO4zDs'), ('chin-up','9JC1EwqezGY'), ('close-grip-bench-press','FiQUzPtS90E'), ('deadlift','AweC3UaM14o'), ('deficit-deadlift','X-uKkAukJVA'), ('diamond-push-up','Lz1aFtuNvEQ'), ('dip','4LA1kF7yCGo'), ('dumbbell-bench-press','YQ2s_Y7g5Qk'), ('dumbbell-curl','iixND1P2lik'), ('dumbbell-shoulder-press','Raemd3qWgJc'), ('face-pull','-MODnZdnmAQ'), ('front-raise','hRJ6tR5-if0'), ('front-squat','HHxNbhP16UE'), ('glute-ham-raise','SBGYSfoqyfU'), ('hack-squat','rYgNArpwE7E'), ('hammer-curl','XOEL4MgekYE'), ('hanging-knee-raise','RD_A-Z15ER4'), ('hanging-leg-raise','7FwGZ8qY5OU'), ('hip-thrust','EF7jXP17DPE'), ('incline-dumbbell-curl','aTYlqC_JacQ'), ('incline-dumbbell-fly','8oR5hBwbIBc'), ('incline-dumbbell-press','5CECBjd7HLQ'), ('inverted-row','KOaCM1HMwU0'), ('lat-pulldown','YCKPD4BSD2E'), ('lateral-raise','OuG1smZTsQQ'), ('leg-curl','Orxowest56U'), ('leg-extension','m0FOpMEgero'), ('leg-press','yZmx_Ac3880'), ('machine-chest-press','NwzUje3z0qY'), ('machine-row','gg5hwJuv6KI'), ('machine-shoulder-press','WvLMauqrnK8'), ('overhead-press','G2qpTG1Eh40'), ('overhead-tricep-extension','1u18yJELsh0'), ('pec-deck','O-OBCfyh9Fw'), ('preacher-curl','Ja6ZlIDONac'), ('pull-over','jQjWlIwG4sI'), ('pull-up','GRgWPT9XSQQ'), ('push-up','mm6_WcoCVTA'), ('rear-delt-fly','5YK4bgzXDp0'), ('reverse-lunge','TQfhY5oJ_Sc'), ('seated-cable-row','UCXxvVItLoM'), ('shrug','M_MjF5Nm_h4'), ('single-leg-glute-bridge','lzDgRRuBdqY'), ('skull-crusher','l3rHYPtMUo8'), ('spider-curl','ke2shAeQ0O8'), ('split-squat','jNihW0WDIL4'), ('stiff-leg-deadlift','CN_7cz3P-1U'), ('straight-arm-pulldown','G9uNaXGTJ4w'), ('sumo-deadlift','pfSMst14EFk'), ('sumo-squat','4eDJa5MnAmY'), ('t-bar-row','yPis7nlbqdY'), ('trap-bar-deadlift','v709aJKv-gM'), ('tricep-pushdown','-xa-6cQaZKY'), ('upright-row','um3VVzqunPU'), ('v-up','BIOM5eSsJ_8'), ('walking-lunge','_meXEWq5MOQ'), ('wrist-curl','iQ4JjOK73PE'));

-- fbb (Functional Bodybuilding), tier 1: 31 rows across 31 exercises.
insert into public.exercise_demo_videos
  (key, video_id, title, channel, channel_id, source, tier, secs, rank, method)
values
  ('archer-push-up', 'Pca41QxE7l4', 'Slider Archer Push Up', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 10, 0, 'confirmed'),
  ('bicycle-crunch', '_vWNnODwF5w', 'Bicycle Crunch', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 7, 0, 'exact'),
  ('bulgarian-split-squat', 'DEEDzAP-0pc', 'Kettlebell Rack Rear Foot Elevated Split Squat', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 14, 0, 'confirmed'),
  ('cossack-squat', 'vcMZNgn5G9c', 'Alternating KB Rack Cossack Squats', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 17, 0, 'confirmed'),
  ('donkey-kick', 'OYuojkJvT4k', 'Glute Loop Donkey Kicks', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 14, 0, 'confirmed'),
  ('flutter-kick', 'e_s7uBNPnow', 'Flutter Kicks', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 14, 0, 'exact'),
  ('frog-pump', 'twJfjVteVbI', 'Dumbbell Frog Pump', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 12, 0, 'confirmed'),
  ('glute-bridge', '1PzFtQZhIgU', 'Glute Loop Glute Bridges', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 11, 0, 'confirmed'),
  ('hanging-knee-raise', 'KYwP30AD_h0', 'Hanging Knee Tucks', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 19, 1, 'confirmed'),
  ('high-knees', 'afOncpVZoAQ', 'High Knees Run in Place', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 7, 0, 'confirmed'),
  ('high-pull', 'D98du9B2bgw', 'Dual KB High Pull', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 18, 0, 'confirmed'),
  ('hollow-hold', 'VqtPkI5pP3o', 'Hollow Hold', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 13, 0, 'exact'),
  ('incline-dumbbell-fly', 'b_LwXzIc9No', 'Incline Dumbbell Fly', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 22, 1, 'exact'),
  ('jefferson-curl', '1tLUb7aqG0c', 'Dual Kettlebell Jefferson Curl', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 22, 0, 'confirmed'),
  ('jump-squat', '-95X7sYHNDI', 'Jump Squat', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 8, 0, 'exact'),
  ('kettlebell-clean', 'roDYEs8qfKQ', 'Kettlebell Clean From Floor', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 15, 0, 'confirmed'),
  ('kettlebell-halo', '61F3dwJFv_U', 'Dumbbell Halo', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 20, 0, 'confirmed'),
  ('kettlebell-snatch', '63d8GMBIUyY', 'Hike Kettlebell Snatch', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 18, 0, 'confirmed'),
  ('kettlebell-windmill', '3rtUK_jUv4s', 'Kettlebell Windmill', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 14, 0, 'exact'),
  ('l-sit', '0h8LCh9b8vY', 'L Sit on Kettlebells', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 16, 0, 'confirmed'),
  ('lateral-lunge', '2rbLIlqnNhg', 'Slider Lateral Lunge', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 13, 0, 'confirmed'),
  ('man-maker', 'w2DbVUp3aq4', 'Kettlebell Man Maker', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 27, 0, 'confirmed'),
  ('mountain-climber', '9DTNHLWAJ1U', 'Slider Mountain Climbers', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 9, 0, 'confirmed'),
  ('plank-shoulder-tap', 'C6At19Q9i2Q', 'Plank Shoulder Taps', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 13, 0, 'exact'),
  ('renegade-row', 'rSc1pmDEhZg', 'Alternating DB Plank Rows', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 19, 0, 'exact'),
  ('scissor-kick', 'CU7Mzo-OtHk', 'Hollow Body Scissor Kicks', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 14, 0, 'confirmed'),
  ('skater-jump', 'CaN4zfIPyXU', 'Skater Jumps', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 12, 0, 'exact'),
  ('sumo-deadlift-high-pull', '0xpSOScnr1E', 'Kettlebell Sumo Deadlift High Pull', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 13, 0, 'confirmed'),
  ('tuck-jump', 'jgPfJjRf9Ck', 'Tuck Jump', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 6, 0, 'exact'),
  ('turkish-get-up', 'O7FdhtkE47M', 'Dumbbell Turkish Get Up', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 11, 0, 'confirmed'),
  ('woodchop', 'ivziZev2BzA', 'Banded Chop', 'Functional Bodybuilding', 'UCjNE2-Yeiwo4mTJ3HdfrSHA', 'fbb', 1, 14, 0, 'confirmed')
on conflict (key, video_id) do update set
  title = excluded.title, channel = excluded.channel, channel_id = excluded.channel_id,
  source = excluded.source, tier = excluded.tier, secs = excluded.secs,
  rank = excluded.rank, method = excluded.method;

delete from public.exercise_demo_videos
 where source = 'fbb' and (key, video_id) not in (
  ('archer-push-up','Pca41QxE7l4'), ('bicycle-crunch','_vWNnODwF5w'), ('bulgarian-split-squat','DEEDzAP-0pc'), ('cossack-squat','vcMZNgn5G9c'), ('donkey-kick','OYuojkJvT4k'), ('flutter-kick','e_s7uBNPnow'), ('frog-pump','twJfjVteVbI'), ('glute-bridge','1PzFtQZhIgU'), ('hanging-knee-raise','KYwP30AD_h0'), ('high-knees','afOncpVZoAQ'), ('high-pull','D98du9B2bgw'), ('hollow-hold','VqtPkI5pP3o'), ('incline-dumbbell-fly','b_LwXzIc9No'), ('jefferson-curl','1tLUb7aqG0c'), ('jump-squat','-95X7sYHNDI'), ('kettlebell-clean','roDYEs8qfKQ'), ('kettlebell-halo','61F3dwJFv_U'), ('kettlebell-snatch','63d8GMBIUyY'), ('kettlebell-windmill','3rtUK_jUv4s'), ('l-sit','0h8LCh9b8vY'), ('lateral-lunge','2rbLIlqnNhg'), ('man-maker','w2DbVUp3aq4'), ('mountain-climber','9DTNHLWAJ1U'), ('plank-shoulder-tap','C6At19Q9i2Q'), ('renegade-row','rSc1pmDEhZg'), ('scissor-kick','CU7Mzo-OtHk'), ('skater-jump','CaN4zfIPyXU'), ('sumo-deadlift-high-pull','0xpSOScnr1E'), ('tuck-jump','jgPfJjRf9Ck'), ('turkish-get-up','O7FdhtkE47M'), ('woodchop','ivziZev2BzA'));

-- catalyst (Catalyst Athletics), tier 2: 99 rows across 99 exercises.
insert into public.exercise_demo_videos
  (key, video_id, title, channel, channel_id, source, tier, secs, rank, method)
values
  ('ab-wheel-rollout', 'Ojf6jVWJDuU', 'Ab Rollout', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 51, 1, 'exact'),
  ('arnold-press', 'y2Z56aTvx_M', 'Arnold Press', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 40, 0, 'exact'),
  ('back-extension', 'skXsFN8NfqU', 'Back Extension', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 65, 1, 'exact'),
  ('back-squat', 'Akd5xmZlsvg', 'Back Squat', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 94, 2, 'exact'),
  ('band-pull-apart', 'Xg58d9lDWME', 'Band Pull-Apart', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 43, 0, 'exact'),
  ('banded-walk', 'UX-hIEbWpCA', 'Monster Walk', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 58, 0, 'exact'),
  ('bench-dip', 'em94npR71nk', 'Bench Dip', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 41, 0, 'exact'),
  ('bench-press', 'GlPKtOUvZqw', 'Bench Press', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 50, 1, 'exact'),
  ('bent-over-row', 'cYVkgmPqRMw', 'Pendlay Row', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 56, 3, 'exact'),
  ('bird-dog', 'DBWdijCeSIM', 'Bird Dog', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 59, 0, 'exact'),
  ('box-jump', 'd2z2_rRkpAo', 'Box Jump', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 70, 1, 'exact'),
  ('broad-jump', 'AOkmLTD8J24', 'Broad Jump', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 59, 0, 'exact'),
  ('bulgarian-split-squat', 'DpZsCmsI0uk', 'Bulgarian Split Squat', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 74, 1, 'exact'),
  ('cable-curl', 'yGdzi_CciKY', 'Cable Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 36, 0, 'exact'),
  ('chest-fly', 'T3EOhuU5RQg', 'Pec Fly', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 40, 1, 'exact'),
  ('chin-up', '0PhzdeDENF0', 'Chin-Up', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 43, 2, 'exact'),
  ('clamshell', 'wRlgcPJ-F-w', 'Clamshell', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 38, 0, 'exact'),
  ('clean-and-jerk', 'jiYPejuiNck', 'Clean-Jerk', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 55, 1, 'exact'),
  ('concentration-curl', 'Bv1iH7mLfb4', 'Concentration Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 35, 0, 'exact'),
  ('copenhagen-plank', 'VfjAmomtVa0', 'Copenhagen Plank', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 44, 0, 'exact'),
  ('cossack-squat', 'Qn5r1xZkC5Q', 'Cossack Squat', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 59, 1, 'exact'),
  ('crunch', 'aqn-hqIk4rk', 'Crunch', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 44, 1, 'exact'),
  ('dead-bug', 'ZtwcT5g4Tb8', 'Dead Bug', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 66, 0, 'exact'),
  ('deadlift', 'E9hLcC8ZrmA', 'Deadlift', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 113, 3, 'exact'),
  ('dip', 'sg3PTIA3rXI', 'Dip', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 49, 2, 'exact'),
  ('dumbbell-bench-press', 'ieewD7N2Nuw', 'Dumbbell Press', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 36, 3, 'exact'),
  ('dumbbell-curl', 'plU7Ca7Fke8', 'Dumbbell Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 34, 2, 'exact'),
  ('dumbbell-row', 'IOy2k0Cb6Vo', 'Single-Arm Dumbbell Row', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 45, 2, 'exact'),
  ('ez-bar-curl', 'OgO6cWoezNc', 'EZ Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 40, 0, 'exact'),
  ('face-pull', 'UnSEJGBotEM', 'Face Pull', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 60, 1, 'exact'),
  ('farmers-carry', 'G-_FYQfur9w', 'Farmer Carry', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 40, 0, 'exact'),
  ('flutter-kick', 'QjEDhGkmx8Y', 'Flutter Kick', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 40, 1, 'exact'),
  ('front-raise', 'xPvL9xLXUbg', 'Dumbbell Front Raise', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 40, 3, 'exact'),
  ('front-squat', 'Q1R0_CbgHpc', 'Front Squat', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 114, 2, 'exact'),
  ('glute-bridge', '1pqZI2t8XHo', 'Glute Bridge', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 50, 2, 'exact'),
  ('glute-ham-raise', '1TlhdiFSJrU', 'Glute-Ham Raise (GHR)', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 83, 2, 'exact'),
  ('good-morning', 'lYUB78Btcxc', 'Good Morning', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 78, 2, 'exact'),
  ('hammer-curl', 'W0xVe5jdnOU', 'Hammer Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 34, 1, 'exact'),
  ('hang-clean', 'uUeV3LwisDI', 'Hang Clean', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 138, 1, 'exact'),
  ('hanging-leg-raise', 'PjlPiVTtWA4', 'Hanging Leg Raise (HLR)', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 48, 1, 'exact'),
  ('high-pull', '2Qv8pEnprpU', 'Clean High-Pull', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 101, 1, 'confirmed'),
  ('hollow-hold', 'x8xSTaaMmuY', 'Hollow Hold', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 34, 1, 'exact'),
  ('incline-bench-press', 'EQSPHyJ75EM', 'Incline Bench Press', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 44, 0, 'exact'),
  ('incline-dumbbell-curl', 'V8H4k8lquiU', 'Incline Dumbbell Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 38, 1, 'exact'),
  ('incline-dumbbell-press', 'JHFd-e2_M8E', 'Dumbbell Incline Bench Press', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 39, 2, 'exact'),
  ('inverted-row', 'jTaIMXRT6qY', 'Inverted Row', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 47, 2, 'exact'),
  ('jefferson-curl', 'lHybIJtacgU', 'Jefferson Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 48, 1, 'exact'),
  ('jump-squat', 'y10UT2nOFVs', 'Squat Vertical Jump', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 70, 2, 'confirmed'),
  ('kettlebell-swing', 'mBajuiwRTSw', 'Kettlebell Swing', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 60, 1, 'exact'),
  ('kettlebell-windmill', 'xkqvxdrfav0', 'Windmill', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 43, 1, 'exact'),
  ('lat-pulldown', 'c2e_j4IdPBs', 'Lat Pulldown', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 40, 1, 'exact'),
  ('lateral-lunge', 'dQZjFjYyghY', 'Lateral Lunge', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 64, 1, 'exact'),
  ('lateral-raise', 'goVyitDXa5o', 'Cable Lateral Raise', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 41, 2, 'exact'),
  ('leg-curl', 'E4aZsdi7ENs', 'Hamstring Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 60, 2, 'exact'),
  ('leg-raise', 'oeuKRVdhxXQ', 'Alternating Lying Leg Raise', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 40, 0, 'exact'),
  ('lunge', 'bBrBLS7aejI', 'Lunge', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 72, 0, 'exact'),
  ('nordic-curl', 'HrOhaEnwDQY', 'Nordic Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 45, 0, 'exact'),
  ('overhead-carry', 'u2zEzUeOI-o', 'Dumbbell Overhead Carry', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 42, 0, 'exact'),
  ('overhead-squat', 'm_fvfJi94D8', 'Overhead Squat', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 84, 1, 'exact'),
  ('overhead-tricep-extension', 'xbNm9fRoUTw', 'Dumbbell Overhead Tricep Extension', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 37, 2, 'exact'),
  ('pallof-press', 'GfTQ0RLZ7GA', 'Pallof Press', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 50, 0, 'exact'),
  ('plank', 'P3FR4GUl2QM', 'Plank', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 57, 0, 'exact'),
  ('power-clean', 'YG8M_-11C2A', 'Power Clean', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 135, 1, 'exact'),
  ('preacher-curl', '90-t0TLEXAE', 'Preacher Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 36, 1, 'exact'),
  ('pull-up', 'IxQDQ2jwS5Y', 'Pull-up', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 55, 3, 'exact'),
  ('push-jerk', 'Om7vLD6x8W0', 'Push Jerk', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 100, 2, 'exact'),
  ('push-press', 'yklSQG1_Ovc', 'Push Press', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 97, 2, 'exact'),
  ('push-up', '8lruUgJ-Rww', 'Push-Up', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 57, 3, 'exact'),
  ('rear-delt-fly', '7Vi3nikf65I', 'Rear Delt Fly', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 42, 1, 'exact'),
  ('reverse-crunch', 'P3HvB3fCD9Y', 'Reverse Crunch', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 61, 0, 'exact'),
  ('reverse-curl', 'etJJujHLuXA', 'Dumbbell Reverse Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 34, 1, 'exact'),
  ('reverse-hyper', 'ROV6iVsSJSE', 'Reverse Hyper', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 55, 0, 'exact'),
  ('reverse-lunge', 'OiYhnVXrFwE', 'Reverse Lunge', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 44, 1, 'exact'),
  ('romanian-deadlift', '_U9KjljQyd0', 'Romanian Deadlift (RDL)', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 84, 0, 'exact'),
  ('russian-twist', 'N-arXZs-H70', 'Russian Twist', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 47, 0, 'exact'),
  ('scapular-pull-up', 'fAHEz25TRKU', 'Scap Pull-Up', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 44, 0, 'exact'),
  ('side-bend', 'vWAiW2v7fCs', 'Side Bend', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 52, 0, 'exact'),
  ('side-plank', 'JFBx8cpLRTw', 'Side Plank', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 53, 1, 'exact'),
  ('single-leg-deadlift', 'opvwjIol9Ts', 'Single-Leg RDL', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 62, 0, 'exact'),
  ('single-leg-glute-bridge', '3FE2eZGeT1o', 'Single-Leg Glute Bridge', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 72, 2, 'exact'),
  ('sit-up', '2o9zkR0hMB8', 'Sit-Up', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 48, 0, 'exact'),
  ('skull-crusher', 'S3xRQfb4Alo', 'Skullcrusher', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 43, 1, 'exact'),
  ('snatch', '1Lv1IyigIUY', 'Snatch', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 108, 1, 'exact'),
  ('spider-curl', 'kF6UsS3ZXo0', 'Dumbbell Spider Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 31, 1, 'exact'),
  ('split-jerk', '2GPA-cjUFnA', 'Split Jerk', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 106, 1, 'exact'),
  ('split-squat', 'L1LBRuJSOU8', 'Split Squat', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 47, 1, 'exact'),
  ('step-up', 'I9lUOenjk9U', 'Step-Up', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 64, 0, 'exact'),
  ('stiff-leg-deadlift', 'QbmaRSO1sIM', 'Stiff-Legged Deadlift (SLDL)', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 98, 2, 'exact'),
  ('straight-arm-pulldown', 'ev7LG1QG05U', 'Straight-Arm Pulldown', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 36, 1, 'exact'),
  ('superman', 'r7u7aofrP3g', 'Superman Hold', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 36, 1, 'exact'),
  ('tricep-kickback', '792uGH9RgfU', 'Tricep Kickback', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 38, 0, 'exact'),
  ('tricep-pushdown', 'e0g_ZbWlWRI', 'Tricep Pushdown', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 36, 1, 'exact'),
  ('tuck-jump', '1XYeIUTmBc8', 'Tuck Jump', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 62, 1, 'exact'),
  ('turkish-get-up', 'cAf9Zj1WIF0', 'Turkish Get-Up', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 79, 2, 'exact'),
  ('upright-row', 'eg2QH0YmDsc', 'Barbell Upright Row', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 36, 1, 'exact'),
  ('v-up', 'vPxaLvOsboM', 'V-Up', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 46, 2, 'exact'),
  ('wall-sit', 'Ok3L48EhvYk', 'Wall Sit', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 59, 0, 'exact'),
  ('wrist-curl', 'lA3QwdAn19Y', 'Barbell Wrist Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 42, 2, 'exact'),
  ('zottman-curl', 'kc-LGcbozhI', 'Zottman Curl', 'Catalyst Athletics', 'UCOe24b2O8eoeHz9fwWuKRVA', 'catalyst', 2, 38, 0, 'exact')
on conflict (key, video_id) do update set
  title = excluded.title, channel = excluded.channel, channel_id = excluded.channel_id,
  source = excluded.source, tier = excluded.tier, secs = excluded.secs,
  rank = excluded.rank, method = excluded.method;

delete from public.exercise_demo_videos
 where source = 'catalyst' and (key, video_id) not in (
  ('ab-wheel-rollout','Ojf6jVWJDuU'), ('arnold-press','y2Z56aTvx_M'), ('back-extension','skXsFN8NfqU'), ('back-squat','Akd5xmZlsvg'), ('band-pull-apart','Xg58d9lDWME'), ('banded-walk','UX-hIEbWpCA'), ('bench-dip','em94npR71nk'), ('bench-press','GlPKtOUvZqw'), ('bent-over-row','cYVkgmPqRMw'), ('bird-dog','DBWdijCeSIM'), ('box-jump','d2z2_rRkpAo'), ('broad-jump','AOkmLTD8J24'), ('bulgarian-split-squat','DpZsCmsI0uk'), ('cable-curl','yGdzi_CciKY'), ('chest-fly','T3EOhuU5RQg'), ('chin-up','0PhzdeDENF0'), ('clamshell','wRlgcPJ-F-w'), ('clean-and-jerk','jiYPejuiNck'), ('concentration-curl','Bv1iH7mLfb4'), ('copenhagen-plank','VfjAmomtVa0'), ('cossack-squat','Qn5r1xZkC5Q'), ('crunch','aqn-hqIk4rk'), ('dead-bug','ZtwcT5g4Tb8'), ('deadlift','E9hLcC8ZrmA'), ('dip','sg3PTIA3rXI'), ('dumbbell-bench-press','ieewD7N2Nuw'), ('dumbbell-curl','plU7Ca7Fke8'), ('dumbbell-row','IOy2k0Cb6Vo'), ('ez-bar-curl','OgO6cWoezNc'), ('face-pull','UnSEJGBotEM'), ('farmers-carry','G-_FYQfur9w'), ('flutter-kick','QjEDhGkmx8Y'), ('front-raise','xPvL9xLXUbg'), ('front-squat','Q1R0_CbgHpc'), ('glute-bridge','1pqZI2t8XHo'), ('glute-ham-raise','1TlhdiFSJrU'), ('good-morning','lYUB78Btcxc'), ('hammer-curl','W0xVe5jdnOU'), ('hang-clean','uUeV3LwisDI'), ('hanging-leg-raise','PjlPiVTtWA4'), ('high-pull','2Qv8pEnprpU'), ('hollow-hold','x8xSTaaMmuY'), ('incline-bench-press','EQSPHyJ75EM'), ('incline-dumbbell-curl','V8H4k8lquiU'), ('incline-dumbbell-press','JHFd-e2_M8E'), ('inverted-row','jTaIMXRT6qY'), ('jefferson-curl','lHybIJtacgU'), ('jump-squat','y10UT2nOFVs'), ('kettlebell-swing','mBajuiwRTSw'), ('kettlebell-windmill','xkqvxdrfav0'), ('lat-pulldown','c2e_j4IdPBs'), ('lateral-lunge','dQZjFjYyghY'), ('lateral-raise','goVyitDXa5o'), ('leg-curl','E4aZsdi7ENs'), ('leg-raise','oeuKRVdhxXQ'), ('lunge','bBrBLS7aejI'), ('nordic-curl','HrOhaEnwDQY'), ('overhead-carry','u2zEzUeOI-o'), ('overhead-squat','m_fvfJi94D8'), ('overhead-tricep-extension','xbNm9fRoUTw'), ('pallof-press','GfTQ0RLZ7GA'), ('plank','P3FR4GUl2QM'), ('power-clean','YG8M_-11C2A'), ('preacher-curl','90-t0TLEXAE'), ('pull-up','IxQDQ2jwS5Y'), ('push-jerk','Om7vLD6x8W0'), ('push-press','yklSQG1_Ovc'), ('push-up','8lruUgJ-Rww'), ('rear-delt-fly','7Vi3nikf65I'), ('reverse-crunch','P3HvB3fCD9Y'), ('reverse-curl','etJJujHLuXA'), ('reverse-hyper','ROV6iVsSJSE'), ('reverse-lunge','OiYhnVXrFwE'), ('romanian-deadlift','_U9KjljQyd0'), ('russian-twist','N-arXZs-H70'), ('scapular-pull-up','fAHEz25TRKU'), ('side-bend','vWAiW2v7fCs'), ('side-plank','JFBx8cpLRTw'), ('single-leg-deadlift','opvwjIol9Ts'), ('single-leg-glute-bridge','3FE2eZGeT1o'), ('sit-up','2o9zkR0hMB8'), ('skull-crusher','S3xRQfb4Alo'), ('snatch','1Lv1IyigIUY'), ('spider-curl','kF6UsS3ZXo0'), ('split-jerk','2GPA-cjUFnA'), ('split-squat','L1LBRuJSOU8'), ('step-up','I9lUOenjk9U'), ('stiff-leg-deadlift','QbmaRSO1sIM'), ('straight-arm-pulldown','ev7LG1QG05U'), ('superman','r7u7aofrP3g'), ('tricep-kickback','792uGH9RgfU'), ('tricep-pushdown','e0g_ZbWlWRI'), ('tuck-jump','1XYeIUTmBc8'), ('turkish-get-up','cAf9Zj1WIF0'), ('upright-row','eg2QH0YmDsc'), ('v-up','vPxaLvOsboM'), ('wall-sit','Ok3L48EhvYk'), ('wrist-curl','lA3QwdAn19Y'), ('zottman-curl','kc-LGcbozhI'));

-- crossfit (CrossFit), tier 2: 50 rows across 50 exercises.
insert into public.exercise_demo_videos
  (key, video_id, title, channel, channel_id, source, tier, secs, rank, method)
values
  ('back-squat', 'QmZAiBqPvZw', 'Back Squat', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 60, 1, 'exact'),
  ('bear-crawl', '-JcD5SOqW50', 'Bear Crawl', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 10, 0, 'exact'),
  ('bench-press', 'XSza8hVTlmM', 'Bench Press', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 39, 0, 'exact'),
  ('bodyweight-squat', 'rMvwVtlqjTE', 'Air Squat', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 61, 1, 'exact'),
  ('box-jump', '52r_Ul5k03g', 'Box Jump', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 28, 0, 'exact'),
  ('burpee', 'u4lvmtFqgio', 'Burpee', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 16, 0, 'exact'),
  ('clean-and-jerk', 'PjY1rH4_MOA', 'Clean and Jerk', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 84, 0, 'exact'),
  ('deadlift', '8OTXZn3xQkk', 'Deadlift', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 16, 1, 'exact'),
  ('dip', 'o2qX3Zb5mvg', 'Dip', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 47, 1, 'exact'),
  ('double-under', '-tF3hUsPZAI', 'Double-under', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 20, 0, 'exact'),
  ('dumbbell-floor-press', '6G-fNatzuSk', 'Floor Press', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 33, 0, 'exact'),
  ('dumbbell-row', 'u63l9f0dAHU', 'Single-Arm Row', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 23, 1, 'exact'),
  ('dumbbell-shoulder-press', '5yWaNOvgFCM', 'Shoulder Press', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 55, 1, 'exact'),
  ('farmers-carry', 'p5MNNosenJc', 'Dumbbell Farmers Carry', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 39, 1, 'exact'),
  ('front-squat', 'uYumuL_G_V0', 'Front Squat', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 66, 1, 'exact'),
  ('glute-ham-raise', 'm0AIU1dCVkU', 'Glute-Ham Raise', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 24, 1, 'exact'),
  ('good-morning', 'KxYxHr1lkx4', 'Good Morning', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 52, 0, 'exact'),
  ('handstand-push-up', '0wDEO6shVjc', 'Strict Handstand Push-Up', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 49, 0, 'confirmed'),
  ('hang-clean', 'TjTEOme9fvw', 'Hang Clean', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 62, 0, 'exact'),
  ('hollow-hold', 'p7j02V1fIzU', 'Hollow Rock', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 31, 2, 'exact'),
  ('inverted-row', 'xhlReCpAE9k', 'Ring Row', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 35, 3, 'exact'),
  ('kettlebell-snatch', 'ZQccQg4kDf8', 'Kettlebell Snatch', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 35, 1, 'exact'),
  ('kettlebell-swing', 'vdezTMulJ-k', 'Kettlebell Swing', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 42, 0, 'exact'),
  ('l-sit', 'DemH-mw1O9I', 'L-Sit', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 20, 1, 'exact'),
  ('medicine-ball-slam', 'ePo39a3mSfk', 'Slam Ball', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 25, 0, 'exact'),
  ('muscle-up', 'o69WaY_7k2c', 'Strict Bar Muscle-Up', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 47, 0, 'confirmed'),
  ('overhead-squat', 'pn8mqlG0nkE', 'Overhead Squat', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 80, 0, 'exact'),
  ('pistol-squat', 'keSzg7MaoVQ', 'Single-Leg Squat', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 60, 0, 'exact'),
  ('plank', 'sZxrs3C209k', 'Plank Hold', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 18, 1, 'exact'),
  ('power-clean', 'GVt4uQ0sDJE', 'Power Clean', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 56, 0, 'exact'),
  ('pull-over', 'faJDYEZmueM', 'Pull-Over', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 59, 1, 'exact'),
  ('pull-up', 'aAggnpPyR6E', 'Pull-Up', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 29, 2, 'exact'),
  ('push-jerk', 'VrHNJXoSyXw', 'Push Jerk', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 62, 1, 'exact'),
  ('push-press', 'iaBVSJm78ko', 'Push Press', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 63, 1, 'exact'),
  ('push-up', '_l3ySVKYVJ8', 'Push-Up', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 31, 2, 'exact'),
  ('ring-dip', 'Vt0lO4jpIDo', 'Ring Dip', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 26, 0, 'exact'),
  ('snatch', 'GhxhiehJcQY', 'Snatch', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 75, 0, 'exact'),
  ('split-jerk', 'PsiO8lZTU2I', 'Split Jerk', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 55, 0, 'exact'),
  ('step-up', '5qjqDHOUh-A', 'Box Step-Up', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 56, 2, 'exact'),
  ('sumo-deadlift', 'wQHSYDSgDn8', 'Sumo Deadlift', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 61, 1, 'exact'),
  ('sumo-deadlift-high-pull', 'gh55vVlwlQg', 'Sumo Deadlift High Pull', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 60, 1, 'exact'),
  ('thruster', 'L219ltL15zk', 'Thruster', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 71, 0, 'exact'),
  ('toes-to-bar', 'xX9Hzi7Onnw', 'Strict Toes-To-Bar', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 57, 0, 'confirmed'),
  ('turkish-get-up', '-_zTytmHM94', 'Turkish Get-Up', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 68, 1, 'exact'),
  ('v-up', 'Mk4zCq9b6hU', 'V-Up', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 30, 1, 'exact'),
  ('walking-lunge', 'L8fvypPrzzs', 'Walking Lunge', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 35, 1, 'exact'),
  ('wall-ball', 'fpUD0mcFp_0', 'Wall Ball', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 37, 0, 'exact'),
  ('wall-walk', '2TnX8j29tRY', 'Wall Walk', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 48, 0, 'exact'),
  ('windshield-wiper', 'W2xdEDuR-dE', 'Windshield Wiper', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 74, 0, 'exact'),
  ('zercher-squat', 'nwx6Ip7hd3I', 'Zercher Squat', 'CrossFit', 'UCtcQ6TPwXAYgZ1Mcl3M1vng', 'crossfit', 2, 52, 0, 'exact')
on conflict (key, video_id) do update set
  title = excluded.title, channel = excluded.channel, channel_id = excluded.channel_id,
  source = excluded.source, tier = excluded.tier, secs = excluded.secs,
  rank = excluded.rank, method = excluded.method;

delete from public.exercise_demo_videos
 where source = 'crossfit' and (key, video_id) not in (
  ('back-squat','QmZAiBqPvZw'), ('bear-crawl','-JcD5SOqW50'), ('bench-press','XSza8hVTlmM'), ('bodyweight-squat','rMvwVtlqjTE'), ('box-jump','52r_Ul5k03g'), ('burpee','u4lvmtFqgio'), ('clean-and-jerk','PjY1rH4_MOA'), ('deadlift','8OTXZn3xQkk'), ('dip','o2qX3Zb5mvg'), ('double-under','-tF3hUsPZAI'), ('dumbbell-floor-press','6G-fNatzuSk'), ('dumbbell-row','u63l9f0dAHU'), ('dumbbell-shoulder-press','5yWaNOvgFCM'), ('farmers-carry','p5MNNosenJc'), ('front-squat','uYumuL_G_V0'), ('glute-ham-raise','m0AIU1dCVkU'), ('good-morning','KxYxHr1lkx4'), ('handstand-push-up','0wDEO6shVjc'), ('hang-clean','TjTEOme9fvw'), ('hollow-hold','p7j02V1fIzU'), ('inverted-row','xhlReCpAE9k'), ('kettlebell-snatch','ZQccQg4kDf8'), ('kettlebell-swing','vdezTMulJ-k'), ('l-sit','DemH-mw1O9I'), ('medicine-ball-slam','ePo39a3mSfk'), ('muscle-up','o69WaY_7k2c'), ('overhead-squat','pn8mqlG0nkE'), ('pistol-squat','keSzg7MaoVQ'), ('plank','sZxrs3C209k'), ('power-clean','GVt4uQ0sDJE'), ('pull-over','faJDYEZmueM'), ('pull-up','aAggnpPyR6E'), ('push-jerk','VrHNJXoSyXw'), ('push-press','iaBVSJm78ko'), ('push-up','_l3ySVKYVJ8'), ('ring-dip','Vt0lO4jpIDo'), ('snatch','GhxhiehJcQY'), ('split-jerk','PsiO8lZTU2I'), ('step-up','5qjqDHOUh-A'), ('sumo-deadlift','wQHSYDSgDn8'), ('sumo-deadlift-high-pull','gh55vVlwlQg'), ('thruster','L219ltL15zk'), ('toes-to-bar','xX9Hzi7Onnw'), ('turkish-get-up','-_zTytmHM94'), ('v-up','Mk4zCq9b6hU'), ('walking-lunge','L8fvypPrzzs'), ('wall-ball','fpUD0mcFp_0'), ('wall-walk','2TnX8j29tRY'), ('windshield-wiper','W2xdEDuR-dE'), ('zercher-squat','nwx6Ip7hd3I'));

-- tnation (T-Nation), tier 2: 29 rows across 29 exercises.
insert into public.exercise_demo_videos
  (key, video_id, title, channel, channel_id, source, tier, secs, rank, method)
values
  ('bent-over-row', 'xz1ep9Oaq3s', 'Pendlay Row', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 38, 2, 'exact'),
  ('calf-raise', 'bRwuofCC9Sg', 'Standing Calf Raise', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 24, 0, 'exact'),
  ('chin-up', 'tActxtAWdk8', 'Chin-up', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 63, 3, 'exact'),
  ('decline-bench-press', 'Kgi_PRr9uhM', 'Decline Bench Press', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 105, 0, 'exact'),
  ('dumbbell-bench-press', 'MvlqSLXgugY', 'Dumbbell Bench Press', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 105, 2, 'exact'),
  ('dumbbell-floor-press', 'S-CxvECZLzg', 'Floor Dumbbell Press', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 41, 1, 'exact'),
  ('face-pull', 'QbpmaP-Oxz8', 'Rope Seated Face Pull', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 54, 2, 'confirmed'),
  ('front-raise', 'svvYvZF7jq0', 'Alternating Dumbbell Front Raise', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 31, 1, 'exact'),
  ('good-morning', 'bmZwXcpXHyA', 'Good Morning', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 52, 1, 'exact'),
  ('hang-clean', '0OTMSpN88jY', 'Power Clean from Hang', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 55, 2, 'exact'),
  ('incline-dumbbell-press', 'j8G9ycoySfA', 'Dumbbell Incline Press', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 65, 3, 'exact'),
  ('kettlebell-deadlift', 'spFfhanSJ6A', 'One-Arm Suitcase Deadlift', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 43, 0, 'confirmed'),
  ('lat-pulldown', 'lVhrjZ_cemo', 'Lat Pulldown', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 49, 2, 'exact'),
  ('lateral-raise', '8mj7_p9F6W0', 'Dumbbell Lateral Raise', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 28, 1, 'exact'),
  ('leg-extension', 'ETRVtFl7P8M', 'Leg Extension', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 105, 2, 'exact'),
  ('leg-press', '3dlyR7uHkH4', 'Leg Press', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 59, 2, 'exact'),
  ('overhead-press', 'tI8HF6UBduA', 'Standing Military Press', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 35, 1, 'exact'),
  ('push-jerk', 'LWF_S97BM8E', 'Push Jerk', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 47, 0, 'exact'),
  ('push-press', 'EVOacEH1foA', 'Push Press', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 44, 0, 'exact'),
  ('seated-cable-row', '1TFafSOiPv0', 'Seated Row', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 51, 2, 'exact'),
  ('seated-calf-raise', 'vWuPAgSSmiA', 'Seated Calf Raise', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 28, 0, 'exact'),
  ('seated-shoulder-press', 'UyTP5uZM3Sk', 'Seated Barbell Press', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 46, 0, 'exact'),
  ('shrug', 'WLKlzUFqwgM', 'Seated Dumbbell Shrug', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 32, 2, 'exact'),
  ('split-squat', '5BmgNHQ_wQg', 'Split Squat', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 62, 2, 'exact'),
  ('step-up', 'bc61ZPAnY8o', 'Step Up', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 90, 1, 'exact'),
  ('straight-arm-pulldown', '6-lDyiVOWqE', 'Straight-Arm Pulldown', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 48, 2, 'exact'),
  ('trap-bar-deadlift', 'g8gmMAOKBxI', 'Trap Bar Deadlift', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 90, 1, 'exact'),
  ('walking-lunge', 'iLT-3PQ9gfk', 'Walking Lunge', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 100, 2, 'exact'),
  ('zercher-squat', '_asFZx8me_I', 'Zercher Squat', 'T-Nation', 'UC6TRaqsCQQBI0QF6aSBz4nw', 'tnation', 2, 59, 1, 'exact')
on conflict (key, video_id) do update set
  title = excluded.title, channel = excluded.channel, channel_id = excluded.channel_id,
  source = excluded.source, tier = excluded.tier, secs = excluded.secs,
  rank = excluded.rank, method = excluded.method;

delete from public.exercise_demo_videos
 where source = 'tnation' and (key, video_id) not in (
  ('bent-over-row','xz1ep9Oaq3s'), ('calf-raise','bRwuofCC9Sg'), ('chin-up','tActxtAWdk8'), ('decline-bench-press','Kgi_PRr9uhM'), ('dumbbell-bench-press','MvlqSLXgugY'), ('dumbbell-floor-press','S-CxvECZLzg'), ('face-pull','QbpmaP-Oxz8'), ('front-raise','svvYvZF7jq0'), ('good-morning','bmZwXcpXHyA'), ('hang-clean','0OTMSpN88jY'), ('incline-dumbbell-press','j8G9ycoySfA'), ('kettlebell-deadlift','spFfhanSJ6A'), ('lat-pulldown','lVhrjZ_cemo'), ('lateral-raise','8mj7_p9F6W0'), ('leg-extension','ETRVtFl7P8M'), ('leg-press','3dlyR7uHkH4'), ('overhead-press','tI8HF6UBduA'), ('push-jerk','LWF_S97BM8E'), ('push-press','EVOacEH1foA'), ('seated-cable-row','1TFafSOiPv0'), ('seated-calf-raise','vWuPAgSSmiA'), ('seated-shoulder-press','UyTP5uZM3Sk'), ('shrug','WLKlzUFqwgM'), ('split-squat','5BmgNHQ_wQg'), ('step-up','bc61ZPAnY8o'), ('straight-arm-pulldown','6-lDyiVOWqE'), ('trap-bar-deadlift','g8gmMAOKBxI'), ('walking-lunge','iLT-3PQ9gfk'), ('zercher-squat','_asFZx8me_I'));

-- musclewiki (MuscleWiki), tier 2: 53 rows across 53 exercises.
insert into public.exercise_demo_videos
  (key, video_id, title, channel, channel_id, source, tier, secs, rank, method)
values
  ('ab-wheel-rollout', '0YgvBL6TtSU', 'Ab Roller', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 24, 0, 'exact'),
  ('back-extension', 'YJI77XgzCcI', 'Back Extension', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 13, 0, 'exact'),
  ('back-squat', 'mqP6RKUMwD0', 'Squat', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 25, 3, 'exact'),
  ('barbell-curl', 'htvWPy1umbE', 'Barbell Curl', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 20, 1, 'exact'),
  ('bench-dip', 'qLeMTzWS-TQ', 'Bench Dips', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 11, 1, 'exact'),
  ('bench-press', '4uSFvPyZI7I', 'Barbell Bench Press', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 17, 2, 'exact'),
  ('bent-over-row', '10XXqWgndZE', 'Bent Over Barbell Row', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 11, 1, 'exact'),
  ('bodyweight-squat', 'BKU3FCkS3-k', 'Body Weight Squat', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 13, 0, 'exact'),
  ('calf-raise', 'RLwzCkxgnVY', 'Calve Raises', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 11, 1, 'exact'),
  ('chest-fly', 'KIxb2_1ycmo', 'Dumbbell Flys', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 21, 2, 'exact'),
  ('chin-up', 'LzFyJRr7-QU', 'Chin-Up', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 17, 1, 'exact'),
  ('crunch', 'NOq1MHw8dYo', 'Crunch', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 20, 0, 'exact'),
  ('deadlift', 'xNTS-CjAvKg', 'Deadlift', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 20, 2, 'exact'),
  ('decline-push-up', 'Jn7Wi_LXwQA', 'Feet Elevated Push-Up', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 18, 0, 'exact'),
  ('dip', 't7iKeDfccxU', 'Dips', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 15, 3, 'exact'),
  ('donkey-kick', 'hAURyHg_bSo', 'Donkey Kicks', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 12, 1, 'exact'),
  ('dumbbell-bench-press', 'fRoZhQLpnGs', 'Dumbbell Bench Press', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 43, 1, 'exact'),
  ('dumbbell-curl', '2TZqOG9zbMQ', 'Dumbbell Curl', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 18, 1, 'exact'),
  ('dumbbell-row', 'QvJZNnUcbsQ', 'Dumbbell Row', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 19, 0, 'exact'),
  ('dumbbell-shoulder-press', 'U8gFooqv0WU', 'Seated Dumbbell Shoulder Press', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 22, 2, 'exact'),
  ('front-raise', 'qKSCu5D5FbI', 'Front Raises', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 32, 2, 'exact'),
  ('glute-bridge', 'rZhyINrwH1U', 'Glute Bridge', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 17, 1, 'exact'),
  ('goblet-squat', 'OmPAYXdeRAo', 'Goblet Squat', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 26, 0, 'exact'),
  ('good-morning', '7JB8TJVWIkY', 'Good Mornings', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 17, 3, 'exact'),
  ('hammer-curl', 'lKK-ob3f8Qc', 'Hammer Curls', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 19, 2, 'exact'),
  ('hanging-knee-raise', 'jOZpm-kMt7w', 'Hanging Knee Raises', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 16, 2, 'exact'),
  ('hip-thrust', '-fsi3-u_kao', 'Barbell Hip Thrust', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 21, 1, 'exact'),
  ('incline-bench-press', '_aJHyS_JAaY', 'Incline Barbell Bench Press', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 31, 1, 'exact'),
  ('incline-dumbbell-fly', 'uLYIc9FZVfg', 'Incline Fly', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 33, 2, 'exact'),
  ('incline-dumbbell-press', '1ChxmaTBQM0', 'Incline Dumbbell Press', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 15, 1, 'exact'),
  ('inverted-row', 'YQG_uoTFLuk', 'Inverted Row', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 15, 1, 'exact'),
  ('jump-squat', 'VbJ1hWdpjJk', 'Squat Jumps', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 19, 1, 'exact'),
  ('lateral-lunge', 'IiJtyFrlwxk', 'Lateral Lunges', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 11, 2, 'exact'),
  ('lateral-raise', 'WAoUNUkni9Y', 'Side Lateral Raises', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 21, 3, 'exact'),
  ('leg-curl', '0cRFTSpzqyc', 'Hamstring Curl', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 24, 1, 'exact'),
  ('leg-extension', 'AuPGdqQ_RIs', 'Leg Extension', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 20, 1, 'exact'),
  ('leg-press', 'tKSrrAJLciU', 'Leg Press', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 17, 1, 'exact'),
  ('leg-raise', 'UVXy_QF8R8o', 'Leg Raises', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 42, 1, 'exact'),
  ('lunge', 'zYQmub9i7ts', 'Lunges', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 9, 1, 'exact'),
  ('overhead-tricep-extension', 'wpS_LIrD3Ic', 'Seated Triceps Extensions', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 27, 1, 'exact'),
  ('pull-up', 'A8ieuTG1ekU', 'Pull-Up', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 17, 1, 'exact'),
  ('push-up', 'nocHH9VZrQQ', 'Push-Up', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 12, 1, 'exact'),
  ('rear-delt-fly', 'drzAGFkb5yg', 'Bent-Over Rear Delt Raises', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 17, 2, 'confirmed'),
  ('reverse-curl', 'fRcQ5xXkKaY', 'Reverse Curls', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 29, 0, 'exact'),
  ('seated-cable-row', 'G70PxKg1LTs', 'Seated Cable Row', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 19, 1, 'exact'),
  ('seated-calf-raise', 'SilwFPMr5SY', 'Seated Calf Raises', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 23, 1, 'exact'),
  ('shrug', '2mp7RQm74G0', 'Seated Dumbbell Shrugs', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 19, 1, 'exact'),
  ('side-plank', 'WJ-hdGm0gtQ', 'Side Plank', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 21, 0, 'exact'),
  ('single-leg-deadlift', 'jebj_GQS474', '1 Leg Romanian Deadlifts', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 21, 1, 'exact'),
  ('single-leg-glute-bridge', 'DHGKTrJUXy4', 'Single Leg Glute Bridge', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 34, 1, 'exact'),
  ('stiff-leg-deadlift', 'fro2Nv6nGSA', 'Stiff Leg Deadlift', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 38, 1, 'exact'),
  ('superman', '64nVdn8i4QU', 'Superman', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 15, 0, 'exact'),
  ('wrist-curl', 'Ws6HyaJsE94', 'Forearm Curl', 'MuscleWiki', 'UCFpj07BSepA04QgvKSUX8eg', 'musclewiki', 2, 10, 1, 'exact')
on conflict (key, video_id) do update set
  title = excluded.title, channel = excluded.channel, channel_id = excluded.channel_id,
  source = excluded.source, tier = excluded.tier, secs = excluded.secs,
  rank = excluded.rank, method = excluded.method;

delete from public.exercise_demo_videos
 where source = 'musclewiki' and (key, video_id) not in (
  ('ab-wheel-rollout','0YgvBL6TtSU'), ('back-extension','YJI77XgzCcI'), ('back-squat','mqP6RKUMwD0'), ('barbell-curl','htvWPy1umbE'), ('bench-dip','qLeMTzWS-TQ'), ('bench-press','4uSFvPyZI7I'), ('bent-over-row','10XXqWgndZE'), ('bodyweight-squat','BKU3FCkS3-k'), ('calf-raise','RLwzCkxgnVY'), ('chest-fly','KIxb2_1ycmo'), ('chin-up','LzFyJRr7-QU'), ('crunch','NOq1MHw8dYo'), ('deadlift','xNTS-CjAvKg'), ('decline-push-up','Jn7Wi_LXwQA'), ('dip','t7iKeDfccxU'), ('donkey-kick','hAURyHg_bSo'), ('dumbbell-bench-press','fRoZhQLpnGs'), ('dumbbell-curl','2TZqOG9zbMQ'), ('dumbbell-row','QvJZNnUcbsQ'), ('dumbbell-shoulder-press','U8gFooqv0WU'), ('front-raise','qKSCu5D5FbI'), ('glute-bridge','rZhyINrwH1U'), ('goblet-squat','OmPAYXdeRAo'), ('good-morning','7JB8TJVWIkY'), ('hammer-curl','lKK-ob3f8Qc'), ('hanging-knee-raise','jOZpm-kMt7w'), ('hip-thrust','-fsi3-u_kao'), ('incline-bench-press','_aJHyS_JAaY'), ('incline-dumbbell-fly','uLYIc9FZVfg'), ('incline-dumbbell-press','1ChxmaTBQM0'), ('inverted-row','YQG_uoTFLuk'), ('jump-squat','VbJ1hWdpjJk'), ('lateral-lunge','IiJtyFrlwxk'), ('lateral-raise','WAoUNUkni9Y'), ('leg-curl','0cRFTSpzqyc'), ('leg-extension','AuPGdqQ_RIs'), ('leg-press','tKSrrAJLciU'), ('leg-raise','UVXy_QF8R8o'), ('lunge','zYQmub9i7ts'), ('overhead-tricep-extension','wpS_LIrD3Ic'), ('pull-up','A8ieuTG1ekU'), ('push-up','nocHH9VZrQQ'), ('rear-delt-fly','drzAGFkb5yg'), ('reverse-curl','fRcQ5xXkKaY'), ('seated-cable-row','G70PxKg1LTs'), ('seated-calf-raise','SilwFPMr5SY'), ('shrug','2mp7RQm74G0'), ('side-plank','WJ-hdGm0gtQ'), ('single-leg-deadlift','jebj_GQS474'), ('single-leg-glute-bridge','DHGKTrJUXy4'), ('stiff-leg-deadlift','fro2Nv6nGSA'), ('superman','64nVdn8i4QU'), ('wrist-curl','Ws6HyaJsE94'));

-- bbcom (Bodybuilding.com), tier 3: 52 rows across 52 exercises.
insert into public.exercise_demo_videos
  (key, video_id, title, channel, channel_id, source, tier, secs, rank, method)
values
  ('back-extension', 'qtjJUWCnDyE', 'Hyperextensions (Back Extensions)', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 48, 2, 'exact'),
  ('barbell-curl', 'dDI8ClxRS04', 'Barbell Curl', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 45, 2, 'exact'),
  ('bench-press', 'Qjxrp9Hwv_Q', 'Bench Press', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 63, 3, 'exact'),
  ('cable-crunch', '3qjoXDTuyOE', 'Cable Crunch', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 50, 1, 'exact'),
  ('cable-fly', 'aoP0s_MjN-g', 'Cable Crossover', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 67, 1, 'exact'),
  ('calf-raise', 'MAMzF7iZNkc', 'Standing Calf Raises', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 63, 2, 'exact'),
  ('chest-fly', 'QwuUZ5wgQOk', 'Dumbbell Flyes', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 55, 3, 'exact'),
  ('clean-and-jerk', 'v13d7g_uUXM', 'Clean and Jerk', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 168, 2, 'exact'),
  ('close-grip-bench-press', 'OYoc93qAAEY', 'Close Grip Bench Press', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 49, 1, 'exact'),
  ('concentration-curl', 'ZcU2hN76UyA', 'Concentration Curls', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 59, 1, 'exact'),
  ('dumbbell-curl', '3OZ2MT_5r3Q', 'Dumbbell Bicep Curl', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 52, 3, 'exact'),
  ('dumbbell-row', 'cpI-Q3VQrEA', 'One-Arm Dumbbell Row', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 66, 3, 'exact'),
  ('dumbbell-shoulder-press', 'tzZMsrzG_zE', 'Dumbbell Shoulder Press', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 49, 3, 'exact'),
  ('ez-bar-curl', 'S_i3SEVgKWU', 'EZ-Bar Curl', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 53, 1, 'exact'),
  ('face-pull', 'tkLTR4b6cAk', 'Face Pull', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 30, 3, 'exact'),
  ('farmers-carry', 'hJW-Xc8TvU8', 'Farmer''s Walk', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 47, 2, 'confirmed'),
  ('front-squat', '9Hi_sgKPNEo', 'Front Barbell Squat', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 83, 3, 'exact'),
  ('glute-ham-raise', 'TDdV0dCsqKs', 'Glute Ham Raise', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 51, 3, 'exact'),
  ('hack-squat', 'plv5ur26Q7A', 'Hack Squat', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 68, 1, 'exact'),
  ('hammer-curl', '0IAM2YtviQY', 'Hammer Curl', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 55, 3, 'exact'),
  ('hang-clean', 'sPrFKddxxZo', 'Hang Clean', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 82, 3, 'exact'),
  ('hanging-leg-raise', 'Nw0LOKe3_l8', 'Hanging Leg Raise', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 46, 2, 'exact'),
  ('hip-thrust', 'Fk1OfkMmVt4', 'Barbell Hip Thrust', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 45, 2, 'exact'),
  ('incline-bench-press', '8YgkJN0gmNM', 'Barbell Incline Bench', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 48, 2, 'exact'),
  ('jump-squat', 'dtJ6kOV5dUc', 'Freehand Jump Squat', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 51, 3, 'confirmed'),
  ('lat-pulldown', 'S0no-Q03h74', 'Wide Grip Lat Pulldown', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 65, 3, 'exact'),
  ('leg-curl', 'jxctD6fL_FQ', 'Lying Leg Curls', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 51, 3, 'exact'),
  ('leg-extension', 'yR_LqZYSIgM', 'Leg Extensions', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 51, 3, 'exact'),
  ('leg-press', '3R0SOJ3alTA', 'Leg Press', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 49, 3, 'exact'),
  ('lunge', 'Wb8Yr3Nx7dE', 'Lunges', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 57, 2, 'exact'),
  ('overhead-press', 'lPFwcHl0a2c', 'Barbell Shoulder Press', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 49, 2, 'exact'),
  ('overhead-tricep-extension', 'ntBjdnckWgo', 'Dumbbell Triceps Extension', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 57, 3, 'exact'),
  ('pec-deck', 'oGxc2ph8Fnw', 'Butterfly', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 47, 1, 'confirmed'),
  ('power-clean', 'zCEj0d3TatI', 'Power Clean', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 100, 2, 'exact'),
  ('preacher-curl', 'RgN216Cumtw', 'Preacher Curl', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 63, 2, 'exact'),
  ('pull-over', '4B-BrBH17uM', 'Bent Arm Dumbbell Pullover', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 68, 2, 'confirmed'),
  ('push-press', 'ChTn_TLDA5o', 'Push Press', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 41, 3, 'exact'),
  ('rack-pull', 'u7NE34Vw81w', 'Rack Pulls', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 63, 0, 'exact'),
  ('rear-delt-fly', 'WCvRMULhUVU', 'Reverse Flyes', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 58, 3, 'exact'),
  ('reverse-crunch', 'lmSP-c1X_iY', 'Reverse Crunch', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 43, 1, 'exact'),
  ('romanian-deadlift', 'e1pFg9Rz55k', 'Romanian Deadlift', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 54, 1, 'exact'),
  ('seated-cable-row', 'IzoCF_b3cIY', 'Seated Cable Rows', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 70, 3, 'exact'),
  ('shrug', '9xGqgGFAtiM', 'Barbell Shrug', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 39, 3, 'exact'),
  ('single-leg-deadlift', 'JOoc07_Xkls', 'Kettlebell One-Legged Deadlift', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 45, 2, 'confirmed'),
  ('spider-curl', 'TVjOooXvzO8', 'Spider Curl', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 25, 2, 'exact'),
  ('split-squat', 'UJWLxHAYxx4', 'Split Squat', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 51, 3, 'exact'),
  ('stiff-leg-deadlift', 'NzMDStjQadQ', 'Stiff-Legged Deadlift', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 56, 3, 'exact'),
  ('straight-arm-pulldown', 'wcVDItawocI', 'Straight Arm Pulldown', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 59, 3, 'exact'),
  ('superman', 'hhq86gJvrvo', 'Superman', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 43, 2, 'exact'),
  ('tricep-kickback', 'HyqTb_jE_oI', 'Tricep Dumbbell Kickback', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 66, 1, 'confirmed'),
  ('tricep-pushdown', 'HIKzvHkibWc', 'Triceps Pushdown', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 53, 2, 'exact'),
  ('upright-row', 'SO_nHq52a8o', 'Standing Dumbbell Upright Row', 'Bodybuilding.com', 'UC97k3hlbE-1rVN8y56zyEEA', 'bbcom', 3, 43, 2, 'exact')
on conflict (key, video_id) do update set
  title = excluded.title, channel = excluded.channel, channel_id = excluded.channel_id,
  source = excluded.source, tier = excluded.tier, secs = excluded.secs,
  rank = excluded.rank, method = excluded.method;

delete from public.exercise_demo_videos
 where source = 'bbcom' and (key, video_id) not in (
  ('back-extension','qtjJUWCnDyE'), ('barbell-curl','dDI8ClxRS04'), ('bench-press','Qjxrp9Hwv_Q'), ('cable-crunch','3qjoXDTuyOE'), ('cable-fly','aoP0s_MjN-g'), ('calf-raise','MAMzF7iZNkc'), ('chest-fly','QwuUZ5wgQOk'), ('clean-and-jerk','v13d7g_uUXM'), ('close-grip-bench-press','OYoc93qAAEY'), ('concentration-curl','ZcU2hN76UyA'), ('dumbbell-curl','3OZ2MT_5r3Q'), ('dumbbell-row','cpI-Q3VQrEA'), ('dumbbell-shoulder-press','tzZMsrzG_zE'), ('ez-bar-curl','S_i3SEVgKWU'), ('face-pull','tkLTR4b6cAk'), ('farmers-carry','hJW-Xc8TvU8'), ('front-squat','9Hi_sgKPNEo'), ('glute-ham-raise','TDdV0dCsqKs'), ('hack-squat','plv5ur26Q7A'), ('hammer-curl','0IAM2YtviQY'), ('hang-clean','sPrFKddxxZo'), ('hanging-leg-raise','Nw0LOKe3_l8'), ('hip-thrust','Fk1OfkMmVt4'), ('incline-bench-press','8YgkJN0gmNM'), ('jump-squat','dtJ6kOV5dUc'), ('lat-pulldown','S0no-Q03h74'), ('leg-curl','jxctD6fL_FQ'), ('leg-extension','yR_LqZYSIgM'), ('leg-press','3R0SOJ3alTA'), ('lunge','Wb8Yr3Nx7dE'), ('overhead-press','lPFwcHl0a2c'), ('overhead-tricep-extension','ntBjdnckWgo'), ('pec-deck','oGxc2ph8Fnw'), ('power-clean','zCEj0d3TatI'), ('preacher-curl','RgN216Cumtw'), ('pull-over','4B-BrBH17uM'), ('push-press','ChTn_TLDA5o'), ('rack-pull','u7NE34Vw81w'), ('rear-delt-fly','WCvRMULhUVU'), ('reverse-crunch','lmSP-c1X_iY'), ('romanian-deadlift','e1pFg9Rz55k'), ('seated-cable-row','IzoCF_b3cIY'), ('shrug','9xGqgGFAtiM'), ('single-leg-deadlift','JOoc07_Xkls'), ('spider-curl','TVjOooXvzO8'), ('split-squat','UJWLxHAYxx4'), ('stiff-leg-deadlift','NzMDStjQadQ'), ('straight-arm-pulldown','wcVDItawocI'), ('superman','hhq86gJvrvo'), ('tricep-kickback','HyqTb_jE_oI'), ('tricep-pushdown','HIKzvHkibWc'), ('upright-row','SO_nHq52a8o'));

-- nippard: nothing matched in this run.
delete from public.exercise_demo_videos where source = 'nippard';

-- nippard-program: nothing matched in this run.
delete from public.exercise_demo_videos where source = 'nippard-program';
