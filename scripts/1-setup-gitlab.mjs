#!/usr/bin/env zx

import { $, fs, path, sleep } from "zx";
import { fileURLToPath } from "url";
import { ec2, gitlabSetup, logger, shortDir, terraform } from "./utils/index.mjs";
$.verbose = true;

// Fix for ES modules - __dirname is not available
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DIR = path.resolve(__dirname, "..");
const TERRAFORM_DIR = path.join(BASE_DIR, "terraform/gitlab");
const OUTPUT_FILE = path.join(BASE_DIR, "gitlab-access.txt");
const PEM_FILE = path.join(TERRAFORM_DIR, "gitlab-server.pem");

async function main() {
  try {
    await logger.task("Setup GitLab server:");

    // Check if gitlab-access.txt already exists (retry scenario)
    let publicIp;
    let skipInfrastructureSetup = false;
    
    if (fs.existsSync(OUTPUT_FILE)) {
      await logger.debug("Found existing gitlab-access.txt file - checking if GitLab is still running...");
      
      // Set PEM file before any SSH operations
      ec2.setPemFile(PEM_FILE);
      
      try {
        const content = fs.readFileSync(OUTPUT_FILE, "utf8");
        const urlMatch = content.match(/GitLab URL: http:\/\/([^\s]+)/);
        
        if (urlMatch) {
          publicIp = urlMatch[1];
          await logger.debug(`Found existing GitLab IP: ${publicIp}`);
          
          const isHealthy = await gitlabSetup.validateExistingGitLab(publicIp);
          
          if (isHealthy) {
            await logger.info("✅ GitLab is still running - skipping infrastructure setup");
            skipInfrastructureSetup = true;
          } else {
            await logger.info("⚠️ GitLab not responding - will recreate infrastructure");
            fs.unlinkSync(OUTPUT_FILE);
          }
        }
      } catch (error) {
        await logger.info("⚠️ Could not validate existing GitLab - will recreate infrastructure");
        fs.unlinkSync(OUTPUT_FILE);
      }
    }

    if (!skipInfrastructureSetup) {
      ec2.setPemFile(PEM_FILE);
      const keyPairReady = await ec2.checkAndCreateKeyPair("gitlab-server", PEM_FILE);
      if (!keyPairReady) {
        logger.error("Cannot proceed without GitLab server keypair.");
        process.exit(1);
      }

      await logger.step("Step 1: Deploying GitLab infrastructure");
      await terraform.init("gitlab");
      await terraform.apply("gitlab");

      await logger.step("Step 2: Get instance information");
      publicIp = await terraform.getOutputValue("gitlab", "gitlab_public_ip");

      await logger.step("Step 3: Wait for instance to be ready for SSH");
      await sleep(30 * 1000);
      await ec2.waitForSshReady(publicIp);

      await logger.step("Step 4: Setting up GitLab container");
      await gitlabSetup.setupGitLabInfrastructure(publicIp, PEM_FILE, TERRAFORM_DIR);

      await logger.step("Step 5: Using predefined root password");
      await logger.debug("Using hardcoded password for easy troubleshooting: eks12345");
    } else {
      await logger.step("Step 5: Using existing GitLab instance");
      ec2.setPemFile(PEM_FILE);
    }

    const rootPassword = "eks12345";
    
    // Create access info file
    await gitlabSetup.createAccessInfoFile(publicIp, rootPassword, OUTPUT_FILE, PEM_FILE);
    
    await logger.info(`GitLab is now available at: http://${publicIp}`);
    await logger.info(`Username: root, Password: ${rootPassword}`);

    await logger.step("Step 6: Creating a GitLab project and pushing the repository");
    await sleep(15 * 1000);
    
    const token = await gitlabSetup.createPersonalAccessToken(publicIp, rootPassword);
    
    if (!token) {
      await logger.debug("Could not create personal access token. Will skip repository push.");
    } else {
      await gitlabSetup.initializeGitRepository(publicIp, token, BASE_DIR);
      await gitlabSetup.setupCICDIntegration(publicIp, token, rootPassword);
    }

    await logger.step("🎉 GitLab server setup task completed successfully!");
    await logger.info(`GitLab is now available at: http://${publicIp}`);
    await logger.info(`Username: root, Password: ${rootPassword}`);
  } catch (error) {
    await logger.error(`Error setting up GitLab server, error: ${error.message}`);
    process.exit(1);
  }
}

main();
