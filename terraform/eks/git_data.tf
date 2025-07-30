locals {
  gitlab_ip = data.terraform_remote_state.gitlab.outputs.gitlab_public_ip

  # If revision_override is provided, use that instead
  revision = var.revision_override != "" ? var.revision_override : "main"

  gitops_addons_url      = "http://${local.gitlab_ip}/root/gitops.git"
  gitops_addons_basepath = "addons/"
  gitops_addons_path     = "bootstrap"
  gitops_addons_revision = local.revision

  gitops_platform_url      = "http://${local.gitlab_ip}/root/gitops.git"
  gitops_platform_basepath = "bootstrap/"
  gitops_platform_path     = ""
  gitops_platform_revision = local.revision

  gitops_workload_url      = "http://${local.gitlab_ip}/root/gitops.git"
  gitops_workload_basepath = "workload/"
  gitops_workload_path     = ""
  gitops_workload_revision = local.revision
}
