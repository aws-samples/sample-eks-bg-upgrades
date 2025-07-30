provider "aws" {
  region = var.region
}

# Get default VPC
data "aws_vpc" "default" {
  default = true
}

# Get default subnets
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Get availability zones for default subnets
data "aws_subnet" "default" {
  for_each = toset(data.aws_subnets.default.ids)
  id       = each.value
}

# Check if IGW exists for default VPC
data "aws_internet_gateway" "default" {
  filter {
    name   = "attachment.vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Get the IGW ID
locals {
  igw_id = data.aws_internet_gateway.default.id
}

# Get main route table for default VPC
data "aws_route_table" "default" {
  vpc_id = data.aws_vpc.default.id
  filter {
    name   = "association.main"
    values = ["true"]
  }
}


data "aws_ami" "ubuntu" {
  most_recent = true

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  owners = ["099720109477"]
}

resource "aws_security_group" "gitlab_sg" {
  name        = "gitlab-security-group"
  description = "Security group for GitLab server"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # GitLab SSH access (for git operations)
  ingress {
    from_port   = 2222 # Using 2222 to avoid conflict with instance SSH
    to_port     = 2222
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

module "ec2_instance" {
  source  = "terraform-aws-modules/ec2-instance/aws"
  version = "5.7.1"

  name = "gitlab-server"

  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.xlarge"
  key_name      = "gitlab-server"

  availability_zone           = data.aws_subnet.default[data.aws_subnets.default.ids[0]].availability_zone
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.gitlab_sg.id]
  associate_public_ip_address = true

  # Use our custom IAM instance profile instead of creating a new one
  create_iam_instance_profile = false
  iam_instance_profile        = aws_iam_instance_profile.gitlab_instance_profile.name

  root_block_device = [{
    volume_size = 100
    volume_type = "gp3"
  }]

  user_data = <<-EOT
    #!/bin/bash
    snap install amazon-ssm-agent --classic
    systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent.service
    systemctl start snap.amazon-ssm-agent.amazon-ssm-agent.service
  EOT
}

resource "aws_eip" "gitlab_ip" {
  instance = module.ec2_instance.id
  domain   = "vpc"
}

resource "local_file" "setup_node" {
  content = templatefile("${path.module}/gitlab/docker-compose.yml.tpl", {
    PUBLIC_IP = aws_eip.gitlab_ip.public_ip
  })
  filename = "${path.module}/gitlab/docker-compose.yml"
}
