import { BASE_DIR, shortDir } from "./base.mjs";
import logger from "./logger.mjs";

import fs from "fs";
import path from "path";
import { $ } from "zx";

class EC2 {
  #pemFile = null;
  #tempDir = null;

  constructor() {
    this.#tempDir = path.join(BASE_DIR, ".temp", "ec2-scripts");
    // Ensure temp directory exists
    fs.mkdirSync(this.#tempDir, { recursive: true });
  }

  setPemFile(pemFilePath) {
    this.#pemFile = pemFilePath;
  }

  async checkAndCreateKeyPair(keyName, pemFile) {
    logger.debug(`Checking for ${keyName} keypair at ${shortDir(pemFile)}`);
    
    // First check if keypair exists in AWS
    let keypairExistsInAWS = false;
    try {
      await $`aws ec2 describe-key-pairs --key-names ${keyName}`;
      keypairExistsInAWS = true;
      logger.debug(`Keypair ${keyName} exists in AWS`);
    } catch (error) {
      // Keypair doesn't exist in AWS
      logger.debug(`Keypair ${keyName} does not exist in AWS`);
    }
    
    // Check if local PEM file exists
    let pemFileExists = false;
    try {
      await fs.promises.access(pemFile);
      pemFileExists = true;
      logger.debug(`Local PEM file exists at ${shortDir(pemFile)}`);
    } catch (error) {
      logger.debug(`Local PEM file does not exist`);
    }
    
    // Handle different scenarios
    if (keypairExistsInAWS && pemFileExists) {
      // Both exist - use existing
      logger.info(`Using existing keypair: ${keyName}`);
      return true;
    } else if (keypairExistsInAWS && !pemFileExists) {
      // Keypair exists in AWS but no local PEM file - auto-recovery
      logger.debug(`Keypair exists in AWS but PEM file missing. Recreating keypair...`);
      try {
        await $`aws ec2 delete-key-pair --key-name ${keyName}`;
        logger.debug(`Deleted existing keypair from AWS`);
      } catch (deleteError) {
        logger.error(`Failed to delete existing keypair: ${deleteError.message}`);
      }
      // Fall through to create new keypair
    } else if (!keypairExistsInAWS && pemFileExists) {
      // PEM file exists but no AWS keypair - delete local file
      logger.debug(`PEM file exists but no AWS keypair. Removing local PEM file...`);
      try {
        await fs.promises.unlink(pemFile);
      } catch (unlinkError) {
        logger.error(`Failed to remove local PEM file: ${unlinkError.message}`);
      }
      // Fall through to create new keypair
    }
    
    // Create new keypair
    logger.debug(`Creating new keypair...`);
    try {
      await $`aws ec2 create-key-pair --key-name ${keyName} --key-type rsa --key-format pem --query "KeyMaterial" --output text > ${pemFile}`;
      await $`chmod 400 ${pemFile}`;
      logger.info(`${keyName} keypair created successfully.`);
      return true;
    } catch (createError) {
      logger.error(`Error creating keypair: ${createError.message}`);
      throw createError;
    }
  }

  async waitForSshReady(host, maxAttempts = 30) {
    logger.debug(`Waiting for SSH to be ready on ${host}`);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.execute(host, 'echo "SSH is ready"', { timeout: 5, ignoreError: true });
        logger.info("SSH connection established!");
        return true;
      } catch (error) {
        logger.debug(`Attempt ${attempt}/${maxAttempts}: SSH not ready yet, waiting...`);
        await new Promise((res) => setTimeout(res, 10 * 1000));
      }
    }
    throw new Error("SSH connection could not be established after maximum attempts");
  }

  async execute(host, command, options = {}) {
    const pemFile = options.pemFile || this.#pemFile;
    const sshOptions = ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-i", pemFile];
    const user = options.user || "ubuntu";
    const timeout = options.timeout || 60;
    logger.debug(`Executing on ${host}: ${command}`);

    // Use absolute path for local temp script
    const tempScriptPath = path.join(this.#tempDir, `temp_script_${Date.now()}.sh`);
    // But just the filename for remote operations
    const tempScriptName = path.basename(tempScriptPath);

    try {
      const scriptContent = `#!/bin/bash\n${command}`;
      
      // Debug logging
      logger.debug(`Creating temp script at: ${tempScriptPath}`);
      logger.debug(`Script content length: ${scriptContent.length} bytes`);
      
      await fs.promises.writeFile(tempScriptPath, scriptContent);
      
      // Verify file was created
      try {
        const stats = await fs.promises.stat(tempScriptPath);
        logger.debug(`Temp script created successfully: ${stats.size} bytes`);
      } catch (statError) {
        logger.error(`Failed to stat temp script: ${statError.message}`);
      }
      
      // Debug zx environment
      logger.debug(`zx shell: ${$.shell}`);
      logger.debug(`Current directory: ${process.cwd()}`);
      
      await $`chmod +x ${tempScriptPath}`;
      await $`scp ${sshOptions} ${tempScriptPath} ${user}@${host}:/tmp/${tempScriptName}`;
      const result = await $`ssh ${sshOptions} -o ConnectTimeout=${timeout} ${user}@${host} sudo -i bash /tmp/${tempScriptName}`;
      await $`ssh ${sshOptions} ${user}@${host} rm /tmp/${tempScriptName}`;

      // Always clean up the local temp file
      try {
        await fs.promises.unlink(tempScriptPath);
      } catch (cleanupError) {
        logger.error(`Warning: Could not remove temp script ${tempScriptPath}: ${cleanupError.message}`);
      }

      return result.stdout.trim();
    } catch (error) {
      // Clean up even if command fails
      try {
        await fs.promises.unlink(tempScriptPath);
      } catch (cleanupError) {
        // Ignore cleanup errors in error path
      }

      logger.error(`Error SSH command failed, error: ${error.message}`);
      if (options.ignoreError) {
        return "";
      }
      throw error;
    }
  }

  async cleanup() {
    logger.debug("Cleaning up EC2 temporary script files...");
    try {
      // Clean up any temp scripts in common locations
      const searchPaths = [this.#tempDir, BASE_DIR, path.join(BASE_DIR, "terraform", "gitlab")];

      let totalCleaned = 0;

      for (const searchPath of searchPaths) {
        try {
          const files = await fs.promises.readdir(searchPath);
          for (const file of files) {
            if (file.startsWith("temp_script_") && file.endsWith(".sh")) {
              const filePath = path.join(searchPath, file);
              await fs.promises.unlink(filePath);
              totalCleaned++;
            }
          }
        } catch (error) {
          // Ignore errors for directories that don't exist
        }
      }

      if (totalCleaned > 0) {
        logger.debug(`Cleaned up ${totalCleaned} temporary script files`);
      } else {
        logger.debug("No temporary script files to clean up");
      }
    } catch (error) {
      logger.error(`Error cleaning up temporary script files: ${error.message}`);
    }
  }
}

export default new EC2();
