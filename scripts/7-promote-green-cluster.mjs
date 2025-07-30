#!/usr/bin/env zx

import { $ } from "zx";
import { cluster, gitlab, logger, terraform, getEksAdminRoleVars } from "./utils/index.mjs";
$.verbose = true;

const blueCluster = await cluster.getBlueClusterInfo();
const greenCluster = await cluster.getGreenClusterInfo();

async function main() {
  try {
    await logger.task(`Promote Green Cluster: ${greenCluster.name} to Production:`);

    await logger.step("Step 1: Getting GitLab credentials");
    const gitlabCreds = await gitlab.getCredentials();
    await logger.info(`GitLab credentials retrieved successfully for user: ${gitlabCreds.username}`);

    await logger.step("Step 2: Switching cluster roles - Green becomes Blue");
    await terraform.init("eks");

    // Update green cluster to have blue role
    const greenWorkspace = `cluster-${greenCluster.number}`;
    const varFile = "workspaces/base.tfvars";
    await terraform.apply("eks", {
      workspace: greenWorkspace,
      varFile,
      vars: {
        cluster_name: greenCluster.name,
        kubernetes_version: greenCluster.version,
        subnet_set: greenCluster.number,
        cluster_role: "blue", // Green cluster becomes blue
        gitlab_username: gitlabCreds.username,
        gitlab_password: gitlabCreds.password,
        revision_override: "main",
        ...getEksAdminRoleVars()
      },
    });

    // Update blue cluster to have green role
    const blueWorkspace = `cluster-${blueCluster.number}`;
    await terraform.apply("eks", {
      workspace: blueWorkspace,
      varFile,
      vars: {
        cluster_name: blueCluster.name,
        kubernetes_version: blueCluster.version,
        subnet_set: blueCluster.number,
        cluster_role: "green", // Blue cluster becomes green
        gitlab_username: gitlabCreds.username,
        gitlab_password: gitlabCreds.password,
        revision_override: "main",
        ...getEksAdminRoleVars()
      },
    });

    await logger.step("Step 3: Updating ALB configuration");
    await terraform.init(`alb`);

    // Send 100% to the newly promoted cluster
    await logger.info(`Set traffic 100% to Cluster: ${greenCluster.name} and 0% to Cluster: ${blueCluster.name}`);
    await terraform.apply("alb", {
      vars: {
        enable_internal_test: "false",
        target_group_1_weight: greenCluster.number === 1 ? "100" : "0",
        target_group_2_weight: greenCluster.number === 2 ? "100" : "0",
      },
    });

    await logger.step("Step 4: Updating cluster state file");
    await cluster.updateState({
      BLUE_CLUSTER: greenCluster.name,
      BLUE_VERSION: greenCluster.version,
      GREEN_CLUSTER: blueCluster.name,
      GREEN_VERSION: blueCluster.version,
    });

    await logger.step("Step 5: Application Access Information");
    try {
      const albUrl = await terraform.getOutputValue("alb", "dns_name");
      await logger.info(`🌐 Production URL (Now Green): http://${albUrl}`);
      await logger.info(`✅ All traffic now directed to the promoted cluster`);
    } catch (error) {
      await logger.error(`Could not retrieve ALB URL: ${error.message}`);
    }

    await logger.step(`🎉 Promote Green Cluster: ${greenCluster.name} to Production task completed successfully!`);
    await logger.info(`Cluster ${greenCluster.name} is now the production (Blue Cluster)`);
    await logger.info(`All traffic is now directed to the new cluster`);
    await logger.info(`Kubernetes version has been updated to ${greenCluster.version}`);
  } catch (error) {
    await logger.error(`Error promoting Green Cluster: ${greenCluster.name} to Production, error: ${error.message}`);
    process.exit(1);
  }
}

main();
