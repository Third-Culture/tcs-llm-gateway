# Custom domains for TCS LLM Gateway

Two subdomains of `thirdculture.systems` front the gateway:

| Hostname                          | Purpose                                 | Auth                      |
| --------------------------------- | --------------------------------------- | ------------------------- |
| `llm.thirdculture.systems`        | Admin dashboard (UI)                    | IAP (TCS Google accounts) |
| `api.llm.thirdculture.systems`    | OpenAI-compatible gateway endpoint      | TCS service API keys      |

The Cloud Run domain mappings are declared in
[`terraform/main.tf`](terraform/main.tf) and created automatically by
`terraform apply`. This doc covers the two pieces that _cannot_ be
automated: DNS and the one-time IAP OAuth consent screen.

## 1. Verify the parent domain in Search Console

Cloud Run only accepts domain mappings for domains that the GCP project
has verified ownership of. If `thirdculture.systems` is not already
verified under this project:

1. Open <https://search.google.com/search-console> signed in as
   `di@thirdculture.world`.
2. Add `thirdculture.systems` as a **Domain** property.
3. Follow the DNS TXT record prompt — add the record at whoever hosts DNS
   for `thirdculture.systems`.
4. Wait for verification, then in GCP, run:

   ```bash
   gcloud domains list-user-verified
   ```

   and confirm `thirdculture.systems` appears.

## 2. Apply Terraform to create the mappings

```bash
cd infra/gcp/terraform
terraform apply -var-file=tcs.tfvars
```

After apply, read the emitted DNS targets:

```bash
terraform output ui_domain_cname
terraform output gateway_domain_cname
```

Each returns a list of records Cloud Run expects you to set.

## 3. Create the CNAMEs at the DNS host

For the most common case (CNAME pointing at `ghs.googlehosted.com.`):

| Record                              | Type  | Target                     |
| ----------------------------------- | ----- | -------------------------- |
| `llm.thirdculture.systems.`         | CNAME | `ghs.googlehosted.com.`    |
| `api.llm.thirdculture.systems.`     | CNAME | `ghs.googlehosted.com.`    |

Cloud Run provisions a managed TLS cert automatically once DNS resolves
(typically 15-60 minutes).

## 4. One-time IAP OAuth consent screen

The UI service is IAP-protected. IAP requires an OAuth consent screen
("brand") which cannot be created via Terraform on an existing org
project without a pre-set support email. Once:

1. Open <https://console.cloud.google.com/apis/credentials/consent?project=third-culture>.
2. Configure as **Internal** (Third Culture org only).
3. Support email: `di@thirdculture.world`.
4. Save. No scopes, no test users required for an internal app.

Terraform's `google_iap_web_cloud_run_service_iam_binding.ui` resource
will then attach IAP to the UI service and grant the
`iap_allowed_users` list access (default: `domain:thirdculture.world`).

## 5. Smoke test

```bash
# UI — should redirect you to Google SSO, then load the dashboard.
open https://llm.thirdculture.systems

# Gateway — should respond with a 401 (auth required) using a random key,
# proving the endpoint is live and authentication is enforced.
curl -i https://api.llm.thirdculture.systems/v1/models \
  -H "Authorization: Bearer tcs-invalid"
```

## Revoking / moving

- To remove a mapping: `terraform destroy -target=google_cloud_run_domain_mapping.ui`.
- To hand ownership to a different project: delete the mapping here, remove
  the CNAME, re-verify the domain under the new project, re-apply.
