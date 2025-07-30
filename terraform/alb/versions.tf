terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
    null = {
      source  = "hashicorp/null"
      version = ">= 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6"
    }
  }

  backend "s3" {
    key                  = "alb"
    encrypt              = true
    workspace_key_prefix = ""
  }
}
