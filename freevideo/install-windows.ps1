# Проверяет, потянет ли этот ПК FreeVideo, скачивает официальный установщик
# из релизов FlashML-org/FreeVideo и запускает его.
# Запуск: powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$ReleaseUrl = 'https://github.com/FlashML-org/FreeVideo/releases/latest/download/FreeVideo.exe'
$Invariant = [Globalization.CultureInfo]::InvariantCulture
$problems = @()

function Ok($text)   { Write-Host "  [OK]  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  [!]   $text" -ForegroundColor Yellow }
function Bad($text)  { Write-Host "  [X]   $text" -ForegroundColor Red }

Write-Host ''
Write-Host 'FreeVideo: проверка компьютера' -ForegroundColor Cyan
Write-Host ''

if (-not [Environment]::Is64BitOperatingSystem) {
    $problems += 'Нужна 64-битная Windows.'
    Bad 'Windows 32-битная'
} else {
    Ok 'Windows 64-битная'
}

# Видеокарта NVIDIA: RTX 30-й серии или новее (SM 8.0+), драйвер 580+, от 8 ГБ видеопамяти.
$smi = (Get-Command nvidia-smi -ErrorAction SilentlyContinue).Source
if (-not $smi) {
    $smi = @("$env:SystemRoot\System32\nvidia-smi.exe",
             "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
$gpus = @()
if ($smi) {
    try {
        $gpus = @(& $smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv,noheader,nounits 2>$null |
            Where-Object { $_ -match ',' } | ForEach-Object {
                $f = $_ -split ',\s*'
                [pscustomobject]@{
                    Name    = $f[0].Trim()
                    VramGb  = [math]::Round([double]::Parse($f[1], $Invariant) / 1024, 1)
                    Driver  = $f[2].Trim()
                    Compute = [double]::Parse($f[3], $Invariant)
                }
            })
    } catch {
        $gpus = @()
    }
}
if ($gpus.Count -eq 0) {
    $problems += 'Не найдена видеокарта NVIDIA или её драйвер. Нужна NVIDIA RTX 30-й серии или новее с драйвером 580+: https://www.nvidia.com/drivers'
    Bad 'Видеокарта NVIDIA не найдена (или драйвер слишком старый)'
} else {
    $gpu = $gpus | Sort-Object VramGb -Descending | Select-Object -First 1
    Write-Host "  Видеокарта: $($gpu.Name), $($gpu.VramGb) ГБ, драйвер $($gpu.Driver)"
    if ($gpu.Compute -lt 8.0) {
        $problems += "Видеокарта $($gpu.Name) слишком старая: FreeVideo нужна NVIDIA RTX 30-й серии или новее (вычислительная способность 8.0+, у вас $($gpu.Compute.ToString($Invariant)))."
        Bad 'Поколение видеокарты не поддерживается'
    } else {
        Ok 'Поколение видеокарты подходит'
    }
    if ($gpu.VramGb -lt 7.5) {
        $problems += "Мало видеопамяти: $($gpu.VramGb) ГБ, нужно от 8 ГБ."
        Bad 'Видеопамяти меньше 8 ГБ'
    } else {
        Ok 'Видеопамяти достаточно'
    }
    if ([int]($gpu.Driver -split '\.')[0] -lt 580) {
        $problems += "Драйвер NVIDIA $($gpu.Driver) устарел, нужен 580 или новее. Обновите его через NVIDIA App или https://www.nvidia.com/drivers и перезагрузите ПК."
        Bad 'Драйвер NVIDIA ниже 580'
    } else {
        Ok 'Драйвер NVIDIA подходит'
    }
}

# Оперативная память: от 16 ГБ (Windows показывает 16 ГБ как ~15.8).
$ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1GB, 1)
if ($ramGb -lt 15) {
    $problems += "Мало оперативной памяти: $ramGb ГБ, нужно от 16 ГБ."
    Bad "Оперативная память: $ramGb ГБ"
} else {
    Ok "Оперативная память: $ramGb ГБ"
}

# Место на диске: модели весят несколько десятков ГБ, точный объём покажет установщик.
$disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' |
    Sort-Object FreeSpace -Descending |
    ForEach-Object { [pscustomobject]@{ Drive = $_.DeviceID; FreeGb = [math]::Round($_.FreeSpace / 1GB) } })
$free = ($disks | ForEach-Object { "$($_.Drive) $($_.FreeGb) ГБ" }) -join ', '
if ($disks.Count -eq 0 -or $disks[0].FreeGb -lt 100) {
    Warn "Свободно: $free. Лучше освободить от 100 ГБ на одном диске (желательно SSD)"
} else {
    Ok "Свободно: $free. Для установки выберите папку на диске $($disks[0].Drive)"
}

Write-Host ''
if ($problems.Count -gt 0) {
    Write-Host 'FreeVideo на этом ПК пока не запустится:' -ForegroundColor Red
    $problems | ForEach-Object { Write-Host "  - $_" }
    Write-Host ''
    exit 1
}

$target = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads\FreeVideo.exe'
Write-Host "Скачиваю установщик FreeVideo в $target ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
$curl = "$env:SystemRoot\System32\curl.exe"
if (Test-Path $curl) {
    & $curl -fL --retry 3 -o $target $ReleaseUrl
    if ($LASTEXITCODE -ne 0) { throw "Не удалось скачать $ReleaseUrl" }
} else {
    Invoke-WebRequest -UseBasicParsing -Uri $ReleaseUrl -OutFile $target -ErrorAction Stop
}

$signature = Get-AuthenticodeSignature $target
if ($signature.Status -eq 'Valid') {
    Ok "Подпись установщика: $($signature.SignerCertificate.Subject)"
}

Write-Host ''
Write-Host 'Запускаю установщик. Дальше в его окне:' -ForegroundColor Cyan
Write-Host '  1. Выберите папку для новой установки ComfyUI (на диске, где больше места).'
Write-Host '  2. Нажмите Install & launch и дождитесь загрузки моделей (это долго).'
Write-Host '  3. ComfyUI откроется в браузере с рабочим пространством FreeVideo.'
Write-Host ''
Start-Process -FilePath $target
