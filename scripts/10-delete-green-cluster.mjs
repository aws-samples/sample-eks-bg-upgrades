#!/usr/bin/env zx

import { $ } from "zx";
import { cluster, logger, terraform, getEksAdminRoleVars } from "./utils/index.mjs";
$.verbose = true;

const greenCluster = await cluster.getGreenClusterInfo();

async function main() {
  try {
    await logger.task(`Delete Green Cluster: ${greenCluster.name}:`);

    await logger.step(`Step 1: Cleaning up Green Cluster: ${greenCluster.name}`);
    await cluster.cleanupCluster(greenCluster.name);

    await logger.step(`Step 2: Deleting Green Cluster: ${greenCluster.name}`);
    const workspace = `cluster-${greenCluster.number}`;
    
    // Initialize Terraform for EKS module (required before working with workspaces)
    await terraform.init("eks");
    
    // Clean up Kubernetes/Helm resources from state before destroy
    await terraform.cleanupEksState(workspace);
    
    // Destroy remaining AWS resources
    await terraform.destroy("eks", { 
      workspace,
      vars: getEksAdminRoleVars()
    });

    await logger.step(`Step 3: Updating cluster state file`);
    await cluster.updateState({
      GREEN_CLUSTER: "",
      GREEN_VERSION: "",
    });

    await logger.step(`🎉 Delete Green Cluster: ${greenCluster.name} task completed successfully!`);
  } catch (error) {
    await logger.error(`Error deleting Green Cluster: ${greenCluster.name}, error: ${error.message}`);
    process.exit(1);
  }
}

main();
