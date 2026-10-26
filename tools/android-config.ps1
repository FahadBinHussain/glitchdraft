# config helper for the GlitchDraft LSPosed module.
#
#   pwsh tools/android-config.ps1            push config into every scoped app
#   pwsh tools/android-config.ps1 -Package xyz.nextalone.nagram
#   pwsh tools/android-config.ps1 -Show      print what is currently pushed
#
# why this exists: the module serves its Neon config to hooked apps through
# ConfigProvider (content://com.fahad.glitchdraft.lsposed.config/firebase), but
# Android 11 package visibility hides that provider from any app without a
# <queries> entry for us - nagram is one, so its panel could not save drafts
# (readConfig() returned null). the fallback-free fix is a channel nothing can
# filter: a json file inside the target app's OWN filesDir, written here as
# root and read by ModuleConfig.kt in-process.
#
#   <target>/files/glitchdraft_config.json
#   {"neon_api_base_url":"…","neon_api_key":"…","pushed_at":"…"}
#
# re-run this after changing the config in the module app. the hook logs
# `config file <path> loaded=true … pushed=<ts>` and the panel header shows a
# ` [file]` marker while this channel is the one serving config.
#
# gotchas (opencode pwsh uses legacy native-arg passing):
#  - `adb shell su -c "a && b > c"` is re-split at spaces, so su only gets `a`
#    and the rest runs as the shell user (seen: permission denied on the
#    redirect). every root call below passes one single-quoted device command.
#  - `su 0 <cmd>` is silently ignored by this su build (exit 0, no output).
#  - anything with pipes/redirects goes through a pushed script, not argv.

param(
    [string[]]$Package,
    [switch]$Show
)

$ErrorActionPreference = 'Stop'

$ModulePackage = 'com.fahad.glitchdraft.lsposed'
$ConfigName = 'glitchdraft_config.json'
$PrefsPath = "/data/data/$ModulePackage/shared_prefs/glitchdraft_module_prefs.xml"
$VectorCli = '/data/adb/modules/zygisk_vector/cli'

function Invoke-Root {
    param([string]$Command)
    if ($Command -match "'") { throw "root command may not contain a single quote: $Command" }
    $out = & adb shell "su -c '$Command'" 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "root command failed (exit $LASTEXITCODE): su -c '$Command'`n$out"
    }
    return ($out -join "`n").Trim()
}

function Get-ScopedPackages {
    $out = Invoke-Root "$VectorCli scope ls $ModulePackage"
    $pkgs = foreach ($line in ($out -split "`r?`n")) {
        $m = [regex]::Match($line, '^\s*([A-Za-z0-9_.]+)\s+(\d+)\s*$')
        if ($m.Success) { $m.Groups[1].Value }
    }
    if (-not $pkgs) {
        throw "no scoped apps for $ModulePackage - run: adb shell `"su -c '$VectorCli scope ls $ModulePackage'`""
    }
    return @($pkgs | Sort-Object -Unique)
}

function Get-TargetConfig([string]$TargetPackage) {
    $path = "/data/data/$TargetPackage/files/$ConfigName"
    $out = & adb shell "su -c 'cat $path'" 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($out -join "`n").Trim()
}

$packages = if ($Package) { $Package } else { Get-ScopedPackages }

if ($Show) {
    foreach ($pkg in $packages) {
        $current = Get-TargetConfig $pkg
        if ($current) { "${pkg}: $current" } else { "${pkg}: (no $ConfigName)" }
    }
    return
}

# read the module's own prefs (root) - same values ConfigProvider would serve
$xml = Invoke-Root "cat $PrefsPath"
if (-not $xml) { throw "module prefs are empty: $PrefsPath" }

$base = [regex]::Match($xml, '<string name="neon_api_base_url">([^<]*)</string>').Groups[1].Value.Trim()
$key = [regex]::Match($xml, '<string name="neon_api_key">([^<]*)</string>').Groups[1].Value.Trim()
if (-not $base -or -not $key) {
    throw "module prefs at $PrefsPath are missing neon_api_base_url / neon_api_key - open the module app and save the config first"
}
$base = $base.TrimEnd('/')

$json = [ordered]@{
    neon_api_base_url = $base
    neon_api_key      = $key
    pushed_at         = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
} | ConvertTo-Json -Compress
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))

# one pushed script keeps the redirect/pipeline inside a root shell (see gotchas)
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('#!/system/bin/sh')
$lines.Add('set -eu')
foreach ($pkg in $packages) {
    $path = "/data/data/$pkg/files/$ConfigName"
    $lines.Add("echo 'pushing $pkg'")
    $lines.Add('uid=$(stat -c %u /data/data/' + $pkg + ')')
    $lines.Add('mkdir -p /data/data/' + $pkg + '/files')
    $lines.Add("echo $b64 | base64 -d > $path")
    $lines.Add('chown $uid:$uid ' + $path)
    $lines.Add('chmod 600 ' + $path)
    $lines.Add('restorecon ' + $path)
}
$localScript = Join-Path $env:TEMP 'gd-config-push.sh'
Set-Content -Path $localScript -Value (($lines -join "`n") + "`n") -NoNewline -Encoding utf8NoBOM
$remoteScript = '/data/local/tmp/gd-config-push.sh'
& adb push $localScript $remoteScript | Out-Null
if ($LASTEXITCODE -ne 0) { throw "adb push $localScript failed" }

try {
    $out = & adb shell "su -c 'sh $remoteScript'" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "config push script failed (exit $LASTEXITCODE)`n$($out -join "`n")" }
    $out | Where-Object { $_ -match '\S' } | ForEach-Object { $_ }
} finally {
    & adb shell "su -c 'rm -f $remoteScript'" | Out-Null
    Remove-Item $localScript -ErrorAction SilentlyContinue
}

$failed = @()
foreach ($pkg in $packages) {
    $written = Get-TargetConfig $pkg
    if ($written -eq $json) {
        "${pkg}: ok"
    } else {
        $failed += $pkg
        "${pkg}: MISMATCH`n  want $json`n  got  $written"
    }
}
if ($failed) { throw "config push verification failed for: $($failed -join ', ')" }

"config pushed from $base to $($packages.Count) app(s)"
