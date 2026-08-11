param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,

  [int]$Port = 5173
)

$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\')
$escapedRoot = [regex]::Escape($resolvedRoot)
$pidMarkerPath = Join-Path $resolvedRoot ".monochromium-dev.pid"
$listenerPattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
$listenerPids = @(
  netstat.exe -ano -p tcp |
    ForEach-Object {
      if ($_ -match $listenerPattern) {
        [int]$Matches[1]
      }
    } |
    Sort-Object -Unique
)

if (Test-Path -LiteralPath $pidMarkerPath) {
  $markedPidText = (Get-Content -LiteralPath $pidMarkerPath -Raw -ErrorAction SilentlyContinue).Trim()
  $markedPid = 0
  if ([int]::TryParse($markedPidText, [ref]$markedPid) -and $listenerPids -contains $markedPid) {
    Write-Host "Closing stale Monochromium development server (PID $markedPid)..."
    try {
      & taskkill.exe /PID $markedPid /T /F | Out-Host
      if ($LASTEXITCODE -ne 0) {
        throw "taskkill exited with code $LASTEXITCODE"
      }
      Wait-Process -Id $markedPid -Timeout 5 -ErrorAction SilentlyContinue
      $listenerPids = @($listenerPids | Where-Object { $_ -ne $markedPid })
    }
    catch {
      Write-Host "The stale server could not be closed: $($_.Exception.Message)" -ForegroundColor Red
      exit 1
    }
  }
  Remove-Item -LiteralPath $pidMarkerPath -Force -ErrorAction SilentlyContinue
}

if ($listenerPids.Count -eq 0) {
  exit 0
}

foreach ($listenerPid in $listenerPids) {
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerPid" -ErrorAction Stop
  }
  catch {
    Write-Host "Port $Port is occupied by PID $listenerPid, but its identity could not be verified." -ForegroundColor Red
    Write-Host "Close that program or run this launcher as administrator if it is a stale Monochromium server."
    exit 1
  }

  $isMonochromiumVite =
    $process.Name -ieq "node.exe" -and
    $process.CommandLine -match $escapedRoot -and
    $process.CommandLine -match "[\\/]vite[\\/]"

  if (-not $isMonochromiumVite) {
    Write-Host "Port $Port is occupied by another program (PID ${listenerPid}: $($process.Name))." -ForegroundColor Red
    Write-Host "It was not closed because it is not a Monochromium Vite server."
    exit 1
  }

  Write-Host "Closing stale Monochromium development server (PID $listenerPid)..."
  try {
    & taskkill.exe /PID $listenerPid /T /F | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "taskkill exited with code $LASTEXITCODE"
    }
    Wait-Process -Id $listenerPid -Timeout 5 -ErrorAction SilentlyContinue
  }
  catch {
    Write-Host "The stale server could not be closed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
}

$stillListening = netstat.exe -ano -p tcp | Select-String -Pattern $listenerPattern
if ($stillListening) {
  Write-Host "Port $Port is still occupied after cleanup." -ForegroundColor Red
  exit 1
}

Write-Host "Stale development server cleared."
exit 0
