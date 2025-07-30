provider "aws" {
  region = "ap-southeast-1"
}

module "vpc" {
  source                    = "./vpc"
  environment_name          = "eks-upgrade"
  region                    = "ap-southeast-1"
  vpc_cidr                  = "10.0.0.0/16"
  public_subnets            = "10.0.0.0/20"
  cluster_1_private_subnets = "10.0.16.0/20"
  cluster_2_private_subnets = "10.0.32.0/20"
  db_subnets                = "10.0.48.0/20"
}

module "alb" {
  source           = "./alb"
  environment_name = "eks-upgrade"
  region           = "ap-southeast-1"

  target_group_1_weight = "100"
  target_group_2_weight = "0"
  enable_internal_test  = "false"
}

module "cluster-1" {
  source             = "./eks"
  cluster_name       = "cluster-1"
  kubernetes_version = "1.31"
  region             = "ap-southeast-1"
  subnet_set         = 1

  addons = {
    enable_aws_load_balancer_controller = true
  }

  eks_admin_role_name = "Admin"

  authentication_mode = "API_AND_CONFIG_MAP"
}

# Create the Green EKS cluster in private_subnet_2
module "cluster-2" {
  source             = "./eks"
  cluster_name       = "cluster-2"
  kubernetes_version = "1.32"
  region             = "ap-southeast-1"

  # Specify to use private_subnet_2
  subnet_set = 2

  # Enable AWS Load Balancer Controller for ALB integration
  addons = {
    enable_aws_load_balancer_controller = true
  }

  # Admin role for cluster access
  eks_admin_role_name = "Admin"

  # Authentication mode
  authentication_mode = "API_AND_CONFIG_MAP"
}

# Output the ALB DNS name for accessing the application
output "alb_dns_name" {
  description = "The DNS name of the load balancer"
  value       = module.alb.dns_name
}

# Output the commands to configure kubectl for both clusters
output "configure_kubectl_blue" {
  description = "Configure kubectl for the blue cluster"
  value       = module.cluster-1.configure_kubectl
}

output "configure_kubectl_green" {
  description = "Configure kubectl for the green cluster"
  value       = module.cluster-2.configure_kubectl
}
