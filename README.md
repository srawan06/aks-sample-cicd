# AKS Sample App — CI/CD with Security Scanning

A learning project: a small Node.js app, deployed to a single-node AKS
cluster, through a GitHub Actions pipeline with SAST, SCA, container, and
IaC scanning built in — sized to fit a constrained student Azure
subscription (1 AKS node, 3 public IPs max).

## Architecture

```
GitHub push
   │
   ├─► infra.yml  (manual trigger)
   │     Checkov (IaC scan) ─► Bicep deploy ─► AKS cluster (1x Standard_B2s, Free tier)
   │
   └─► ci-cd.yml  (on push to app/)
         CodeQL (SAST) ─┐
         npm audit (SCA)─┼─► Build image ─► Trivy (container scan) ─► Push to Docker Hub
                         │                                                │
                         └────────────────────────────────────────────────┘
                                                                           ▼
                                                          Deploy to AKS (Helm: NGINX
                                                          ingress + kubectl apply)
```

**Public IP usage**: 1 for the AKS cluster's outbound standard load
balancer, 1 for the NGINX ingress controller's LoadBalancer service.
That's 2 of your 3 available — 1 spare.

## Repo layout

```
app/          Node.js/Express sample app + Dockerfile
infra/        Bicep: resource group + single-node AKS cluster
k8s/          Namespace, Deployment, Service, Ingress manifests
.github/      GitHub Actions workflows (infra + app CI/CD)
docs/         Full setup guide — START HERE: docs/SETUP.md
```

## Start here

👉 **[docs/SETUP.md](docs/SETUP.md)** — step-by-step, including exact Azure
CLI commands to run in Cloud Shell to verify your quota and confirm each
stage before moving to the next.

## Security scanning included

| Layer | Tool | Where |
|---|---|---|
| SAST | CodeQL | `ci-cd.yml` → `sast` job |
| SCA (dependencies) | `npm audit` | `ci-cd.yml` → `sca` job |
| Container image | Trivy | `ci-cd.yml` → `build-scan-push` job |
| IaC (Bicep) | Checkov | `infra.yml` → `iac-scan` job |

All findings that support SARIF (CodeQL, Trivy) are uploaded to the repo's
**Security → Code scanning alerts** tab.
