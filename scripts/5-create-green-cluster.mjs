#!/usr/bin/env zx

import { $ } from "zx";
import { cluster, gitlab, logger, terraform, getEksAdminRoleVars } from "./utils/index.mjs";
$.verbose = true;

const greenCluster = await cluster.getGreenClusterInfo(true);

async function main() {
  try {
    await logger.task(`Create Green Cluster: ${greenCluster.name}:`);

    await logger.step("Step 1: Getting GitLab credentials");
    const gitlabCreds = await gitlab.getCredentials();
    await logger.info(`GitLab credentials retrieved successfully for user: ${gitlabCreds.username}`);

    await logger.step("Step 2: Creating EKS cluster");
    await terraform.init(`eks`);

    const workspace = `cluster-${greenCluster.number}`;
    const varFile = "workspaces/base.tfvars";
    await terraform.apply("eks", {
      workspace,
      varFile,
      vars: {
        cluster_name: greenCluster.name,
        kubernetes_version: greenCluster.version,
        subnet_set: greenCluster.number,
        cluster_role: "green",
        gitlab_username: gitlabCreds.username,
        gitlab_password: gitlabCreds.password,
        revision_override: greenCluster.version,
        ...getEksAdminRoleVars()
      },
    });

    await logger.step("Step 3: Updating cluster state file");
    await cluster.updateState({
      GREEN_CLUSTER: greenCluster.name,
      GREEN_VERSION: greenCluster.version,
    });

    await logger.step("Step 4: Configuring kubectl");
    await cluster.configureKubectl(greenCluster.name);

    await logger.step("Step 5: Setting up ArgoCD load balancer access");
    await cluster.configureArgoCdAccess(greenCluster.name);

    await logger.step(`🎉 Create Green Cluster: ${greenCluster.name} task completed successfully!`);
    await logger.info(`Kubernetes version: ${greenCluster.version}`);
    await logger.info("Core EKS add-ons and ArgoCD have been installed.");
    await logger.info(`Cluster state file updated with GREEN_CLUSTER=${greenCluster.name}`);
  } catch (error) {
    await logger.error(`Error creating Green Cluster: ${greenCluster.name}, error: ${error.message}`);
    process.exit(1);
  }
}

main();
