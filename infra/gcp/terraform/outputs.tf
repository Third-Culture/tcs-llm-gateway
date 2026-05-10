output "gateway_url" {
  description = "Cloud Run URL of the OpenAI-compatible gateway."
  value       = google_cloud_run_v2_service.gateway.uri
}

output "api_url" {
  description = "Cloud Run URL of the admin API (internal)."
  value       = google_cloud_run_v2_service.api.uri
}

output "ui_url" {
  description = "Cloud Run URL of the dashboard (public but IAP-gated)."
  value       = google_cloud_run_v2_service.ui.uri
}

output "gateway_domain_cname" {
  description = "CNAME target to point api.llm.thirdculture.systems at (only set when enable_domain_mappings = true)."
  value = try(
    [for r in google_cloud_run_domain_mapping.gateway[0].status[0].resource_records : r if r.type == "CNAME"],
    [],
  )
}

output "ui_domain_cname" {
  description = "CNAME target to point llm.thirdculture.systems at (only set when enable_domain_mappings = true)."
  value = try(
    [for r in google_cloud_run_domain_mapping.ui[0].status[0].resource_records : r if r.type == "CNAME"],
    [],
  )
}

output "postgres_connection_name" {
  description = "Cloud SQL connection name (for Cloud SQL Auth Proxy and IAM)."
  value       = google_sql_database_instance.postgres.connection_name
}

output "postgres_private_ip" {
  description = "Cloud SQL private IP reachable via the VPC connector."
  value       = google_sql_database_instance.postgres.private_ip_address
}

output "redis_host" {
  description = "Memorystore Redis host."
  value       = google_redis_instance.cache.host
}

output "redis_port" {
  description = "Memorystore Redis port."
  value       = google_redis_instance.cache.port
}

output "service_account_email" {
  description = "Cloud Run runtime service account (already granted Secret accessor + AI Platform user)."
  value       = google_service_account.cloud_run.email
}
