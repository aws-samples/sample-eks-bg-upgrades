#!/usr/bin/env zx

import { $ } from "zx";
import { ec2, gitlab, logger, terraform } from "./utils/index.mjs";
$.verbose = true;

async function main() {
  try {
    await logger.task("Destroy GitLab infrastructure:");

    await logger.step("Step 1: Destroying GitLab instance");
    try {
      await terraform.destroy("gitlab");
      await logger.debug("GitLab instance destroyed successfully");
    } catch (error) {
      await logger.error(`Warning: Could not destroy GitLab instance: ${error.message}`);
      // Continue with other cleanup steps
    }

    await logger.step("Step 2: Cleaning up GitLab access files");
    try {
      await gitlab.cleanup();
      await logger.debug("GitLab access files cleaned up successfully");
    } catch (error) {
      await logger.error(`Warning: Could not clean up GitLab access files: ${error.message}`);
      // Continue with other cleanup steps
    }

    await logger.step("Step 3: Cleaning up EC2 keypairs and temporary files");
    try {
      await ec2.cleanup();
      await logger.debug("EC2 cleanup completed successfully");
    } catch (error) {
      await logger.error(`Warning: Could not complete EC2 cleanup: ${error.message}`);
      // Continue with other cleanup steps
    }

    await logger.step("Step 4: Cleaning up Terraform backend");
    try {
      await terraform.deleteBackend();
      await logger.debug("Terraform backend S3 bucket deleted successfully");
    } catch (error) {
      await logger.error(`Warning: Could not delete Terraform backend: ${error.message}`);
      await logger.error("You may need to manually delete the S3 bucket");
      // Don't fail the entire cleanup for this
    }

    await logger.step("Step 5: Final cleanup of temporary directories");
    try {
      // Clean up any remaining temporary directories
      await $`rm -rf .temp/`;
      await logger.debug("Temporary directories cleaned up successfully");
    } catch (error) {
      await logger.error(`Warning: Could not clean up temporary directories: ${error.message}`);
      // Don't fail the entire cleanup for this
    }

    await logger.step(`🎉 Destroy GitLab infrastructure task completed successfully!`);
    await logger.info("All infrastructure has been completely removed.");
    await logger.info("You can now safely delete this project directory if desired.");
  } catch (error) {
    await logger.error(`Error destroying GitLab infrastructure, error: ${error.message}`);
    process.exit(1);
  }
}

main();
