#!/usr/bin/env zx

import { $ } from "zx";
import { cluster, gitlab, logger, shortDir } from "./utils/index.mjs";
$.verbose = true;

const BRANCH_NAME = await cluster.getNextVersion();

async function main() {
  try {
    await logger.task(`Setup new GitOps branch for next version, branch: ${BRANCH_NAME}`);

    await logger.step("Step 1: Getting GitLab credentials...");
    const gitlabCreds = await gitlab.getCredentials();
    await logger.info(`GitLab credentials retrieved successfully for user: ${gitlabCreds.username}`);

    await logger.step("Step 2: Cloning the repository...");
    const repoUrl = `${gitlabCreds.baseUrl}/gitops`;
    const repoDir = await gitlab.cloneRepository(repoUrl, gitlabCreds.username, gitlabCreds.password);
    await logger.info(`Repository cloned successfully to: ${shortDir(repoDir)}`);

    await logger.step(`Step 3: Creating and pushing the '${BRANCH_NAME}' branch...`);
    await gitlab.createAndPushBranch(repoDir, BRANCH_NAME);
    await logger.info(`Branch '${BRANCH_NAME}' created and pushed successfully!`);

    await logger.step(`🎉 Setup GitOps branch for next version, branch: ${BRANCH_NAME} task completed successfully!`);
    await logger.info(`Branch '${BRANCH_NAME}' is now ready for the Green Cluster deployment.`);
  } catch (error) {
    await logger.error(`Error setting up GitOps branch for next version, branch: ${BRANCH_NAME}, error: ${error.message}`);
    process.exit(1);
  }
}

main();
