"""Static, encrypted export for GitHub Pages.

Run by the GitHub Action (or locally):
  1. restore the encrypted state (database [+ Garmin tokens]) from the cache/seed
  2. sync new data from Garmin
  3. write site/data.bin: ALL dashboard data, gzip + AES-256-GCM, key from your passphrase
  4. write the next encrypted state

Everything that leaves this process (data.bin, state files) is ciphertext. The passphrase comes from
the DATA_PASSPHRASE environment variable and is never written anywhere.

File format: b"MG1" + salt(16) + iv(12) + AES-GCM ciphertext (tag at the end).
"""
import argparse
import gzip
import hashlib
import io
import json
import os
import shutil
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from . import db, sync

MAGIC = b"MG1"
ITERATIONS = 600_000  # must match web/app.js
ROOT = Path(__file__).resolve().parent.parent


def derive(passphrase: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", passphrase.encode(), salt, ITERATIONS, 32)


def encrypt(passphrase: str, salt: bytes, data: bytes) -> bytes:
    iv = os.urandom(12)
    return MAGIC + salt + iv + AESGCM(derive(passphrase, salt)).encrypt(iv, data, None)


def decrypt(passphrase: str, blob: bytes) -> bytes:
    if blob[:3] != MAGIC:
        raise ValueError("unknown file format")
    salt, iv, ct = blob[3:19], blob[19:31], blob[31:]
    return AESGCM(derive(passphrase, salt)).decrypt(iv, ct, None)


def salt_of(blob: bytes) -> bytes:
    return blob[3:19]


# ---------- state (database + tokens) ----------
def pack_state(include_tokens: bool) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(db.DB_PATH, arcname="garmin.db")
        if include_tokens and sync.TOKEN_DIR.exists():
            tar.add(sync.TOKEN_DIR, arcname="garmin_tokens")
    return buf.getvalue()


def unpack_state(raw: bytes):
    db.DATA_DIR.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        tar.extractall(db.DATA_DIR, filter="data")  # 'data' filter blocks absolute paths / traversal


# ---------- dashboard data ----------
def build_bundle() -> dict:
    from . import app  # reuse the exact same calculations the API uses

    con = db.connect()
    acts, off = [], 0
    while True:
        page = app.activities(limit=100, offset=off, type=None)
        acts += page
        if len(page) < 100:
            break
        off += 100
    return {
        "generated": datetime.now(timezone.utc).isoformat(),
        "overview": app.overview(),
        "activities": acts,
        "activity": {str(a["id"]): app.activity(a["id"]) for a in acts},
        "daily": app.daily(days=90),
        "count": con.execute("SELECT COUNT(*) FROM activities").fetchone()[0],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site", help="folder for the static site")
    ap.add_argument("--state", default="state.enc", help="encrypted state read at start, rewritten at end")
    ap.add_argument("--seed", default="state.seed.enc", help="fallback state (no tokens) used when --state is missing")
    ap.add_argument("--write-seed", metavar="PATH", help="also write a token-free seed state to PATH")
    ap.add_argument("--no-sync", action="store_true", help="skip the Garmin sync (use the database as it is)")
    args = ap.parse_args()

    passphrase = os.environ.get("DATA_PASSPHRASE", "")
    if len(passphrase) < 12:
        sys.exit("DATA_PASSPHRASE must be set and at least 12 characters (use a long phrase).")

    salt = None
    for path in (Path(args.state), Path(args.seed)):
        if path.exists():
            blob = path.read_bytes()
            try:
                unpack_state(decrypt(passphrase, blob))
            except InvalidTag:
                sys.exit(f"Could not decrypt {path}: wrong DATA_PASSPHRASE.")
            salt = salt_of(blob)
            print(f"state restored from {path}")
            break
    salt = salt or os.urandom(16)

    if not args.no_sync:
        try:
            sync.run()
        except Exception as e:  # noqa: BLE001 - keep the site up with the last good data
            print(f"::warning::Garmin sync failed ({type(e).__name__}: {str(e)[:160]}). Publishing previous data.")
    if not db.DB_PATH.exists():
        sys.exit("No database and sync failed: nothing to publish.")

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "web", out)
    raw = gzip.compress(json.dumps(build_bundle(), separators=(",", ":")).encode(), 9)
    (out / "data.bin").write_bytes(encrypt(passphrase, salt, raw))
    (out / ".nojekyll").write_text("")

    Path(args.state).write_bytes(encrypt(passphrase, salt, pack_state(include_tokens=True)))
    if args.write_seed:
        Path(args.write_seed).write_bytes(encrypt(passphrase, salt, pack_state(include_tokens=False)))
    print(f"exported {(out / 'data.bin').stat().st_size / 1024:.0f} KB to {out}/")


if __name__ == "__main__":
    main()
