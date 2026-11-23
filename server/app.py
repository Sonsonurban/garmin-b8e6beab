"""Private API + static PWA. Single user, protected by DASHBOARD_PASSWORD."""
import base64
import hashlib
import hmac
import json
import os
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db

WEB = Path(__file__).resolve().parent.parent / "web"
PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")
SECRET = os.environ.get("SESSION_SECRET", "")
TOKEN_DAYS = 90

app = FastAPI(title="Garmin Dashboard", docs_url=None, redoc_url=None, openapi_url=None)

# ---------- auth ----------
_fails: dict[str, list[float]] = {}


def _sign(payload: str) -> str:
    return hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token() -> str:
    exp = str(int(time.time()) + TOKEN_DAYS * 86400)
    return f"{exp}.{_sign(exp)}"


def require_auth(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()
    exp, _, sig = token.partition(".")
    if not exp.isdigit() or not hmac.compare_digest(sig, _sign(exp)) or int(exp) < time.time():
        raise HTTPException(401, "unauthorized")


@app.post("/api/login")
async def login(request: Request):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0]
    now = time.time()
    recent = [t for t in _fails.get(ip, []) if now - t < 900]
    if len(recent) >= 5:
        raise HTTPException(429, "too many attempts, try again in 15 minutes")
    body = await request.json()
    if not hmac.compare_digest(str(body.get("password", "")).encode(), PASSWORD.encode()):
        _fails[ip] = recent + [now]
        raise HTTPException(401, "wrong password")
    _fails.pop(ip, None)
    return {"token": make_token()}


# ---------- helpers ----------
def rows(con, sql, *args):
    return [dict(r) for r in con.execute(sql, args)]


def _load(a):
    """Training load of one activity; falls back to a duration x intensity estimate."""
    if a["load"]:
        return a["load"]
    mins = (a["duration_s"] or 0) / 60
    hr = a["avg_hr"] or 120
    return mins * (hr / 150) ** 2 * 1.2


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


# ---------- endpoints ----------
@app.get("/api/overview", dependencies=[Depends(require_auth)])
def overview():
    con = db.connect()
    acts = rows(con, "SELECT * FROM activities ORDER BY start_time")
    today = date.today()

    def d_of(a):
        return datetime.fromisoformat(a["start_time"]).date()

    # weekly volume (last 26 weeks), all sports + running only
    weeks = {}
    for i in range(26):
        weeks[(_week_start(today) - timedelta(weeks=i)).isoformat()] = {"km": 0, "min": 0, "runs": 0, "gain": 0}
    for a in acts:
        k = _week_start(d_of(a)).isoformat()
        if k in weeks:
            w = weeks[k]
            w["min"] += (a["duration_s"] or 0) / 60
            if a["type"] in ("running", "trail_running", "treadmill_running"):
                w["km"] += (a["distance_m"] or 0) / 1000
                w["runs"] += 1
                w["gain"] += a["elev_gain"] or 0
    weekly = [{"week": k, **{m: round(v, 1) for m, v in w.items()}} for k, w in sorted(weeks.items())]

    # fitness / fatigue / form (EWMA of daily load, like TrainingPeaks)
    daily_load = {}
    for a in acts:
        daily_load[d_of(a)] = daily_load.get(d_of(a), 0) + _load(a)
    start = today - timedelta(days=120)
    atl = ctl = 0.0
    form = []
    d = start
    while d <= today:
        x = daily_load.get(d, 0)
        atl += (x - atl) / 7
        ctl += (x - ctl) / 42
        if d >= today - timedelta(days=60):
            form.append({"date": d.isoformat(), "fatigue": round(atl, 1), "fitness": round(ctl, 1), "form": round(ctl - atl, 1)})
        d += timedelta(days=1)

    # acute:chronic workload ratio (7d vs 28d weekly average)
    def load_between(a, b):
        return sum(v for k, v in daily_load.items() if a <= k <= b)

    acute = load_between(today - timedelta(days=6), today)
    chronic = load_between(today - timedelta(days=27), today) / 4
    acwr = round(acute / chronic, 2) if chronic else None

    runs = [a for a in acts if a["type"] in ("running", "trail_running", "treadmill_running") and a["distance_m"]]

    def period(since):
        sel = [a for a in runs if d_of(a) >= since]
        return {
            "km": round(sum(a["distance_m"] for a in sel) / 1000, 1),
            "runs": len(sel),
            "hours": round(sum(a["duration_s"] or 0 for a in sel) / 3600, 1),
            "gain": round(sum(a["elev_gain"] or 0 for a in sel)),
        }

    # records (whole-activity bests; label them as such in the UI)
    def best_pace(min_m):
        sel = [a for a in runs if a["distance_m"] >= min_m and a["duration_s"]]
        if not sel:
            return None
        a = min(sel, key=lambda a: a["duration_s"] / a["distance_m"])
        return {"id": a["id"], "date": a["start_time"][:10], "dist": a["distance_m"], "dur": a["duration_s"]}

    records = {
        "pace_5k": best_pace(5000),
        "pace_10k": best_pace(10000),
        "pace_21k": best_pace(21000),
        "longest": max(runs, key=lambda a: a["distance_m"], default=None),
        "climb": max(runs, key=lambda a: a["elev_gain"] or 0, default=None),
    }
    for k in ("longest", "climb"):
        a = records[k]
        records[k] = {"id": a["id"], "date": a["start_time"][:10], "dist": a["distance_m"], "gain": a["elev_gain"]} if a else None

    # consistency heatmap: activities per day, last 26 weeks
    since = today - timedelta(weeks=26)
    heat = {}
    for a in acts:
        if d_of(a) >= since:
            k = d_of(a).isoformat()
            heat[k] = round(heat.get(k, 0) + (a["distance_m"] or 0) / 1000, 1)

    latest = rows(con, "SELECT * FROM daily ORDER BY date DESC LIMIT 1")
    vo2 = rows(con, "SELECT date, vo2max FROM daily WHERE vo2max IS NOT NULL ORDER BY date")
    return {
        "last_sync": db.get_meta(con, "last_sync"),
        "periods": {
            "week": {**period(today - timedelta(days=6)), "prev_km": round(sum(
                a["distance_m"] for a in runs if today - timedelta(days=13) <= d_of(a) <= today - timedelta(days=7)) / 1000, 1)},
            "month": period(today.replace(day=1)),
            "year": period(today.replace(month=1, day=1)),
            "all": period(date(1990, 1, 1)),
        },
        "weekly": weekly,
        "form": form,
        "acwr": acwr,
        "records": records,
        "heat": heat,
        "latest_daily": latest[0] if latest else None,
        "vo2max": vo2,
        "activity_count": len(acts),
    }


@app.get("/api/activities", dependencies=[Depends(require_auth)])
def activities(limit: int = 30, offset: int = 0, type: str | None = None):
    con = db.connect()
    q = ("SELECT id,start_time,type,name,distance_m,duration_s,avg_hr,max_hr,elev_gain,calories,load,"
         "aerobic_te, (polyline IS NOT NULL) AS has_map FROM activities")
    args: list = []
    if type:
        q += " WHERE type=?"
        args.append(type)
    q += " ORDER BY start_time DESC LIMIT ? OFFSET ?"
    return rows(con, q, *args, min(limit, 100), offset)


@app.get("/api/activity/{aid}", dependencies=[Depends(require_auth)])
def activity(aid: int):
    con = db.connect()
    r = con.execute("SELECT * FROM activities WHERE id=?", (aid,)).fetchone()
    if not r:
        raise HTTPException(404)
    a = dict(r)
    if not a["load"]:
        a["load"], a["load_est"] = round(_load(a)), True
    for k in ("polyline", "splits", "hr_zones"):
        a[k] = json.loads(a[k]) if a[k] else None
    a.pop("raw", None)
    return a


@app.get("/api/daily", dependencies=[Depends(require_auth)])
def daily(days: int = 60):
    con = db.connect()
    since = (date.today() - timedelta(days=days)).isoformat()
    return rows(con, "SELECT * FROM daily WHERE date>=? ORDER BY date", since)


_sync_lock = threading.Lock()


@app.post("/api/sync", dependencies=[Depends(require_auth)])
def sync_now():
    from . import sync

    if not _sync_lock.acquire(blocking=False):
        return {"status": "already running"}
    try:
        return {"status": "ok", "new": sync.run()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"sync failed: {type(e).__name__}") from e
    finally:
        _sync_lock.release()


def _auto_sync_loop():
    """Background refresh every SYNC_HOURS (default 3) while the server runs."""
    hours = float(os.environ.get("SYNC_HOURS", "3"))
    if hours <= 0:
        return
    from . import sync

    while True:
        try:
            if _sync_lock.acquire(blocking=False):
                try:
                    sync.run()
                finally:
                    _sync_lock.release()
        except Exception as e:  # noqa: BLE001
            print(f"auto-sync failed: {type(e).__name__}: {str(e)[:120]}")
        time.sleep(hours * 3600)


@app.on_event("startup")
def _start():
    if not PASSWORD or not SECRET:
        raise SystemExit("Set DASHBOARD_PASSWORD and SESSION_SECRET (long random string) before starting.")
    if os.environ.get("DEMO") != "1":
        threading.Thread(target=_auto_sync_loop, daemon=True).start()


@app.get("/")
def index():
    return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=WEB), name="web")
