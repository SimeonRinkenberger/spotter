#!/usr/bin/env python3
"""Byte-level census of the REAL users' data. Run before and after each phase.

Snapshots are written next to this file unless CENSUS_DIR is set — set it to a
scratch directory so row dumps never land in the repository.

Usage: census.py <label>
Writes scratchpad/census-<label>.json and prints counts + sha256 per (user, table).
The hash is over the full rows (select=*), canonical JSON, sorted by id, so any
change to any column of any real row shows up as a different hash.
"""
import hashlib, json, os, sys, urllib.request, urllib.parse

HERE = os.environ.get("CENSUS_DIR", os.path.dirname(os.path.abspath(__file__)))
ENV = "/Users/simeon/Desktop/CLAUDE COWORK/spotter/.env.local"
env = {}
for line in open(ENV):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v
SB = "https://%s.supabase.co" % env["PROJECT_REF"]
KEY = env["SERVICE_ROLE_KEY"]

REAL_USERS = {
    "b5740c99-b2aa-41e6-9710-e01908de2f87": "simeonrinkenberger@gmail.com",
    "9ccaf4d4-8965-4b07-81ad-1222dd67273b": "sullijb09@gmail.com",
}
USER_TABLES = ["workouts", "profiles", "plan", "workout_logs", "corrections"]

def get(path):
    req = urllib.request.Request(SB + path, headers={"apikey": KEY, "authorization": "Bearer " + KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def canon(rows):
    rows = sorted(rows, key=lambda r: str(r.get("id")))
    return json.dumps(rows, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

label = sys.argv[1] if len(sys.argv) > 1 else "now"
out = {"label": label, "users": {}, "global": {}}
for uid, email in REAL_USERS.items():
    out["users"][uid] = {"email": email, "tables": {}}
    for t in USER_TABLES:
        col = "id" if t == "profiles" else "user_id"
        rows = get("/rest/v1/%s?select=*&%s=eq.%s&order=id" % (t, col, uid))
        c = canon(rows)
        out["users"][uid]["tables"][t] = {"count": len(rows), "sha256": sha(c), "rows": rows}
        print("%-28s %-14s n=%-3d %s" % (email, t, len(rows), sha(c)[:16]))

# The global cache rows the real workouts point at must also stay untouched.
codes = set()
for uid in REAL_USERS:
    for w in out["users"][uid]["tables"]["workouts"]["rows"]:
        codes.add(w["shortcode"])
if codes:
    q = "in.(%s)" % ",".join(urllib.parse.quote(c) for c in sorted(codes))
    rows = get("/rest/v1/video_cache?select=*&shortcode=%s&order=shortcode" % q)
    c = canon(rows)
    out["global"]["video_cache_real"] = {"count": len(rows), "sha256": sha(c), "rows": rows}
    print("%-28s %-14s n=%-3d %s" % ("(global)", "video_cache", len(rows), sha(c)[:16]))

users = get("/auth/v1/admin/users?per_page=100").get("users", [])
out["global"]["auth_users"] = [{"id": u["id"], "email": u["email"]} for u in users]
print("auth users: %d -> %s" % (len(users), ", ".join(sorted(u["email"] for u in users))))

path = os.path.join(HERE, "census-%s.json" % label)
with open(path, "w") as f:
    json.dump(out, f, indent=1, sort_keys=True)
print("wrote", path)
