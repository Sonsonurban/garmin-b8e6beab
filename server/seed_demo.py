"""Fills a SEPARATE demo database with synthetic data so the dashboard can be tried without Garmin.

    set DATA_DIR=data_demo && .venv\\Scripts\\python -m server.seed_demo
"""
import json
import math
import random
from datetime import date, datetime, timedelta

from . import db

random.seed(7)
LAT, LON = -41.32, -72.98  # Puerto Varas area


def route(km, gain):
    n = 120
    pts = []
    r = km / (2 * math.pi) / 111
    cx, cy = LAT + random.uniform(-0.01, 0.01), LON + random.uniform(-0.01, 0.01)
    for i in range(n):
        t = i / n * 2 * math.pi
        wob = 1 + 0.25 * math.sin(3 * t + random.random())
        pts.append([round(cx + r * math.sin(t) * wob, 5), round(cy + r * 1.3 * math.cos(t) * wob, 5)])
    return pts


def main():
    con = db.connect()
    today = date.today()
    aid = 9000000000
    fitness = 0.0
    for back in range(200, -1, -1):
        d = today - timedelta(days=back)
        # ~5 runs a week, long run on weekends, a rest day or two
        if d.weekday() in (2, 6) and random.random() < 0.8:
            continue
        if random.random() < 0.1:
            continue
        long_run = d.weekday() == 4 or d.weekday() == 5 and random.random() < 0.3
        km = round(random.uniform(14, 22) if long_run else random.uniform(5, 10), 2)
        base_pace = 5.55 - min(back, 200) * -0.0008 + random.uniform(-0.25, 0.25)  # min/km, slowly improving
        base_pace = 5.35 + back * 0.0015 + random.uniform(-0.2, 0.25)
        dur = km * base_pace * 60
        hr = int(138 + (km > 12) * 6 + random.uniform(-4, 6))
        gain = round(km * random.uniform(6, 22))
        load = round(dur / 60 * (hr / 150) ** 2 * 1.6, 1)
        lap_n = int(km)
        splits = [
            {
                "dist": 1000.0,
                "dur": round(base_pace * 60 * random.uniform(0.94, 1.07)),
                "hr": round(hr + i * 0.35 + random.uniform(-3, 3)),
                "speed": 1000 / (base_pace * 60),
                "gain": round(random.uniform(1, 14)),
                "cad": round(random.uniform(168, 178)),
            }
            for i in range(lap_n)
        ]
        zones = [random.randint(60, 200), random.randint(400, 900), dur * 0.5, dur * 0.2, random.randint(0, 150)]
        aid += 1
        st = datetime(d.year, d.month, d.day, random.choice([7, 8, 9, 10, 17]), random.randint(0, 59))
        con.execute(
            """INSERT OR REPLACE INTO activities(id,start_time,type,name,distance_m,duration_s,moving_s,avg_hr,max_hr,
               calories,elev_gain,avg_cadence,aerobic_te,anaerobic_te,load,vo2max,polyline,splits,hr_zones,raw)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (aid, st.strftime("%Y-%m-%d %H:%M:%S"), "running", "Puerto Varas Running", km * 1000, dur, dur - 8,
             hr, hr + random.randint(14, 30), round(km * 68), gain, round(random.uniform(168, 178)),
             round(random.uniform(2.4, 4.4), 1), round(random.uniform(0, 1.2), 1), load, None,
             json.dumps(route(km, gain)), json.dumps(splits), json.dumps(zones), "{}"),
        )
        fitness += 1
    for back in range(90, -1, -1):
        d = (today - timedelta(days=back)).isoformat()
        sleep = int(random.gauss(7.1, 0.7) * 3600)
        con.execute(
            "INSERT OR REPLACE INTO daily VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (d, int(random.gauss(11000, 3000)), int(52 - back * 0.04 + random.uniform(-2, 2)), random.randint(22, 38),
             random.randint(70, 98), random.randint(8, 30), sleep, random.randint(66, 92),
             int(sleep * 0.18), int(sleep * 0.22), int(sleep * 0.55), int(random.gauss(62, 7)),
             random.choice(["BALANCED", "BALANCED", "UNBALANCED", "LOW"]),
             round(50 - back * 0.012 + random.uniform(-0.3, 0.3), 1), random.randint(35, 90)),
        )
    db.set_meta(con, "last_sync", datetime.utcnow().isoformat() + "+00:00")
    con.commit()
    print("demo data ready")


if __name__ == "__main__":
    main()
