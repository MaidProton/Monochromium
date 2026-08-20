[CmdletBinding()]
param(
  [string]$Repo,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Get-CommandPath([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "Required command '$Name' was not found on PATH." }
  return $command.Source
}

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE."
  }
}

function Get-RepositorySlug {
  $remote = (& git config --get remote.origin.url 2>$null).Trim()
  if (-not $remote) { throw "No origin remote is configured. Pass -Repo OWNER/REPOSITORY." }
  $slug = $remote -replace '^https://github\.com/', ''
  $slug = $slug -replace '^git@github\.com:', ''
  $slug = $slug -replace '\.git$', ''
  if ($slug -notmatch '^[^/]+/[^/]+$') {
    throw "Could not derive a GitHub repository from origin '$remote'. Pass -Repo OWNER/REPOSITORY."
  }
  return $slug
}

$npm = Get-CommandPath "npm.cmd"
$gh = Get-CommandPath "gh.exe"
if (-not $Repo) { $Repo = Get-RepositorySlug }

$package = Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json
if ($package.version -notmatch '^([0-9]+)\.([0-9]+)\.([0-9]+)$') {
  throw "package.json version '$($package.version)' is not a simple semver patch version."
}
$currentVersion = [version]$package.version
$nextVersion = "{0}.{1}.{2}" -f $currentVersion.Major, $currentVersion.Minor, ($currentVersion.Build + 1)
$tag = "v$nextVersion"
$releaseDir = Join-Path $PSScriptRoot "out\make\squirrel.windows\x64"
$packageAsset = Join-Path $releaseDir "monochromium-$nextVersion-full.nupkg"
$installerAsset = Join-Path $releaseDir "Monochromium-Setup.exe"
$manifestAsset = Join-Path $releaseDir "RELEASES"

Write-Host "Monochromium release: $($package.version) -> $nextVersion"
Write-Host "Repository: $Repo"
Write-Host "Only release assets will be published; source files will not be uploaded."
if ($DryRun) {
  Write-Host "DRY RUN: would run npm version, npm run desktop:make, and publish $tag."
  exit 0
}

Invoke-Checked $gh @("auth", "status")

$versionChanged = $false
try {
  Invoke-Checked $npm @("version", $nextVersion, "--no-git-tag-version", "--allow-same-version")
  $versionChanged = $true
  Invoke-Checked $npm @("run", "desktop:make")

  foreach ($asset in @($installerAsset, $packageAsset, $manifestAsset)) {
    if (-not (Test-Path -LiteralPath $asset -PathType Leaf)) {
      throw "Expected release asset was not produced: $asset"
    }
  }
  $manifest = Get-Content -LiteralPath $manifestAsset -Raw
  if ($manifest -notmatch [regex]::Escape((Split-Path -Leaf $packageAsset))) {
    throw "RELEASES does not reference $nextVersion-full.nupkg."
  }

  $existingJson = & $gh "release" "view" $tag "--repo" $Repo "--json" "isDraft" 2>$null
  $releaseExists = $LASTEXITCODE -eq 0
  $assets = @($installerAsset, $packageAsset, $manifestAsset)
  if ($releaseExists) {
    $existing = $existingJson | ConvertFrom-Json
    Invoke-Checked $gh (@("release", "upload", $tag) + $assets + @("--clobber", "--repo", $Repo))
    if ($existing.isDraft) {
      Invoke-Checked $gh @("release", "edit", $tag, "--draft=false", "--latest", "--repo", $Repo)
    }
  } else {
    Invoke-Checked $gh (@("release", "create", $tag) + $assets + @("--draft", "--title", "Monochromium $tag", "--generate-notes", "--repo", $Repo))
    Invoke-Checked $gh @("release", "edit", $tag, "--draft=false", "--latest", "--repo", $Repo)
  }

  Write-Host "Release published: https://github.com/$Repo/releases/tag/$tag"
  Write-Host "Assets: Monochromium-Setup.exe, $(Split-Path -Leaf $packageAsset), RELEASES"
} catch {
  if ($versionChanged) {
    try {
      & $npm "version" $package.version "--no-git-tag-version" "--allow-same-version" *> $null
    } catch {
      Write-Warning "Could not restore package.json/package-lock.json to $($package.version)."
    }
  }
  throw
}
