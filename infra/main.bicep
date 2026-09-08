// Resource-group-scope deployment (this Azure for Students subscription
// rejects subscription-scope AKS deployments with a generic
// "RequestDisallowedByAzure / best available regions" error, even though
// the exact same AKS spec succeeds when deployed at resource-group scope,
// or via `az aks create`. We create the resource group separately (see
// the infra.yml workflow's `az group create` step) and deploy this
// template into it. Run with:
//   az deployment group create --resource-group rg-aks-sample \
//     --template-file main.bicep --parameters location=uaenorth
targetScope = 'resourceGroup'

@description('Azure region for the AKS cluster')
param location string = 'uaenorth'

@description('Name of the AKS cluster')
param aksClusterName string = 'aks-sample-cluster'

@description('VM size for the single node pool')
param nodeVmSize string = 'Standard_B2s_v2'

module aks 'aks.bicep' = {
  name: 'aksDeployment'
  params: {
    location: location
    aksClusterName: aksClusterName
    nodeVmSize: nodeVmSize
  }
}

output aksClusterName string = aksClusterName
