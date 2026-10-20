terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.69"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # State bucket bootstrap/ modulida yaratiladi (bir marta). Lock — S3 native (use_lockfile).
  # `terraform init -backend-config="bucket=<bootstrap output>"` bilan beriladi.
  backend "s3" {
    key          = "cells/uz-1/staging.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

# eu-central-1 (Frankfurt): Germaniya O'zbekistonning adekvat himoya ro'yxatida — docs/ARCHITECTURE.md §4.3
provider "aws" {
  region = "eu-central-1"

  default_tags {
    tags = {
      Project     = "matchup"
      Environment = "staging"
      Cell        = "uz-1"
      ManagedBy   = "terraform"
    }
  }
}
