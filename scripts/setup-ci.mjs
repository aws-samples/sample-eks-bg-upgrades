#!/usr/bin/env zx

import { $ } from "zx";
import { logger } from "./utils/index.mjs";
import fs from "fs";
import path from "path";
$.verbose = true;

async function main() {
  try {
    // Only run in CI mode
    if (process.env.CI !== 'true') {
      await logger.info("CI=false, skipping setup-ci.mjs");
      return;
    }

    await logger.task("Setting up CI environment:");

    // Read existing .env.local if it exists
    const envLocalPath = path.join(process.cwd(), '.env.local');
    let existingVars = {};
    
    if (fs.existsSync(envLocalPath)) {
      await logger.step("Reading existing .env.local file");
      const content = fs.readFileSync(envLocalPath, 'utf8');
      content.split('\n').forEach(line => {
        if (line.includes('=') && !line.startsWith('#')) {
          const [key, value] = line.split('=');
          if (key && value !== undefined) {
            existingVars[key.trim()] = value.trim();
          }
        }
      });
    }

    // Validate ACCOUNT_ID exists
    const accountId = existingVars.ACCOUNT_ID || process.env.ACCOUNT_ID;
    if (!accountId || accountId === 'YOUR_AWS_ACCOUNT_ID_HERE' || accountId === '') {
      await logger.error("❌ ACCOUNT_ID not found in .env.local");
      await logger.error("Please ensure your .env.local file contains:");
      await logger.error("ACCOUNT_ID=your-12-digit-aws-account-id");
      await logger.error("");
      await logger.error("You can find your AWS Account ID by running:");
      await logger.error("aws sts get-caller-identity --query 'Account' --output text");
      process.exit(1);
    }

    await logger.step("Validating required CI variables");

    // Validate required CI variables
    if (!process.env.GITLAB_PASSWORD || !process.env.GITLAB_HOST) {
      await logger.error("❌ Missing required GitLab CI variables:");
      await logger.error("GITLAB_PASSWORD and GITLAB_HOST must be set in GitLab CI/CD variables");
      process.exit(1);
    }

    await logger.step("Merging environment variables");

    // Merge variables with validation
    const mergedVars = {
      ...existingVars,
      // CI-provided GitLab variables (required in CI mode)
      GITLAB_PASSWORD: process.env.GITLAB_PASSWORD,
      GITLAB_HOST: process.env.GITLAB_HOST,
      // Validated ACCOUNT_ID
      ACCOUNT_ID: accountId,
      // Optional variables
      SLACK_BOT_TOKEN: existingVars.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN || ''
    };

    // Write merged .env.local
    const envContent = [
      '# Local environment variables - DO NOT COMMIT TO GIT',
      '# This file is auto-generated in CI mode',
      '',
      ...Object.entries(mergedVars)
        .filter(([key, value]) => key && value !== undefined)
        .map(([key, value]) => `${key}=${value}`)
    ].join('\n');
    
    fs.writeFileSync(envLocalPath, envContent);
    
    await logger.info("✅ CI environment configured successfully");
    await logger.info(`Using AWS Account ID: ${accountId}`);
    await logger.info(`GitLab Host: ${process.env.GITLAB_HOST}`);

  } catch (error) {
    await logger.error(`Error setting up CI environment: ${error.message}`);
    process.exit(1);
  }
}

main();
