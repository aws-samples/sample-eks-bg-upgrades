# ArgoCD Pod Identity - Auto Mode handles the agent, we just need the role/association
module "argocd_pod_identity" {
  source = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 1.12.0"

  name = "${local.name}-argocd"

  # Custom policy for ArgoCD to assume other roles (for GitOps)
  attach_custom_policy = true
  policy_statements = [
    {
      sid       = "AssumeRolePolicy"
      actions   = ["sts:AssumeRole", "sts:TagSession"]
      resources = ["*"]
    }
  ]

  # Create Pod Identity Associations for ArgoCD components
  associations = {
    argocd_application_controller = {
      service_account = "argocd-application-controller"
      namespace       = "argocd"
      cluster_name    = module.eks.cluster_name
    }
    argocd_server = {
      service_account = "argocd-server"
      namespace       = "argocd"
      cluster_name    = module.eks.cluster_name
    }
  }

  tags = {
    Name = "${local.name}-argocd"
  }
}
