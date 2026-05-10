# TCS LLM Gateway — GCP Infrastructure

This directory contains the reviewable-and-reproducible infrastructure for
running `tcs-llm-gateway` on Google Cloud in the `third-culture` project.

## Layout

```
infra/gcp/
├── README.md            (this file)
├── bootstrap.sh         Idempotent setup for free/cheap resources
│                        (enable APIs, Artifact Registry, Secret Manager
│                        placeholders). Safe to run repeatedly.
├── setup-wif.sh         Idempotent Workload Identity Federation setup for
│                        the GitHub Actions deploy workflow (no JSON keys).
└── terraform/
    ├── versions.tf
    ├── variables.tf
    ├── providers.tf
    ├── main.tf          Cloud SQL, Memorystore, VPC connector, Cloud Run,
    │                    IAP binding, domain mappings
    ├── outputs.tf
    └── tcs.tfvars.example
```

## Order of operations

1. **Bootstrap** — run once from any admin workstation:

   ```bash
   ./bootstrap.sh
   ```

   This enables all required GCP services, creates the Artifact Registry
   repo `tcs/llm-gateway`, and pre-seeds Secret Manager with empty
   placeholders for every `LLM_*_API_KEY` the gateway expects. You then
   populate the real values via the GCP console or `gcloud secrets versions add`.

2. **Populate provider secrets** — put real values into each secret:

   ```bash
   echo -n "fw-xxx" | gcloud secrets versions add LLM_FIREWORKS_API_KEY --data-file=-
   echo -n "ps-xxx" | gcloud secrets versions add LLM_PARASAIL_API_KEY --data-file=-
   # ...and so on for each provider you intend to use
   ```

3. **Terraform apply (paid resources)** — spins up Cloud SQL, Memorystore,
   VPC connector, and the three Cloud Run services. The first apply is the
   only one that incurs new baseline cost (~$60/month: db-g1-small Postgres
   + Memorystore Basic 1 GB).

   ```bash
   cd terraform
   terraform init
   terraform plan -var-file=tcs.tfvars
   terraform apply -var-file=tcs.tfvars
   ```

4. **Point DNS** — create two CNAMEs at your DNS host for
   `thirdculture.systems`:

   - `llm` → the domain-mapping target emitted by
     `terraform output ui_domain_cname`
   - `api.llm` → `terraform output gateway_domain_cname`

   IAP configuration for the UI service is handled by Terraform but the
   OAuth consent screen still requires a one-time manual step in the console
   (see docstring in `main.tf`).

5. **Set up GitHub Actions deploy** — one-time WIF config so the workflow
   at `.github/workflows/tcs-deploy.yml` can push images and deploy without
   a service-account JSON key:

   ```bash
   ./setup-wif.sh Third-Culture/tcs-llm-gateway
   ```

   After this, any push to the `tcs/main` branch builds the unified image,
   pushes it to Artifact Registry, and rolls out all three Cloud Run
   services.

## Cost envelope (us-central1, monthly, idle)

| Component                               | Idle baseline |
| --------------------------------------- | ------------- |
| Cloud Run (3 services, min 0 instances) | ~$0           |
| Cloud SQL `db-g1-small`                 | ~$25          |
| Memorystore Basic 1 GB                  | ~$35          |
| Serverless VPC Access connector         | ~$0 (pay per throughput) |
| Artifact Registry (1 GB images)         | ~$0.10        |
| Secret Manager (10 secrets)             | ~$0.05        |
| **Total idle**                          | **~$60/mo**   |

Usage-based costs (Cloud Run request/second time, LLM provider calls, egress)
are billed on top.

## Teardown

```bash
cd terraform && terraform destroy -var-file=tcs.tfvars
./bootstrap.sh --destroy-secrets     # optional, only if you want the
                                     # provider API secrets removed too
```
