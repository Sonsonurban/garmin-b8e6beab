# Mi Garmin — dashboard privado, gratis (GitHub Actions + Pages, datos cifrados)

Cada 3 h un workflow de GitHub Actions sincroniza tu Garmin, cifra TODOS los datos con tu clave
(PBKDF2-SHA256 600k + AES-256-GCM) y publica `data.bin` en GitHub Pages. La app (PWA) lo descarga
y lo descifra en el teléfono. Sin servidor, sin pago.

## Una sola vez
1. `.\.venv\Scripts\python -m server.login_garmin`   (crea el token de sesión de Garmin)
2. `.\.venv\Scripts\python -m server.sync --full`    (primera descarga local)
3. `.\prepare_github.ps1`                            (elige tu clave; crea `state.seed.enc`)
4. Subir el código a un repositorio PÚBLICO de tu cuenta personal de GitHub.
5. Settings > Pages > Source: GitHub Actions.
6. Settings > Secrets and variables > Actions: `DATA_PASSPHRASE` (tu clave) y `GARMIN_TOKENS_B64` (pegar desde el portapapeles).
7. Actions > sync-and-publish > Run workflow.
8. iPhone: Safari > https://<usuario>.github.io/<repo>/ > Compartir > Agregar a pantalla de inicio.

## Límites a recordar
- La clave protege todo: usa una frase larga. Sin ella, `data.bin` es ruido.
- En repos públicos GitHub desactiva los workflows programados tras 60 días sin actividad: reactívalo en Actions.
- Si Garmin bloquea las IP de GitHub, el sitio sigue publicando el último dato bueno (aviso en el log).
- `data/` (tu base y token) nunca se sube: está en `.gitignore`.

## Probar en local (sin GitHub)
    $env:DATA_PASSPHRASE="una-frase-larga-de-prueba"
    .\.venv\Scripts\python -m server.export --no-sync --out _site --state _st.enc --seed none
    .\.venv\Scripts\python -m http.server 8767 --directory _site
