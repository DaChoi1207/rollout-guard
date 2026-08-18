[CmdletBinding()]
param(
  [string]$Profile = "",
  [int]$RequestsPerSecond = 25,
  [int]$DurationSeconds = 240
)

. (Join-Path $PSScriptRoot "aws-common.ps1")
Assert-Command aws
Assert-Command docker
Assert-Command npm.cmd
Set-AwsProfile $Profile

$environmentFile = Join-Path $script:ProjectRoot ".aws-demo.env"
if (-not (Test-Path $environmentFile)) {
  throw ".aws-demo.env is missing. Run aws-demo-up.ps1 -Apply first."
}
foreach ($line in Get-Content $environmentFile) {
  if ($line -match '^([^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
  }
}

$env:DATABASE_URL = "postgresql://rollout_guard:rollout_guard@localhost:5432/rollout_guard"
$env:STABLE_REVISION_ID = "v1"
$env:CANDIDATE_REVISION_ID = "v2"
$env:SERVICE_NAME = "aws-demo-service"

Push-Location $script:ProjectRoot
try {
  # Use the long form because PowerShell advanced functions can interpret -d
  # as the common -Debug parameter before it reaches Docker Compose.
  Invoke-Checked docker compose up --detach postgres
  Invoke-Checked npm.cmd run db:migrate
  Invoke-Checked npm.cmd run build --workspace "@rollout-guard/aws-rollout-worker"
  Invoke-Checked npm.cmd run deployment:create

  $worker = Start-Process npm.cmd -ArgumentList "run", "start", "--workspace", "@rollout-guard/aws-rollout-worker" -PassThru -WindowStyle Hidden -RedirectStandardOutput "aws-worker.log" -RedirectStandardError "aws-worker-error.log"
  $worker.Id | Set-Content ".aws-worker.pid"
  Write-Host "AWS rollout worker started as process $($worker.Id)."

  $target = "$(Get-TerraformOutput 'application_url')/api/demo"
  Invoke-Checked npm.cmd run start --workspace "@rollout-guard/load-generator" -- --target $target --requests-per-second $RequestsPerSecond --duration-seconds $DurationSeconds --concurrency 10
  Write-Host "Rollout traffic finished. Use .\scripts\aws-demo-status.ps1 to inspect AWS state."
} finally {
  Pop-Location
}
