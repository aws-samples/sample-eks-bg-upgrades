output "dns_name" {
  description = "The DNS name of the load balancer"
  value       = aws_lb.this.dns_name
}

output "target_group_1_arn" {
  description = "ARN of the target group 1"
  value       = aws_lb_target_group.tg_1.arn
}

output "target_group_2_arn" {
  description = "ARN of the target group 2"
  value       = aws_lb_target_group.tg_2.arn
}

output "security_group_id" {
  description = "ID of the security group"
  value       = aws_security_group.alb.id
}
