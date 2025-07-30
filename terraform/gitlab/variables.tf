variable "remote_state_bucket" {
  description = "Name of the S3 bucket storing the remote state"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-southeast-1"
}
