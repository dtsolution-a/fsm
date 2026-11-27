terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State is local by default. For a team / real production use, keep state in S3 instead:
  #   1. create an S3 bucket (versioned) + DynamoDB table for locking
  #   2. uncomment and fill in the block below, then run `terraform init -migrate-state`
  #
  # backend "s3" {
  #   bucket         = "your-tf-state-bucket"
  #   key            = "fsm/terraform.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "your-tf-lock-table"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
