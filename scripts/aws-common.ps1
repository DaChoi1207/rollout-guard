Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:ProjectRoot = Split-Path -Parent $PSScriptRoot
$script:TerraformDirectory = Join-Path $script:ProjectRoot "infrastructure/aws"

function Assert-Command {
  param([Parameter(Mandatory)][string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' is not installed or is not on PATH."
  }
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(ValueFromRemainingArguments)][string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE."
  }
}

function Set-AwsProfile {
  param([string]$Profile)

  if ($Profile) {
    $env:AWS_PROFILE = $Profile
  }
}

function Get-TerraformVariables {
  param(
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$ProjectName,
    [string]$BudgetEmail
  )

  $variables = @(
    "-var=aws_region=$Region",
    "-var=project_name=$ProjectName"
  )
  if ($BudgetEmail) {
    $variables += "-var=budget_email=$BudgetEmail"
  }
  return $variables
}

function Get-TerraformOutput {
  param([Parameter(Mandatory)][string]$Name)

  $value = & terraform -chdir=$script:TerraformDirectory output -raw $Name
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read Terraform output '$Name'."
  }
  return $value.Trim()
}
