output "configure_kubectl" {
  description = "Configure kubectl command"
  value       = <<-EOT
    aws eks --region ${local.region} update-kubeconfig --name ${module.eks.cluster_name} --alias ${module.eks.cluster_name}
  EOT
}
