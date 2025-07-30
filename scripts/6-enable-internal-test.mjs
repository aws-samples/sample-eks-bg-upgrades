#!/usr/bin/env zx

import { $ } from "zx";
import { cluster, logger, terraform } from "./utils/index.mjs";
$.verbose = true;

const greenCluster = await cluster.getGreenClusterInfo();

async function main() {
  try {
    await logger.task("Enable ALB rule for internal testing:");

    await logger.step("Step 1: Reading cluster state");
    const blueCluster = await cluster.getBlueClusterInfo();
    const greenCluster = await cluster.getGreenClusterInfo();
    await logger.info(`Found Blue Cluster: ${blueCluster.name}, Green Cluster: ${greenCluster.name}`);

    await logger.step("Step 2: Updating ALB configuration");
    await terraform.init("alb");

    await terraform.apply("alb", {
      vars: {
        enable_internal_test: "true",
        target_group_1_weight: blueCluster.number === 1 ? "100" : "0",
        target_group_2_weight: blueCluster.number === 2 ? "100" : "0",
      },
    });

    await logger.step("Step 3: Application Access Information");
    try {
      const albUrl = await terraform.getOutputValue("alb", "dns_name");
      await logger.info(`🌐 Production URL (Blue): http://${albUrl}`);
      await logger.info(`🧪 Internal Test URL (Green): http://${albUrl}?internal=true`);
      await logger.info(`🧪 Internal Test Header: X-Internal-Test: true`);
    } catch (error) {
      await logger.error(`Could not retrieve ALB URL: ${error.message}`);
    }

    await logger.step("🎉 Enable ALB rule for internal testing task completed successfully!");
    await logger.info(`Internal users can now access the Green Cluster: ${greenCluster.name}`);
  } catch (error) {
    await logger.error(`Error enabling ALB rule for internal testing, error: ${error.message}`);
    process.exit(1);
  }
}

main();
