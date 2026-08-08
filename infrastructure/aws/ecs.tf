data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${var.project_name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_cloudwatch_log_group" "demo" {
  name              = "/ecs/${var.project_name}"
  retention_in_days = 7
}

resource "aws_ecs_cluster" "main" {
  name = var.project_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

locals {
  revisions = {
    stable = {
      image      = var.stable_image
      version    = "v1"
      error_rate = "0"
      delay_ms   = "50"
    }
    candidate = {
      image      = var.candidate_image
      version    = "v2"
      error_rate = tostring(var.candidate_error_rate)
      delay_ms   = "300"
    }
  }
}

resource "aws_ecs_task_definition" "revision" {
  for_each = local.revisions

  family                   = "${var.project_name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([
    {
      name      = "demo-service"
      image     = each.value.image
      essential = true
      portMappings = [{
        containerPort = 3000
        hostPort      = 3000
        protocol      = "tcp"
      }]
      environment = [
        { name = "APP_VERSION", value = each.value.version },
        { name = "ERROR_RATE", value = each.value.error_rate },
        { name = "RESPONSE_DELAY_MS", value = each.value.delay_ms },
        { name = "PORT", value = "3000" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.demo.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = each.key
        }
      }
    }
  ])
}

resource "aws_ecs_service" "revision" {
  for_each = local.revisions

  name            = "${var.project_name}-${each.key}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.revision[each.key].arn
  desired_count   = each.key == "stable" ? 1 : 0
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = each.key == "stable" ? aws_lb_target_group.stable.arn : aws_lb_target_group.candidate.arn
    container_name   = "demo-service"
    container_port   = 3000
  }

  health_check_grace_period_seconds = 30

  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.http]
}
