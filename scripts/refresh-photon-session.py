#!/usr/bin/env python3
"""
Refresh Photon session cookies from clipboard or stdin.

Usage:
  pbpaste | python3 scripts/refresh-photon-session.py        # from clipboard
  echo "myCookie=...; _shibsession_...=..." | python3 scripts/refresh-photon-session.py
"""
import sys, json, urllib.request, urllib.error

cookie = sys.stdin.read().strip().lstrip("Cookie:").strip()

if not cookie:
    print("ERROR: No cookie data received. Copy the Cookie header value first, then run:")
    print("  pbpaste | python3 scripts/refresh-photon-session.py")
    sys.exit(1)

has_my = "myCookie=" in cookie
has_shib = "_shibsession_" in cookie

if not has_my or not has_shib:
    print(f"ERROR: Cookie is missing required values:")
    print(f"  myCookie present:      {'YES' if has_my else 'NO  ← needed'}")
    print(f"  _shibsession_ present: {'YES' if has_shib else 'NO  ← needed'}")
    print("\nMake sure you copy the full 'Cookie:' header from timetracker.photon.com")
    sys.exit(1)

print(f"OK  myCookie found, _shibsession_ found — saving to backend...")

def call(path, data, extra_headers=None):
    headers = {"Content-Type": "application/json", "Content-Length": str(len(data))}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(f"http://localhost:3001{path}", data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, json.loads(r.read()), dict(r.headers)

# Login
try:
    st, body, hdrs = call("/api/auth/login",
        json.dumps({"username": "admin", "password": "Admin@1234!"}).encode())
    sid = ""
    for v in hdrs.get("Set-Cookie", "").split(","):
        if "connect.sid=" in v:
            sid = v.strip().split("connect.sid=")[1].split(";")[0]
    print(f"OK  Logged in as {body.get('username','?')} (sid {'set' if sid else 'MISSING'})")
except Exception as e:
    print(f"ERROR: Cannot connect to backend at localhost:3001 — is it running? ({e})")
    sys.exit(1)

auth = {"Cookie": f"connect.sid={sid}"}

# Refresh session cookies in all 3 Photon services
try:
    st, body, _ = call("/api/timesheet/photon/refresh-session",
        json.dumps({"cookie_header": cookie}).encode(), auth)
    print(f"OK  {body.get('message','Session refreshed')}")
    print(f"    Services: {', '.join(body.get('services', []))}")
except urllib.error.HTTPError as e:
    print(f"ERROR: Session refresh failed {e.code}: {e.read().decode()[:200]}")
    sys.exit(1)

print("\nDone. You can now run Submit to PMO from the dashboard.")
