# Standalone Terraform for the knowledge-base Postgres (pgvector), kept out of the visual builder
# because its RDS node can't express publicly_accessible / engine_version / a security group.
#
#   cd services/agents/deploy
#   terraform init
#   terraform apply -var 'allowed_cidr=YOUR.IP.ADDR.0/24'   # lock ingress to where the Lambda egresses, or your office
#   terraform output -raw database_url                       # feed this to configure-production.sh as DATABASE_URL
#   psql "$(terraform output -raw database_url)" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
#
# db.t4g.micro, 20 GB gp3, single-AZ, publicly reachable but SG-restricted and SSL-only. ~$13/mo.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.0" }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "allowed_cidr" {
  description = "CIDR allowed to reach Postgres on 5432. A non-VPC Lambda's egress is dynamic, so this is usually 0.0.0.0/0 with the DB relying on SSL + a strong password, or your own IP for setup."
  type        = string
  default     = "0.0.0.0/0"
}

variable "identifier" {
  type    = string
  default = "infraflow-agents-kb"
}

variable "db_name" {
  type    = string
  default = "infraflow"
}

variable "username" {
  type    = string
  default = "infraflow"
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { ManagedBy = "infraflow", Component = "agents-knowledge-base" }
  }
}

data "aws_vpc" "default" {
  default = true
}

resource "random_password" "db" {
  length  = 24
  special = false # keep the connection string URL-safe
}

resource "aws_security_group" "db" {
  name        = "${var.identifier}-sg"
  description = "Postgres 5432 for the infraflow agents knowledge base"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "kb" {
  identifier             = var.identifier
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  storage_type           = "gp3"
  db_name                = var.db_name
  username               = var.username
  password               = random_password.db.result
  publicly_accessible    = true
  vpc_security_group_ids = [aws_security_group.db.id]
  skip_final_snapshot    = true
  apply_immediately      = true
  # Force TLS.
  parameter_group_name = aws_db_parameter_group.kb.name
}

resource "aws_db_parameter_group" "kb" {
  name   = "${var.identifier}-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

output "database_url" {
  description = "Pass to configure-production.sh as DATABASE_URL. Contains the generated password."
  sensitive   = true
  value       = "postgresql://${var.username}:${random_password.db.result}@${aws_db_instance.kb.address}:5432/${var.db_name}?sslmode=require"
}
