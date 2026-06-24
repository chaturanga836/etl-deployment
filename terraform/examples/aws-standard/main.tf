# AWS reference architecture (skeleton) — Phase 3
# Apply after Helm chart values are validated.
#
# Usage:
#   cd terraform/examples/aws-standard
#   cp terraform.tfvars.example terraform.tfvars
#   terraform init && terraform plan

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "cluster_name" {
  type    = string
  default = "elt-platform"
}

variable "db_username" {
  type    = string
  default = "elt_admin"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "helm_release_name" {
  type    = string
  default = "elt-platform"
}

variable "helm_chart_path" {
  type    = string
  default = "../../../charts/elt-platform"
}

# --- Placeholder outputs for Helm wiring ---
# Expand with modules: network, eks, rds, elasticache

output "next_steps" {
  value = <<-EOT
    This is a skeleton. Implement modules for:
      - VPC + subnets
      - EKS cluster + node groups
      - RDS (metadata Postgres)
      - ElastiCache (Redis)
      - helm_release using var.helm_chart_path

    Pass to Helm values:
      database.url = postgresql://...@rds-endpoint:5432/elt_metadata
      redis.url      = redis://elasticache-endpoint:6379/0
  EOT
}
