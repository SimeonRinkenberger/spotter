#!/usr/bin/env python3
"""Throwaway-account driver for verifying the live Spotter deployment.

  tw.py ensure  <tag>                  create spotter-tw-<tag>@example.com if missing, print id
  tw.py token   <tag>                  print an access token (password grant, no human typing)
  tw.py magic   <tag>                  print an admin magic link for browser sign-in
  tw.py api     <tag> <METHOD> <path> [json]   call the edge function as that user
  tw.py rest    <tag> <METHOD> <path> [json]   call PostgREST as that user (RLS applies)
  tw.py srest   <tag> <METHOD> <path> [json]   call PostgREST as the SERVICE ROLE, with
                                               user_id filled in for that throwaway
  tw.py qa      <tag> on|off           flag the throwaway a store QA account (profiles.limits.store_qa),
                                       which REVENUECAT_SANDBOX_POLICY qa/all read in spotter-purchases
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
    return call(SB + path, method, body,
                {"apikey": SVC, "authorization": "Bearer " + SVC, "prefer": "return=representation"})

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
    if cmd == "qa":
        # profiles has no user_id column, so srest's owner scoping cannot address
        # it; this is the one profiles write the harnesses need, scoped by id here.
        # profiles.limits is service-role-only, which is why it can carry the flag.
        if tag == "simeon": raise SystemExit("not the owner's permanent test account")
        u = find(tag)
        if not u: raise SystemExit("no such throwaway: " + email(tag))
        on = len(a) > 2 and a[2] == "on"
        st, d = admin("/rest/v1/profiles?id=eq.%s&select=limits" % u["id"])
        limits = dict((d or [{}])[0].get("limits") or {})
        if on: limits["store_qa"] = True
        else: limits.pop("store_qa", None)
        st, d = admin("/rest/v1/profiles?id=eq.%s" % u["id"], "PATCH", {"limits": limits or None})
        print(st, u["email"], "store_qa", "on" if on else "off"); return
    if cmd == "delete":
        u = find(tag)
        if not u: print("no such user"); return
        st, d = admin("/auth/v1/admin/users/" + u["id"], "DELETE")
        print("deleted", u["email"], st); return
    if cmd in ("api", "rest", "srest"):
        method, path = a[2], a[3]
        body = json.loads(a[4]) if len(a) > 4 else None
        if cmd == "api":
            st, d = call(API + path, method, body, {"authorization": "Bearer " + token(tag)})
        elif cmd == "rest":
            st, d = call(SB + "/rest/v1/" + path, method, body,
                         {"apikey": ANON, "authorization": "Bearer " + token(tag),
                          "prefer": "return=representation"})
        else:
            # Fixture rows, written the only way they still can be. The cost guards of
            # 8 Sept revoked insert on public.workouts from authenticated — a card is
            # supposed to arrive through the edge function, which is the thing that
            # counts saves and spends money. A harness giving itself a card is not that,
            # so it writes with the service role and fills in the owner itself, which is
            # the one field RLS would otherwise have enforced.
            uid = ensure(tag)
            if isinstance(body, dict) and "user_id" not in body:
                body = dict(body, user_id=uid)
            # The service role sees every account, so a DELETE or PATCH whose
            # filter forgets the owner reaches every account. On 16 Sept an agent
            # ran `srest <tag> DELETE "plan?day=eq.<date>"` and took that date off
            # every user who had one. Every destructive verb is scoped to this
            # throwaway's rows here unless the caller already said whose.
            if method.upper() in ("DELETE", "PATCH", "PUT") and "user_id=" not in path:
                path += ("&" if "?" in path else "?") + "user_id=eq." + uid
            # A READ is not scoped, and cannot be: plenty of tables the service role
            # is wanted for (the exercise catalog, app_config) have no owner column,
            # and adding one there is an error rather than a filter. So it is said
            # out loud instead — on 16 Sept a QA agent ran `srest <tag> GET plan` to
            # check its own five fixture rows and paged every account's plan back.
            # Read your own rows with `rest`, where RLS answers the question for you.
            if method.upper() == "GET" and "user_id=" not in path:
                sys.stderr.write(
                    "warning: srest GET is the service role and sees EVERY account's rows. "
                    "Use `rest %s GET %s` for this throwaway's own, or add user_id=eq.%s.\n"
                    % (tag, path.split("?")[0], uid))
            st, d = admin("/rest/v1/" + path, method, body)
        print(st)
        print(json.dumps(d, indent=1) if not isinstance(d, str) else d)
        return
    print(__doc__)

main()
