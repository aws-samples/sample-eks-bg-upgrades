#!/usr/bin/env zx

import { $ } from "zx";
import { cluster, logger, terraform } from "./utils/index.mjs";
$.verbose = true;

async function main() {
  try {
    await logger.task("Create base infrastructure:");

    const environment_name = process.env.ENVIRONMENT_NAME;

    await logger.step("Step 1: Creating VPC");
    await terraform.init("vpc");
    await terraform.apply("vpc", { vars: { environment_name } });

    await logger.step("Step 2: Creating ALB and Target Groups");
    await terraform.init("alb");
    await terraform.apply("alb", { vars: { environment_name } });

    await logger.step("Step 3: Initialize cluster state file");
    const stateFile = await cluster.initState();

    await logger.step("Step 4: ALB URL Information");
    try {
      const albUrl = await terraform.getOutputValue("alb", "dns_name");
      await logger.info(`🌐 ALB URL: http://${albUrl}`);
      await logger.info(`ℹ️  Note: No applications deployed yet - URL will be active after cluster creation`);
    } catch (error) {
      await logger.error(`Could not retrieve ALB URL: ${error.message}`);
    }

    await logger.step("🎉 Create base infrastructure task completed successfully!");
    await logger.info("VPC, ALB, and target groups have been created");
    await logger.info(`Cluster state file initialized at: ${stateFile}`);
  } catch (error) {
    await logger.error(`Error creating base infrastructure, error: ${error.message}`);
    process.exit(1);
  }
}

main();
