# IAM configuration for GitLab instance
# This provides the GitLab instance with the same AWS permissions as the current user

# Get current user identity and policies
data "aws_caller_identity" "current" {}

# Extract username from ARN (handles both user and assumed role ARNs)
locals {
  # For user ARN: arn:aws:iam::123456789012:user/username
  # For assumed role ARN: arn:aws:sts::123456789012:assumed-role/role-name/session-name
  arn_parts = split("/", data.aws_caller_identity.current.arn)
  username = length(local.arn_parts) >= 2 ? local.arn_parts[1] : null
  is_user = startswith(data.aws_caller_identity.current.arn, "arn:aws:iam::")
}

# Create IAM role for GitLab instance
resource "aws_iam_role" "gitlab_instance_role" {
  name = "gitlab-instance-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "gitlab-instance-role"
  }
}

# Temporarily using AdministratorAccess for testing
# TODO: Replace with minimal permissions once workflow is validated
resource "aws_iam_role_policy_attachment" "gitlab_admin_access" {
  role       = aws_iam_role.gitlab_instance_role.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# Commented out minimal permissions policy for later use
/*
resource "aws_iam_role_policy" "gitlab_minimal_permissions" {
  name  = "gitlab-minimal-permissions"
  role  = aws_iam_role.gitlab_instance_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          # S3 permissions for Terraform state
          "s3:*",
          # EC2 and VPC permissions for infrastructure
          "ec2:*",
          "vpc:*",
          # EKS permissions for cluster management
          "eks:*",
          # IAM permissions for role management
          "iam:PassRole",
          "iam:GetRole",
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:CreateInstanceProfile",
          "iam:DeleteInstanceProfile",
          "iam:AddRoleToInstanceProfile",
          "iam:RemoveRoleFromInstanceProfile",
          # Additional IAM permissions for EKS cluster creation
          "iam:CreatePolicy",
          "iam:DeletePolicy",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListPolicyVersions",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:GetRolePolicy",
          "iam:ListInstanceProfilesForRole",
          # OIDC Provider permissions for EKS Pod Identity
          "iam:CreateOpenIDConnectProvider",
          "iam:DeleteOpenIDConnectProvider",
          "iam:GetOpenIDConnectProvider",
          "iam:ListOpenIDConnectProviders",
          "iam:TagOpenIDConnectProvider",
          "iam:UntagOpenIDConnectProvider",
          # ALB permissions
          "elasticloadbalancing:*",
          # Route53 permissions (if needed)
          "route53:*",
          # CloudFormation permissions (for EKS add-ons)
          "cloudformation:*",
          # CloudWatch Logs permissions for EKS
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:DescribeLogGroups",
          "logs:PutRetentionPolicy",
          "logs:TagLogGroup",
          "logs:UntagLogGroup",
          "logs:ListTagsForResource",
          "logs:TagResource",
          "logs:UntagResource",
          # KMS permissions for EKS encryption
          "kms:*",
          # SQS permissions for Karpenter
          "sqs:*",
          # EventBridge permissions for Karpenter
          "events:*",
          # STS permissions
          "sts:GetCallerIdentity",
          "sts:AssumeRole"
        ]
        Resource = "*"
      }
    ]
  })
}
*/

# Create instance profile
resource "aws_iam_instance_profile" "gitlab_instance_profile" {
  name = "gitlab-instance-profile"
  role = aws_iam_role.gitlab_instance_role.name

  tags = {
    Name = "gitlab-instance-profile"
  }
}

# Output the instance profile name for use in main.tf
output "gitlab_instance_profile_name" {
  description = "Name of the IAM instance profile for GitLab"
  value       = aws_iam_instance_profile.gitlab_instance_profile.name
}
