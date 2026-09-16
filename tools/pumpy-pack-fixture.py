#!/usr/bin/env python3
"""Put the WODfather pack fixture in front of a throwaway, and take it away again.

  pumpy-pack-fixture.py add   <tag>    write the card and its pack, print the workout id
  pumpy-pack-fixture.py clean <tag>    delete both rows again

Why this exists: `throwaway.py rest <tag> POST workouts` is refused — the
authenticated role has no INSERT grant on public.workouts — so a fixture card
cannot be written as the user. This writes it with the service role, which is
also what the ingest itself does, and the row is still owned by the throwaway and
still read back through RLS like any other.

Both files come out of tools/pumpy-pack-harness.ts --write-fixture, so the card
the coach reads live is the same one the battery measured.

The pack goes into video_cache, which is GLOBAL. It is filed under the shortcode
tt-vcp-fixture rather than the real video's, because a hand-authored pack sitting
on a real TikTok id would be served to everyone else who saved that clip. `clean`
removes it; run it when the check is done.
"""
import json, os, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# .env.local is gitignored, so it lives in the main checkout and not in the
# worktrees hanging off it. Same file throwaway.py reads.
MAIN = ROOT.split("/.claude/worktrees/")[0]
ENV = os.path.join(MAIN, ".env.local")
env = {}
for line in open(ENV):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v
SB = "https://%s.supabase.co" % env["PROJECT_REF"]
SVC = env["SERVICE_ROLE_KEY"]
HEAD = {"apikey": SVC, "authorization": "Bearer " + SVC, "content-type": "application/json"}


def call(url, method="GET", body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers or HEAD)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def user_id(tag):
    email = "spotter-tw-%s@example.com" % tag
    st, d = call(SB + "/auth/v1/admin/users?per_page=200")
    if st >= 300:
        raise SystemExit("could not list users: %s %s" % (st, d))
    for u in (d or {}).get("users", []):
        if u["email"] == email:
            return u["id"]
    raise SystemExit("no throwaway %s — run tools/throwaway.py ensure %s first" % (email, tag))


def fixture(name):
    with open(os.path.join(ROOT, "tools", "fixtures", name)) as f:
        return json.load(f)


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        print(__doc__)
        return
    cmd, tag = a[0], a[1]
    uid = user_id(tag)
    card = fixture("pumpy-wodfather-card.json")
    pack = fixture("pumpy-wodfather-pack.json")
    sc = card["shortcode"]

    if cmd == "add":
        st, d = call(SB + "/rest/v1/video_cache?on_conflict=shortcode", "POST", pack,
                     dict(HEAD, prefer="resolution=merge-duplicates,return=representation"))
        print("video_cache", st, "" if st < 300 else d)
        row = dict(card, user_id=uid)
        st, d = call(SB + "/rest/v1/workouts", "POST", row,
                     dict(HEAD, prefer="return=representation"))
        print("workouts", st)
        if st >= 300:
            raise SystemExit(json.dumps(d, indent=1))
        print(json.dumps({"id": d[0]["id"], "title": d[0]["title"], "shortcode": sc}, indent=1))
        return

    if cmd == "clean":
        st, _ = call(SB + "/rest/v1/workouts?user_id=eq.%s&shortcode=eq.%s" % (uid, sc), "DELETE")
        print("workouts deleted", st)
        st, _ = call(SB + "/rest/v1/video_cache?shortcode=eq.%s" % sc, "DELETE")
        print("video_cache deleted", st)
        return

    print(__doc__)


main()
