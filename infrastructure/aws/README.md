# AWS demo environment

This Terraform configuration creates the execution layer used by Rollout
Guard: a two-AZ public VPC, an Application Load Balancer with stable and
candidate target groups, and two ECS Fargate services. The candidate starts at
zero tasks and the controller scales it up when a rollout begins.

## Prerequisites

- Terraform 1.8 or newer
- AWS CLI credentials for a sandbox account
- Docker Desktop running
- An AWS CLI profile with permission to create the demo resources

The recommended workflow uses the guarded PowerShell scripts from the project
root. Plan-only mode authenticates to AWS and previews the infrastructure but
does not create resources:

```powershell
.\scripts\aws-demo-up.ps1 -BudgetEmail "you@example.com"
```

To create the billable demo after reviewing the plan:

```powershell
.\scripts\aws-demo-up.ps1 -BudgetEmail "you@example.com" -Apply
.\scripts\aws-demo-run.ps1
.\scripts\aws-demo-status.ps1
```

The up script creates ECR first, builds the demo image once, pushes immutable
`stable` and `candidate` tags, then applies the complete reviewed plan. Runtime
behavior differs through ECS environment variables, so both revisions can use
the same image. The AWS rollout policy waits for CloudWatch's one-minute ALB
metric periods instead of using the faster local-development timing.

Always tear down the demo when finished:

```powershell
.\scripts\aws-demo-down.ps1
```

The configuration creates a $10 monthly AWS Budget when `BudgetEmail` is
provided. Budget notifications are warnings, not hard spending caps. The ALB,
Fargate tasks, and public IPv4 addresses continue to incur charges until the
infrastructure is destroyed.

After apply, the up script writes an ignored `.aws-demo.env` file from these
Terraform outputs:

```text
ECS_CLUSTER
ALB_LISTENER_ARN
ALB_LOAD_BALANCER_DIMENSION
STABLE_ECS_SERVICE
STABLE_TARGET_GROUP_ARN
STABLE_TARGET_GROUP_DIMENSION
CANDIDATE_ECS_SERVICE
CANDIDATE_TARGET_GROUP_ARN
CANDIDATE_TARGET_GROUP_DIMENSION
```

The worker uses the normal AWS SDK credential chain. Its IAM principal needs
`ecs:DescribeServices`, `ecs:UpdateService`,
`elasticloadbalancing:DescribeTargetHealth`,
`elasticloadbalancing:ModifyListener`, and `cloudwatch:GetMetricData`.
Terraform creates a least-privilege policy containing those permissions and
returns its ARN as `rollout_worker_policy_arn`; it does not automatically attach
the policy to your existing AWS identity.
