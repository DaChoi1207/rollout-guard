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

variable "stable_image" {
  description = "Container image URI for the stable revision."
  type        = string
}

variable "candidate_image" {
  description = "Container image URI for the candidate revision."
  type        = string
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
