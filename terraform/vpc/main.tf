data "aws_availability_zones" "available" {
  # Do not include local zones
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  name   = var.environment_name
  region = var.region

  vpc_cidr = var.vpc_cidr
  azs      = slice(data.aws_availability_zones.available.names, 0, 2)
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.18.1"

  name = local.name
  cidr = local.vpc_cidr
  azs  = local.azs

  public_subnets = [for k, v in local.azs : cidrsubnet(var.public_subnets, 1, k)]
  public_subnet_names = [
    "${local.name}-public-subnet-1",
    "${local.name}-public-subnet-2",
  ]
  private_subnets = concat(
    [for k, v in local.azs : cidrsubnet(var.cluster_1_private_subnets, 1, k)],
    [for k, v in local.azs : cidrsubnet(var.cluster_2_private_subnets, 1, k)],
    [for k, v in local.azs : cidrsubnet(var.db_subnets, 1, k)],
  )
  private_subnet_names = [
    "${local.name}-cluster-1-private-subnet-1",
    "${local.name}-cluster-1-private-subnet-2",
    "${local.name}-cluster-2-private-subnet-1",
    "${local.name}-cluster-2-private-subnet-2",
    "${local.name}-database-private-subnet-1",
    "${local.name}-database-private-subnet-2",
  ]

  enable_nat_gateway = true
  single_nat_gateway = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
    # Removed generic Karpenter discovery tag - will use specific tags per subnet group
  }
}

# Add cluster-specific Karpenter discovery tags to subnets
resource "aws_ec2_tag" "blue_cluster_subnet_tags" {
  count       = 2 # First two private subnets are for cluster-1
  resource_id = module.vpc.private_subnets[count.index]
  key         = "karpenter.sh/discovery"
  value       = "eks-upgrade-cluster-1"
}

resource "aws_ec2_tag" "green_cluster_subnet_tags" {
  count       = 2 # Next two private subnets are for cluster-2
  resource_id = module.vpc.private_subnets[count.index + 2]
  key         = "karpenter.sh/discovery"
  value       = "eks-upgrade-cluster-2"
}
