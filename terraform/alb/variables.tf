variable "remote_state_bucket" {
  description = "Name of the S3 bucket storing the remote state"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-southeast-1"
}

variable "environment_name" {
  description = "The name of environment infrastructure stack."
  type        = string
  default     = "eks-upgrade"
}

variable "target_group_1_weight" {
  description = "Weight for target group 1"
  type        = string
  default     = "100"
}

variable "target_group_2_weight" {
  description = "Weight for target group 2"
  type        = string
  default     = "0"
}

variable "enable_internal_test" {
  description = "Enable internal testing"
  type        = string
  default     = "false"
}
