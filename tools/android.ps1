# build/install helper for the GlitchDraft LSPosed module (android/).
#
#   pwsh tools/android.ps1 run           assembleDebug + install + launch MainActivity
#   pwsh tools/android.ps1 release       assembleRelease only
#   pwsh tools/android.ps1 release-apk   assembleRelease + copy an installable apk to backend/public
#
# needs JDK 21 (app/build.gradle pins source/target/jvmTarget to 21). a JDK is
# picked from JAVA_HOME or a known install location and printed before building.
#
# release commands also need the signing vars (GD_KEYSTORE_FILE,
# GD_KEYSTORE_PASSWORD, GD_KEY_ALIAS) from the repo-root .env.local — restored
# from the vault with `pwsh <automata-private>/tools/env-sync.ps1 -Repo glitchdraft`.
# they are asserted before gradle runs, so a missing keystore fails loudly here
# instead of producing an unsigned apk.

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('run', 'release', 'release-apk')]
    [string]$Command
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repo 'android'
$gradlew = Join-Path $project 'gradlew.bat'

if (-not (Test-Path $gradlew)) {
    throw "missing gradle wrapper at $gradlew — run 'gradle wrapper --gradle-version 8.9' inside android/"
}

function Find-Jdk21 {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
    $candidates += Get-ChildItem (Join-Path $env:USERPROFILE 'scoop\apps') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '21' } |
        ForEach-Object { Join-Path $_.FullName 'current' }
    foreach ($root in @((Join-Path $env:ProgramFiles 'Java'), (Join-Path $env:USERPROFILE '.jdks'))) {
        $candidates += Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '21' } | ForEach-Object { $_.FullName }
    }
    foreach ($c in $candidates) {
        $java = Join-Path $c 'bin\java.exe'
        if (Test-Path $java) {
            $v = (& $java -version 2>&1 | Out-String)
            if ($v -match 'version "21\.') { return $c }
        }
    }
    return $null
}

$jdk21 = Find-Jdk21
if (-not $jdk21) {
    throw 'JDK 21 not found (JAVA_HOME is not 21 and no 21 install detected). app/build.gradle targets Java 21 — install a JDK 21, e.g. `scoop install temurin21-jdk`.'
}
if ($env:JAVA_HOME -ne $jdk21) {
    Write-Host "using JDK 21: $jdk21"
    $env:JAVA_HOME = $jdk21
}

function Invoke-Gradle([string[]]$Tasks) {
    & $gradlew -p $project @Tasks
    if ($LASTEXITCODE -ne 0) { throw "gradle $($Tasks -join ' ') failed with exit code $LASTEXITCODE" }
}

# release signing lives in the repo-root .env.local (gitignored, restored from the
# Bitwarden vault by automata-private/tools/env-sync.ps1 -Repo glitchdraft).
# only GD_* keys are imported, never overriding vars already in the shell, and
# GD_KEYSTORE_FILE is resolved against the repo root so gradle sees an absolute path.
function Import-SigningEnv {
    $envFile = Join-Path $repo '.env.local'
    if (Test-Path $envFile) {
        foreach ($line in Get-Content $envFile) {
            $t = $line.Trim()
            if (-not $t -or $t.StartsWith('#')) { continue }
            $i = $t.IndexOf('=')
            if ($i -lt 1) { continue }
            $k = $t.Substring(0, $i).Trim()
            $v = $t.Substring($i + 1).Trim().Trim('"', "'")
            if ($k -like 'GD_*' -and -not (Test-Path "env:$k")) {
                Set-Item -Path "env:$k" -Value $v
            }
        }
    }
    if ($env:GD_KEYSTORE_FILE -and -not [IO.Path]::IsPathRooted($env:GD_KEYSTORE_FILE)) {
        $env:GD_KEYSTORE_FILE = Join-Path $repo $env:GD_KEYSTORE_FILE
    }
    return $envFile
}

function Assert-SigningEnv([string]$EnvFile) {
    $missing = @()
    if (-not $env:GD_KEYSTORE_FILE) { $missing += 'GD_KEYSTORE_FILE' }
    if (-not $env:GD_KEYSTORE_PASSWORD) { $missing += 'GD_KEYSTORE_PASSWORD' }
    if (-not $env:GD_KEY_ALIAS) { $missing += 'GD_KEY_ALIAS' }
    if ($missing) {
        $sync = 'C:\Users\Admin\Downloads\automata-private\tools\env-sync.ps1'
        throw "release signing env missing ($($missing -join ', ')). expected them in $EnvFile (gitignored). restore from the vault: pwsh $sync -Repo glitchdraft"
    }
    if (-not (Test-Path $env:GD_KEYSTORE_FILE)) {
        $sync = 'C:\Users\Admin\Downloads\automata-private\tools\env-sync.ps1'
        throw "keystore not found at $($env:GD_KEYSTORE_FILE). restore it from the vault: pwsh $sync -Repo glitchdraft"
    }
    Write-Host "release signing: $($env:GD_KEYSTORE_FILE) (alias $($env:GD_KEY_ALIAS))"
}

switch ($Command) {
    'run' {
        Invoke-Gradle @('installDebug')
        $adb = Get-Command adb -ErrorAction SilentlyContinue
        if (-not $adb) { throw 'adb not found on PATH (scoop android-clt provides it)' }
        & $adb.Source shell am start -n com.fahad.glitchdraft.lsposed/.ui.MainActivity
        if ($LASTEXITCODE -ne 0) { throw "adb am start failed with exit code $LASTEXITCODE" }
        Write-Host 'installed + launched com.fahad.glitchdraft.lsposed/.ui.MainActivity'
    }
    'release' {
        Assert-SigningEnv (Import-SigningEnv)
        Invoke-Gradle @('assembleRelease')
    }
    'release-apk' {
        Assert-SigningEnv (Import-SigningEnv)
        Invoke-Gradle @('assembleRelease')
        $releaseDir = Join-Path $project 'app\build\outputs\apk\release'
        $apks = Get-ChildItem $releaseDir -Filter '*.apk' -ErrorAction SilentlyContinue
        $signed = $apks | Where-Object { $_.Name -notlike '*unsigned*' } | Select-Object -First 1
        if (-not $signed) {
            $unsigned = $apks | Where-Object { $_.Name -like '*unsigned*' } | Select-Object -First 1
            if ($unsigned) {
                throw "release apk is unsigned ($($unsigned.FullName)) — GD_KEYSTORE_* did not reach gradle (env vars must come from tools/android.ps1, not a bare gradlew call). signed builds start at 'pwsh tools/android.ps1 release-apk'; debug sideload stays available via 'pwsh tools/android.ps1 run'."
            }
            throw "no apk produced in $releaseDir"
        }
        $destDir = Join-Path $repo 'backend\public'
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        $dest = Join-Path $destDir 'glitchdraft.apk'
        Copy-Item $signed.FullName $dest -Force
        Write-Host "copied $($signed.Name) -> $dest"
    }
}
