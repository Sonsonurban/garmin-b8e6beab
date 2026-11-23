# Prepares everything that goes to GitHub. Nothing secret is printed or written in plain text.
#   - asks for your passphrase (typed twice, hidden)
#   - writes state.seed.enc (your current data, ENCRYPTED, no Garmin tokens) to commit with the code
#   - copies your Garmin session token to the clipboard, to paste as a GitHub secret
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Read-Secret($prompt) {
  $s = Read-Host $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$pw = Read-Secret "Elige tu clave: una frase larga, minimo 16 caracteres (la usaras en el iPhone)"
if ($pw.Length -lt 16) { throw "Clave demasiado corta: usa 16 o mas caracteres (ej. 4 o 5 palabras sin relacion)." }
if ($pw -ne (Read-Secret "Repitela para confirmar")) { throw "No coinciden. Vuelve a ejecutar el script." }
if (-not (Test-Path "data\garmin.db")) { throw "Falta data\garmin.db. Primero sincroniza: .\.venv\Scripts\python -m server.sync --full" }
if (-not (Test-Path "data\garmin_tokens_b64.txt")) { throw "Falta data\garmin_tokens_b64.txt. Ejecuta: .\.venv\Scripts\python -m server.login_garmin" }

$tmp = Join-Path $env:TEMP ("mg_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory $tmp | Out-Null
$env:DATA_PASSPHRASE = $pw
try {
  & ".\.venv\Scripts\python.exe" -m server.export --no-sync --out "$tmp\site" --state "$tmp\state.enc" --seed "$tmp\none" --write-seed "state.seed.enc"
  if ($LASTEXITCODE -ne 0) { throw "La exportacion fallo." }
} finally {
  Remove-Item Env:DATA_PASSPHRASE -ErrorAction SilentlyContinue
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

(Get-Content "data\garmin_tokens_b64.txt" -Raw).Trim() | Set-Clipboard
Write-Host ""
Write-Host "Listo. state.seed.enc creado (cifrado)."
Write-Host "El token de Garmin esta en tu portapapeles: pegalo como secreto GARMIN_TOKENS_B64 en GitHub."
Write-Host "El secreto DATA_PASSPHRASE es la clave que acabas de elegir (escribela tu en GitHub)."
