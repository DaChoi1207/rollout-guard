data "aws_iam_policy_document" "rollout_worker" {
  statement {
    sid       = "ManageCandidateCapacity"
    actions   = ["ecs:DescribeServices", "ecs:UpdateService"]
    resources = [for service in aws_ecs_service.revision : service.id]
  }

  statement {
    sid       = "InspectTargetHealth"
    actions   = ["elasticloadbalancing:DescribeTargetHealth"]
    resources = ["*"]
  }

  statement {
    sid       = "ChangeTrafficWeights"
    actions   = ["elasticloadbalancing:ModifyListener"]
    resources = [aws_lb_listener.http.arn]
  }

  statement {
    sid       = "ReadDeploymentMetrics"
    actions   = ["cloudwatch:GetMetricData"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "rollout_worker" {
  name        = "${var.project_name}-rollout-worker"
  description = "Least-privilege AWS access for the Rollout Guard worker"
  policy      = data.aws_iam_policy_document.rollout_worker.json
}
