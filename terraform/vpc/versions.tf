terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
    random = {
      version = ">= 3"
    }
  }

  backend "s3" {
    key                  = "vpc"
    encrypt              = true
    workspace_key_prefix = ""
  }
}
