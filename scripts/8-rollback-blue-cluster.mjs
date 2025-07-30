#!/usr/bin/env zx

import { $ } from "zx";
import { cluster, gitlab, logger, terraform, getEksAdminRoleVars } from "./utils/index.mjs";
$.verbose = true;

const blueCluster = await cluster.getBlueClusterInfo();
const greenCluster = await cluster.getGreenClusterInfo();

async function main() {
  try {
    await logger.task(`Rollback Blue Cluster: ${blueCluster.name} from Production:`);

    await logger.step("Step 1: Getting GitLab credentials");
    const gitlabCreds = await gitlab.getCredentials();
    await logger.info(`GitLab credentials retrieved successfully for user: ${gitlabCreds.username}`);

    await logger.step("Step 2: Switching cluster roles back - Rollback");
    await terraform.init("eks");

    // Update current blue cluster back to green role
    const blueWorkspace = `cluster-${blueCluster.number}`;
    const varFile = "workspaces/base.tfvars";
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

    // Update current green cluster back to blue role
    const greenWorkspace = `cluster-${greenCluster.number}`;
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

    await logger.step("Step 3: Updating ALB configuration");
    await terraform.init(`alb`);

    await logger.info(`Set traffic 100% to Cluster: ${greenCluster.name} and 0% to Cluster: ${blueCluster.name}`);
    await terraform.apply("alb", {
      vars: {
        enable_internal_test: "true",
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
      await logger.info(`🌐 Production URL (Rolled Back): http://${albUrl}`);
      await logger.info(`🔄 Traffic rolled back to previous cluster`);
    } catch (error) {
      await logger.error(`Could not retrieve ALB URL: ${error.message}`);
    }

    await logger.step(`🎉 Rollback Blue Cluster: ${blueCluster.name} from Production task completed successfully!`);
    await logger.info(`Cluster ${greenCluster.name} is now the production (Blue Cluster)`);
    await logger.info(`All traffic is now directed to the new cluster`);
    await logger.info(`Kubernetes version has been updated to ${greenCluster.version}`);
  } catch (error) {
    await logger.error(`Error rolling back Blue Cluster: ${blueCluster.name} from Production, error: ${error.message}`);
    process.exit(1);
  }
}

main();
