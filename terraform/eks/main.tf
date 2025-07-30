
data "aws_caller_identity" "current" {}

locals {
  name            = var.cluster_name
  cluster_version = var.kubernetes_version
  region          = var.region
  vpc_id          = data.terraform_remote_state.vpc.outputs.vpc_id
  # Select the appropriate subnets based on the subnet_set variable
  private_subnet = var.subnet_set == 1 ? slice(data.terraform_remote_state.vpc.outputs.private_subnets, 0, 2) : slice(data.terraform_remote_state.vpc.outputs.private_subnets, 2, 4)
}

data "aws_iam_role" "eks_admin_role_name" {
  name = var.eks_admin_role_name
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.24"

  cluster_name                   = local.name
  cluster_version                = local.cluster_version
  cluster_endpoint_public_access = true

  enable_cluster_creator_admin_permissions = true
  access_entries = {
    eks_admin = {
      principal_arn = data.aws_iam_role.eks_admin_role_name.arn
      policy_associations = {
        argocd = {
          policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = {
            type = "cluster"
          }
        }
      }
    }
  }

  vpc_id     = local.vpc_id
  subnet_ids = local.private_subnet

  # Enable EKS Auto Mode
  cluster_compute_config = {
    enabled    = true
    node_pools = ["general-purpose"]
  }

}

# Security group rule for ALB to node communication (required for blue/green deployment)
resource "aws_security_group_rule" "alb_to_node_3000" {
  type                     = "ingress"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  source_security_group_id = data.terraform_remote_state.alb.outputs.security_group_id
  security_group_id        = module.eks.cluster_primary_security_group_id
  description              = "ALB to node port 3000 for blue/green deployment"
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", local.region]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)

    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", local.region]
    }
  }
}
