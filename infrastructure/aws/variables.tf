variable "aws_region" {
  description = "AWS region for the demo environment."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefix used for AWS resource names."
  type        = string
  default     = "rollout-guard"
}

variable "candidate_error_rate" {
  description = "Injected candidate error rate used by the rollback demo."
  type        = number
  default     = 0.15

  validation {
    condition     = var.candidate_error_rate >= 0 && var.candidate_error_rate <= 1
    error_message = "candidate_error_rate must be between 0 and 1."
  }
}

variable "budget_email" {
  description = "Email address for AWS Budget alerts. Null disables the budget resource."
  type        = string
  default     = null
  nullable    = true
}

variable "budget_limit_usd" {
  description = "Monthly AWS cost threshold for the demo budget."
  type        = number
  default     = 10

  validation {
    condition     = var.budget_limit_usd > 0
    error_message = "budget_limit_usd must be greater than zero."
  }
}
