# AKS Sample App — CI/CD with Security Scanning
### Project Reference & Runbook

**Repo:** https://github.com/srawan06/aks-sample-cicd
**Subscription:** Azure for Students (Aga Khan University tenant)
**Domain:** vitalsoftai.com (Cloudflare DNS)

---

## 1. Architecture Overview

```
GitHub push
   |
   |--> infra.yml (manual trigger)
   |      Checkov (IaC scan) -> Bicep deploy -> AKS cluster (1x Standard_B2s_v2, Free tier, uaenorth)
   |
   |--> ci-cd.yml (on push to app/**, k8s/**)
   |      CodeQL (SAST) --+
   |      npm audit (SCA)-+--> Build image -> Trivy (container scan) -> Push to Docker Hub
   |                      |                                                |
   |                      +------------------------------------------------+
   |                                                                       v
   |                                                    Deploy to AKS (Helm: NGINX ingress
   |                                                    + kubectl: app, service, ingress, HPA)
   |
   |--> monitoring.yml (on push to monitoring/**)
   |      Helm install kube-prometheus-stack (Prometheus + Grafana), routed through
   |      existing ingress at grafana.vitalsoftai.com
   |
   |--> cert-manager.yml (on push to cert-manager/**)
          Helm install cert-manager + ClusterIssuer -> automatic Let's Encrypt HTTPS
          for grafana.vitalsoftai.com (auto-renewing)
```

**Public IP usage (quota: 3 max):**
1. AKS outbound load balancer IP (automatic, not directly reachable)
2. NGINX ingress controller IP (serves both the app AND Grafana, via hostname routing)
3. Spare / unused

**Authentication:** GitHub Actions authenticates to Azure via **OIDC federated credentials**
— no client secrets or passwords stored anywhere. Azure AD trusts short-lived tokens
GitHub issues, scoped to this specific repo + branch.

---

## 2. Repo Structure

```
app/            Node.js/Express sample app + Dockerfile (non-root, multi-stage)
infra/          Bicep - AKS cluster definition (resource-group scope)
k8s/            Namespace, Deployment, Service, Ingress, HPA manifests
monitoring/     Prometheus/Grafana Helm values
cert-manager/   ClusterIssuer manifest for Let's Encrypt
.github/workflows/
  infra.yml           - provisions AKS
  ci-cd.yml           - builds/scans/deploys the app
  monitoring.yml      - installs Prometheus + Grafana
  cert-manager.yml    - installs cert-manager + HTTPS
docs/SETUP.md   Original step-by-step setup guide
```

---

## 3. Security Scanning Summary

| Layer | Tool | Runs in | Gate behavior |
|---|---|---|---|
| IaC (Bicep) | Checkov | infra.yml | soft-fail (informational) |
| SAST | CodeQL | ci-cd.yml | blocks on findings |
| SCA (dependencies) | npm audit | ci-cd.yml | fails on high/critical only |
| Container image | Trivy | ci-cd.yml | fails on CRITICAL (fixable) |

**Real vulnerability caught and fixed during this project:** `CVE-2026-59873` (CRITICAL) —
a DoS bug in `tar`, bundled internally by npm itself inside the `node:20-alpine` base
image (not one of our app's own dependencies). Fixed by stripping npm entirely out of
the final runtime image (`app/Dockerfile`), since the app only needs `node`, not `npm`,
at runtime.

---

## 4. Key Design Decisions & Why

- **Docker Hub instead of Azure Container Registry** — avoids per-day ACR costs on a
  limited student credit.
- **AKS Free tier SKU** — no charge for the control plane; only the single VM node costs.
- **Single node pool, `Standard_B2s_v2`** — matches the subscription's 1-node constraint
  and confirmed-working VM size (plain `Standard_B2s` had no capacity in this subscription).
- **Region: `uaenorth`** — the only one of 5 policy-allowed regions where AKS actually
  had capacity for this subscription (confirmed by testing all 5).
- **Resource-group-scope Bicep deployment, not subscription-scope** — this specific
  subscription rejects `az deployment sub create`/`what-if` for AKS with a generic
  "policy violation" error; the identical spec succeeds at resource-group scope. The
  resource group itself is created via a plain `az group create` CLI step first.
- **Grafana routed through the existing NGINX ingress** (hostname-based), not a
  dedicated LoadBalancer — conserves the 3-public-IP quota.
- **Monitoring stack trimmed down** (no Alertmanager, no control-plane scrape targets,
  6h Prometheus retention) — sized to fit alongside the app on one small node.

---

## 5. Problems Encountered & How They Were Solved

| Problem | Root Cause | Fix |
|---|---|---|
| `.github/workflows/` missing from first zip | My `zip -x "*.git*"` exclude pattern also matched `.github` (substring match) | Recreated the workflow files manually |
| AKS subscription-scope deploy failed (`RequestDisallowedByAzure`) | This subscription blocks sub-scope AKS deployments specifically | Switched to resource-group-scope deployment |
| OIDC login failed (`AADSTS700213`) | GitHub changed its OIDC subject format (July 2026) to include immutable numeric IDs (`repo:owner@id/repo@id`) | Updated the Azure federated credential's `subject` to the new format |
| `az group create` failed - location mismatch | RG had been created with `malaysiawest` during earlier debugging, cluster needed `uaenorth` | Eventually deleted and recreated the whole resource group cleanly in `uaenorth` |
| Bicep deploy failed - "new agent pool introduced" | Bicep's pool name (`systempool`) didn't match an existing adopted cluster's pool name (`nodepool1`) | Resolved permanently by deleting the old cluster and letting Bicep create a fresh one (no adoption mismatch) |
| Bicep deploy failed - `dnsPrefix` immutable | Same adoption-mismatch issue as above | Same fix - fresh cluster build |
| Trivy step failed to resolve action version | Pinned an invalid version (`0.24.0`) | Correct valid, post-supply-chain-incident version is `v0.35.0` |
| Trivy found CRITICAL `tar` CVE | Vulnerability in npm's own bundled tooling inside `node:20-alpine`, not our app's dependencies | Removed npm entirely from the final runtime image (not needed there anyway) |
| Pod stuck `CreateContainerConfigError` | k8s `runAsNonRoot: true` couldn't verify a named Docker `USER appuser` | Changed Dockerfile to a numeric UID (`USER 1001`) and matched it in `k8s/deployment.yaml` |
| Grafana repeatedly `OOMKilled` | Memory limit set too tight (256Mi) vs actual usage (~370Mi) | Raised limit to 512Mi (node had headroom) |
| `helm` step failed - file not found | Created `monitoring/values.yml` but workflow referenced `values.yaml` | Renamed to match exactly |

---

## 6. Testing / Verification Steps (for future reference)

### Confirm cluster health
```bash
az aks show -g rg-aks-sample -n aks-sample-cluster \
  --query "{state:provisioningState, nodes:agentPoolProfiles[0].count, location:location}" -o table
az aks get-credentials -g rg-aks-sample -n aks-sample-cluster --admin --overwrite-existing
kubectl get nodes
```

### Confirm app is live
```bash
kubectl get pods -n sample-app
kubectl get svc -n ingress-nginx ingress-nginx-controller   # get EXTERNAL-IP
curl http://<EXTERNAL-IP>/
curl http://<EXTERNAL-IP>/health
```

### Confirm monitoring
```bash
kubectl get pods -n monitoring
kubectl get ingress -n monitoring
# Browse to https://grafana.vitalsoftai.com (admin / GRAFANA_ADMIN_PASSWORD secret)
```

### Confirm HTTPS / cert-manager
```bash
kubectl get pods -n cert-manager
kubectl get clusterissuer
kubectl get certificate -n monitoring   # should show READY: True
```

### Confirm HPA
```bash
kubectl get hpa -n sample-app
# TARGETS column shows live CPU% vs 50% threshold; REPLICAS scales 1-4 under load
```

### Explore/learn commands used throughout
```bash
kubectl get all -n sample-app
kubectl logs -n sample-app -l app=sample-app --tail=20
kubectl exec -it -n sample-app deploy/sample-app -- sh
kubectl top pod -n sample-app
kubectl top node
kubectl scale deployment sample-app -n sample-app --replicas=3   # manual scaling test
```

---

## 7. Full Rebuild Procedure (after a teardown)

1. **Destroy (to save credit when not in use):**
   ```bash
   az group delete --name rg-aks-sample --yes --no-wait
   ```
2. **Rebuild infra:** GitHub Actions -> `Infra - Provision AKS` -> Run workflow
3. **Redeploy app:** GitHub Actions -> `App CI/CD` -> Run workflow
4. **Get the new ingress IP:**
   ```bash
   kubectl get svc -n ingress-nginx ingress-nginx-controller
   ```
5. **Update Cloudflare DNS** — `grafana` A record must point to the NEW ingress IP
   (it changes every time the cluster/ingress controller is recreated).
6. **Reinstall monitoring:** GitHub Actions -> `Monitoring - Install Prometheus & Grafana` -> Run workflow
7. **Reinstall cert-manager (if needed):** GitHub Actions -> `Cert-Manager - Install & Configure HTTPS` -> Run workflow
   (Note: cert-manager + ClusterIssuer are cluster-scoped and get wiped with the cluster;
   the `grafana-tls` certificate will be re-requested automatically once the ingress exists again.)

**Important:** the ingress controller's public IP changes on every rebuild. Always update
the Cloudflare `grafana` A record after step 4, before expecting `grafana.vitalsoftai.com`
to work.

---

## 8. GitHub Secrets & Variables Reference

**Secrets** (Settings -> Secrets and variables -> Actions -> Secrets):
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` — OIDC identity
- `DOCKERHUB_TOKEN` — Docker Hub push access
- `GRAFANA_ADMIN_PASSWORD` — Grafana login

**Variables:**
- `DOCKERHUB_USERNAME`, `AZURE_LOCATION` (`uaenorth`), `AKS_RESOURCE_GROUP`
  (`rg-aks-sample`), `AKS_CLUSTER_NAME` (`aks-sample-cluster`)

**Azure AD App (OIDC identity):**
- Client ID: `52853dc9-4006-4537-a288-065f29033010`
- Tenant ID: `a5d4252a-02f9-4e60-96f0-9733baae4919`
- Federated credential subject: `repo:srawan06@228827919/aks-sample-cicd@1360824280:ref:refs/heads/main`
  (GitHub's newer immutable-ID OIDC format, effective July 2026)

---

## 9. Ideas Explored But Deliberately Not Kept

- **`/burn` CPU-stress endpoint** — used once to demonstrate the HPA scaling under real
  load, then gated behind `ENABLE_BURN_ENDPOINT=true` (not set anywhere by default) since
  an open, unauthenticated CPU-burn route is a real DoS vector. Code remains in
  `app/index.js` for reference; to re-enable temporarily, add that env var to
  `k8s/deployment.yaml`'s container spec and redeploy.

---

## 10. Possible Future Additions (discussed, not yet built)

- **DAST** (OWASP ZAP) — scan the live running app for runtime vulnerabilities (XSS,
  injection, missing headers), complementing CodeQL's source-code-only view.
- **NetworkPolicies** — restrict pod-to-pod traffic so only the ingress controller can
  reach `sample-app` (zero-trust networking, free to add).
- **Dependabot** — automatic PRs for vulnerable dependency bumps (would have caught the
  `tar` CVE proactively, without waiting for Trivy at build time).
- **PR-based workflow** — run scans on pull requests as a required check before merging
  to `main`, rather than scanning after the fact on direct pushes.
- **Azure DevOps Pipelines version** — rebuild this same project's CI/CD using Azure
  DevOps instead of GitHub Actions, for comparison/learning purposes.
- **A second microservice** — demonstrate internal service-to-service calls and
  Kubernetes service discovery.
