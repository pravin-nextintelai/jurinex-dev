# Deploy judgement-service to Cloud Run (no local Docker required).
# Cloud Build builds from source using the Dockerfile in this folder.
#
# Every variable in judgement.env (or the file named by $env:JUDGEMENT_ENV_FILE)
# is pushed to the service through --env-vars-file, which REPLACES the service's
# env var set, so the running revision always mirrors the file exactly.
# PORT is skipped: Cloud Run reserves it and injects 8080 itself
# (config.py already listens on the injected PORT).
#
# Prerequisites: gcloud CLI, `gcloud auth login`, a project selected
#                (defaults to structured-document-processing; override with $env:GCP_PROJECT).
# Usage:  .\deploy.ps1            # build + deploy
#         .\deploy.ps1 -DryRun    # show the env keys + gcloud command, deploy nothing
#
# Optional overrides (env vars): JUDGEMENT_SERVICE_NAME, CLOUD_RUN_REGION, GCP_PROJECT,
#   JUDGEMENT_ENV_FILE, CLOUD_RUN_TIMEOUT_SECONDS, CLOUD_RUN_MEMORY, CLOUD_RUN_CPU,
#   CLOUD_RUN_MIN_INSTANCES, CLOUD_RUN_MAX_INSTANCES.
# On an EXISTING service the CPU/memory/instances/timeout are left untouched unless
# the matching override is set; on first creation the defaults below are applied.

[CmdletBinding()]
param([switch]$DryRun, [string]$EnvYamlOut)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$ServiceName = if ($env:JUDGEMENT_SERVICE_NAME) { $env:JUDGEMENT_SERVICE_NAME } else { "judgement-service" }
$Region      = if ($env:CLOUD_RUN_REGION)       { $env:CLOUD_RUN_REGION }       else { "asia-south1" }
$Project     = if ($env:GCP_PROJECT)            { $env:GCP_PROJECT }            else { "structured-document-processing" }  # project 120280829617
$EnvFile     = if ($env:JUDGEMENT_ENV_FILE)     { $env:JUDGEMENT_ENV_FILE }     else { "judgement.env" }

$Defaults = @{
    Timeout      = "900"
    Memory       = "2Gi"
    Cpu          = "2"
    MinInstances = "0"
    MaxInstances = "10"
}

# Cloud Run rejects these names in --env-vars-file (it injects them itself).
$ReservedKeys = @("PORT", "K_SERVICE", "K_REVISION", "K_CONFIGURATION")

if (-not (Test-Path $EnvFile)) { throw "Env file not found: $EnvFile (run from the service folder or set JUDGEMENT_ENV_FILE)" }

# ---------------------------------------------------------------------------
# dotenv -> YAML mapping for --env-vars-file
# ---------------------------------------------------------------------------
$values  = @{}
$order   = New-Object System.Collections.Generic.List[string]
$skipped = New-Object System.Collections.Generic.List[string]

foreach ($raw in (Get-Content $EnvFile -Encoding UTF8)) {
    $line = $raw.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { continue }
    if ($line.StartsWith("export ")) { $line = $line.Substring(7).Trim() }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { continue }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
    if ($val.Length -ge 2) {
        $first = $val[0]; $last = $val[$val.Length - 1]
        if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
            $val = $val.Substring(1, $val.Length - 2)
        }
    }
    if ($ReservedKeys -contains $key) { if (-not $skipped.Contains($key)) { $skipped.Add($key) }; continue }
    if (-not $values.ContainsKey($key)) { $order.Add($key) }   # last duplicate wins, like dotenv
    $values[$key] = $val
}

if ($order.Count -eq 0) { throw "No variables parsed from $EnvFile" }

$yaml = New-Object System.Text.StringBuilder
foreach ($k in $order) {
    $esc = $values[$k].Replace('\', '\').Replace('"', '\"')
    [void]$yaml.AppendLine("${k}: `"$esc`"")
}

$EnvYamlPath = if ($EnvYamlOut) { $EnvYamlOut } else { Join-Path $env:TEMP ("judgement-env-{0}.yaml" -f $PID) }
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText($EnvYamlPath, $yaml.ToString(), $utf8NoBom)

try {
    # ---------------------------------------------------------------------------
    # Does the service already exist? (decides whether sizing defaults are applied)
    # ---------------------------------------------------------------------------
    $projectArgs = @()
    if ($Project) { $projectArgs = @("--project", $Project) }

    # cmd /c keeps gcloud stderr out of PowerShell error stream (PS 5.1 NativeCommandError)
    $existing = cmd /c "gcloud run services describe $ServiceName --region $Region --platform managed --format=value(metadata.name) $($projectArgs -join ' ') 2>nul"
    $exists = ($LASTEXITCODE -eq 0 -and $existing)

    $gcloudArgs = @(
        "run", "deploy", $ServiceName,
        "--source", ".",
        "--region", $Region,
        "--platform", "managed",
        "--allow-unauthenticated",
        "--env-vars-file", $EnvYamlPath
    ) + $projectArgs

    function Add-Sizing([string]$flag, [string]$override, [string]$default) {
        if ($override) { return @($flag, $override) }
        if (-not $script:exists) { return @($flag, $default) }
        return @()
    }
    $gcloudArgs += Add-Sizing "--timeout"       $env:CLOUD_RUN_TIMEOUT_SECONDS $Defaults.Timeout
    $gcloudArgs += Add-Sizing "--memory"        $env:CLOUD_RUN_MEMORY          $Defaults.Memory
    $gcloudArgs += Add-Sizing "--cpu"           $env:CLOUD_RUN_CPU             $Defaults.Cpu
    $gcloudArgs += Add-Sizing "--min-instances" $env:CLOUD_RUN_MIN_INSTANCES   $Defaults.MinInstances
    $gcloudArgs += Add-Sizing "--max-instances" $env:CLOUD_RUN_MAX_INSTANCES   $Defaults.MaxInstances

    Write-Host "Service : $ServiceName ($Region)$(if ($Project) { " project=$Project" })"
    Write-Host "Env file: $EnvFile -> $($order.Count) variables$(if ($skipped.Count) { " (skipped reserved: $($skipped -join ', '))" })"
    Write-Host "Exists  : $(if ($exists) { 'yes - keeping current sizing unless overridden' } else { 'no - applying default sizing' })"

    if ($DryRun) {
        Write-Host ""
        Write-Host "Variables that would be set:"
        $order | ForEach-Object { Write-Host "  $_" }
        Write-Host ""
        Write-Host "Command:"
        Write-Host ("  gcloud " + ($gcloudArgs -join " "))
        Write-Host ""
        Write-Host "(dry run - nothing deployed)"
        return
    }

    Write-Host ""
    Write-Host "Deploying from source (Cloud Build)..."
    & gcloud @gcloudArgs
    if ($LASTEXITCODE -ne 0) { throw "gcloud run deploy failed (exit $LASTEXITCODE)" }

    $url = & gcloud run services describe $ServiceName --region $Region --platform managed --format "value(status.url)" @projectArgs
    Write-Host ""
    Write-Host "Deployed: $url"
    try {
        $health = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 60
        Write-Host ("Health  : status={0} postgres={1} ikTokenRejected={2}" -f $health.status, $health.stores.postgres, $health.ikTokenRejected)
    } catch {
        Write-Warning "Health check failed: $_"
    }
}
finally {
    if (-not $EnvYamlOut -and (Test-Path $EnvYamlPath)) { Remove-Item $EnvYamlPath -Force -ErrorAction SilentlyContinue }
}
