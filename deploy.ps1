# ==============================================================================
# Script de Despliegue Automatizado para Windows PowerShell
# Quadient Inspire Flex Stack & Kafka Studio (Docker Desktop)
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   INSTALADOR / DESPLIEGUE - QUADIENT INSPIRE FLEX (WIN)  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$EnvFile = ".quadient_credentials.env"
$DefaultRegistry = "quadientdistribution.azurecr.io"
$DefaultUser = ""
$DefaultPass = ""
$DefaultLic = ""
$DefaultVersion = "17.5"

# 1. Cargar configuración existente si existe
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $val = $matches[2].Trim().Trim('"').Trim("'")
            if ($name -eq "ACR_REGISTRY") { $DefaultRegistry = $val }
            if ($name -eq "ACR_USERNAME") { $DefaultUser = $val }
            if ($name -eq "ACR_PASSWORD") { $DefaultPass = $val }
            if ($name -eq "CX_LIC_SERVER") { $DefaultLic = $val }
            if ($name -eq "INSPIRE_VERSION") { $DefaultVersion = $val -replace '-latest$', '' }
        }
    }
}

# 2. Configurar Versión
Write-Host ""
Write-Host "--- [1/4] Version de Inspire ---" -ForegroundColor Yellow
$InputVersion = Read-Host "Version de Inspire (ej. 17.5, 17.6, 18.0) [default: $DefaultVersion]"
if ([string]::IsNullOrWhiteSpace($InputVersion)) { $InputVersion = $DefaultVersion }

if ($InputVersion -notmatch '-latest$' -and $InputVersion -ne "latest") {
    $SelectedTag = "$InputVersion-latest"
} else {
    $SelectedTag = $InputVersion
}
Write-Host "-> Version configurada: $SelectedTag" -ForegroundColor Green

# 3. Credenciales Azure & Licencia
Write-Host ""
Write-Host "--- [2/4] Credenciales Azure Registry & Licencia Inspire ---" -ForegroundColor Yellow
$InputRegistry = Read-Host "Azure Container Registry [$DefaultRegistry]"
if ([string]::IsNullOrWhiteSpace($InputRegistry)) { $InputRegistry = $DefaultRegistry }
$AcrName = ($InputRegistry -split '\.')[0]

$InputUser = Read-Host "Usuario ACR [$DefaultUser]"
if ([string]::IsNullOrWhiteSpace($InputUser)) { $InputUser = $DefaultUser }
if ([string]::IsNullOrWhiteSpace($InputUser)) {
    Write-Error "El usuario de Azure Registry es obligatorio."
}

if (![string]::IsNullOrWhiteSpace($DefaultPass)) {
    $InputPass = Read-Host "Password/Token ACR [Presiona Enter para mantener actual]" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($InputPass)
    $UnsecurePass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    if ([string]::IsNullOrWhiteSpace($UnsecurePass)) {
        $AcrPassword = $DefaultPass
    } else {
        $AcrPassword = $UnsecurePass
    }
} else {
    $InputPass = Read-Host "Password/Token ACR" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($InputPass)
    $AcrPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}
if ([string]::IsNullOrWhiteSpace($AcrPassword)) {
    Write-Error "La contrasena o token de Azure Registry es obligatoria."
}

if (![string]::IsNullOrWhiteSpace($DefaultLic)) {
    $InputLic = Read-Host "Servidor de Licencia Inspire (CX_LIC_SERVER) [$DefaultLic]"
    if ([string]::IsNullOrWhiteSpace($InputLic)) { $InputLic = $DefaultLic }
} else {
    $InputLic = Read-Host "Servidor de Licencia Inspire (CX_LIC_SERVER)"
}
if ([string]::IsNullOrWhiteSpace($InputLic)) {
    Write-Error "El servidor de licencia Inspire es obligatorio."
}

# Guardar en archivo .env
$EnvContent = @"
ACR_NAME="$AcrName"
ACR_REGISTRY="$InputRegistry"
ACR_USERNAME="$InputUser"
ACR_PASSWORD="$AcrPassword"
CX_LIC_SERVER="$InputLic"
QUADIENT_LICENSE_URL="$InputLic"
INSPIRE_VERSION="$SelectedTag"
"@
Set-Content -Path $EnvFile -Value $EnvContent -Encoding UTF8
Set-Content -Path ".env" -Value $EnvContent -Encoding UTF8
Write-Host "[OK] Configuracion guardada en .quadient_credentials.env y .env" -ForegroundColor Green

# 4. Tipo de Instalacion
Write-Host ""
Write-Host "--- [3/4] Seleccion de Tipo de Instalacion ---" -ForegroundColor Yellow
Write-Host "1) Unicamente Quadient (IPS, ICM, Scaler, Interactive + Postgres)"
Write-Host "2) Full Stack (Quadient + Servidores Kafka KRaft + GUI CSV Studio)"
$Option = Read-Host "Seleccione opcion [1 o 2]"

if ($Option -ne "1" -and $Option -ne "2") {
    Write-Error "Opcion invalida. Debe ser 1 o 2."
}

# 5. Login y Descarga
Write-Host ""
Write-Host "--- [4/4] Ejecutando Despliegue con Docker Desktop ---" -ForegroundColor Yellow
Write-Host "[*] Autenticando en $InputRegistry..." -ForegroundColor Cyan
$AcrPassword | docker login $InputRegistry -u $InputUser --password-stdin

Write-Host "[*] Descargando las ultimas versiones de las imagenes (tag: $SelectedTag)..." -ForegroundColor Cyan
if ($Option -eq "2") {
    docker compose --env-file $EnvFile --profile full pull
} else {
    docker compose --env-file $EnvFile pull
}

# 6. Inicializacion de PostgreSQL e ICM
Write-Host "[*] Iniciando contenedor PostgreSQL..." -ForegroundColor Cyan
docker compose --env-file $EnvFile up -d postgres

Write-Host "[*] Esperando a que PostgreSQL este listo..." -ForegroundColor Cyan
do {
    Start-Sleep -Seconds 2
    $status = (docker inspect --format='{{.State.Health.Status}}' quadient-postgres 2>$null)
    Write-Host -NoNewline "."
} while ($status -ne "healthy")
Write-Host " [OK]" -ForegroundColor Green

Write-Host "[*] Verificando usuario administrador 'system' en Inspire ICM..." -ForegroundColor Cyan
docker run --rm --network host `
    "$InputRegistry/flex/icm:$SelectedTag" `
    /opt/Quadient/Designer/InspireICM -dbtype PostgreSQL `
    -connectstring "PostgreSQL:HOST=localhost;PORT=5432;DBNAME=icm_db;USER=scaler;PASSWORD=scalerpassword123;" `
    -insertadminname system -insertadminpassword 'Password12345*' `
    -dir /opt/Quadient/Inspire-Designer-data/icm 2>$null

Write-Host "[*] Iniciando ICM..." -ForegroundColor Cyan
docker compose --env-file $EnvFile up -d icm
Start-Sleep -Seconds 4

Write-Host "[*] Aplicando permisos de 'User impersonation' a usuario 'system'..." -ForegroundColor Cyan
$CurrentDir = (Get-Location).Path
docker run --rm --network host -v "${CurrentDir}:/work" -w /work `
    --entrypoint /bin/bash "$InputRegistry/flex/scaler:$SelectedTag" `
    -c "java -cp '/opt/InspireScalerInstaller/lib/*:/opt/InspireScalerInstaller/scaler-conductor.jar' grant_impersonation.java localhost 30353 system 'Password12345*'" 2>$null

# 7. Despliegue final
Write-Host "[*] Iniciando servicios de la aplicacion..." -ForegroundColor Cyan
if ($Option -eq "1") {
    docker compose --env-file $EnvFile up -d
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "   [OK] DESPLIEGUE TIPO 1 COMPLETADO (QUADIENT CORE)      " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  * Version Inspire:     $SelectedTag"
    Write-Host "  * Inspire Interactive: http://localhost:30701/interactive"
    Write-Host "  * Inspire Scaler:      http://localhost:30600/scaler"
    Write-Host "  * Inspire ICM:         Puerto 30353"
    Write-Host "  * Usuario Admin:       system"
    Write-Host "  * Password:            Password12345*"
    Write-Host "==========================================================" -ForegroundColor Green
} else {
    docker compose --env-file $EnvFile --profile full up -d --build
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "   [OK] DESPLIEGUE TIPO 2 COMPLETADO (FULL STACK)         " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  * Version Inspire:     $SelectedTag"
    Write-Host "  * Inspire Interactive: http://localhost:30701/interactive"
    Write-Host "  * Inspire Scaler:      http://localhost:30600/scaler"
    Write-Host "  * Kafka CSV Studio:    http://localhost:8080"
    Write-Host "  * Broker Kafka:        localhost:9092"
    Write-Host "  * Usuario Admin:       system"
    Write-Host "  * Password:            Password12345*"
    Write-Host "==========================================================" -ForegroundColor Green
}
