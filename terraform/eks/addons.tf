locals {  
  workspace_name   = terraform.workspace
  combined_name    = "${local.name}-${local.workspace_name}" # For debugging/logging
  argocd_namespace = "argocd"
  environment      = "control-plane"
  tenant           = "tenant1"
  fleet_member     = "control-plane"

  # Core addons - use values from base.tfvars
  # AWS Load Balancer Controller and Karpenter are now managed by Auto Mode
  addons = {
    enable_argocd      = try(var.addons.enable_aws_argocd, false)
    kubernetes_version = local.cluster_version
    fleet_member       = local.fleet_member
    aws_cluster_name   = module.eks.cluster_name
    tenant             = local.tenant
    workload_webstore  = true
  }

  # Simplified metadata for ArgoCD and GitOps
  addons_metadata = merge(
    module.eks_blueprints_addons.gitops_metadata,
    {
      aws_cluster_name = module.eks.cluster_name
      aws_region       = local.region
      aws_account_id   = data.aws_caller_identity.current.account_id
      aws_vpc_id       = local.vpc_id
      aws_vpc_name     = data.terraform_remote_state.vpc.outputs.vpc_name
      
      # Blue-green deployment support
      cluster_role     = var.cluster_role
      target_group_arn = var.subnet_set == 1 ? data.terraform_remote_state.alb.outputs.target_group_1_arn : data.terraform_remote_state.alb.outputs.target_group_2_arn
      
      # ArgoCD configuration
      argocd_iam_role_arn = module.argocd_pod_identity.iam_role_arn
      argocd_namespace    = local.argocd_namespace
      
      # GitOps repository configuration
      addons_repo_url      = local.gitops_addons_url
      addons_repo_basepath = local.gitops_addons_basepath
      addons_repo_path     = local.gitops_addons_path
      addons_repo_revision = local.gitops_addons_revision
      
      # Platform repository configuration for bootstrap
      gitops_platform_url      = local.gitops_platform_url
      gitops_platform_basepath = local.gitops_platform_basepath
      gitops_platform_path     = local.gitops_platform_path
      gitops_platform_revision = local.gitops_platform_revision
      
      workload_repo_url      = local.gitops_workload_url
      workload_repo_basepath = local.gitops_workload_basepath
      workload_repo_path     = local.gitops_workload_path
      workload_repo_revision = local.gitops_workload_revision
      
    }
  )
}

resource "kubernetes_namespace" "argocd" {
  metadata {
    name = local.argocd_namespace
  }
}

# // Create the appropriate target group secret based on cluster type
# resource "kubernetes_secret" "target_group_arn" {
#   depends_on = [kubernetes_namespace.argocd]

#   metadata {
#     name      = contains(local.name, "1") ? "target-group-1-arn" : "target-group-2-arn"
#     namespace = local.argocd_namespace
#   }

#   data = {
#     target_group_arn = contains(local.name, "1") ? data.terraform_remote_state.alb.outputs.target_group_1_arn : data.terraform_remote_state.alb.outputs.target_group_2_arn
#   }
# }
################################################################################
# GitOps Bridge: Bootstrap
################################################################################
module "gitops_bridge_bootstrap" {
  source  = "gitops-bridge-dev/gitops-bridge/helm"
  version = "0.1.0"
  cluster = {
    cluster_name = module.eks.cluster_name
    environment  = local.environment
    metadata     = local.addons_metadata
    addons       = local.addons
  }

  apps = local.argocd_apps
  argocd = {
    name          = "argocd"
    namespace     = local.argocd_namespace
    chart_version = "7.5.2"
    values        = [file("${path.module}/argocd-initial-values.yaml")]
    timeout       = 600
    #create_namespace = false
  }

  depends_on = [module.eks]
}

################################################################################
# EKS Blueprints Addons
################################################################################
module "eks_blueprints_addons" {
  source  = "aws-ia/eks-blueprints-addons/aws"
  version = "~> 1.16.3"

  cluster_name      = module.eks.cluster_name
  cluster_endpoint  = module.eks.cluster_endpoint
  cluster_version   = module.eks.cluster_version
  oidc_provider_arn = module.eks.oidc_provider_arn

  # Using GitOps Bridge

  create_kubernetes_resources = false
}

resource "kubernetes_secret" "git_secrets" {
  depends_on = [kubernetes_namespace.argocd]
  for_each = {
    git-addons = {
      type     = "git"
      url      = local.gitops_addons_url
      username = var.gitlab_username
      password = var.gitlab_password
    }
    git-workloads = {
      type     = "git"
      url      = local.gitops_workload_url
      username = var.gitlab_username
      password = var.gitlab_password
    }
  }
  metadata {
    name      = each.key
    namespace = kubernetes_namespace.argocd.metadata[0].name
    labels = {
      "argocd.argoproj.io/secret-type" = "repository"
    }
  }
  data = each.value
}

locals {
  argocd_apps = {
    bootstrap = file("${path.module}/bootstrap/bootstrap-applicationset.yaml")
  }
}
