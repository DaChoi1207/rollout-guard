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
