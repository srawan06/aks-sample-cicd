// Subscription-scope deployment: creates the resource group, then
// deploys AKS into it. Run with:
//   az deployment sub create --location eastus --template-file main.bicep
targetScope = 'subscription'

@description('Azure region for all resources')
param location string = 'eastus'

@description('Name of the resource group to create')
param resourceGroupName string = 'rg-aks-sample'

@description('Name of the AKS cluster')
param aksClusterName string = 'aks-sample-cluster'

@description('VM size for the single node pool - cheapest viable size')
param nodeVmSize string = 'Standard_B2s'

resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: resourceGroupName
  location: location
}

module aks 'aks.bicep' = {
  name: 'aksDeployment'
  scope: rg
  params: {
    location: location
    aksClusterName: aksClusterName
    nodeVmSize: nodeVmSize
  }
}

output resourceGroupName string = rg.name
output aksClusterName string = aksClusterName
