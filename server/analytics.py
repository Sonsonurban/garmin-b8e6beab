"""Builds the dashboard data bundle from the SQLite database.

Everything the app shows comes from here, already shaped for the browser. Own metrics
(training load, efficiency, cardiac drift, pace at a fixed heart rate) are computed here
because Garmin does not provide them for this watch.
"""
import json
from datetime import date, datetime, timedelta, timezone

from . import db

RUN_TYPES = {"running", "trail_running", "track_running", "treadmill_running", "virtual_run"}


def _j(s):
    return json.loads(s) if s else None


def est_load(dur_s, hr):
    """Training load estimate (no Garmin load on this watch): minutes x (HR / 150)^2 x 1.2."""
    mins = (dur_s or 0) / 60
    return round(mins * ((hr or 110) / 150) ** 2 * 1.2, 1) if mins else 0.0


def _series_metrics(ser, duration):
    """Cardiac drift (%) and pace at fixed heart-rate bands, from the per-second series."""
    out = {"dec": None, "ph": {}}
    if not ser or not ser.get("hr") or not ser.get("sp") or not duration:
        return out
    hr, sp = ser["hr"], ser["sp"]
    n = len(hr)
    dt = duration / n
    ok = [i for i in range(n) if hr[i] and sp[i] and sp[i] > 1.2 and hr[i] > 90]
    if duration >= 1500 and len(ok) >= 40:
        half = n // 2
        a = [i for i in ok if i < half]
        b = [i for i in ok if i >= half]
        if len(a) > 10 and len(b) > 10:
            ef = lambda idx: (sum(sp[i] for i in idx) / len(idx)) / (sum(hr[i] for i in idx) / len(idx))
            out["dec"] = round((ef(a) - ef(b)) / ef(a) * 100, 1)
    for center in (130, 140, 150, 160):
        idx = [i for i in ok if abs(hr[i] - center) <= 5]
        if len(idx) * dt >= 240:
            out["ph"][str(center)] = round(1000 / (sum(sp[i] for i in idx) / len(idx)))
    return out


def build() -> dict:
    con = db.connect()
    acts, det = [], {}
    for r in con.execute("SELECT * FROM activities ORDER BY start_time"):
        a = _j(r["raw"]) or {}
        ser = _j(r["series"]) or None
        dur = r["duration_s"] or 0
        hr = r["avg_hr"]
        sm = _series_metrics(ser, r["moving_s"] or dur)
        spd = a.get("averageSpeed")
        row = {
            "id": r["id"], "s": r["start_time"], "ty": r["type"], "nm": r["name"], "d": r["distance_m"], "t": dur,
            "mv": r["moving_s"], "hr": hr, "mhr": r["max_hr"], "cal": r["calories"], "bmr": a.get("bmrCalories"),
            "gain": r["elev_gain"], "loss": a.get("elevationLoss"), "cad": r["avg_cadence"], "ate": r["aerobic_te"],
            "ane": r["anaerobic_te"], "lab": a.get("trainingEffectLabel"), "ld": est_load(dur, hr), "v2": r["vo2max"],
            "st": a.get("steps"), "mod": a.get("moderateIntensityMinutes"), "vig": a.get("vigorousIntensityMinutes"),
            "bb": a.get("differenceBodyBattery"), "gct": a.get("avgGroundContactTime"), "sl": a.get("avgStrideLength"),
            "vo": a.get("avgVerticalOscillation"), "vr": a.get("avgVerticalRatio"), "pw": a.get("avgPower"),
            "mpw": a.get("maxPower"), "npw": a.get("normPower"), "gap": a.get("avgGradeAdjustedSpeed"),
            "hz": [a.get(f"hrTimeInZone_{i}") or 0 for i in range(1, 6)],
            "pz": [a.get(f"powerTimeInZone_{i}") or 0 for i in range(1, 6)],
            "tmin": a.get("minTemperature"), "tmax": a.get("maxTemperature"), "loc": a.get("locationName"),
            "pr": bool(a.get("pr")), "ef": round(spd * 60 / hr, 3) if spd and hr else None,
            "bs": {k: a.get(f"fastestSplit_{k}") for k in (1000, 1609, 5000, 10000) if a.get(f"fastestSplit_{k}")},
            "w": _j(r["weather"]), "dec": sm["dec"], "ph": sm["ph"], "run": r["type"] in RUN_TYPES,
            "ser": bool(ser), "map": bool(r["polyline"]),
        }
        acts.append(row)
        if ser or r["polyline"] or r["splits"]:
            det[str(r["id"])] = {"ser": ser, "poly": _j(r["polyline"]), "laps": _j(r["splits"])}

    daily, sleep = [], {}
    for r in con.execute("SELECT * FROM daily ORDER BY date"):
        e = _j(r["extra"]) or {}
        sl = e.pop("sleep", None)
        if sl:
            sleep[r["date"]] = sl
        row = {"date": r["date"], "steps": r["steps"], "rhr": r["resting_hr"], "stress": r["stress_avg"],
               "bbH": r["bb_high"], "bbL": r["bb_low"], "sleepS": r["sleep_s"], "sleepScore": r["sleep_score"],
               "deep": r["deep_s"], "rem": r["rem_s"], "light": r["light_s"], "hrv": r["hrv_avg"],
               "hrvSt": r["hrv_status"], "vo2": r["vo2max"]}
        row.update({k: v for k, v in e.items() if v is not None})
        daily.append(row)

    # training load model: exponentially weighted fatigue (7 d) and fitness (42 d), like TrainingPeaks
    by_day = {}
    for a in acts:
        k = a["s"][:10]
        by_day[k] = by_day.get(k, 0) + a["ld"]
    load = {"dates": [], "load": [], "atl": [], "ctl": []}
    if by_day:
        d0 = date.fromisoformat(min(by_day))
        atl = ctl = 0.0
        d = d0
        while d <= date.today():
            x = by_day.get(d.isoformat(), 0)
            atl += (x - atl) / 7
            ctl += (x - ctl) / 42
            load["dates"].append(d.isoformat())
            load["load"].append(round(x, 1))
            load["atl"].append(round(atl, 1))
            load["ctl"].append(round(ctl, 1))
            d += timedelta(days=1)

    curves = {r["date"]: json.loads(r["json"]) for r in con.execute("SELECT * FROM curves")}
    return {
        "generated": datetime.now(timezone.utc).isoformat(),
        "last_sync": db.get_meta(con, "last_sync"),
        "activities": acts, "detail": det, "daily": daily, "sleep": sleep, "curves": curves, "load": load,
        "records": db.get_meta(con, "records", []), "predictions": db.get_meta(con, "predictions", {}),
        "gear": db.get_meta(con, "gear", []), "weights": db.get_meta(con, "weights", []),
    }
