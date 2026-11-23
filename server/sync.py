"""Pulls data from Garmin Connect into SQLite.

Uses a saved session token (created once by login_garmin.py), so no password
is stored on the server. Every Garmin call is wrapped: a missing metric never
stops the rest of the sync.
"""
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import db

TOKEN_DIR = Path(os.environ.get("GARMIN_TOKEN_DIR", db.DATA_DIR / "garmin_tokens"))


def _client():
    from garminconnect import Garmin

    # Hosting option: tokens passed as an env var instead of a folder.
    blob = os.environ.get("GARMIN_TOKENS_B64")
    if blob and not TOKEN_DIR.exists():
        import base64
        import io
        import zipfile

        TOKEN_DIR.mkdir(parents=True, exist_ok=True)
        zipfile.ZipFile(io.BytesIO(base64.b64decode(blob))).extractall(TOKEN_DIR)
    api = Garmin()
    api.login(str(TOKEN_DIR))
    return api


def _try(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except Exception as e:  # noqa: BLE001 - keep syncing
        print(f"  ! {getattr(fn, '__name__', fn)} failed: {type(e).__name__}: {str(e)[:120]}", file=sys.stderr)
        return None


def _num(v):
    return float(v) if isinstance(v, (int, float)) else None


def _save_activity(con, a, details=None, splits=None, zones=None):
    poly = None
    if details:
        pts = ((details.get("geoPolylineDTO") or {}).get("polyline")) or []
        poly = [[round(p["lat"], 5), round(p["lon"], 5)] for p in pts if "lat" in p and "lon" in p]
    lap_list = None
    if splits:
        lap_list = [
            {
                "dist": _num(l.get("distance")),
                "dur": _num(l.get("duration")),
                "hr": _num(l.get("averageHR")),
                "speed": _num(l.get("averageSpeed")),
                "gain": _num(l.get("elevationGain")),
                "cad": _num(l.get("averageRunCadence")),
            }
            for l in (splits.get("lapDTOs") or [])
        ]
    zone_list = None
    if zones:
        zone_list = [_num(z.get("secsInZone")) or 0 for z in sorted(zones, key=lambda z: z.get("zoneNumber", 0))]
    con.execute(
        """INSERT INTO activities(id,start_time,type,name,distance_m,duration_s,moving_s,avg_hr,max_hr,calories,
             elev_gain,avg_cadence,aerobic_te,anaerobic_te,load,vo2max,polyline,splits,hr_zones,raw)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name,distance_m=excluded.distance_m,duration_s=excluded.duration_s,
             moving_s=excluded.moving_s,avg_hr=excluded.avg_hr,max_hr=excluded.max_hr,calories=excluded.calories,
             elev_gain=excluded.elev_gain,avg_cadence=excluded.avg_cadence,aerobic_te=excluded.aerobic_te,
             anaerobic_te=excluded.anaerobic_te,load=excluded.load,vo2max=excluded.vo2max,
             polyline=COALESCE(excluded.polyline,polyline),splits=COALESCE(excluded.splits,splits),
             hr_zones=COALESCE(excluded.hr_zones,hr_zones),raw=excluded.raw""",
        (
            a["activityId"],
            a.get("startTimeLocal"),
            (a.get("activityType") or {}).get("typeKey"),
            a.get("activityName"),
            _num(a.get("distance")),
            _num(a.get("duration")),
            _num(a.get("movingDuration")),
            _num(a.get("averageHR")),
            _num(a.get("maxHR")),
            _num(a.get("calories")),
            _num(a.get("elevationGain")),
            _num(a.get("averageRunningCadenceInStepsPerMinute")),
            _num(a.get("aerobicTrainingEffect")),
            _num(a.get("anaerobicTrainingEffect")),
            _num(a.get("activityTrainingLoad")),
            _num(a.get("vO2MaxValue")),
            json.dumps(poly) if poly else None,
            json.dumps(lap_list) if lap_list else None,
            json.dumps(zone_list) if zone_list else None,
            json.dumps(a),
        ),
    )


def sync_activities(api, con, full=False):
    known = {r["id"] for r in con.execute("SELECT id FROM activities")}
    new = 0
    start, page = 0, 50
    while True:
        batch = _try(api.get_activities, start, page) or []
        if not batch:
            break
        fresh = [a for a in batch if a["activityId"] not in known]
        for a in fresh:
            aid = a["activityId"]
            details = _try(api.get_activity_details, aid, 2000, 400)
            splits = _try(api.get_activity_splits, aid)
            zones = _try(api.get_activity_hr_in_timezones, aid)
            _save_activity(con, a, details, splits, zones)
            new += 1
            time.sleep(0.4)  # be gentle with Garmin
        con.commit()
        # Stop paging once a whole page is already known (unless doing a full import)
        if not full and not fresh:
            break
        if len(batch) < page:
            break
        start += page
    return new


def sync_daily(api, con, days=14):
    today = date.today()
    for i in range(days):
        d = (today - timedelta(days=i)).isoformat()
        stats = _try(api.get_stats, d) or {}
        sleep = (_try(api.get_sleep_data, d) or {}).get("dailySleepDTO") or {}
        hrv = (_try(api.get_hrv_data, d) or {}).get("hrvSummary") or {}
        mx = _try(api.get_max_metrics, d)
        ready = _try(api.get_training_readiness, d)
        vo2 = None
        if isinstance(mx, list) and mx:
            vo2 = _num((mx[0].get("generic") or {}).get("vo2MaxPreciseValue") or (mx[0].get("generic") or {}).get("vo2MaxValue"))
        score = None
        if isinstance(ready, list) and ready:
            score = ready[0].get("score")
        sleep_score = (((sleep.get("sleepScores") or {}).get("overall")) or {}).get("value")
        con.execute(
            """INSERT INTO daily VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(date) DO UPDATE SET steps=excluded.steps,resting_hr=excluded.resting_hr,
                 stress_avg=excluded.stress_avg,bb_high=excluded.bb_high,bb_low=excluded.bb_low,
                 sleep_s=excluded.sleep_s,sleep_score=excluded.sleep_score,deep_s=excluded.deep_s,
                 rem_s=excluded.rem_s,light_s=excluded.light_s,hrv_avg=excluded.hrv_avg,
                 hrv_status=excluded.hrv_status,vo2max=COALESCE(excluded.vo2max,vo2max),
                 readiness=excluded.readiness""",
            (
                d,
                stats.get("totalSteps"),
                stats.get("restingHeartRate"),
                stats.get("averageStressLevel"),
                stats.get("bodyBatteryHighestValue"),
                stats.get("bodyBatteryLowestValue"),
                sleep.get("sleepTimeSeconds"),
                sleep_score,
                sleep.get("deepSleepSeconds"),
                sleep.get("remSleepSeconds"),
                sleep.get("lightSleepSeconds"),
                hrv.get("lastNightAvg"),
                hrv.get("status"),
                vo2,
                score,
            ),
        )
        con.commit()


def run(full=False):
    con = db.connect()
    api = _client()
    first = db.get_meta(con, "last_sync") is None
    n = sync_activities(api, con, full=full or first)
    sync_daily(api, con, days=90 if (full or first) else 7)
    db.set_meta(con, "last_sync", datetime.now(timezone.utc).isoformat())
    print(f"sync ok: {n} new activities")
    return n


if __name__ == "__main__":
    run(full="--full" in sys.argv)
