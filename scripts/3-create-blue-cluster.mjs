#!/usr/bin/env zx

import { $ } from "zx";
import { cluster, gitlab, logger, terraform, getEksAdminRoleVars } from "./utils/index.mjs";
$.verbose = true;

const CLUSTER_NAME = `${process.env.ENVIRONMENT_NAME}-cluster-1`;
const KUBERNETES_VERSION = process.env.KUBERNETES_VERSION; // Version N

async function main() {
  try {
    await logger.task(`Create Blue Cluster: ${CLUSTER_NAME}:`);

    await logger.step("Step 1: Getting GitLab credentials");
    const gitlabCreds = await gitlab.getCredentials();
    await logger.info(`GitLab credentials retrieved successfully for user: ${gitlabCreds.username}`);

    await logger.step("Step 2: Creating EKS cluster");
    await terraform.init("eks");

    const workspace = "cluster-1";
    const varFile = "workspaces/base.tfvars";
    await terraform.apply("eks", {
      workspace,
      varFile,
      vars: {
        cluster_name: CLUSTER_NAME,
        kubernetes_version: KUBERNETES_VERSION,
        subnet_set: 1,
        cluster_role: "blue",
        gitlab_username: gitlabCreds.username,
        gitlab_password: gitlabCreds.password,
        ...getEksAdminRoleVars()
      },
    });

    await logger.step("Step 3: Updating cluster state file");
    await cluster.updateState({
      BLUE_CLUSTER: CLUSTER_NAME,
      BLUE_VERSION: KUBERNETES_VERSION,
    });

    await logger.step("Step 4: Configuring kubectl");
    await cluster.configureKubectl(CLUSTER_NAME);

    await logger.step("Step 5: Setting up ArgoCD load balancer access");
    await cluster.configureArgoCdAccess(CLUSTER_NAME);

    await logger.step("Step 6: Application Access Information");
    try {
      const albUrl = await terraform.getOutputValue("alb", "dns_name");
      await logger.info(`🌐 Blue Cluster Application URL: http://${albUrl}`);
    } catch (error) {
      await logger.error(`Could not retrieve ALB URL: ${error.message}`);
    }

    await logger.step(`🎉 Create Blue Cluster: ${CLUSTER_NAME} task completed successfully!`);
    await logger.info(`Kubernetes version: ${KUBERNETES_VERSION}`);
    await logger.info("Core EKS add-ons and ArgoCD have been installed.");
    await logger.info(`Cluster state file updated with BLUE_CLUSTER=${CLUSTER_NAME}`);
  } catch (error) {
    await logger.error(`Error creating Blue Cluster: ${CLUSTER_NAME}, error: ${error.message}`);
    process.exit(1);
  }
}

main();
