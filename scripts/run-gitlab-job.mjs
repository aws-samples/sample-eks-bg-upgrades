#!/usr/bin/env zx

import { $, path } from "zx";
import { fileURLToPath } from "url";
import { logger } from "./utils/index.mjs";
import dotenv from "dotenv";
$.verbose = true;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DIR = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(BASE_DIR, ".env.gitlab"), override: true });

async function getJobStatus(gitlabHost, apiToken, projectPath, jobId) {
  try {
    logger.info(`Getting job status - projectPath: ${projectPath}, jobId: ${jobId} `);
    const url = `${gitlabHost}/api/v4/projects/${projectPath}/jobs/${jobId}`;
    const result = await $`curl --header "PRIVATE-TOKEN: ${apiToken}" \
      --url ${url}`;
    const status = JSON.parse(result.stdout).status;
    return status;
  } catch (error) {
    logger.error("Error getJobStatus:", error);
    throw error;
  }
}

async function runAndWaitForJob(gitlabHost, apiToken, projectPath, jobId) {
  try {
    let status = await getJobStatus(gitlabHost, apiToken, projectPath, jobId);
    if (status !== "running") {
      logger.info(`Running job - projectPath: ${projectPath}, jobId: ${jobId}`);
      const url = `${gitlabHost}/api/v4/projects/${projectPath}/jobs/${jobId}/play`;
      logger.info(`URL: ${url}`);
      let result = await $`curl --request POST \
      --header "PRIVATE-TOKEN: ${apiToken}" \
      --header "Content-Type: application/json" \
      --url ${url}`;
    } else {
      logger.info(`Job is already running - projectPath: ${projectPath}, jobId: ${jobId}`);
    }

    status = "running";
    const startTime = Date.now();
    const retrySec = 60;
    while (status === "running" || status === "pending") {
      await new Promise((resolve) => setTimeout(resolve, retrySec * 1000));
      status = await getJobStatus(gitlabHost, apiToken, projectPath, jobId);
      const elapsedTime = Math.floor((Date.now() - startTime) / 60000);
      logger.info(`Job status: ${status}, Running for ${elapsedTime} minutes`);
    }

    if (status === "success") {
      logger.info("Job completed successfully!");
    } else {
      logger.error(`Job failed with status: ${status}`);
    }
  } catch (error) {
    logger.error("Error runAndWaitForJob:", error);
    throw error;
  }
}

async function main() {
  const gitlabHost = process.env.GITLAB_HOST;
  const apiToken = process.env.GITLAB_API_TOKEN;

  const jobId = process.argv[3];

  if (!jobId) {
    logger.error("Usage: ./scripts/rrun-gitlab-job.mjs <jobId>");
    process.exit(1);
  }

  if (!gitlabHost || !apiToken) {
    logger.error("GITLAB_HOST and GITLAB_API_TOKEN must be set in .env.gitlab");
    process.exit(1);
  }

  await runAndWaitForJob(gitlabHost, apiToken, "root%2Finfra", jobId);
}

main();
