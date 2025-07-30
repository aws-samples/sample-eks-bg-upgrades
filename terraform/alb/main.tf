provider "aws" {
  region = var.region
}

locals {
  name = var.environment_name

  tags = {
    Name = local.name
  }
}

# ALB Setup
resource "aws_security_group" "alb" {
  name        = "${local.name}-alb-sg"
  description = "Security group for ALB"
  vpc_id      = data.terraform_remote_state.vpc.outputs.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP web traffic"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS web traffic"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  tags = local.tags
}

resource "aws_lb" "this" {
  name               = "${local.name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.terraform_remote_state.vpc.outputs.public_subnets

  tags = local.tags
}

# ALB Target Group Setup
resource "aws_lb_target_group" "tg_1" {
  name        = "${local.name}-alb-tg-1"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.terraform_remote_state.vpc.outputs.vpc_id

  tags = merge(local.tags, {
    "eks:eks-cluster-name" = "${local.name}-cluster-1"
  })
}

resource "aws_lb_target_group" "tg_2" {
  name        = "${local.name}-alb-tg-2"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.terraform_remote_state.vpc.outputs.vpc_id

  tags = merge(local.tags, {
    "eks:eks-cluster-name" = "${local.name}-cluster-2"
  })
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "forward"
    forward {
      target_group {
        arn    = aws_lb_target_group.tg_1.arn
        weight = tonumber(var.target_group_1_weight)
      }
      target_group {
        arn    = aws_lb_target_group.tg_2.arn
        weight = tonumber(var.target_group_2_weight)
      }
    }
  }
}

# Internal Test Setup
resource "aws_lb_listener_rule" "internal_test_header" {
  count        = var.enable_internal_test == "true" ? 1 : 0
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type = "forward"
    # Select the target group based on the current green cluster
    target_group_arn = var.target_group_1_weight == "100" ? aws_lb_target_group.tg_2.arn : aws_lb_target_group.tg_1.arn
  }

  condition {
    http_header {
      http_header_name = "X-Internal-Test"
      values           = ["true"]
    }
  }
}

resource "aws_lb_listener_rule" "internal_test_query" {
  count        = var.enable_internal_test == "true" ? 1 : 0
  listener_arn = aws_lb_listener.http.arn
  priority     = 20

  action {
    type = "forward"
    # Select the target group based on the current green cluster
    target_group_arn = var.target_group_1_weight == "100" ? aws_lb_target_group.tg_2.arn : aws_lb_target_group.tg_1.arn
  }

  condition {
    query_string {
      key   = "internal"
      value = "true"
    }
  }
}
