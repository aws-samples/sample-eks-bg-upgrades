output "gitlab_public_ip" {
  description = "Public IP of the GitLab server"
  value       = aws_eip.gitlab_ip.public_ip
}

output "connect_vpn_server" {
  description = "Command to connect to VPN Server using SSM"
  value       = "aws ssm start-session --target ${module.ec2_instance.id} --region ${var.region}"
}

output "gitlab_instance_role_arn" {
  description = "ARN of the GitLab instance role for EKS cluster access"
  value       = aws_iam_role.gitlab_instance_role.arn
}
