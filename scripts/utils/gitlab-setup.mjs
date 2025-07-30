import { $, cd, fs, path, sleep } from "zx";
import { fileURLToPath } from "url";
import { ec2, logger, shortDir } from "./index.mjs";
import { setupCICD } from "./cicd.mjs";

// Fix for ES modules - __dirname is not available
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DIR = path.resolve(__dirname, "../..");

/**
 * Validates if an existing GitLab instance is healthy
 * @param {string} publicIp - The public IP of the GitLab instance
 * @returns {Promise<boolean>} - True if GitLab is healthy
 */
export async function validateExistingGitLab(publicIp) {
  await logger.debug(`Checking GitLab health with multiple attempts...`);
  
  // 3 attempts with 10 second delays - simple and effective
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const healthCheck = await ec2.execute(publicIp, `curl -s -o /dev/null -w "%{http_code}" http://localhost`, { ignoreError: true });
      
      // Accept common GitLab response codes
      if (healthCheck && ['200', '302', '307'].includes(healthCheck.trim())) {
        await logger.info(`✅ GitLab is healthy (attempt ${attempt})`);
        return true;
      }
      
      if (attempt < 3) {
        await logger.debug(`GitLab not ready, waiting 10s... (attempt ${attempt}/3)`);
        await sleep(10000);
      }
    } catch (error) {
      if (attempt < 3) await sleep(10000);
    }
  }
  
  return false;
}

/**
 * Waits for GitLab to become ready after installation
 * @param {string} publicIp - The public IP of the GitLab instance
 * @param {number} maxWaitMinutes - Maximum time to wait in minutes
 * @returns {Promise<boolean>} - True if GitLab becomes ready
 */
export async function waitForGitLabReady(publicIp, maxWaitMinutes = 10) {
  await logger.debug(`Waiting for GitLab to become ready (max ${maxWaitMinutes} minutes)...`);
  const maxWaitMs = maxWaitMinutes * 60 * 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Check if GitLab web interface is responding
      const healthCheck = await ec2.execute(publicIp, `curl -s -o /dev/null -w "%{http_code}" http://localhost`, { ignoreError: true });

      if (healthCheck && (healthCheck.trim() === "200" || healthCheck.trim() === "302")) {
        await logger.info("GitLab is ready and responding!");
        return true;
      }

      // Also check if initial password file exists as a secondary indicator
      const passwordFileCheck = await ec2.execute(publicIp, '/usr/bin/docker exec gitlab test -f /etc/gitlab/initial_root_password && echo "exists"', {
        ignoreError: true,
      });

      const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);
      const webStatus = healthCheck && (healthCheck.trim() === "200" || healthCheck.trim() === "302") ? "✅" : "⏳";
      const passwordFileStatus = passwordFileCheck && passwordFileCheck.includes("exists") ? "✅" : "⏳";

      await logger.debug(`GitLab status check (${elapsedMinutes}m elapsed): Web ${webStatus} | Password file ${passwordFileStatus}`);
    } catch (error) {
      const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);
      await logger.debug(`GitLab still initializing... (${elapsedMinutes} minutes elapsed)`);
    }

    await sleep(30 * 1000); // Check every 30 seconds
  }

  throw new Error(`GitLab failed to become ready within ${maxWaitMinutes} minutes`);
}

/**
 * Sets up GitLab infrastructure (Docker + GitLab container)
 * @param {string} publicIp - The public IP of the GitLab instance
 * @param {string} pemFile - Path to the PEM file for SSH access
 * @param {string} terraformDir - Path to the terraform directory
 */
export async function setupGitLabInfrastructure(publicIp, pemFile, terraformDir) {
  await logger.debug("Installing Docker...");
  await ec2.execute(publicIp, "curl -fsSL https://get.docker.com -o get-docker.sh");
  await ec2.execute(publicIp, "sudo sh ./get-docker.sh");

  await ec2.execute(publicIp, 'echo "export GITLAB_HOME=/home/ubuntu/gitlab" >> ~/.bashrc');
  await ec2.execute(publicIp, "mkdir -p /home/ubuntu/gitlab/config /home/ubuntu/gitlab/logs /home/ubuntu/gitlab/data");
  await ec2.execute(publicIp, "chown -R ubuntu:ubuntu /home/ubuntu/gitlab");
  await ec2.execute(publicIp, "chmod -R 775 /home/ubuntu/gitlab");

  await logger.debug("Copying docker-compose.yml and root_password.txt to the instance...");
  await $`scp -i ${pemFile} -o StrictHostKeyChecking=no ${terraformDir}/gitlab/docker-compose.yml ubuntu@${publicIp}:/home/ubuntu/gitlab/`;
  await $`scp -i ${pemFile} -o StrictHostKeyChecking=no ${terraformDir}/gitlab/root_password.txt ubuntu@${publicIp}:/home/ubuntu/gitlab/`;

  await logger.debug("Starting GitLab container...");
  await sleep(30 * 1000);
  await ec2.execute(publicIp, "cd /home/ubuntu/gitlab && export GITLAB_HOME=/home/ubuntu/gitlab && /usr/bin/docker compose up -d");

  await logger.debug("Wait for GitLab to initialize");
  await waitForGitLabReady(publicIp);
}

/**
 * Creates a personal access token for GitLab
 * @param {string} publicIp - The public IP of the GitLab instance
 * @param {string} rootPassword - The root password for GitLab
 * @returns {Promise<string|null>} - The created token or null if failed
 */
export async function createPersonalAccessToken(publicIp, rootPassword) {
  await logger.debug("Creating a personal access token...");
  
  // Get CSRF token from the login page
  const csrfTokenCmd = `
        curl -s -c cookies.txt "http://${publicIp}/users/sign_in" > sign_in.html
        grep -o 'name="authenticity_token" value="[^"]*"' sign_in.html | sed 's/.*value="\\(.*\\)".*/\\1/'
        rm sign_in.html
    `;
  
  const csrfToken = await ec2.execute(publicIp, csrfTokenCmd, { ignoreError: true });
  if (!csrfToken) {
    await logger.debug("Could not get CSRF token. Will skip repository push.");
    return null;
  }

  // Login to GitLab
  const loginCmd = `
        curl -s -b cookies.txt -c cookies.txt -X POST "http://${publicIp}/users/sign_in" \\
        -F "user[login]=root" \\
        -F "user[password]=${rootPassword}" \\
        -F "authenticity_token=${csrfToken}"
    `;
  await ec2.execute(publicIp, loginCmd, { ignoreError: true });

  // Create a personal access token
  const tokenName = `setup-script-token-${Date.now()}`;
  const createTokenCmd = `
        # Get the personal access tokens page to extract the meta CSRF token
        curl -s -b cookies.txt -c cookies.txt "http://${publicIp}/-/user_settings/personal_access_tokens" > pat_page.html
        META_CSRF=$(grep -o "<meta name=\\"csrf-token\\" content=\\"[^\\"]*\\"" pat_page.html | sed "s/.*content=\\"\\(.*\\)\\"/\\1/")
        echo "Meta CSRF Token: $META_CSRF"

        # Create the token using the meta CSRF token in the header
        curl -s -b cookies.txt -c cookies.txt -X POST "http://${publicIp}/-/user_settings/personal_access_tokens" \\
        -H "X-CSRF-Token: $META_CSRF" \\
        -F "personal_access_token[name]=${tokenName}" \\
        -F "personal_access_token[scopes][]=api" \\
        -F "personal_access_token[scopes][]=read_repository" \\
        -F "personal_access_token[scopes][]=write_repository" > token_response.json

        # Extract the token from the JSON response
        cat token_response.json
        TOKEN=$(grep -o '"new_token":"[^"]*"' token_response.json | sed 's/"new_token":"\\(.*\\)"/\\1/')
        echo "Token: $TOKEN"

        # Clean up
        rm -f pat_page.html token_response.json
    `;

  const tokenOutput = await ec2.execute(publicIp, createTokenCmd, { ignoreError: true });

  // Extract just the token value from the output
  const tokenMatch = tokenOutput.match(/Token: (glpat-[a-zA-Z0-9_-]+)/);
  const token = tokenMatch ? tokenMatch[1] : null;

  if (!token) {
    await logger.debug("Could not create personal access token. Will skip repository push.");
    await logger.debug("Token output was:");
    await logger.debug(tokenOutput);
    return null;
  }

  await logger.info(`Personal access token created successfully: ${token}`);
  return token;
}

/**
 * Initializes and pushes the GitOps repository
 * @param {string} publicIp - The public IP of the GitLab instance
 * @param {string} token - The personal access token
 * @param {string} baseDir - The base directory of the project
 */
export async function initializeGitRepository(publicIp, token, baseDir) {
  const projectName = "gitops";
  
  // Create a project via the API
  const createProjectCmd = `
    curl -s -X POST "http://${publicIp}/api/v4/projects" \\
      -H "PRIVATE-TOKEN: ${token}" \\
      -F "name=${projectName}" \\
      -F "visibility=private"
  `;

  await ec2.execute(publicIp, createProjectCmd, { ignoreError: true });

  await logger.debug("Initializing and pushing the repository...");

  // Create a separate directory for the GitLab repo in the .temp directory of BASE_DIR
  const tempDir = `${baseDir}/.temp`;
  await $`mkdir -p ${tempDir}`;
  const repoDir = path.join(tempDir, "gitlab-repo-" + Date.now());

  // Ensure the repository directory exists
  try {
    await fs.promises.access(repoDir);
  } catch (error) {
    await logger.debug(`Creating repository directory: ${shortDir(repoDir)}...`);
    await fs.promises.mkdir(repoDir, { recursive: true });
  }

  // Copy the current project files to the new repository directory using sudo
  await logger.debug(`Copying repo files to ${shortDir(repoDir)}...`);
  try {
    // Use sudo to copy files, preserving permissions
    await $`sudo cp -r ${baseDir}/terraform/gitlab/gitlab/repo/* ${repoDir}/`;

    // Change ownership of the copied files to the current user
    await $`sudo chown -R $(id -u):$(id -g) ${repoDir}`;
  } catch (error) {
    await logger.error(`Some files could not be copied. Error: ${error.message}`);
    await logger.error("Continuing with the files that were successfully copied.");
  }

  // Initialize Git repository
  cd(repoDir);
  await $`git init`;
  await $`git config user.name "GitLab Setup Script"`;
  await $`git config user.email "setup@example.com"`;

  // Check if there are any changes to commit
  const status = await $`git status --porcelain`;
  const hasChanges = status.stdout.trim().length > 0;

  if (hasChanges) {
    await $`git add .`;
    await $`git commit -m "Initial commit"`;
  } else {
    await logger.debug("No changes to commit. Checking if repository has any commits...");

    // Check if the repository has any commits
    try {
      await $`git rev-parse HEAD`;
      await logger.debug("Repository has existing commits. Proceeding with push.");
    } catch (error) {
      await logger.error("Repository has no commits. Creating an empty commit...");
      await $`git commit --allow-empty -m "Initial empty commit"`;
    }
  }

  // Check if the remote already exists
  try {
    await $`git remote get-url origin`;
    await logger.debug('Remote "origin" already exists. Updating it...');
    await $`git remote set-url origin http://root:${encodeURIComponent(token)}@${publicIp}/root/${projectName}.git`;
  } catch (error) {
    // Remote doesn't exist, add it
    await $`git remote add origin http://root:${encodeURIComponent(token)}@${publicIp}/root/${projectName}.git`;
  }

  // Push to the remote repository
  try {
    const branch = await $`git branch --show-current`;
    await $`git push -u origin ${branch}:main`;
  } catch (error) {
    await logger.error("Failed to push to repository. Error:");
    await logger.error(error.message);
    throw new Error("Failed to push to repository");
  }

  await logger.info("Repository pushed successfully!");

  // Clean up the temporary repository
  await logger.debug(`Cleaning up temporary repository at ${shortDir(repoDir)}...`);
  await $`rm -rf ${repoDir}`;
  await logger.debug("Temporary repository deleted successfully!");
}

/**
 * Creates the GitLab access information file
 * @param {string} publicIp - The public IP of the GitLab instance
 * @param {string} rootPassword - The root password for GitLab
 * @param {string} outputFile - Path to the output file
 * @param {string} pemFile - Path to the PEM file
 */
export async function createAccessInfoFile(publicIp, rootPassword, outputFile, pemFile) {
  // Only create access info file when CI=true (for CI/CD automation and troubleshooting)
  if (process.env.CI === 'true') {
    await logger.info("Creating/updating GitLab access information file for CI/CD automation...");
    const accessInfo = `# GitLab Access Information
    # Generated on ${new Date().toISOString()}

    GitLab URL: http://${publicIp}
    SSH Clone URL Format: ssh://git@${publicIp}:2222/username/project.git

    # Access Credentials
    Username: root
    Password: ${rootPassword}

    # Note: The initial password is valid for 24 hours after installation

    # SSH Access
    ssh -i ${pemFile} ubuntu@${publicIp}

    # Docker Commands
    # Check GitLab container status:
    sudo -i /usr/bin/docker ps

    # View GitLab logs:
    sudo -i /usr/bin/docker logs -f gitlab

    # Restart GitLab:
    sudo -i /usr/bin/docker restart gitlab

    # Stop GitLab:
    sudo -i bash -c "cd /home/ubuntu/gitlab && /usr/bin/docker compose down"
    `;

    fs.writeFileSync(outputFile, accessInfo);
    await logger.info(`✅ GitLab access information saved to: ${shortDir(outputFile)}`);
  } else {
    await logger.info("Manual mode (CI=false) - access info not saved to file");
  }
}

/**
 * Sets up CI/CD integration if running in CI mode
 * @param {string} publicIp - The public IP of the GitLab instance
 * @param {string} token - The personal access token
 * @param {string} rootPassword - The root password for GitLab
 */
export async function setupCICDIntegration(publicIp, token, rootPassword) {
  // NEW: CI/CD Integration
  if (process.env.CI === 'true') {
    // Change back to the scripts directory before calling setupCICD
    // This fixes the working directory issue that causes the spawn error
    cd(path.dirname(__filename));
    await setupCICD(publicIp, token, rootPassword);
  }
}
