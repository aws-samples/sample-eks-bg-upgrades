data "terraform_remote_state" "vpc" {
  backend = "s3"

  config = {
    bucket = var.remote_state_bucket
    key    = "vpc"
    region = var.region
  }
}

data "terraform_remote_state" "alb" {
  backend = "s3"

  config = {
    bucket = var.remote_state_bucket
    key    = "alb"
    region = var.region
  }
}

data "terraform_remote_state" "gitlab" {
  backend = "s3"

  config = {
    bucket = var.remote_state_bucket
    key    = "gitlab"
    region = var.region
  }
}

