[CmdletBinding()]
param(
  [string]$Repo,
  [switch]$DryRun,
  [switch]$AllowDirty,
  [switch]$SkipTests,
  [switch]$ReuseBuild,
  [switch]$Ui
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Get-CommandPath([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "Required command '$Name' was not found on PATH." }
  return $command.Source
}

function Write-Stage([int]$Percent, [string]$Stage, [string]$Message) {
  if ($Ui) {
    Write-Output ("RELEASE_PROGRESS|{0}|{1}|{2}" -f $Percent, $Stage, $Message)
    return
  }
  Write-Host "[$Stage] $Message"
}

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE."
  }
}

function Get-RepositorySlug([string]$GitCommand) {
  $remote = (& $GitCommand config --get remote.origin.url 2>$null).Trim()
  if (-not $remote) { throw "No origin remote is configured. Pass -Repo OWNER/REPOSITORY." }
  $slug = $remote -replace '^https://github\.com/', ''
  $slug = $slug -replace '^git@github\.com:', ''
  $slug = $slug -replace '\.git$', ''
  if ($slug -notmatch '^[^/]+/[^/]+$') {
    throw "Could not derive a GitHub repository from origin '$remote'. Pass -Repo OWNER/REPOSITORY."
  }
  return $slug
}

function Get-WorkingTreeChanges([string]$GitCommand) {
  $changes = @(& $GitCommand status --porcelain --untracked-files=all 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect the Git working tree." }
  return @($changes | Where-Object { $_ -and $_.Trim() })
}

function Get-LocalAssetInfo([string[]]$Assets) {
  $info = @{}
  foreach ($asset in $Assets) {
    $file = Get-Item -LiteralPath $asset -ErrorAction Stop
    $leaf = $file.Name
    $hash = (Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant()
    $info[$leaf] = [pscustomobject]@{
      Name = $leaf
      Size = [int64]$file.Length
      Hash = $hash
    }
  }
  return $info
}

function Normalize-SquirrelReleasesManifest([string]$ManifestPath, [string]$Repository) {
  $raw = Get-Content -LiteralPath $ManifestPath -Raw
  $normalizedLines = @()
  foreach ($line in ($raw -split "`r?`n")) {
    $trimmed = $line.Trim()
    if (-not $trimmed) { continue }
    $parts = $trimmed -split '\s+'
    if ($parts.Count -lt 3) { continue }
    $sha1 = $parts[0]
    $size = $parts[-1]
    $fileOrUrl = if ($parts.Count -eq 3) { $parts[1] } else { $parts[-2] }
    $filename = Split-Path -Leaf $fileOrUrl
    if ($filename -match '^monochromium-([0-9]+\.[0-9]+\.[0-9]+)-(full|delta)\.nupkg$') {
      $version = $Matches[1]
      $url = "https://github.com/$Repository/releases/download/v$version/$filename"
      $normalizedLines += "$sha1 $url $size"
    } else {
      $normalizedLines += $trimmed
    }
  }
  $normalizedContent = ($normalizedLines -join "`n") + "`n"
  Set-Content -LiteralPath $ManifestPath -Value $normalizedContent -NoNewline -Encoding utf8
  return $normalizedContent
}

$npm = Get-CommandPath "npm.cmd"
$gh = Get-CommandPath "gh.exe"
$git = Get-CommandPath "git.exe"
if (-not $Repo) { $Repo = Get-RepositorySlug $git }

$package = Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json
if ($package.version -notmatch '^([0-9]+)\.([0-9]+)\.([0-9]+)$') {
  throw "package.json version '$($package.version)' is not a simple semver patch version."
}
$lockRaw = Get-Content -LiteralPath "package-lock.json" -Raw
if ($lockRaw -notmatch ('"version"\s*:\s*"' + [regex]::Escape([string]$package.version) + '"')) {
  throw "package-lock.json does not start at package.json version $($package.version). Run npm install before releasing."
}

$currentVersion = [version]$package.version
$releaseDir = Join-Path $PSScriptRoot "out\make\squirrel.windows\x64"
$releaseVersion = "{0}.{1}.{2}" -f $currentVersion.Major, $currentVersion.Minor, ($currentVersion.Build + 1)
$previousVersion = $package.version
$tag = "v$releaseVersion"
$packageAsset = Join-Path $releaseDir "monochromium-$releaseVersion-full.nupkg"
$deltaAsset = Join-Path $releaseDir "monochromium-$releaseVersion-delta.nupkg"
$installerAsset = Join-Path $releaseDir "Monochromium-Setup.exe"
$manifestAsset = Join-Path $releaseDir "RELEASES"

$workingTreeChanges = Get-WorkingTreeChanges $git
Write-Stage 5 "Preflight" "Preparing Monochromium $($package.version) -> $releaseVersion for $Repo."
if ($workingTreeChanges.Count -gt 0) {
  if (-not $AllowDirty -and -not $DryRun) {
    $sample = ($workingTreeChanges | Select-Object -First 8) -join "; "
    throw "The working tree has $($workingTreeChanges.Count) uncommitted change(s): $sample. Review them, then rerun with -AllowDirty if these are intentionally being released."
  }
  Write-Stage 8 "Preflight" "Working tree has $($workingTreeChanges.Count) change(s); continuing because this was explicitly allowed."
} else {
  Write-Stage 8 "Preflight" "Working tree is clean."
}

Write-Host "Monochromium release: $($package.version) -> $releaseVersion"
Write-Host "Repository: $Repo"
Write-Host "Only release assets will be published; source files will not be uploaded."
if ($DryRun) {
  Write-Stage 100 "Dry run" "No files were changed and no release was published."
  if ($ReuseBuild) {
    Write-Host "DRY RUN: would validate and publish the existing $releaseVersion build without rebuilding."
  } else {
    Write-Host "DRY RUN: would deploy and verify the relay, run parallel checks, npm version, the fast desktop build, and publish $tag."
  }
  exit 0
}

Write-Stage 12 "Authentication" "Checking GitHub CLI authentication and repository access."
Invoke-Checked $gh @("auth", "status")
Invoke-Checked $gh @("repo", "view", $Repo, "--json", "nameWithOwner")

$versionChanged = $false
$createdRelease = $false
$publicationAttempted = $false
$remoteReleasesUrl = $env:MONOCHROMIUM_REMOTE_RELEASES_URL
try {
  if ($ReuseBuild) {
    Write-Stage 20 "Reuse" "Using the existing $releaseVersion output; checks, versioning, and packaging are skipped."
  } else {
    # The client and relay share shared/multiplayer-protocol.json. Deploy the
    # current relay first so a one-click desktop release cannot publish a
    # client that is incompatible with the public multiplayer service.
    Write-Stage 18 "Relay" "Deploying and verifying the multiplayer relay before desktop checks."
    Invoke-Checked $npm @("run", "relay:deploy")

    if ($SkipTests) {
      Write-Stage 20 "Tests" "Tests were skipped by request."
    } else {
      Write-Stage 20 "Tests" "Running parallel checks, then isolated Electron UI smoke."
      Invoke-Checked $npm @("run", "release:checks")
    }

    Write-Stage 35 "Version" "Setting package version to $releaseVersion."
    Invoke-Checked $npm @("version", $releaseVersion, "--no-git-tag-version", "--allow-same-version")
    $versionChanged = $true

    # Squirrel needs the previous release directory to build a delta package.
    # Respect an explicit URL, otherwise use the current release as the delta
    # source when it already exists on GitHub.
    if (-not $remoteReleasesUrl) {
      $previousTag = "v$previousVersion"
      $previousReleaseJson = & $gh "release" "view" $previousTag "--repo" $Repo "--json" "assets" 2>$null
      $previousReleaseExit = $LASTEXITCODE
      if ($previousReleaseExit -eq 0 -and $previousReleaseJson) {
        $previousRelease = ($previousReleaseJson -join "`n") | ConvertFrom-Json
        $hasPreviousManifest = @($previousRelease.assets | Where-Object { $_.name -eq "RELEASES" }).Count -gt 0
        $hasPreviousPackage = @($previousRelease.assets | Where-Object { $_.name -eq "monochromium-$previousVersion-full.nupkg" }).Count -gt 0
        if ($hasPreviousManifest -and $hasPreviousPackage) {
          $remoteReleasesUrl = "https://github.com/$Repo/releases/download/$previousTag/"
        }
      }
    }

    if ($remoteReleasesUrl) {
      Write-Stage 42 "Delta package" "Using $remoteReleasesUrl as the previous release source."
      $env:MONOCHROMIUM_REMOTE_RELEASES_URL = $remoteReleasesUrl
    } else {
      Write-Stage 42 "Delta package" "No previous release source found; a full package will be produced."
      Remove-Item Env:MONOCHROMIUM_REMOTE_RELEASES_URL -ErrorAction SilentlyContinue
    }

    Write-Stage 48 "Build" "Building the game and Squirrel.Windows installer in one bundling pass."
    Invoke-Checked $npm @("run", "desktop:make:fast")

    if (-not $SkipTests) {
      Write-Stage 70 "Smoke test" "Running the desktop server smoke test against the compiled build."
      Invoke-Checked $npm @("run", "test:server")
    }
  }

  Write-Stage 78 "Validation" "Checking and normalizing generated installer and updater assets."
  foreach ($asset in @($installerAsset, $packageAsset, $manifestAsset)) {
    if (-not (Test-Path -LiteralPath $asset -PathType Leaf)) {
      throw "Expected release asset was not produced: $asset"
    }
  }
  $manifest = Normalize-SquirrelReleasesManifest $manifestAsset $Repo
  $packageName = Split-Path -Leaf $packageAsset
  if ($manifest -notmatch [regex]::Escape($packageName)) {
    throw "RELEASES does not reference $releaseVersion-full.nupkg."
  }
  $deltaExists = Test-Path -LiteralPath $deltaAsset -PathType Leaf
  $deltaName = Split-Path -Leaf $deltaAsset
  $deltaReferenced = $manifest -match [regex]::Escape($deltaName)
  if ($remoteReleasesUrl -and -not $ReuseBuild) {
    if (-not $deltaExists) {
      throw "A delta source was configured, but Squirrel did not produce $releaseVersion-delta.nupkg."
    }
    if (-not $deltaReferenced) {
      throw "RELEASES does not reference $releaseVersion-delta.nupkg."
    }
  }
  $fullUrlPattern = 'https://github\.com/' + [regex]::Escape($Repo) + '/releases/download/v' + [regex]::Escape($releaseVersion) + '/' + [regex]::Escape($packageName)
  if ($manifest -notmatch $fullUrlPattern) {
    throw "RELEASES does not contain valid GitHub URL for $packageName."
  }
  if ($deltaReferenced) {
    $deltaUrlPattern = 'https://github\.com/' + [regex]::Escape($Repo) + '/releases/download/v' + [regex]::Escape($releaseVersion) + '/' + [regex]::Escape($deltaName)
    if ($manifest -notmatch $deltaUrlPattern) {
      throw "RELEASES does not contain valid GitHub URL for $deltaName."
    }
  }

  $assets = @($installerAsset, $packageAsset, $manifestAsset)
  if (($remoteReleasesUrl -or $ReuseBuild) -and $deltaExists -and $deltaReferenced) {
    $assets += $deltaAsset
  }
  $localAssets = Get-LocalAssetInfo $assets
  foreach ($assetInfo in $localAssets.Values) {
    Write-Host ("Asset: {0} ({1} bytes, SHA-256 {2})" -f $assetInfo.Name, $assetInfo.Size, $assetInfo.Hash)
  }

  # gh writes its expected "release not found" result to stderr. With
  # ErrorActionPreference=Stop, PowerShell otherwise aborts before we can
  # inspect LASTEXITCODE and create the first release for this tag.
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $existingJson = & $gh "release" "view" $tag "--repo" $Repo "--json" "isDraft" 2>$null
    $releaseViewExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $releaseExists = $releaseViewExit -eq 0

  Write-Stage 84 "GitHub release" "Uploading release assets."
  if ($releaseExists) {
    $existing = ($existingJson -join "`n") | ConvertFrom-Json
    if (-not $existing.isDraft) { throw "Release $tag is already published. Refusing to overwrite its assets." }
    Invoke-Checked $gh (@("release", "upload", $tag) + $assets + @("--clobber", "--repo", $Repo))

  } else {
    Invoke-Checked $gh @("release", "create", $tag, "--draft", "--title", "Monochromium $tag", "--generate-notes", "--repo", $Repo)
    $createdRelease = $true
    Invoke-Checked $gh (@("release", "upload", $tag) + $assets + @("--clobber", "--repo", $Repo))
  }

  Write-Stage 94 "Verification" "Confirming uploaded draft assets before publication."
  $publishedJson = & $gh "release" "view" $tag "--repo" $Repo "--json" "isDraft,assets" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $publishedJson) {
    throw "GitHub did not return the published release metadata."
  }
  $published = ($publishedJson -join "`n") | ConvertFrom-Json
  if (-not $published.isDraft) { throw "Release $tag was published concurrently; refusing further changes." }
  $remoteByName = @{}
  foreach ($remoteAsset in @($published.assets)) {
    $remoteByName[$remoteAsset.name] = $remoteAsset
  }
  foreach ($assetInfo in $localAssets.Values) {
    if (-not $remoteByName.ContainsKey($assetInfo.Name)) {
      throw "Published release is missing $($assetInfo.Name)."
    }
    $remoteAsset = $remoteByName[$assetInfo.Name]
    if ([int64]$remoteAsset.size -ne $assetInfo.Size) {
      throw "Published asset $($assetInfo.Name) has size $($remoteAsset.size), expected $($assetInfo.Size)."
    }
    $remoteDigest = [string]$remoteAsset.digest
    if ($remoteDigest -and $remoteDigest -match '^sha256:(.+)$' -and $Matches[1].ToLowerInvariant() -ne $assetInfo.Hash) {
      throw "Published asset $($assetInfo.Name) has a SHA-256 digest mismatch."
    }
  }

  # From this point a failed command may still have published remotely.
  # Preserve both the release and local version on ambiguous outcomes.
  $publicationAttempted = $true
  Invoke-Checked $gh @("release", "edit", $tag, "--draft=false", "--latest", "--repo", $Repo)
  $finalJson = & $gh "release" "view" $tag "--repo" $Repo "--json" "isDraft" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $finalJson -or (($finalJson -join "`n") | ConvertFrom-Json).isDraft) {
    throw "Could not confirm publication of $tag. The release was preserved; inspect GitHub before retrying."
  }

  Write-Stage 100 "Complete" "Release published successfully."
  Write-Host "Release published: https://github.com/$Repo/releases/tag/$tag"
  $publishedAssets = "Monochromium-Setup.exe, $(Split-Path -Leaf $packageAsset), RELEASES"
  if (($remoteReleasesUrl -or $ReuseBuild) -and $deltaExists -and $deltaReferenced) { $publishedAssets += ", $deltaName" }
  Write-Host "Assets: $publishedAssets"
} catch {
  if ($createdRelease -and -not $publicationAttempted) {
    try {
      Write-Stage 98 "Cleanup" "Removing the draft release created by this failed run."
      $cleanupErrorActionPreference = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      & $gh "release" "delete" $tag "--repo" $Repo "--yes" *> $null
      $cleanupExit = $LASTEXITCODE
      $ErrorActionPreference = $cleanupErrorActionPreference
      if ($cleanupExit -ne 0) { Write-Warning "Could not remove draft release $tag. It may be retried from GitHub." }
    } catch {
      Write-Warning "Could not remove draft release $tag. It may be retried from GitHub."
    }
  }
  if ($versionChanged -and -not $publicationAttempted) {
    try {
      & $npm "version" $package.version "--no-git-tag-version" "--allow-same-version" *> $null
    } catch {
      Write-Warning "Could not restore package.json/package-lock.json to $($package.version)."
    }
  }
  throw
}
