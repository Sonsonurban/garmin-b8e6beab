"""Pulls data from Garmin Connect into SQLite.

Uses a saved session token (created once by login_garmin.py), so no password is stored.
Every Garmin call is wrapped: one missing metric never stops the rest of the sync.
Heavy history (per-second series, sleep, daily stats) is filled in newest-first within a time
budget per run (SYNC_BUDGET_MIN, default 40), so a first run can finish over a few runs.
"""
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import db

TOKEN_DIR = Path(os.environ.get("GARMIN_TOKEN_DIR", db.DATA_DIR / "garmin_tokens"))
BUDGET_MIN = float(os.environ.get("SYNC_BUDGET_MIN", "40"))
PAUSE = 0.25  # seconds between calls, be gentle with Garmin

_fails = {"n": 0}


def _client():
    from garminconnect import Garmin

    blob = os.environ.get("GARMIN_TOKENS_B64")  # hosting option: token passed as a secret
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
        r = fn(*a, **kw)
        _fails["n"] = 0
        return r
    except Exception as e:  # noqa: BLE001 - keep syncing
        _fails["n"] += 1
        print(f"  ! {getattr(fn, '__name__', fn)} failed: {type(e).__name__}: {str(e)[:100]}", file=sys.stderr)
        return None


def _blocked():
    """Stop the heavy backfill when Garmin keeps refusing (rate limit / block)."""
    return _fails["n"] >= 8


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _r(v, nd=0):
    return None if v is None else (int(round(v)) if nd == 0 else round(v, nd))


# ---------------------------------------------------------------- per-activity detail
SERIES_KEYS = {
    "t": "sumElapsedDuration", "d": "sumDistance", "hr": "directHeartRate", "sp": "directSpeed",
    "el": "directElevation", "cad": "directDoubleCadence", "pw": "directPower",
    "gct": "directGroundContactTime", "sl": "directStrideLength", "vo": "directVerticalOscillation",
    "vr": "directVerticalRatio", "gap": "directGradeAdjustedSpeed", "tmp": "directAirTemperature",
}
POINTS = 200


def make_series(details):
    """Per-second recording -> ~200 evenly spaced bins (means), as compact column arrays."""
    desc = {m.get("key"): m.get("metricsIndex") for m in details.get("metricDescriptors") or []}
    rows = [r.get("metrics") or [] for r in details.get("activityDetailMetrics") or []]
    if len(rows) < 20 or "sumDistance" not in desc:
        return None
    n = min(POINTS, len(rows))
    out = {k: [] for k in SERIES_KEYS}
    for b in range(n):
        lo, hi = b * len(rows) // n, max((b + 1) * len(rows) // n, b * len(rows) // n + 1)
        chunk = rows[lo:hi]
        for k, src in SERIES_KEYS.items():
            idx = desc.get(src)
            vals = [r[idx] for r in chunk if idx is not None and idx < len(r) and isinstance(r[idx], (int, float))]
            if k in ("t", "d"):
                v = vals[-1] if vals else None
            else:
                v = sum(vals) / len(vals) if vals else None
            if v is not None:
                if k == "sl" and v > 300:  # mm -> cm
                    v /= 10
                if k == "vo" and v > 60:
                    v /= 10
            out[k].append(_r(v, {"t": 0, "d": 1, "hr": 0, "sp": 3, "el": 1, "cad": 0, "pw": 0, "gct": 0, "sl": 1,
                                  "vo": 1, "vr": 1, "gap": 3, "tmp": 1}[k]))
    # drop columns that carry nothing (e.g. power on a run without it)
    return {k: v for k, v in out.items() if any(x is not None for x in v)}


def make_poly(details):
    pts = ((details.get("geoPolylineDTO") or {}).get("polyline")) or []
    pts = [(p["lat"], p["lon"]) for p in pts if "lat" in p and "lon" in p]
    if len(pts) < 4:
        return None
    step = max(1, len(pts) // 250)
    return [[round(a, 5), round(b, 5)] for a, b in pts[::step]]


def make_weather(w):
    if not isinstance(w, dict) or w.get("temp") is None:
        return None
    f2c = lambda f: None if f is None else round((f - 32) * 5 / 9, 1)  # Garmin returns Fahrenheit / mph
    wind = w.get("windSpeed")
    return {"temp": f2c(w.get("temp")), "feels": f2c(w.get("apparentTemp")), "hum": w.get("relativeHumidity"),
            "wind": None if wind is None else round(wind * 1.609), "dir": w.get("windDirectionCompassPoint"),
            "desc": ((w.get("weatherTypeDTO") or {}).get("desc"))}


def _save_activity(con, a, details=None, splits=None, weather=None):
    poly = make_poly(details) if details else None
    series = make_series(details) if details else None
    laps = None
    if splits:
        laps = [{"dist": _num(l.get("distance")), "dur": _num(l.get("duration")), "hr": _num(l.get("averageHR")),
                 "speed": _num(l.get("averageSpeed")), "gain": _num(l.get("elevationGain")),
                 "cad": _num(l.get("averageRunCadence")), "pw": _num(l.get("averagePower"))}
                for l in (splits.get("lapDTOs") or [])]
    zones = [_num(a.get(f"hrTimeInZone_{i}")) or 0 for i in range(1, 6)]
    con.execute(
        """INSERT INTO activities(id,start_time,type,name,distance_m,duration_s,moving_s,avg_hr,max_hr,calories,
             elev_gain,avg_cadence,aerobic_te,anaerobic_te,load,vo2max,polyline,splits,hr_zones,raw,series,weather)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name,distance_m=excluded.distance_m,duration_s=excluded.duration_s,
             moving_s=excluded.moving_s,avg_hr=excluded.avg_hr,max_hr=excluded.max_hr,calories=excluded.calories,
             elev_gain=excluded.elev_gain,avg_cadence=excluded.avg_cadence,aerobic_te=excluded.aerobic_te,
             anaerobic_te=excluded.anaerobic_te,vo2max=excluded.vo2max,
             polyline=COALESCE(excluded.polyline,polyline),splits=COALESCE(excluded.splits,splits),
             hr_zones=excluded.hr_zones,raw=excluded.raw,series=COALESCE(excluded.series,series),
             weather=COALESCE(excluded.weather,weather)""",
        (a["activityId"], a.get("startTimeLocal"), (a.get("activityType") or {}).get("typeKey"), a.get("activityName"),
         _num(a.get("distance")), _num(a.get("duration")), _num(a.get("movingDuration")), _num(a.get("averageHR")),
         _num(a.get("maxHR")), _num(a.get("calories")), _num(a.get("elevationGain")),
         _num(a.get("averageRunningCadenceInStepsPerMinute")), _num(a.get("aerobicTrainingEffect")),
         _num(a.get("anaerobicTrainingEffect")), None, _num(a.get("vO2MaxValue")),
         json.dumps(poly) if poly else None, json.dumps(laps) if laps else None, json.dumps(zones),
         json.dumps(a), json.dumps(series, separators=(",", ":")) if series else None,
         json.dumps(make_weather(weather)) if make_weather(weather) else None),
    )


def sync_activities(api, con, full, deadline):
    known = {r["id"] for r in con.execute("SELECT id FROM activities")}
    new, start, page = 0, 0, 50
    while time.time() < deadline and not _blocked():
        batch = _try(api.get_activities, start, page) or []
        if not batch:
            break
        fresh = [a for a in batch if a["activityId"] not in known]
        for a in fresh:
            aid = a["activityId"]
            details = _try(api.get_activity_details, aid, 2000, 400)
            splits = _try(api.get_activity_splits, aid)
            weather = _try(api.get_activity_weather, aid)
            _save_activity(con, a, details, splits, weather)
            new += 1
            time.sleep(PAUSE)
        con.commit()
        if (not full and not fresh) or len(batch) < page:
            break
        start += page
    return new


def backfill_activities(api, con, deadline):
    """Activities saved by an older version have no per-second series / weather yet."""
    rows = con.execute("SELECT id, raw FROM activities WHERE series IS NULL AND distance_m > 0 "
                       "ORDER BY start_time DESC").fetchall()
    done = 0
    for r in rows:
        if time.time() > deadline or _blocked():
            break
        a = json.loads(r["raw"])
        details = _try(api.get_activity_details, r["id"], 2000, 400)
        weather = _try(api.get_activity_weather, r["id"])
        if details is None:
            continue
        series = make_series(details)
        poly = make_poly(details)
        con.execute("UPDATE activities SET series=?, weather=?, polyline=COALESCE(?,polyline) WHERE id=?",
                    (json.dumps(series, separators=(",", ":")) if series else "{}",
                     json.dumps(make_weather(weather)) if make_weather(weather) else None,
                     json.dumps(poly) if poly else None, r["id"]))
        done += 1
        if done % 20 == 0:
            con.commit()
        time.sleep(PAUSE)
    con.commit()
    left = con.execute("SELECT COUNT(*) FROM activities WHERE series IS NULL AND distance_m > 0").fetchone()[0]
    print(f"  activity backfill: {done} done, {left} left")


# ---------------------------------------------------------------- daily health
def _ds(values, every, fn=lambda v: v):
    """Downsample [[ts, v], ...] into buckets of `every` ms (mean)."""
    buckets = {}
    for ts, v in values:
        if isinstance(ts, (int, float)) and isinstance(v, (int, float)) and v >= 0:
            buckets.setdefault(int(ts // every), []).append(v)
    return [[k * every, round(sum(v) / len(v))] for k, v in sorted(buckets.items())]


def _gmt_ms(s):
    try:
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=timezone.utc).timestamp() * 1000)
    except Exception:  # noqa: BLE001
        return None


def build_sleep(s):
    dto = (s or {}).get("dailySleepDTO") or {}
    if not dto.get("sleepTimeSeconds"):
        return None
    sc = dto.get("sleepScores") or {}
    sub = {}
    for k in ("totalDuration", "stress", "awakeCount", "restlessness", "remPercentage", "lightPercentage", "deepPercentage"):
        v = sc.get(k) or {}
        sub[k] = [v.get("value"), v.get("qualifierKey")]
    need = dto.get("sleepNeed") or {}
    levels = []
    for l in s.get("sleepLevels") or []:
        a, b = _gmt_ms(l.get("startGMT", "")), _gmt_ms(l.get("endGMT", ""))
        if a and b:
            levels.append([a, b, int(l.get("activityLevel", 0))])  # 0 deep, 1 light, 2 rem, 3 awake
    return {
        "score": (sc.get("overall") or {}).get("value"), "dur": dto.get("sleepTimeSeconds"),
        "deep": dto.get("deepSleepSeconds"), "light": dto.get("lightSleepSeconds"), "rem": dto.get("remSleepSeconds"),
        "awake": dto.get("awakeSleepSeconds"), "nap": dto.get("napTimeSeconds"), "awakeN": dto.get("awakeCount"),
        "stress": dto.get("avgSleepStress"), "hr": dto.get("avgHeartRate"), "resp": dto.get("averageRespirationValue"),
        "start": dto.get("sleepStartTimestampLocal"), "end": dto.get("sleepEndTimestampLocal"),
        "needBase": need.get("baseline"), "needAct": need.get("actual"), "sub": sub,
        "bbChg": s.get("bodyBatteryChange"), "hrv": s.get("avgOvernightHrv"), "restless": s.get("restlessMomentsCount"),
        "levels": levels,
        "hrc": _ds([(x.get("startGMT"), x.get("value")) for x in (s.get("sleepHeartRate") or []) if isinstance(x, dict)], 600_000)
        if (s.get("sleepHeartRate") and isinstance(s["sleepHeartRate"][0], dict)) else None,
    }


def sync_day(api, con, d):
    st = _try(api.get_stats, d) or {}
    sl = _try(api.get_sleep_data, d) or {}
    hv = (_try(api.get_hrv_data, d) or {}) or {}
    hs = hv.get("hrvSummary") or {}
    base = hs.get("baseline") or {}
    slp = build_sleep(sl)
    extra = {
        "kT": st.get("totalKilocalories"), "kA": st.get("activeKilocalories"), "kB": st.get("bmrKilocalories"),
        "mod": st.get("moderateIntensityMinutes"), "vig": st.get("vigorousIntensityMinutes"),
        "ig": st.get("intensityMinutesGoal"), "fl": st.get("floorsAscended"), "dist": st.get("totalDistanceMeters"),
        "sg": st.get("dailyStepGoal"), "sed": st.get("sedentarySeconds"), "act": st.get("activeSeconds"),
        "hact": st.get("highlyActiveSeconds"), "sp": [st.get("restStressPercentage"), st.get("lowStressPercentage"),
                                                       st.get("mediumStressPercentage"), st.get("highStressPercentage")],
        "bbC": st.get("bodyBatteryChargedValue"), "bbD": st.get("bodyBatteryDrainedValue"),
        "bbW": st.get("bodyBatteryAtWakeTime"), "bbS": st.get("bodyBatteryDuringSleep"),
        "rW": st.get("avgWakingRespirationValue"), "spo2": st.get("averageSpo2"),
        "hrvW": hs.get("weeklyAvg"), "hrvLo": base.get("balancedLow"), "hrvUp": base.get("balancedUpper"),
        "hrvHi5": hs.get("lastNight5MinHigh"), "hrMin": st.get("minHeartRate"), "hrMax": st.get("maxHeartRate"),
        "sleep": slp,
    }
    mx = _try(api.get_max_metrics, d)
    vo2 = None
    if isinstance(mx, list) and mx:
        g = mx[0].get("generic") or {}
        vo2 = _num(g.get("vo2MaxPreciseValue") or g.get("vo2MaxValue"))
    dto = (sl.get("dailySleepDTO") or {})
    con.execute(
        """INSERT INTO daily(date,steps,resting_hr,stress_avg,bb_high,bb_low,sleep_s,sleep_score,deep_s,rem_s,light_s,
             hrv_avg,hrv_status,vo2max,readiness,extra) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(date) DO UPDATE SET steps=excluded.steps,resting_hr=excluded.resting_hr,
             stress_avg=excluded.stress_avg,bb_high=excluded.bb_high,bb_low=excluded.bb_low,sleep_s=excluded.sleep_s,
             sleep_score=excluded.sleep_score,deep_s=excluded.deep_s,rem_s=excluded.rem_s,light_s=excluded.light_s,
             hrv_avg=excluded.hrv_avg,hrv_status=excluded.hrv_status,vo2max=COALESCE(excluded.vo2max,vo2max),
             extra=excluded.extra""",
        (d, st.get("totalSteps"), st.get("restingHeartRate"), st.get("averageStressLevel"),
         st.get("bodyBatteryHighestValue"), st.get("bodyBatteryLowestValue"), dto.get("sleepTimeSeconds"),
         ((dto.get("sleepScores") or {}).get("overall") or {}).get("value"), dto.get("deepSleepSeconds"),
         dto.get("remSleepSeconds"), dto.get("lightSleepSeconds"), hs.get("lastNightAvg"), hs.get("status"), vo2, None,
         json.dumps(extra, separators=(",", ":"))))


def sync_curves(api, con, d):
    stress = _try(api.get_all_day_stress, d) or {}
    hr = _try(api.get_heart_rates, d) or {}
    st = _ds([(x[0], x[1]) for x in stress.get("stressValuesArray") or [] if len(x) > 1], 900_000)
    bb = _ds([(x[0], x[2] if len(x) > 2 and isinstance(x[2], (int, float)) else x[1])
              for x in stress.get("bodyBatteryValuesArray") or [] if len(x) > 1], 900_000)
    h = _ds([(x[0], x[1]) for x in hr.get("heartRateValues") or [] if len(x) > 1], 600_000)
    con.execute("INSERT INTO curves(date,json) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET json=excluded.json",
                (d, json.dumps({"stress": st, "bb": bb, "hr": h}, separators=(",", ":"))))


def sync_daily(api, con, deadline, full):
    today = date.today()
    first = con.execute("SELECT MIN(substr(start_time,1,10)) m FROM activities").fetchone()["m"]
    start = date.fromisoformat(first) if first else today - timedelta(days=60)
    start = max(min(start, today - timedelta(days=60)), today - timedelta(days=400))
    have = {r["date"] for r in con.execute("SELECT date FROM daily WHERE extra IS NOT NULL")}
    days = [(today - timedelta(days=i)).isoformat() for i in range((today - start).days + 1)]
    todo = [d for d in days if d not in have or d >= (today - timedelta(days=3)).isoformat()]  # newest first
    done = 0
    for d in todo:
        if time.time() > deadline or _blocked():
            break
        sync_day(api, con, d)
        done += 1
        if done % 15 == 0:
            con.commit()
        time.sleep(PAUSE)
    con.commit()
    have_c = {r["date"] for r in con.execute("SELECT date FROM curves")}
    for i in range(21):
        d = (today - timedelta(days=i)).isoformat()
        if (d in have_c and i > 1) or time.time() > deadline or _blocked():
            continue
        sync_curves(api, con, d)
        time.sleep(PAUSE)
    con.commit()
    print(f"  daily: {done} days refreshed, {len([d for d in days if d not in have]) - done if len(days) else 0} may remain")


# ---------------------------------------------------------------- records, predictions, gear, weight
def sync_misc(api, con):
    today = date.today().isoformat()
    recs = _try(api.get_personal_record)
    if isinstance(recs, list):
        db.set_meta(con, "records", [{"type": r.get("typeId"), "value": r.get("value"), "act": r.get("activityId"),
                                      "date": (r.get("actStartDateTimeInGMTFormatted") or "")[:10]} for r in recs])
    pred = _try(api.get_race_predictions)
    if isinstance(pred, dict) and pred.get("time5K"):
        hist = db.get_meta(con, "predictions", {})
        hist[today] = [pred.get("time5K"), pred.get("time10K"), pred.get("timeHalfMarathon"), pred.get("timeMarathon")]
        db.set_meta(con, "predictions", hist)
    w = _try(api.get_weigh_ins, (date.today() - timedelta(days=400)).isoformat(), today)
    if isinstance(w, dict):
        out = []
        for e in w.get("dailyWeightSummaries") or []:
            lw = e.get("latestWeight") or {}
            kg = _num(lw.get("weight"))
            if kg:
                out.append({"date": e.get("summaryDate"), "kg": round(kg / 1000 if kg > 300 else kg, 1)})
        db.set_meta(con, "weights", out)
    prof = _try(api.get_user_profile)
    if isinstance(prof, dict) and prof.get("id"):
        gear = _try(api.get_gear, str(prof["id"]))
        items = gear if isinstance(gear, list) else (gear or {}).get("gear") or []
        out = []
        for g in items:
            uuid = g.get("uuid")
            stats = _try(api.get_gear_stats, uuid) if uuid else None
            out.append({"name": g.get("displayName") or g.get("customMakeModel"), "model": g.get("customMakeModel"),
                        "max": g.get("maximumMeters"), "status": g.get("gearStatusName"),
                        "since": (g.get("dateBegin") or "")[:10],
                        "dist": (stats or {}).get("totalDistance"), "acts": (stats or {}).get("totalActivities")})
        if out:
            db.set_meta(con, "gear", out)


def run(full=False):
    con = db.connect()
    api = _client()
    deadline = time.time() + BUDGET_MIN * 60
    first = db.get_meta(con, "last_sync") is None
    n = sync_activities(api, con, full or first, deadline)
    backfill_activities(api, con, deadline)
    sync_daily(api, con, deadline, full)
    sync_misc(api, con)
    db.set_meta(con, "last_sync", datetime.now(timezone.utc).isoformat())
    print(f"sync ok: {n} new activities")
    return n


if __name__ == "__main__":
    run(full="--full" in sys.argv)
