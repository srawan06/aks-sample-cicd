# Setup Guide

Follow these steps in order. Steps marked **[Cloud Shell]** should be run in
Azure Cloud Shell (https://shell.azure.com) — verify each before moving on.

---

## 0. Prerequisites

- Azure student subscription (note your Subscription ID: `az account show --query id -o tsv`)
- A GitHub account with a new **empty** repository created (e.g. `aks-sample-cicd`)
- A Docker Hub account (free) — https://hub.docker.com

---

## 1. Push this project to your GitHub repo

```bash
cd aks-sample-project
git init
git remote add origin https://github.com/<your-username>/<your-repo>.git
git add .
git commit -m "Initial scaffold: app, infra, k8s, pipelines"
git branch -M main
git push -u origin main
```

---

## 2. Create a Docker Hub access token

1. Docker Hub → Account Settings → Security → **New Access Token**
2. Scope: Read & Write. Copy the token (shown once).
3. In your GitHub repo: **Settings → Secrets and variables → Actions**
   - Add **Variable** `DOCKERHUB_USERNAME` = your Docker Hub username
   - Add **Secret** `DOCKERHUB_TOKEN` = the token you copied

---

## 2.5 [Cloud Shell] Validate the Bicep before trusting it

I wrote `infra/*.bicep` without access to a live Azure environment to
compile-test against, so validate it yourself first — cheap and catches
typos before you spend pipeline runs on it:

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
az bicep build --file infra/main.bicep --outfile /tmp/main.json
# No output = compiles cleanly. If it errors, paste the error back to me.

# Optional: dry-run against Azure without creating anything
az deployment sub what-if \
  --location eastus \
  --template-file infra/main.bicep
```

---

## 3. Create an Azure AD App Registration for GitHub OIDC

This lets GitHub Actions authenticate to Azure **without storing a password
or client secret** — GitHub proves its identity via a short-lived OIDC token
that Azure trusts because of the federated credential you're about to create.

**[Cloud Shell]** Run these one at a time. Replace `<...>` placeholders.

```bash
# 3.1 Confirm your subscription and quota first
az account show --query "{name:name, id:id}" -o table
az vm list-usage --location eastus -o table | grep -i "Public IP"
```

Check the output: your **Public IP Addresses** quota should show a limit of
3 (matching what you described). This confirms we're not about to exceed it
— our design uses at most 2 (1 for AKS outbound load balancer, 1 for the
NGINX ingress controller).

```bash
# 3.2 Create the app registration
az ad app create --display-name "github-actions-aks-sample" \
  --query appId -o tsv
# Save the output — this is your AZURE_CLIENT_ID
```

```bash
# 3.3 Create a service principal for that app
APP_ID="<paste the appId from above>"
az ad sp create --id "$APP_ID"
```

```bash
# 3.4 Get your tenant and subscription IDs
az account show --query "{tenantId:tenantId, subscriptionId:id}" -o table
```

```bash
# 3.5 Create the federated credential, scoped to your repo's main branch
#     (This is the step that lets GitHub's token be trusted - no secret needed)
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-main-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<your-username>/<your-repo>:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

Also add one for manual `workflow_dispatch` runs (the `infra.yml` workflow
uses this trigger), since the subject claim differs slightly:

```bash
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-workflow-dispatch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<your-username>/<your-repo>:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

> Note: both subjects above are actually the same (`ref:refs/heads/main`)
> because both workflows run against `main`. You only need the first one
> unless you later trigger from a different branch/environment — GitHub's
> subject claim is based on the git ref, not the trigger type.

```bash
# 3.6 Grant Contributor on the subscription so the pipeline can create the
#     resource group + AKS cluster. (For tighter scoping later, you could
#     instead scope this to a specific resource group after first creating
#     it manually.)
SUB_ID="<your subscription id>"
az role assignment create \
  --assignee "$APP_ID" \
  --role "Contributor" \
  --scope "/subscriptions/$SUB_ID"
```

---

## 4. Add Azure secrets/variables to GitHub

In your GitHub repo: **Settings → Secrets and variables → Actions**

**Secrets:**
| Name | Value |
|---|---|
| `AZURE_CLIENT_ID` | appId from step 3.2 |
| `AZURE_TENANT_ID` | tenantId from step 3.4 |
| `AZURE_SUBSCRIPTION_ID` | subscriptionId from step 3.4 |
| `DOCKERHUB_TOKEN` | token from step 2 |

**Variables:**
| Name | Value |
|---|---|
| `DOCKERHUB_USERNAME` | your Docker Hub username |
| `AZURE_LOCATION` | e.g. `eastus` |
| `AKS_RESOURCE_GROUP` | `rg-aks-sample` (or your choice) |
| `AKS_CLUSTER_NAME` | `aks-sample-cluster` (or your choice) |

---

## 5. Run the infra pipeline

GitHub repo → **Actions → Infra - Provision AKS → Run workflow**.

This will:
1. Run Checkov against the Bicep files (soft-fail — review findings in the log)
2. Deploy the resource group + AKS cluster (~5-10 min)
3. Grant the CI service principal "Azure Kubernetes Service Cluster Admin
   Role" on the new cluster, so the next pipeline can deploy to it

**[Cloud Shell] Verify before moving on:**

```bash
az aks show -g rg-aks-sample -n aks-sample-cluster --query "{provisioningState:provisioningState, nodeCount:agentPoolProfiles[0].count, vmSize:agentPoolProfiles[0].vmSize}" -o table

az aks get-credentials -g rg-aks-sample -n aks-sample-cluster --admin --overwrite-existing
kubectl get nodes
```

You should see exactly 1 node, `Ready`.

---

## 6. Run the app CI/CD pipeline

Push any change under `app/` (or run **Actions → App CI/CD → Run workflow**
manually). This runs, in order:

1. **SAST** — CodeQL scans the JavaScript source (results appear in the
   repo's **Security → Code scanning alerts** tab)
2. **SCA** — `npm audit` fails the job on high/critical dependency
   vulnerabilities (moderate ones are logged but won't block)
3. **Build, scan & push** — builds the Docker image, scans it with Trivy
   (fails on CRITICAL; HIGH+CRITICAL findings are also uploaded to the
   Security tab), then pushes to Docker Hub
4. **Deploy** — installs the NGINX ingress controller via Helm (provisions
   your 2nd public IP) and applies the Kubernetes manifests

**[Cloud Shell] Verify:**

```bash
kubectl get pods -n sample-app
kubectl get pods -n ingress-nginx
kubectl get svc -n ingress-nginx ingress-nginx-controller
```

Grab the `EXTERNAL-IP` from the last command and test:

```bash
curl http://<EXTERNAL-IP>/
curl http://<EXTERNAL-IP>/health
```

---

## 7. Where to see the security scan results

- **CodeQL + Trivy findings**: GitHub repo → **Security → Code scanning**
- **npm audit**: Actions → App CI/CD → `sca` job log
- **Checkov (IaC)**: Actions → Infra - Provision AKS → `iac-scan` job log

---

## 8. Cost control / cleanup

To avoid burning student credit when you're not actively working on this:

```bash
az group delete --name rg-aks-sample --yes --no-wait
```

Re-run the infra workflow any time to recreate it (Bicep is idempotent).
The Free-tier AKS control plane costs nothing; you're only billed for the
single `Standard_B2s` VM, its disk, and the 2 public IPs while they exist.
