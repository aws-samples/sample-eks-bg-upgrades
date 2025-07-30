#!/usr/bin/env zx

import { $ } from "zx";
import { cluster, ec2, gitlab, logger, terraform, getEksAdminRoleVars } from "./utils/index.mjs";
$.verbose = true;

async function main() {
  try {
    await logger.task("Destroy workload infrastructure:");

    await logger.step("Step 1: Cleaning up all EKS clusters");
    
    // Initialize Terraform for EKS module
    await terraform.init("eks");
    
    // Force cleanup all known workspace patterns
    const knownWorkspaces = ['cluster-1', 'cluster-2'];
    
    for (const workspace of knownWorkspaces) {
      try {
        await logger.debug(`Attempting to clean up workspace: ${workspace}`);
        
        // Extract cluster number and name for kubectl cleanup
        const clusterNumber = workspace.replace('cluster-', '');
        const clusterName = `eks-upgrade-cluster-${clusterNumber}`;
        
        // Clean up kubectl config and ArgoCD (safe if cluster doesn't exist)
        try {
          await cluster.cleanupCluster(clusterName);
        } catch (error) {
          await logger.debug(`Cluster ${clusterName} not found in kubectl config: ${error.message}`);
        }
        
        // Clean up Kubernetes/Helm resources from state before destroy
        await terraform.cleanupEksState(workspace);
        
        // Destroy remaining AWS resources
        await terraform.destroy("eks", { 
          workspace,
          vars: getEksAdminRoleVars()
        });
        
        await logger.info(`✅ Successfully cleaned up workspace: ${workspace}`);
      } catch (error) {
        await logger.debug(`⚠️ Workspace ${workspace} doesn't exist or already cleaned up: ${error.message}`);
      }
    }

    await logger.step("Step 3: Destroying ALB");
    await terraform.init("alb");
    await terraform.destroy("alb");

    await logger.step("Step 4: Destroying VPC");
    await terraform.init("vpc");
    await terraform.destroy("vpc");

    await logger.step("Step 5: Cleaning up cluster state and temporary files");
    await cluster.deleteState();
    await ec2.cleanup();

    await logger.step("Step 6: Cleaning up CI/CD temporary files");
    try {
      // Clean up any temporary directories created during CI/CD operations
      await $`rm -rf .temp/`;
      
      // Clean up any Git configuration that might have been set during CI operations
      if (process.env.CI === 'true') {
        await logger.debug("Cleaning up CI-specific configurations...");
        // Git config cleanup is handled automatically as it's local to the runner
        await logger.debug("CI cleanup completed");
      }
      
      await logger.debug("Temporary files cleaned up successfully");
    } catch (error) {
      await logger.error(`Warning: Could not clean up temporary files: ${error.message}`);
      // Don't fail the entire cleanup for this
    }

    await logger.step(`🎉 Destroy workload infrastructure task completed successfully!`);
    await logger.info("Note: GitLab infrastructure is preserved. Use cleanup-gitlab.mjs to remove GitLab when completely done.");
  } catch (error) {
    await logger.error(`Error destroying workload infrastructure, error: ${error.message}`);
    process.exit(1);
  }
}

main();
