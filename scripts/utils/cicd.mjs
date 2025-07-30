#!/usr/bin/env zx

import { $, cd, fs, path, sleep } from "zx";
import { fileURLToPath } from "url";
import { ec2, logger } from "./index.mjs";

// Fix for ES modules - __dirname is not available
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DIR = path.resolve(__dirname, "../..");

/**
 * Main CI/CD setup function
 * Sets up GitLab Runner, CI/CD variables, and creates infrastructure repository
 */
export async function setupCICD(publicIp, token, rootPassword) {
  await logger.step("Step 7: Setting up CI/CD automation");
  
  try {
    // Install GitLab Runner and tools
    await installGitLabRunner(publicIp);
    
    // Get runner registration token
    const runnerToken = await getRunnerRegistrationToken(publicIp, token);
    
    // Register GitLab Runner
    await registerGitLabRunner(publicIp, runnerToken);
    
    // Set up CI/CD variables
    await setGitLabCIVariables(publicIp, token, rootPassword);
    
    // Create infrastructure repository
    await createInfraRepository(publicIp, token, rootPassword);
    
    await logger.info("✅ CI/CD setup completed successfully");
    
  } catch (error) {
    await logger.error(`❌ CI/CD setup failed: ${error.message}`);
    throw error;
  }
}

/**
 * Install GitLab Runner and required tools on the GitLab instance
 */
async function installGitLabRunner(publicIp) {
    await logger.debug("Installing GitLab Runner and CI/CD tools...");
  
  const installCmd = `
    # Update system
    sudo apt-get update
    
    # Install required utilities
    sudo apt-get install -y unzip
    
    # Install GitLab Runner
    curl -L "https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh" | sudo bash
    sudo apt-get install gitlab-runner -y
    
    # Install Node.js 18
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    
    # Install Yarn
    sudo npm install -g yarn
    
    # Install Terraform
    wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
    sudo apt update && sudo apt install terraform -y
    
    # Install AWS CLI v2
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip awscliv2.zip
    sudo ./aws/install
    rm -rf aws awscliv2.zip
    
    # Install kubectl with cascading fallbacks: curl -> snap -> apt
    echo "Installing kubectl..."
    
    # Method 1: Try direct download from Kubernetes releases
    if curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" 2>/dev/null && [ -f kubectl ] && [ -s kubectl ]; then
      echo "✅ Downloaded kubectl via curl"
      sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
      rm kubectl
    elif sudo snap install kubectl --classic 2>/dev/null; then
      echo "✅ Installed kubectl via snap"
    else
      echo "⚠️ Direct download and snap failed, using apt package manager..."
      
      # Method 3: APT package manager
      sudo apt-get update
      sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
      
      # Add Kubernetes apt repository
      sudo mkdir -p -m 755 /etc/apt/keyrings
      curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.33/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg 2>/dev/null || {
        echo "⚠️ Failed to add Kubernetes GPG key, trying alternative method..."
        curl -s https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key add -
        echo "deb https://apt.kubernetes.io/ kubernetes-xenial main" | sudo tee /etc/apt/sources.list.d/kubernetes.list
      }
      
      if [ -f /etc/apt/keyrings/kubernetes-apt-keyring.gpg ]; then
        sudo chmod 644 /etc/apt/keyrings/kubernetes-apt-keyring.gpg
        echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.33/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
        sudo chmod 644 /etc/apt/sources.list.d/kubernetes.list
      fi
      
      # Install kubectl
      sudo apt-get update
      sudo apt-get install -y kubectl
      echo "✅ Installed kubectl via apt"
    fi
    
    # Verify installations
    echo "=== Installation Verification ==="
    gitlab-runner --version
    node --version
    yarn --version
    zx --version
    terraform --version
    aws --version
    kubectl version --client
  `;
  
  await ec2.execute(publicIp, installCmd);
  await logger.info("✅ GitLab Runner and tools installed successfully");
}

/**
 * Get the runner registration token from GitLab
 */
async function getRunnerRegistrationToken(publicIp, token) {
    await logger.debug("Getting GitLab Runner registration token...");
  
  // Use Rails console to get the runner registration token
  // The API endpoint method is deprecated in newer GitLab versions
  const getTokenCmd = `
    /usr/bin/docker exec gitlab gitlab-rails runner "puts Gitlab::CurrentSettings.runners_registration_token"
  `;
  
  try {
    const output = await ec2.execute(publicIp, getTokenCmd);
    // Extract the token from the output (it might include warnings)
    const lines = output.trim().split('\n');
    let runnerToken = '';
    
    // Find the actual token (skip warning lines)
    for (const line of lines) {
      if (line && !line.includes('WARNING') && !line.includes('composite primary key')) {
        runnerToken = line.trim();
        break;
      }
    }
    
    if (!runnerToken) {
      throw new Error("Failed to get runner registration token");
    }
    
    await logger.info("✅ Runner registration token obtained");
    return runnerToken;
  } catch (error) {
    await logger.error(`Failed to get runner registration token: ${error.message}`);
    throw error;
  }
}

/**
 * Register GitLab Runner with the GitLab instance
 */
async function registerGitLabRunner(publicIp, runnerToken) {
    await logger.debug("Registering GitLab Runner...");
  
  const registerCmd = `
    sudo gitlab-runner register \\
      --non-interactive \\
      --url "http://${publicIp}" \\
      --registration-token "${runnerToken}" \\
      --executor "shell" \\
      --description "GitLab Runner - Shell Executor" \\
      --tag-list "shell,aws,terraform,nodejs" \\
      --run-untagged="true" \\
      --locked="false" \\
      --access-level="not_protected"
  `;
  
  try {
    await ec2.execute(publicIp, registerCmd);
    
    // Start the runner service
    await ec2.execute(publicIp, "sudo gitlab-runner start");
    
    await logger.info("✅ GitLab Runner registered and started successfully");
  } catch (error) {
    await logger.error(`Failed to register GitLab Runner: ${error.message}`);
    throw error;
  }
}

/**
 * Set GitLab CI/CD global variables
 */
async function setGitLabCIVariables(publicIp, token, rootPassword) {
    await logger.debug("Setting GitLab CI/CD global variables...");
  
  // Get values from environment and parameters
  const variables = {
    GITLAB_PASSWORD: rootPassword, // Use the actual GitLab root password for web login
    GITLAB_API_TOKEN: token,       // Store PAT separately for API calls
    GITLAB_HOST: `http://${publicIp}`,
    ACCOUNT_ID: process.env.ACCOUNT_ID || '',
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || '',
    AWS_REGION: process.env.REGION || 'ap-southeast-1'
  };
  
  for (const [key, value] of Object.entries(variables)) {
    if (value) {
      const createVarCmd = `
        curl -s -X POST "http://${publicIp}/api/v4/admin/ci/variables" \\
          -H "PRIVATE-TOKEN: ${token}" \\
          -F "key=${key}" \\
          -F "value=${value}" \\
          -F "variable_type=env_var" \\
          -F "protected=false" \\
          -F "masked=false"
      `;
      
      try {
        await ec2.execute(publicIp, createVarCmd, { ignoreError: true });
        await logger.debug(`✅ Set CI variable: ${key}`);
      } catch (error) {
        await logger.error(`Failed to set CI variable ${key}: ${error.message}`);
      }
    }
  }
  
  await logger.info("✅ CI/CD variables configured");
}

/**
 * Create and populate the infrastructure repository
 */
async function createInfraRepository(publicIp, token, rootPassword) {
    await logger.debug("Creating infrastructure repository...");
  
  // Create infra project via API
  const createInfraProjectCmd = `
    curl -s -X POST "http://${publicIp}/api/v4/projects" \\
      -H "PRIVATE-TOKEN: ${token}" \\
      -F "name=infra" \\
      -F "visibility=private" \\
      -F "initialize_with_readme=false"
  `;
  
  await ec2.execute(publicIp, createInfraProjectCmd, { ignoreError: true });
  
  // Create temporary directory for infra repo
  const tempDir = `${BASE_DIR}/.temp`;
  await $`mkdir -p ${tempDir}`;
  const infraRepoDir = path.join(tempDir, "infra-repo-" + Date.now());
  await fs.promises.mkdir(infraRepoDir, { recursive: true });
  
  try {
    await logger.debug("Copying infrastructure files to infra repository...");
    
    // Copy scripts folder
    await $`cp -r ${BASE_DIR}/scripts ${infraRepoDir}/`;
    
    // Copy terraform folder (excluding gitlab)
    await $`mkdir -p ${infraRepoDir}/terraform`;
    await $`cp -r ${BASE_DIR}/terraform/vpc ${infraRepoDir}/terraform/`;
    await $`cp -r ${BASE_DIR}/terraform/eks ${infraRepoDir}/terraform/`;
    await $`cp -r ${BASE_DIR}/terraform/alb ${infraRepoDir}/terraform/`;
    await $`cp ${BASE_DIR}/terraform/main.tf ${infraRepoDir}/terraform/`;
    
    // Copy configuration files
    await $`cp ${BASE_DIR}/.env ${infraRepoDir}/`;
    await $`cp ${BASE_DIR}/.gitignore ${infraRepoDir}/`;
    await $`cp ${BASE_DIR}/.gitlab-ci.yml ${infraRepoDir}/`;
    await $`cp ${BASE_DIR}/package.json ${infraRepoDir}/`;
    await $`cp ${BASE_DIR}/yarn.lock ${infraRepoDir}/`;
    
    // Create empty cluster state file
    await fs.promises.writeFile(
      path.join(infraRepoDir, "cluster-state.txt"), 
      "# EKS Blue/Green Cluster State\n# This file tracks the current state of blue/green clusters\n"
    );
    
    // Initialize and push infra repository
    cd(infraRepoDir);
    await $`git init`;
    await $`git config user.name "GitLab Setup Script"`;
    await $`git config user.email "setup@example.com"`;
    await $`git add .`;
    await $`git commit -m "Initial infrastructure repository"`;
    await $`git remote add origin http://root:${encodeURIComponent(token)}@${publicIp}/root/infra.git`;
    await $`git push -u origin main`;

    await logger.info("✅ Infrastructure repository created and pushed successfully");
    
  } catch (error) {
    await logger.error(`Failed to create infrastructure repository: ${error.message}`);
    throw error;
  } finally {
    // Change back to a valid directory before cleanup to avoid working directory issues
    cd(BASE_DIR);
    // Clean up temporary directory
    await $`rm -rf ${infraRepoDir}`;
  }
}
