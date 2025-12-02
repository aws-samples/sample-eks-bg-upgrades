import { BASE_DIR, shortDir } from "./base.mjs";
import logger from "./logger.mjs";

import path from "path";
import { $, cd, fs } from "zx";
$.verbose = true;

class GitLab {
  #GITLAB_ACCESS_FILE;
  constructor() {
    this.#GITLAB_ACCESS_FILE = path.join(BASE_DIR, "gitlab-access.txt");
  }

  async getCredentials() {
    // NEW: Check if running in CI mode
    if (process.env.CI === 'true') {
      const gitlabHost = process.env.GITLAB_HOST;
      const gitlabPassword = process.env.GITLAB_PASSWORD;
      
      if (!gitlabHost || !gitlabPassword) {
        await logger.error("GitLab credentials not found in environment variables");
        throw new Error("GitLab credentials not found in environment variables");
      }
      
      return {
        username: 'root',
        password: gitlabPassword,
        baseUrl: `${gitlabHost}/root`
      };
    }
    
    // Existing logic for manual mode
    const gitlabAccessFile = path.join(BASE_DIR, "gitlab-access.txt");

    if (!fs.existsSync(gitlabAccessFile)) {
      await logger.error("GitLab access file not found. Please run script 2 first.");
      throw new Error("GitLab access file not found. Please run script 2 first.");
    }

    const content = fs.readFileSync(gitlabAccessFile, "utf8");

    // Extract GitLab URL and credentials
    const urlMatch = content.match(/URL: ([^\s]+)/);
    const usernameMatch = content.match(/Username: ([^\s]+)/);
    const passwordMatch = content.match(/Password: ([^\s]+)/);

    if (!usernameMatch || !passwordMatch) {
      await logger.error("Could not extract GitLab credentials from access file.");
      throw new Error("Could not extract GitLab credentials from access file.");
    }

    return {
      username: usernameMatch[1],
      password: passwordMatch[1],
      baseUrl: `${urlMatch[1]}/${usernameMatch[1]}`,
    };
  }

  async cleanup() {
    await logger.info("Cleaning up GitLab access file...");

    try {
      if (fs.existsSync(this.#GITLAB_ACCESS_FILE)) {
        fs.unlinkSync(this.#GITLAB_ACCESS_FILE);
        await logger.info("GitLab access file deleted successfully");
      } else {
        await logger.info("GitLab access file does not exist, nothing to clean up");
      }
    } catch (error) {
      await logger.error(`Error cleaning up GitLab access file: ${error.message}`);
      throw error;
    }
  }

  async cloneRepository(url, username, password) {
    try {
      // Create a temporary directory for the repository
      const tempDir = fs.mkdtempSync(path.join(BASE_DIR, ".temp", "repo-"));

      // Parse the URL to handle authentication
      const urlObj = new URL(url);
      const authUrl = `${urlObj.protocol}//${username}:${password}@${urlObj.host}${urlObj.pathname}`;

      // Clone the repository
      await $`git clone ${authUrl} ${tempDir}`;

      logger.debug(`Repository cloned to ${shortDir(tempDir)}`);
      return tempDir;
    } catch (error) {
      logger.error(`Error cloning repository, error: ${error.message}`);
      throw error;
    }
  }

  async createAndPushBranch(repoDir, branchName) {
    try {
      cd(repoDir);
      
      // Fetch latest from remote to get all branch information
      await $`git fetch origin`;
      
      // Check if branch exists on remote
      let branchExists = false;
      try {
        const result = await $`git ls-remote --heads origin ${branchName}`;
        branchExists = result.stdout.trim().length > 0;
        await logger.debug(`Branch ${branchName} already exists on remote`);
      } catch (error) {
        await logger.debug(`Branch ${branchName} does not exist on remote, will create new`);
      }
      
      if (branchExists) {
        // Branch exists, check it out and pull latest
        try {
          await $`git checkout ${branchName}`;
        } catch (error) {
          // If local branch doesn't exist, create it tracking the remote
          await $`git checkout -b ${branchName} origin/${branchName}`;
        }
        await $`git pull origin ${branchName}`;
        await logger.info(`Checked out existing branch: ${branchName}`);
      } else {
        // Branch doesn't exist, create new
        await $`git checkout -b ${branchName}`;
        await $`git commit --allow-empty -m "Initial commit for ${branchName}"`;
        await $`git push -u origin ${branchName}`;
        await logger.info(`Created and pushed new branch: ${branchName}`);
      }
      
      fs.rmSync(repoDir, { recursive: true, force: true });
      await logger.debug("Temporary repository directory removed.");
    } catch (error) {
      logger.error(`Error handling branch ${branchName}, error: ${error.message}`);
      throw error;
    }
  }

  async mergeAndPushBranch(repoDir, branchName) {
    try {
      cd(repoDir);
      
      // Fetch all tags and branches from remote
      await $`git fetch origin --tags`;
      
      // Check if the merge is needed (branch might already be merged)
      let mergeNeeded = true;
      try {
        const mergeBase = await $`git merge-base HEAD origin/${branchName}`;
        const branchCommit = await $`git rev-parse origin/${branchName}`;
        if (mergeBase.stdout.trim() === branchCommit.stdout.trim()) {
          await logger.info(`Branch ${branchName} is already merged into main`);
          mergeNeeded = false;
        }
      } catch (error) {
        await logger.debug(`Could not check merge status, proceeding with merge: ${error.message}`);
      }
      
      // Perform merge if needed
      if (mergeNeeded) {
        await $`git merge origin/${branchName} --no-ff -m "EKS version: ${branchName}"`;
        await logger.info(`Branch ${branchName} merged into main`);
      }
      
      // Check if tag already exists
      let tagExists = false;
      try {
        await $`git rev-parse --verify "refs/tags/${branchName}"`;
        tagExists = true;
        await logger.info(`Tag ${branchName} already exists, skipping tag creation`);
      } catch (error) {
        await logger.debug(`Tag ${branchName} does not exist, will create it`);
      }
      
      // Create tag only if it doesn't exist
      if (!tagExists) {
        await $`git tag -a "${branchName}" -m "EKS version: ${branchName}"`;
        await logger.info(`Created tag ${branchName}`);
      }
      
      // Push changes and tags
      await $`git push origin main --tags`;
      await logger.info(`Branch: ${branchName} processing completed successfully`);
      
      fs.rmSync(repoDir, { recursive: true, force: true });
      await logger.debug("Temporary repository directory removed.");
    } catch (error) {
      await logger.error(`Error merging branch ${branchName} into main, error: ${error.message}`);
      throw error;
    }
  }

  async setProjectVariable(key, value) {
    try {
      const creds = await this.getCredentials();
      const projectId = process.env.CI === 'true' ? process.env.CI_PROJECT_ID : 'root%2Fgitops';
      
      // Get GitLab token - in CI mode use CI_JOB_TOKEN, in manual mode use password as token
      let token;
      if (process.env.CI === 'true') {
        token = process.env.GITLAB_API_TOKEN; // Use GitLab's built-in job token
      } else {
        // For manual mode, we'll need to use the password as token (assuming it's a personal access token)
        token = creds.password;
      }

      const gitlabHost = creds.baseUrl.split('/root')[0];
      
      // Build the URL as a complete string to avoid zx escaping issues
      const updateUrl = `${gitlabHost}/api/v4/projects/${projectId}/variables/${key}`;
      
      // Try to update existing variable first
      const updateResult = await $`curl -s -X PUT ${updateUrl} \
        -H ${'PRIVATE-TOKEN: ' + token} \
        -F ${'value=' + value}`;
      
      try {
        const response = JSON.parse(updateResult.stdout);
        if (response.message && (response.message.includes("404") || response.message.includes("Variable Not Found"))) {
          // Variable doesn't exist, create it
          const createUrl = `${gitlabHost}/api/v4/projects/${projectId}/variables`;
          await $`curl -s -X POST ${createUrl} \
            -H ${'PRIVATE-TOKEN: ' + token} \
            -F ${'key=' + key} \
            -F ${'value=' + value}`;
          await logger.debug(`Created project variable: ${key}`);
        } else if (response.message) {
          // Some other error occurred
          await logger.error(`Error updating project variable ${key}: ${response.message}`);
          throw new Error(`Failed to update project variable ${key}: ${response.message}`);
        } else {
          // Success - variable was updated
          await logger.debug(`Updated project variable: ${key}`);
        }
      } catch (parseError) {
        // If we can't parse the response, assume it was successful (no JSON response usually means success)
        await logger.debug(`Updated project variable: ${key}`);
      }
    } catch (error) {
      await logger.error(`Error setting project variable ${key}: ${error.message}`);
      throw error;
    }
  }

  async getProjectVariable(key) {
    try {
      const creds = await this.getCredentials();
      const projectId = process.env.CI === 'true' ? process.env.CI_PROJECT_ID : 'root%2Fgitops';
      
      let token;
      if (process.env.CI === 'true') {
        token = process.env.GITLAB_API_TOKEN;
      } else {
        token = creds.password;
      }

      const gitlabHost = creds.baseUrl.split('/root')[0];
      
      // Build the URL as a complete string to avoid zx escaping issues
      const getUrl = `${gitlabHost}/api/v4/projects/${projectId}/variables/${key}`;
      
      const result = await $`curl -s ${getUrl} \
        -H ${'PRIVATE-TOKEN: ' + token}`;
      
      const response = JSON.parse(result.stdout);
      if (response.value !== undefined) {
        return response.value;
      } else {
        return null;
      }
    } catch (error) {
      await logger.debug(`Project variable ${key} not found or error: ${error.message}`);
      return null;
    }
  }

  async deleteProjectVariable(key) {
    try {
      const creds = await this.getCredentials();
      const projectId = process.env.CI === 'true' ? process.env.CI_PROJECT_ID : 'root%2Fgitops';
      
      let token;
      if (process.env.CI === 'true') {
        token = process.env.GITLAB_API_TOKEN;
      } else {
        token = creds.password;
      }

      const gitlabHost = creds.baseUrl.split('/root')[0];
      
      // Build the URL as a complete string to avoid zx escaping issues
      const deleteUrl = `${gitlabHost}/api/v4/projects/${projectId}/variables/${key}`;
      
      await $`curl -s -X DELETE ${deleteUrl} \
        -H ${'PRIVATE-TOKEN: ' + token}`;
      
      await logger.debug(`Deleted project variable: ${key}`);
    } catch (error) {
      await logger.debug(`Error deleting project variable ${key}: ${error.message}`);
      // Don't throw error for delete operations
    }
  }
}

export default new GitLab();
