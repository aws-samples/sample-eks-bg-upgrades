#!/usr/bin/env zx

import { $ } from "zx";
import { logger, terraform } from "./utils/index.mjs";
$.verbose = true;

async function main() {
  try {
    await logger.task("Setup:");

    await logger.step("Step 1: Creating Terraform backend resources");
    try {
      await terraform.createBackend();
    } catch (error) {
      await logger.error(error);
    }
    await logger.step(`🎉 Setup task completed successfully!`);
  } catch (error) {
    await logger.error(`Error setting up, error: ${error.message}`);
    process.exit(1);
  }
}

main();
