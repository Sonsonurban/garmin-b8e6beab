"""Run ONCE on your own computer to create a Garmin session token.

    .venv\\Scripts\\python -m server.login_garmin

It asks for your Garmin email and password in the terminal (the password is
not echoed and is never saved). Only the session token is stored in
data/garmin_tokens. If your account has two-step verification it asks for the code.
"""
import base64
import getpass
import io
import zipfile

from garminconnect import Garmin

from .sync import TOKEN_DIR


def main():
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password (hidden): ")
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    api = Garmin(email, password, prompt_mfa=lambda: input("Verification code: ").strip())
    api.login(str(TOKEN_DIR))
    print(f"\nLogged in. Token saved in {TOKEN_DIR}")

    # Single-line version of the token, to paste as a secret on the hosting service.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in TOKEN_DIR.rglob("*"):
            if p.is_file():
                z.write(p, p.relative_to(TOKEN_DIR))
    out = TOKEN_DIR.parent / "garmin_tokens_b64.txt"
    out.write_text(base64.b64encode(buf.getvalue()).decode())
    print(f"Hosting secret saved in {out} (treat it like a password; never share it).")


if __name__ == "__main__":
    main()
