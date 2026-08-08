[CmdletBinding()]
param(
  [string]$Region = "us-east-1",
  [string]$ProjectName = "rollout-guard",
  [string]$Profile = "",
  [Parameter(Mandatory)][string]$BudgetEmail,
  [switch]$Apply,
  [switch]$AutoApprove
)

. (Join-Path $PSScriptRoot "aws-common.ps1")

Assert-Command aws
Assert-Command docker
Assert-Command terraform
Set-AwsProfile $Profile

$identity = & aws sts get-caller-identity --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
  throw "AWS authentication failed. Configure or sign in to the selected profile."
}
Write-Host "AWS account: $($identity.Account)"
Write-Host "Region:      $Region"
Write-Host "Project:     $ProjectName"

$terraformVariables = Get-TerraformVariables -Region $Region -ProjectName $ProjectName -BudgetEmail $BudgetEmail
Invoke-Checked terraform "-chdir=$script:TerraformDirectory" init -input=false
Invoke-Checked terraform "-chdir=$script:TerraformDirectory" fmt -check
Invoke-Checked terraform "-chdir=$script:TerraformDirectory" validate
Invoke-Checked terraform "-chdir=$script:TerraformDirectory" plan -input=false @terraformVariables

if (-not $Apply) {
  Write-Host ""
  Write-Host "Plan-only mode complete. No AWS resources were created."
  Write-Host "Rerun with -Apply when you are ready to create billable resources."
  exit 0
}

if (-not $AutoApprove) {
  $confirmation = Read-Host "Type APPLY to create billable AWS resources"
  if ($confirmation -cne "APPLY") {
    throw "AWS deployment cancelled."
  }
}

# Bootstrap ECR first so the image exists before ECS starts its stable task.
Invoke-Checked terraform "-chdir=$script:TerraformDirectory" apply -input=false -auto-approve "-target=aws_ecr_repository.demo" @terraformVariables
$repositoryUrl = Get-TerraformOutput "ecr_repository_url"
$registry = $repositoryUrl.Split('/')[0]

Write-Host "Authenticating Docker with $registry"
$password = & aws ecr get-login-password --region $Region
if ($LASTEXITCODE -ne 0) { throw "Could not obtain an ECR login token." }
$password | docker login --username AWS --password-stdin $registry
if ($LASTEXITCODE -ne 0) { throw "Docker could not authenticate with ECR." }

Push-Location $script:ProjectRoot
try {
  Invoke-Checked docker build --file apps/demo-service/Dockerfile --tag "${repositoryUrl}:stable" .
  Invoke-Checked docker tag "${repositoryUrl}:stable" "${repositoryUrl}:candidate"
  Invoke-Checked docker push "${repositoryUrl}:stable"
  Invoke-Checked docker push "${repositoryUrl}:candidate"
} finally {
  Pop-Location
}

$planPath = Join-Path $script:TerraformDirectory "demo.tfplan"
Invoke-Checked terraform "-chdir=$script:TerraformDirectory" plan -input=false "-out=$planPath" @terraformVariables
Invoke-Checked terraform "-chdir=$script:TerraformDirectory" apply -input=false $planPath

$environment = @(
  "AWS_REGION=$Region",
  "ECS_CLUSTER=$(Get-TerraformOutput 'ecs_cluster')",
  "ALB_LISTENER_ARN=$(Get-TerraformOutput 'listener_arn')",
  "ALB_LOAD_BALANCER_DIMENSION=$(Get-TerraformOutput 'load_balancer_dimension')",
  "STABLE_ECS_SERVICE=$(Get-TerraformOutput 'stable_service')",
  "STABLE_TARGET_GROUP_ARN=$(Get-TerraformOutput 'stable_target_group_arn')",
  "STABLE_TARGET_GROUP_DIMENSION=$(Get-TerraformOutput 'stable_target_group_dimension')",
  "CANDIDATE_ECS_SERVICE=$(Get-TerraformOutput 'candidate_service')",
  "CANDIDATE_TARGET_GROUP_ARN=$(Get-TerraformOutput 'candidate_target_group_arn')",
  "CANDIDATE_TARGET_GROUP_DIMENSION=$(Get-TerraformOutput 'candidate_target_group_dimension')"
)
$environment | Set-Content (Join-Path $script:ProjectRoot ".aws-demo.env")

Write-Host ""
Write-Host "AWS demo infrastructure is ready."
Write-Host "Application: $(Get-TerraformOutput 'application_url')"
Write-Host "Next: .\scripts\aws-demo-run.ps1"
