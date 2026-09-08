@description('Azure region')
param location string

@description('AKS cluster name')
param aksClusterName string

@description('VM size for the single node')
param nodeVmSize string = 'Standard_B2s'

@description('Kubernetes version - leave empty to use AKS default')
param kubernetesVersion string = ''

resource aks 'Microsoft.ContainerService/managedClusters@2023-10-01' = {
  name: aksClusterName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'Base'
    tier: 'Free' // No SLA, no control-plane cost - fine for a learning cluster
  }
  properties: {
    kubernetesVersion: empty(kubernetesVersion) ? null : kubernetesVersion
    dnsPrefix: '${aksClusterName}-dns'
    enableRBAC: true
    disableLocalAccounts: false // keep simple kubeconfig auth for learning
    agentPoolProfiles: [
      {
        name: 'systempool'
        count: 1 // single-node constraint
        vmSize: nodeVmSize
        osType: 'Linux'
        osDiskSizeGB: 30
        mode: 'System'
        type: 'VirtualMachineScaleSets'
        maxPods: 30
      }
    ]
    networkProfile: {
      networkPlugin: 'kubenet' // no extra subnet/CNI setup needed
      loadBalancerSku: 'standard' // required; provisions AKS outbound public IP (#1 of your 3)
      outboundType: 'loadBalancer'
    }
    // Monitoring / Container Insights add-on deliberately OMITTED to avoid
    // Log Analytics ingestion costs on a student subscription.
  }
}

output aksClusterName string = aks.name
output aksPrincipalId string = aks.identity.principalId
