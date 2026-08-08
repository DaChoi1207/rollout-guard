[CmdletBinding()]
param(
  [string]$Region = "us-east-1",
  [string]$ProjectName = "rollout-guard",
  [string]$Profile = "",
  [switch]$Force
)

. (Join-Path $PSScriptRoot "aws-common.ps1")
Assert-Command aws
Assert-Command terraform
Set-AwsProfile $Profile

if (-not $Force) {
  $confirmation = Read-Host "Type DESTROY to remove the AWS demo and stop its recurring charges"
  if ($confirmation -cne "DESTROY") {
    throw "AWS teardown cancelled."
  }
}

$pidFile = Join-Path $script:ProjectRoot ".aws-worker.pid"
if (Test-Path $pidFile) {
  $workerProcessId = [int](Get-Content $pidFile)
  Stop-Process -Id $workerProcessId -ErrorAction SilentlyContinue
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

$terraformVariables = Get-TerraformVariables -Region $Region -ProjectName $ProjectName
Invoke-Checked terraform "-chdir=$script:TerraformDirectory" destroy -input=false -auto-approve @terraformVariables

Remove-Item (Join-Path $script:ProjectRoot ".aws-demo.env") -ErrorAction SilentlyContinue
Write-Host "AWS demo infrastructure was destroyed. Check AWS Billing to confirm no unexpected resources remain."
