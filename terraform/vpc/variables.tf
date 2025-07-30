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

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnets" {
  description = "Public Subnets"
  type        = string
  default     = "10.0.0.0/20"
}

variable "cluster_1_private_subnets" {
  description = "Cluster 1 Private Subnets"
  type        = string
  default     = "10.0.16.0/20"
}

variable "cluster_2_private_subnets" {
  description = "Cluster 2 Private Subnets"
  type        = string
  default     = "10.0.32.0/20"
}

variable "db_subnets" {
  description = "Database Subnet"
  type        = string
  default     = "10.0.48.0/20"
}
