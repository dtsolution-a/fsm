#!/usr/bin/env bash
# FSM deployment helper for AWS (ECS Fargate).  Run from anywhere:  bash infra/deploy.sh <command>
#
#   first-time:   bootstrap  ->  release  ->  seed
#   every update: release
#
# Needs: aws CLI (logged in), terraform >= 1.6, docker. Linux/macOS/WSL/Git Bash.
set -euo pipefail

# Git Bash on Windows rewrites arguments that start with '/' (e.g. /api/v1 -> C:/Program Files/Git/api/v1). Harmless elsewhere.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT/infra/terraform"
tf() { terraform -chdir="$TF_DIR" "$@"; }
out() { tf output -raw "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }; }

default_tag() {
  if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
    echo "$(date +%Y%m%d-%H%M%S)-$(git -C "$ROOT" rev-parse --short HEAD)"
  else
    date +%Y%m%d-%H%M%S
  fi
}

cmd_bootstrap() {
  need terraform; need aws
  tf init
  echo ">> Creating the image registries first (the services cannot start until images exist)"
  tf apply -target=aws_ecr_repository.backend -target=aws_ecr_repository.web
}

push_images() {
  local tag="$1"
  need docker; need aws
  local region backend web registry
  region="$(out aws_region)"; backend="$(out ecr_backend_url)"; web="$(out ecr_web_url)"
  registry="${backend%%/*}"
  echo ">> Logging in to ECR ($registry)"
  aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry"
  echo ">> Building backend:$tag"
  # linux/amd64 because the Fargate task definitions use X86_64 (matters when building on Apple Silicon)
  docker build --platform linux/amd64 -t "$backend:$tag" "$ROOT/backend"
  echo ">> Building web:$tag (same-origin API at /api/v1)"
  docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_API_URL=/api/v1 -t "$web:$tag" "$ROOT/web"
  docker push "$backend:$tag"
  docker push "$web:$tag"
}

cmd_release() {
  need terraform; need aws; need docker
  local tag="${1:-$(default_tag)}"
  tf init -input=false >/dev/null
  push_images "$tag"
  echo ">> Rolling out $tag (infrastructure + services)"
  tf apply -var "image_tag=$tag"
  echo ">> Waiting for services to become stable (a failed release rolls back automatically)"
  aws ecs wait services-stable --region "$(out aws_region)" --cluster "$(out ecs_cluster)" --services backend web
  echo ">> Done. App: $(out app_url)   (release tag: $tag)"
  echo "   Remember the tag. To roll back: bash infra/deploy.sh rollback <previous-tag>"
}

cmd_rollback() {
  need terraform; need aws
  local tag="${1:?usage: deploy.sh rollback <image-tag>}"
  echo ">> Re-deploying already-pushed images with tag $tag"
  tf apply -var "image_tag=$tag"
  aws ecs wait services-stable --region "$(out aws_region)" --cluster "$(out ecs_cluster)" --services backend web
  echo ">> Rolled back to $tag"
}

cmd_seed() {
  need terraform; need aws
  local region cluster
  region="$(out aws_region)"; cluster="$(out ecs_cluster)"
  echo ">> Running the one-off seed task (lookups + first admin user). Safe to run again."
  local arn
  arn="$(aws ecs run-task --region "$region" --cluster "$cluster" --launch-type FARGATE \
    --task-definition "$(out seed_task_definition)" \
    --network-configuration "awsvpcConfiguration={subnets=[$(out app_subnet_ids_csv)],securityGroups=[$(out app_security_group_id)],assignPublicIP=ENABLED}" \
    --query 'tasks[0].taskArn' --output text)"
  echo "   task: $arn"
  aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" --tasks "$arn"
  local code
  code="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$arn" --query 'tasks[0].containers[0].exitCode' --output text)"
  if [ "$code" = "0" ]; then
    echo ">> Seed finished OK."
    echo "   Admin login:  user ID 'Admin',  password from:"
    echo "   aws secretsmanager get-secret-value --region $region --secret-id $(out admin_password_secret_arn) --query SecretString --output text"
  else
    echo ">> Seed FAILED (exit code $code). See CloudWatch log group /ecs/*/backend, stream prefix 'seed'." >&2
    exit 1
  fi
}

cmd_logs() {
  need aws
  local svc="${1:-backend}"
  aws logs tail "$(out log_group_prefix)/$svc" --region "$(out aws_region)" --follow --since 15m
}

cmd_info() { tf output; }

case "${1:-}" in
  bootstrap) shift; cmd_bootstrap "$@" ;;
  release)   shift; cmd_release "$@" ;;
  rollback)  shift; cmd_rollback "$@" ;;
  seed)      shift; cmd_seed "$@" ;;
  logs)      shift; cmd_logs "$@" ;;
  info)      shift; cmd_info "$@" ;;
  *)
    sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    echo; echo "Commands: bootstrap | release [tag] | seed | rollback <tag> | logs [backend|web] | info"
    exit 1 ;;
esac
