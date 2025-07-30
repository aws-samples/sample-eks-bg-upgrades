#!/usr/bin/env zx

import { $ } from "zx";
import { cluster, gitlab, logger, shortDir, terraform, getEksAdminRoleVars } from "./utils/index.mjs";
$.verbose = true;

const blueCluster = await cluster.getBlueClusterInfo();
const version = blueCluster.version;

async function main() {
  try {
    await logger.task(`Merge new GitOps branch: ${version} into main branch`);

    await logger.step("Step 1: Getting GitLab credentials...");
    const gitlabCreds = await gitlab.getCredentials();
    await logger.info(`GitLab credentials retrieved successfully for user: ${gitlabCreds.username}`);

    await logger.step("Step 2: Cloning the repository...");
    const repoUrl = `${gitlabCreds.baseUrl}/gitops`;
    const repoDir = await gitlab.cloneRepository(repoUrl, gitlabCreds.username, gitlabCreds.password);
    await logger.info(`Repository cloned successfully to: ${shortDir(repoDir)}`);

    await logger.step("Step 3: Merging branch into main");
    await gitlab.mergeAndPushBranch(repoDir, version);

    await logger.step("Step 4: Updating ArgoCD in Blue Cluster to point to main branch");
    await terraform.init(`eks`);

    // This will update the revision to point to main branch
    const workspace = `cluster-${blueCluster.number}`;
    const varFile = "workspaces/base.tfvars";
    await terraform.apply("eks", {
      workspace,
      varFile,
      vars: {
        cluster_name: blueCluster.name,
        kubernetes_version: version,
        subnet_set: blueCluster.number,
        cluster_role: "blue", // Ensure blue cluster maintains blue role
        gitlab_username: gitlabCreds.username,
        gitlab_password: gitlabCreds.password,
        revision_override: "main",
        ...getEksAdminRoleVars()
      },
    });

    await logger.step(`🎉 Merge new GitOps branch: ${version} into main branch task completed successfully!`);
    await logger.info(`ArgoCD has been updated to point to the main branch`);
  } catch (error) {
    await logger.error(`Error merging new GitOps branch: ${version} into main branch, error: ${error.message}`);
    process.exit(1);
  }
}

main();
