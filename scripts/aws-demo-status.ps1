[CmdletBinding()]
param([string]$Profile = "")

. (Join-Path $PSScriptRoot "aws-common.ps1")
Assert-Command aws
Assert-Command terraform
Set-AwsProfile $Profile

$cluster = Get-TerraformOutput "ecs_cluster"
$stable = Get-TerraformOutput "stable_service"
$candidate = Get-TerraformOutput "candidate_service"
$url = Get-TerraformOutput "application_url"

Write-Host "Application: $url"
Invoke-Checked aws ecs describe-services --cluster $cluster --services $stable $candidate --query "services[].{Service:serviceName,Desired:desiredCount,Running:runningCount,Pending:pendingCount}" --output table
Invoke-Checked aws elbv2 describe-listeners --listener-arns (Get-TerraformOutput "listener_arn") --query "Listeners[0].DefaultActions[0].ForwardConfig.TargetGroups[].{TargetGroup:TargetGroupArn,Weight:Weight}" --output table

$pidFile = Join-Path $script:ProjectRoot ".aws-worker.pid"
if (Test-Path $pidFile) {
  $workerProcessId = [int](Get-Content $pidFile)
  $worker = Get-Process -Id $workerProcessId -ErrorAction SilentlyContinue
  Write-Host "AWS worker:  $(if ($worker) { "running (PID $workerProcessId)" } else { "stopped" })"
} else {
  Write-Host "AWS worker:  not started"
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
  $runningServices = & docker compose ps --status running --services 2>$null
  if ($LASTEXITCODE -eq 0 -and $runningServices -contains "postgres") {
    Write-Host ""
    Write-Host "Latest AWS deployment:"
    $deploymentQuery = @"
SELECT d.state AS state,
       d.stable_revision_id || ' -> ' || d.candidate_revision_id AS revisions,
       d.stable_weight || '/' || d.candidate_weight AS weights,
       COALESCE(d.failure_reason, '') AS failure_reason,
       d.updated_at
FROM deployments d
JOIN services s ON s.id = d.service_id
WHERE s.name = 'aws-demo-service'
ORDER BY d.created_at DESC
LIMIT 1;
"@
    Invoke-Checked docker compose exec -T postgres psql -U rollout_guard -d rollout_guard -c $deploymentQuery
  }
}

$workerLog = Join-Path $script:ProjectRoot "aws-worker.log"
if (Test-Path $workerLog) {
  $transitions = Get-Content $workerLog -Tail 100 |
    Select-String '"outcome":"TRANSITIONED"' |
    Select-Object -Last 5
  if ($transitions) {
    Write-Host "Recent worker transitions:"
    $transitions | ForEach-Object { Write-Host $_.Line }
  }
}
