# AWS demo environment

This Terraform configuration creates the execution layer used by Rollout
Guard: a two-AZ public VPC, an Application Load Balancer with stable and
candidate target groups, and two ECS Fargate services. The candidate starts at
zero tasks and the controller scales it up when a rollout begins.

## Prerequisites

- Terraform 1.8 or newer
- AWS CLI credentials for a sandbox account
- Stable and candidate demo-service images pushed to ECR

Copy `terraform.tfvars.example` to `terraform.tfvars`, replace the image URIs,
then review the plan:

```powershell
terraform init
terraform fmt -check
terraform validate
terraform plan
```

Do not apply this configuration casually: the ALB, Fargate tasks, and public
IPv4 addresses can incur AWS charges.

After apply, use `terraform output` to populate the AWS worker environment:

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
