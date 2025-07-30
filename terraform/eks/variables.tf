variable "remote_state_bucket" {
  description = "Name of the S3 bucket storing the remote state"
  type        = string
}

variable "region" {
  description = "region"
  default     = "ap-southeast-1"
  type        = string
}

variable "kubernetes_version" {
  description = "EKS version"
  type        = string
  default     = "1.31"
}

variable "cluster_name" {
  description = "region"
  default     = "cluster-placeholder"
  type        = string
}

variable "eks_admin_role_name" {
  description = "EKS admin role"
  type        = string
  default     = "Admin"
}

variable "addons" {
  description = "EKS addons"
  type        = any
  default = {
    enable_aws_argocd = false
    # AWS Load Balancer Controller and Karpenter are now managed by Auto Mode
  }
}

variable "authentication_mode" {
  description = "The authentication mode for the cluster. Valid values are CONFIG_MAP, API or API_AND_CONFIG_MAP"
  type        = string
  default     = "API_AND_CONFIG_MAP"
}

variable "subnet_set" {
  description = "The set of subnet to use for the EKS cluster (1 for cluster-1-private-subnet-*, 2 for cluster-2-private-subnet-*)"
  type        = number
  default     = 1
}

variable "secret_name_git_data_addons" {
  description = "Secret name for Git data addons"
  type        = string
  default     = "eks-blueprints-workshop-gitops-addons"
}

variable "secret_name_git_data_platform" {
  description = "Secret name for Git data platform"
  type        = string
  default     = "eks-blueprints-workshop-gitops-platform"
}

variable "secret_name_git_data_workloads" {
  description = "Secret name for Git data workloads"
  type        = string
  default     = "eks-blueprints-workshop-gitops-workloads"
}

variable "gitlab_username" {
  description = "GitLab username for repository access"
  type        = string
  default     = "root"
}

variable "gitlab_password" {
  description = "GitLab password for repository access"
  type        = string
  sensitive   = true
  default     = ""
}

variable "revision_override" {
  description = "Override the Git revision to use for ArgoCD"
  type        = string
  default     = ""
}

variable "cluster_role" {
  description = "The role of this cluster (blue or green)"
  type        = string
  default     = "blue"

  validation {
    condition     = contains(["blue", "green"], var.cluster_role)
    error_message = "Cluster role must be either 'blue' or 'green'."
  }
}
