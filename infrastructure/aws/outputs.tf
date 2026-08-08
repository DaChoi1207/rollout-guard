output "application_url" {
  value = "http://${aws_lb.demo.dns_name}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.demo.repository_url
}

output "rollout_worker_policy_arn" {
  description = "Policy to attach to the identity that runs the AWS rollout worker."
  value       = aws_iam_policy.rollout_worker.arn
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "listener_arn" {
  value = aws_lb_listener.http.arn
}

output "stable_service" {
  value = aws_ecs_service.revision["stable"].name
}

output "candidate_service" {
  value = aws_ecs_service.revision["candidate"].name
}

output "stable_target_group_arn" {
  value = aws_lb_target_group.stable.arn
}

output "candidate_target_group_arn" {
  value = aws_lb_target_group.candidate.arn
}

output "load_balancer_dimension" {
  description = "CloudWatch LoadBalancer dimension consumed by the AWS worker."
  value       = aws_lb.demo.arn_suffix
}

output "stable_target_group_dimension" {
  value = aws_lb_target_group.stable.arn_suffix
}

output "candidate_target_group_dimension" {
  value = aws_lb_target_group.candidate.arn_suffix
}
