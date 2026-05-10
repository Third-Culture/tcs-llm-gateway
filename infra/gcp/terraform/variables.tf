variable "project_id" {
  description = "GCP project ID that hosts tcs-llm-gateway."
  type        = string
  default     = "third-culture"
}

variable "region" {
  description = "Primary deployment region."
  type        = string
  default     = "us-central1"
}

variable "artifact_registry_repo" {
  description = "Artifact Registry repo (created by bootstrap.sh)."
  type        = string
  default     = "tcs"
}

variable "image_tag" {
  description = "Container image tag deployed by Cloud Run. Bumped by CI/CD."
  type        = string
  default     = "latest"
}

variable "root_domain" {
  description = "Parent domain for the two gateway subdomains."
  type        = string
  default     = "thirdculture.systems"
}

variable "ui_hostname" {
  description = "Hostname for the IAP-protected dashboard."
  type        = string
  default     = "llm.thirdculture.systems"
}

variable "gateway_hostname" {
  description = "Hostname for the OpenAI-compatible gateway endpoint."
  type        = string
  default     = "api.llm.thirdculture.systems"
}

variable "db_tier" {
  description = "Cloud SQL machine tier. db-g1-small is fine for internal traffic."
  type        = string
  default     = "db-g1-small"
}

variable "redis_memory_gb" {
  description = "Memorystore Redis size in GB."
  type        = number
  default     = 1
}

variable "iap_support_email" {
  description = "Support email shown on the IAP OAuth consent screen."
  type        = string
  default     = "di@thirdculture.world"
}

variable "iap_allowed_users" {
  description = "IAM members (e.g. user:alice@thirdculture.world) allowed through IAP to the UI."
  type        = list(string)
  default     = ["domain:thirdculture.world"]
}

variable "enable_iap" {
  description = "Bind IAP to the UI Cloud Run service. Requires the OAuth consent screen brand to exist (manual one-time console step). Leave false on first apply, then re-apply with true once the brand is configured."
  type        = bool
  default     = false
}

variable "enable_domain_mappings" {
  description = "Create Cloud Run domain mappings for the gateway/UI hostnames. Requires that the parent domain has been verified in Search Console for the project's service account. Leave false on first apply, verify the domain, then re-apply with true."
  type        = bool
  default     = false
}

variable "admin_emails" {
  description = "Email addresses with full admin access to the dashboard (gift credits, see all orgs, etc.). Wired into the ADMIN_EMAILS env var used by apps/api/src/middleware/admin.ts."
  type        = list(string)
  default     = ["di@thirdculture.world"]
}

variable "gateway_min_instances" {
  description = "Minimum warm Cloud Run instances for the gateway. 1 keeps the gateway always-warm to avoid cold starts on the hot path. Set to 0 to scale-to-zero (cheaper but ~5-10s cold-start latency)."
  type        = number
  default     = 1
}
