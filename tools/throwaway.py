#!/usr/bin/env python3
"""Throwaway-account driver for verifying the live Spotter deployment.

  tw.py ensure  <tag>                  create spotter-tw-<tag>@example.com if missing, print id
  tw.py token   <tag>                  print an access token (password grant, no human typing)
  tw.py magic   <tag>                  print an admin magic link for browser sign-in
  tw.py api     <tag> <METHOD> <path> [json]   call the edge function as that user
  tw.py rest    <tag> <METHOD> <path> [json]   call PostgREST as that user (RLS applies)
  tw.py delete  <tag>                  delete the account (cascades its data)
  tw.py list                           list every throwaway currently in auth
"""
import json, os, sys, urllib.request, urllib.error

ENV = "/Users/simeon/Desktop/CLAUDE COWORK/spotter/.env.local"
env = {}
for line in open(ENV):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v
SB = "https://%s.supabase.co" % env["PROJECT_REF"]
SVC = env["SERVICE_ROLE_KEY"]
ANON = env["ANON_KEY"]
API = SB + "/functions/v1/spotter/api/"
PW = "Throwaway-Pass-2026!"

def call(url, method="GET", body=None, headers=None):
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    h = {"content-type": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw

def admin(path, method="GET", body=None):
    return call(SB + path, method, body, {"apikey": SVC, "authorization": "Bearer " + SVC})

def email(tag): return "spotter-tw-%s@example.com" % tag

def find(tag):
    st, d = admin("/auth/v1/admin/users?per_page=200")
    for u in (d or {}).get("users", []):
        if u["email"] == email(tag): return u
    return None

def ensure(tag):
    u = find(tag)
    if u: return u["id"]
    st, d = admin("/auth/v1/admin/users", "POST",
                  {"email": email(tag), "password": PW, "email_confirm": True,
                   "user_metadata": {"display_name": "tw-" + tag}})
    if st >= 300: raise SystemExit("create failed %s %s" % (st, d))
    return d["id"]

def token(tag):
    st, d = call(SB + "/auth/v1/token?grant_type=password", "POST",
                 {"email": email(tag), "password": PW}, {"apikey": ANON})
    if st >= 300: raise SystemExit("sign-in failed %s %s" % (st, d))
    return d["access_token"]

def magic(tag):
    st, d = admin("/auth/v1/admin/generate_link", "POST",
                  {"type": "magiclink", "email": email(tag),
                   "options": {"redirect_to": "https://simeonrinkenberger.github.io/spotter/"}})
    if st >= 300: raise SystemExit("magic link failed %s %s" % (st, d))
    return d.get("action_link") or d.get("properties", {}).get("action_link")

def main():
    a = sys.argv[1:]
    if not a: print(__doc__); return
    cmd = a[0]
    if cmd == "list":
        st, d = admin("/auth/v1/admin/users?per_page=200")
        for u in (d or {}).get("users", []):
            if u["email"].startswith("spotter-tw-"): print(u["id"], u["email"])
        return
    tag = a[1]
    if cmd == "ensure": print(ensure(tag)); return
    if cmd == "token": print(token(tag)); return
    if cmd == "magic": print(magic(tag)); return
    if cmd == "delete":
        u = find(tag)
        if not u: print("no such user"); return
        st, d = admin("/auth/v1/admin/users/" + u["id"], "DELETE")
        print("deleted", u["email"], st); return
    if cmd in ("api", "rest"):
        method, path = a[2], a[3]
        body = json.loads(a[4]) if len(a) > 4 else None
        tok = token(tag)
        if cmd == "api":
            st, d = call(API + path, method, body, {"authorization": "Bearer " + tok})
        else:
            st, d = call(SB + "/rest/v1/" + path, method, body,
                         {"apikey": ANON, "authorization": "Bearer " + tok,
                          "prefer": "return=representation"})
        print(st)
        print(json.dumps(d, indent=1) if not isinstance(d, str) else d)
        return
    print(__doc__)

main()
