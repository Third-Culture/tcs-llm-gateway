###############################################################################
# Networking                                                                  #
###############################################################################

# Use the default VPC. If a dedicated VPC exists, point the connector at it.
data "google_compute_network" "default" {
  name = "default"
}

# Project number is needed to construct the canonical Cloud Run URLs
# (`<service>-<project_number>.<region>.run.app`), which we set as env vars on
# the Cloud Run services themselves.
data "google_project" "this" {
  project_id = var.project_id
}

resource "google_compute_global_address" "private_services" {
  name          = "tcs-llm-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.default.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = data.google_compute_network.default.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

resource "google_vpc_access_connector" "cloud_run" {
  name          = "tcs-llm-connector"
  region        = var.region
  network       = data.google_compute_network.default.name
  ip_cidr_range = "10.8.0.0/28"
  min_instances = 2
  max_instances = 3
}

###############################################################################
# Cloud SQL Postgres                                                          #
###############################################################################

resource "random_password" "db_password" {
  length  = 32
  special = true
}

resource "google_sql_database_instance" "postgres" {
  name                = "tcs-llm-postgres"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true

  depends_on = [google_service_networking_connection.private_vpc]

  settings {
    # ENTERPRISE_PLUS (the new default) doesn't support db-g1-small. Pin to
    # ENTERPRISE so we can use the small/cheap shared-core tier for internal
    # traffic. Bump to ENTERPRISE_PLUS + db-perf-optimized-N-* if we need
    # higher throughput later.
    edition           = "ENTERPRISE"
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_size         = 20
    disk_type         = "PD_SSD"
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = data.google_compute_network.default.id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      location                       = var.region
      point_in_time_recovery_enabled = true
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = false
      record_client_address   = false
    }

    maintenance_window {
      day          = 7
      hour         = 3
      update_track = "stable"
    }
  }
}

resource "google_sql_database" "gateway" {
  name     = "llmgateway"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "app" {
  name     = "llmgateway"
  instance = google_sql_database_instance.postgres.name
  password = random_password.db_password.result
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = "projects/${var.project_id}/secrets/TCS_LLM_DATABASE_URL"
  # sslmode=no-verify: encrypt in transit but skip CA chain verification.
  # Cloud SQL serves a Google-rooted cert that pg's bundled CA list doesn't
  # trust by default in node 20+. The connection still goes over the private
  # VPC peering link and is still TLS-encrypted, just without certificate
  # pinning. Acceptable for internal traffic; tighten later by mounting the
  # Cloud SQL CA bundle and switching to verify-ca.
  secret_data = format(
    "postgres://%s:%s@%s:5432/%s?sslmode=no-verify",
    google_sql_user.app.name,
    random_password.db_password.result,
    google_sql_database_instance.postgres.private_ip_address,
    google_sql_database.gateway.name,
  )
}

###############################################################################
# Memorystore Redis                                                           #
###############################################################################

resource "google_redis_instance" "cache" {
  name               = "tcs-llm-redis"
  tier               = "BASIC"
  memory_size_gb     = var.redis_memory_gb
  region             = var.region
  authorized_network = data.google_compute_network.default.id
  redis_version      = "REDIS_7_2"
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  # Plain TCP within the private VPC. The bundled ioredis client used by the
  # gateway doesn't speak TLS by default, and traffic never leaves Google's
  # private network. Re-enable auth + TLS once the client supports it.
  auth_enabled            = false
  transit_encryption_mode = "DISABLED"

  depends_on = [google_service_networking_connection.private_vpc]
}

# Memorystore auth is disabled, so no auth_string exists. We keep a placeholder
# secret version so the secret resource is non-empty, but it's not mounted by
# any Cloud Run service. If we re-enable auth later, switch the value to
# google_redis_instance.cache.auth_string and re-add REDIS_PASSWORD to
# gateway_env_secrets.
resource "google_secret_manager_secret_version" "redis_password" {
  secret      = "projects/${var.project_id}/secrets/TCS_LLM_REDIS_PASSWORD"
  secret_data = " "
}

###############################################################################
# Cloud Run services                                                          #
###############################################################################

locals {
  image_base = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_registry_repo}/llm-gateway"

  # Secrets that every service needs mounted as env vars.
  # REDIS_PASSWORD intentionally omitted — Memorystore is configured without
  # auth, so leaving the env var unset is correct (ioredis will skip AUTH).
  gateway_env_secrets = {
    DATABASE_URL                 = "TCS_LLM_DATABASE_URL"
    AUTH_SECRET                  = "TCS_LLM_AUTH_SECRET"
    GATEWAY_API_KEY_HASH_SECRET  = "GATEWAY_API_KEY_HASH_SECRET"
    LLM_FIREWORKS_API_KEY        = "LLM_FIREWORKS_API_KEY"
    LLM_PARASAIL_API_KEY         = "LLM_PARASAIL_API_KEY"
    LLM_DEEPINFRA_API_KEY        = "LLM_DEEPINFRA_API_KEY"
    LLM_WANDB_API_KEY            = "LLM_WANDB_API_KEY"
    LLM_GOOGLE_VERTEX_API_KEY    = "LLM_GOOGLE_VERTEX_API_KEY"
    LLM_MOONSHOT_API_KEY         = "LLM_MOONSHOT_API_KEY"
    LLM_MINIMAX_API_KEY          = "LLM_MINIMAX_API_KEY"
    LLM_CANOPY_WAVE_API_KEY      = "LLM_CANOPY_WAVE_API_KEY"
    LLM_TOGETHER_AI_API_KEY      = "LLM_TOGETHER_AI_API_KEY"
    LLM_NOVITA_AI_API_KEY        = "LLM_NOVITA_AI_API_KEY"
    LLM_OPENAI_API_KEY           = "LLM_OPENAI_API_KEY"
    LLM_ANTHROPIC_API_KEY        = "LLM_ANTHROPIC_API_KEY"
    TCS_SLACK_BUDGET_WEBHOOK_URL = "TCS_SLACK_BUDGET_WEBHOOK_URL"
    TCS_LINEAR_API_KEY           = "TCS_LINEAR_API_KEY"
    TCS_LINEAR_BUDGET_TEAM_ID    = "TCS_LINEAR_BUDGET_TEAM_ID"
    INTERNAL_STATS_TOKEN         = "TCS_LLM_INTERNAL_STATS_TOKEN"
  }

  # Public-facing URLs. We can't read these from the cloud_run_v2_service
  # resources (cycle: services depend on env vars set from their own URLs),
  # so we build them from the predictable
  # `<service>-<project_number>.<region>.run.app` pattern. When custom domains
  # are enabled, swap these out for the *.thirdculture.systems hostnames.
  cr_run_app  = "${data.google_project.this.number}.${var.region}.run.app"
  api_url     = var.enable_domain_mappings ? "https://${var.gateway_hostname}" : "https://llmgateway-api-${local.cr_run_app}"
  gateway_url = var.enable_domain_mappings ? "https://${var.gateway_hostname}" : "https://llmgateway-gateway-${local.cr_run_app}"
  ui_url      = var.enable_domain_mappings ? "https://${var.ui_hostname}" : "https://llmgateway-ui-${local.cr_run_app}"

  # Cookie domain for better-auth. With custom domains, scope to the parent
  # domain so cookies are shared between llm.* and api.llm.* subdomains. On
  # *.run.app we can't set a cookie domain (publicSuffix list blocks it), so
  # we set it to the exact API hostname which keeps cookies first-party for
  # the API only — the UI calls the API cross-origin with credentials.
  cookie_domain = var.enable_domain_mappings ? ".${var.root_domain}" : "llmgateway-api-${local.cr_run_app}"

  common_env = {
    NODE_ENV                 = "production"
    REDIS_HOST               = google_redis_instance.cache.host
    REDIS_PORT               = tostring(google_redis_instance.cache.port)
    LLM_GOOGLE_CLOUD_PROJECT = var.project_id
    LLM_GOOGLE_VERTEX_REGION = "global"
    API_URL                  = local.api_url
    UI_URL                   = local.ui_url
    ORIGIN_URLS              = "${local.ui_url},${local.api_url},${local.gateway_url}"
    COOKIE_DOMAIN            = local.cookie_domain
    ADMIN_EMAILS             = join(",", var.admin_emails)
    GOOGLE_CLOUD_PROJECT     = var.project_id
  }
}

resource "google_service_account" "cloud_run" {
  account_id   = "tcs-llm-gateway"
  display_name = "TCS LLM Gateway Cloud Run runtime"
}

resource "google_project_iam_member" "cloud_run_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "cloud_run_vertex_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "cloud_run_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "cloud_run_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_cloud_run_v2_service" "gateway" {
  name                = "llmgateway-gateway"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.cloud_run.email

    # min_instance_count=1 keeps a warm gateway pod so the first request from
    # a service doesn't pay 5-10s of cold start (image pull + node startup +
    # supervisord booting Postgres/Redis/UI/API/etc inside the unified image).
    # Cost: 2 vCPU + 2 GiB always-on ≈ ~$45/mo. Worth it for predictable
    # latency on the hot path.
    scaling {
      min_instance_count = var.gateway_min_instances
      max_instance_count = 10
    }

    vpc_access {
      connector = google_vpc_access_connector.cloud_run.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "${local.image_base}:${var.image_tag}"

      ports {
        container_port = 4001
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }

      dynamic "env" {
        for_each = local.common_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.gateway_env_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.redis_password,
  ]
}

resource "google_cloud_run_v2_service" "api" {
  name     = "llmgateway-api"
  location = var.region
  # Public ingress: the API's own better-auth session middleware authenticates
  # every request. The UI calls this service directly from the browser, so it
  # must be reachable from outside the VPC. Locked-down via IAP later if we
  # bind a custom domain + the UI as the only allowed origin.
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    vpc_access {
      connector = google_vpc_access_connector.cloud_run.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "${local.image_base}:${var.image_tag}"

      # The API service in the unified image listens on 4002 (the gateway is
      # on 4001, the UI is on 3002, the chat playground is on 3003).
      ports {
        container_port = 4002
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      dynamic "env" {
        for_each = local.common_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.gateway_env_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.redis_password,
  ]
}

resource "google_cloud_run_v2_service" "ui" {
  name                = "llmgateway-ui"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    vpc_access {
      connector = google_vpc_access_connector.cloud_run.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "${local.image_base}:${var.image_tag}"

      ports {
        container_port = 3002
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      dynamic "env" {
        for_each = local.common_env
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_version.database_url,
  ]
}

###############################################################################
# IAP for the UI                                                              #
###############################################################################

# NOTE: The OAuth consent screen ("brand") must be configured once in the GCP
# console — terraform cannot create the brand from scratch on an org without
# a support email set. After that, this block binds the Cloud Run UI service
# to IAP and allows the configured users/groups through it.

resource "google_iap_web_cloud_run_service_iam_binding" "ui" {
  count                  = var.enable_iap ? 1 : 0
  project                = var.project_id
  location               = var.region
  cloud_run_service_name = google_cloud_run_v2_service.ui.name
  role                   = "roles/iap.httpsResourceAccessor"
  members                = var.iap_allowed_users
}

###############################################################################
# Domain mappings                                                             #
###############################################################################

resource "google_cloud_run_domain_mapping" "gateway" {
  count    = var.enable_domain_mappings ? 1 : 0
  location = var.region
  name     = var.gateway_hostname

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.gateway.name
  }
}

resource "google_cloud_run_domain_mapping" "ui" {
  count    = var.enable_domain_mappings ? 1 : 0
  location = var.region
  name     = var.ui_hostname

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.ui.name
  }
}

# Allow unauthenticated invocation of the gateway — it authenticates clients
# via its own TCS-service API keys, not IAM.
resource "google_cloud_run_v2_service_iam_member" "gateway_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.gateway.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The API service authenticates every request via its own better-auth session
# cookie middleware. The UI calls it from the browser, so it must be invokable
# without GCP IAM. (Same security posture as the gateway: app-level auth, not
# infra-level.)
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# When IAP isn't enabled yet, the UI must be public so we can sign in. Once
# IAP is configured, this binding is removed and IAP gates access instead.
resource "google_cloud_run_v2_service_iam_member" "ui_public" {
  count    = var.enable_iap ? 0 : 1
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.ui.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
