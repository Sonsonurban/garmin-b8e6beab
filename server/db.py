"""SQLite storage. One file, no server needed."""
import json
import os
import sqlite3
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DB_PATH = DATA_DIR / "garmin.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  start_time TEXT NOT NULL,          -- local time, 'YYYY-MM-DD HH:MM:SS'
  type TEXT,
  name TEXT,
  distance_m REAL,
  duration_s REAL,
  moving_s REAL,
  avg_hr REAL,
  max_hr REAL,
  calories REAL,
  elev_gain REAL,
  avg_cadence REAL,
  aerobic_te REAL,
  anaerobic_te REAL,
  load REAL,                         -- Garmin training load (EPOC based)
  vo2max REAL,
  polyline TEXT,                     -- JSON [[lat, lon], ...]
  splits TEXT,                       -- JSON list of laps / km splits
  hr_zones TEXT,                     -- JSON list of seconds per zone
  raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_act_start ON activities(start_time);

CREATE TABLE IF NOT EXISTS daily (
  date TEXT PRIMARY KEY,
  steps INTEGER,
  resting_hr INTEGER,
  stress_avg INTEGER,
  bb_high INTEGER,
  bb_low INTEGER,
  sleep_s INTEGER,
  sleep_score INTEGER,
  deep_s INTEGER,
  rem_s INTEGER,
  light_s INTEGER,
  hrv_avg INTEGER,
  hrv_status TEXT,
  vo2max REAL,
  readiness INTEGER
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS curves (date TEXT PRIMARY KEY, json TEXT);   -- intraday stress / body battery / HR
"""

# Columns added after the first version (added in place so an existing database keeps working).
NEW_COLUMNS = {
    "activities": [("series", "TEXT"), ("weather", "TEXT")],
    "daily": [("extra", "TEXT")],
}


def migrate(con):
    for table, cols in NEW_COLUMNS.items():
        have = {r["name"] for r in con.execute(f"PRAGMA table_info({table})")}
        for name, kind in cols:
            if name not in have:
                con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {kind}")
    con.commit()


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    migrate(con)
    return con


def set_meta(con, key, value):
    con.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)))
    con.commit()


def get_meta(con, key, default=None):
    row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default
