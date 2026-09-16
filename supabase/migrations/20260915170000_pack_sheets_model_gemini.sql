-- 2026-09-15 bench on identical magnified sheets of tt-7679960172495785246 (push-ups with both
-- hands on the kettlebell handle): gpt-5.6-luna reported "hands on the mat" with and without the
-- transcript; gpt-5.6-terra and gemini-3.6-flash both saw the hands on the handle, and Gemini
-- gave the finer description at about a third of Terra's price ($0.007 vs $0.020 per video).
-- The phone's contact sheets are therefore read by Gemini; Luna keeps the text work (the card).
update public.app_config set value = 'gemini-3.6-flash' where key = 'pack.sheets_model';
