import { BASE_DIR, shortDir } from "./base.mjs";
import logger from "./logger.mjs";
import gitlab from "./gitlab.mjs";

import fs from "fs";
import path from "path";
import { $ } from "zx";
import terraform from "./terraform.mjs";
$.verbose = true;

class Cluster {
  #STATE_FILE;
  constructor() {
    this.#STATE_FILE = path.join(BASE_DIR, "cluster-state.txt");
  }

  async initState() {
    await logger.info("Initializing cluster state using GitLab project variables");
    return "GitLab project variables";
  }

  async readState() {
    try {
      const state = {};
      const stateKeys = ['BLUE_CLUSTER', 'BLUE_VERSION', 'GREEN_CLUSTER', 'GREEN_VERSION'];
      
      for (const key of stateKeys) {
        const value = await gitlab.getProjectVariable(key);
        if (value) {
          state[key] = value;
        }
      }
      
      await logger.debug(`Read cluster state: ${JSON.stringify(state)}`);
      return state;
    } catch (error) {
      await logger.error(`Error reading cluster state from GitLab variables, error: ${error.message}`);
      return {};
    }
  }

  async updateState(state) {
    try {
      await logger.info("Updating cluster state using GitLab project variables");
      
      for (const [key, value] of Object.entries(state)) {
        if (value && value.trim() !== '') {
          await gitlab.setProjectVariable(key, value);
          await logger.debug(`Set ${key}=${value}`);
        } else if (value === '') {
          // Handle explicit empty values by deleting the variable
          await gitlab.deleteProjectVariable(key);
          await logger.debug(`Cleared ${key} (set to empty)`);
        }
      }
      
      await logger.info("Cluster state updated successfully in GitLab project variables");
      return "GitLab project variables";
    } catch (error) {
      await logger.error(`Error updating cluster state in GitLab variables, error: ${error.message}`);
      throw error;
    }
  }

  async commitStateToInfraRepo(state) {
    try {
      const gitlabHost = process.env.GITLAB_HOST;
      const gitlabPassword = process.env.GITLAB_PASSWORD;
      
      if (!gitlabHost || !gitlabPassword) {
        await logger.error("GitLab credentials not found in environment variables");
        return;
      }
      
      await logger.info("Committing state changes to infra repository...");
      
      // Configure git for commits
      await $`git config user.name "EKS Blue/Green Automation"`;
      await $`git config user.email "automation@example.com"`;
      
      // Add and commit state changes
      await $`git add cluster-state.txt`;
      await $`git commit -m "Update cluster state: ${JSON.stringify(state)} [skip ci]"`;
      
      // Push to infra repository
      const repoUrl = `http://root:${encodeURIComponent(gitlabPassword)}@${gitlabHost.replace('http://', '')}/root/infra.git`;
      await $`git push ${repoUrl} main`;
      
      await logger.info("✅ State committed to infra repository");
    } catch (error) {
      await logger.error(`Failed to commit state to Git: ${error.message}`);
      // Don't throw - state is still saved locally
    }
  }

  async deleteState() {
    await logger.info("Cleaning up cluster state from GitLab project variables...");

    try {
      const stateKeys = ['BLUE_CLUSTER', 'BLUE_VERSION', 'GREEN_CLUSTER', 'GREEN_VERSION'];
      
      for (const key of stateKeys) {
        await gitlab.deleteProjectVariable(key);
        await logger.debug(`Deleted project variable: ${key}`);
      }
      
      // Also clean up local state file if it exists
      if (fs.existsSync(this.#STATE_FILE)) {
        fs.unlinkSync(this.#STATE_FILE);
        await logger.debug("Local state file deleted successfully");
      }
      
      await logger.info("Cluster state cleaned up successfully");
    } catch (error) {
      await logger.error(`Error cleaning up cluster state, error: ${error.message}`);
      throw error;
    }
  }

  async getBlueClusterInfo() {
    const state = await this.readState();
    const blueCluster = state.BLUE_CLUSTER;
    if (!blueCluster) {
      throw new Error("Blue Cluster not found in cluster state");
    }
    const number = blueCluster.match(/([12])$/)[1];
    return {
      name: blueCluster,
      version: state.BLUE_VERSION,
      number: parseInt(number),
    };
  }

  async getGreenClusterInfo(newCluster) {
    const state = await this.readState();
    if (newCluster) {
      const blueCluster = state.BLUE_CLUSTER;
      if (!blueCluster) {
        throw new Error("Blue Cluster not found in cluster state");
      }
      const greenCluster = blueCluster.replace(/([12])$/, (match) => {
        return match === "1" ? "2" : "1";
      });
      const number = greenCluster.match(/([12])$/)[1];
      return {
        name: greenCluster,
        version: await this.getNextVersion(),
        number: parseInt(number),
      };
    }
    const greenCluster = state.GREEN_CLUSTER;
    if (!greenCluster) {
      throw new Error("Green Cluster not found in cluster state");
    }
    const number = greenCluster.match(/([12])$/)[1];
    return {
      name: greenCluster,
      version: state.GREEN_VERSION,
      number: parseInt(number),
    };
  }

  async getNextVersion() {
    const blueCluster = await this.getBlueClusterInfo();
    const currentVersion = blueCluster.version;
    const [major, minor] = currentVersion.split(".").map(Number);
    const nextVersion = `${major}.${minor + 1}`;
    return nextVersion;
  }

  async configureKubectl(clusterName) {
    const region = process.env.AWS_REGION || "ap-southeast-1";
    await logger.debug(`Configuring kubectl for cluster ${clusterName} in region ${region}`);

    try {
      await $`aws eks --region ${region} update-kubeconfig --name ${clusterName} --alias ${clusterName}`;
      await logger.info(`Successfully configured kubectl for cluster ${clusterName}`);
    } catch (error) {
      await logger.error(`Error configuring kubectl, error: ${error.message}`);
      throw error;
    }
  }
  // Helper function for kubectl apply with retry logic
  async #applyWithRetry(yamlFile, maxRetries = 10, waitSeconds = 20) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await logger.debug(`Applying ${path.basename(yamlFile)} (attempt ${attempt}/${maxRetries})`);
        await $`kubectl apply -f ${yamlFile}`;
        await logger.debug(`Successfully applied ${path.basename(yamlFile)}`);
        return; // Success!
      } catch (error) {
        if (attempt === maxRetries) {
          throw new Error(`Failed to apply ${path.basename(yamlFile)} after ${maxRetries} attempts: ${error.message}`);
        }

        await logger.debug(`Attempt ${attempt} failed, waiting ${waitSeconds}s before retry...`);
        await logger.debug(`Error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      }
    }
  }

  // Helper function to wait for load balancer hostname
  async #waitForLoadBalancerHostname(maxWaitMinutes = 5) {
    await logger.debug(`Waiting for load balancer hostname (max ${maxWaitMinutes} minutes)...`);
    for (let attempt = 1; attempt <= maxWaitMinutes * 2; attempt++) {
      try {
        const result = await $`kubectl get svc -n argocd argo-cd-argocd-server -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'`;
        const hostname = result.stdout.trim();

        if (hostname && hostname.length > 0) {
          await logger.info(`Load balancer hostname ready: ${hostname}`);
          return hostname;
        }

        await logger.debug(`Waiting for load balancer hostname... (${Math.floor(attempt / 2)}/${maxWaitMinutes} minutes)`);
        await new Promise((resolve) => setTimeout(resolve, 30000));
      } catch (error) {
        // Continue waiting
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    }
    throw new Error("Load balancer hostname not available after timeout");
  }

  // Helper function to wait for ArgoCD web interface
  async #waitForArgoCdReady(hostname, maxWaitMinutes = 5) {
    await logger.debug(`Waiting for ArgoCD web interface to be ready (max ${maxWaitMinutes} minutes)...`);
    for (let attempt = 1; attempt <= maxWaitMinutes * 2; attempt++) {
      try {
        const response = await $`curl -s -o /dev/null -w "%{http_code}" http://${hostname} --connect-timeout 10`;
        const statusCode = response.stdout.trim();

        if (statusCode === "200" || statusCode === "302" || statusCode === "307") {
          await logger.info(`ArgoCD web interface is ready! (Status: ${statusCode})`);
          return true;
        }

        await logger.debug(`Waiting for ArgoCD to be accessible... (${Math.floor(attempt / 2)}/${maxWaitMinutes} minutes) - Status: ${statusCode}`);
        await new Promise((resolve) => setTimeout(resolve, 30000));
      } catch (error) {
        await logger.debug(`ArgoCD not yet accessible, continuing to wait... (${Math.floor(attempt / 2)}/${maxWaitMinutes} minutes)`);
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    }
    throw new Error("ArgoCD web interface not accessible after timeout");
  }

  // Helper function to force sync ArgoCD workload applications
  async #syncArgoCdWorkload(maxWaitMinutes = 5) {
    await logger.debug("Force syncing ArgoCD workload applications...");

    try {
      // Wait for workload applications (name-based search)
      for (let attempt = 1; attempt <= maxWaitMinutes * 2; attempt++) {
        try {
          const apps = await $`kubectl get applications -n argocd --no-headers | grep "^workload-"`;
          const appLines = apps.stdout
            .trim()
            .split("\n")
            .filter((line) => line.trim());

          if (appLines.length > 0) {
            const appNames = appLines.map((line) => line.split(/\s+/)[0]);
            await logger.debug(`Found ${appNames.length} workload applications, syncing...`);

            // Sync each application
            for (const appName of appNames) {
              await logger.debug(`Syncing application: ${appName}`);
              try {
                // Force sync the application
                await $`kubectl patch application ${appName} -n argocd --type=merge -p='{"operation":{"sync":{"syncStrategy":{"hook":{"force":true}}}}}'`;

                // Also add refresh annotation to ensure latest state
                await $`kubectl annotate application ${appName} -n argocd argocd.argoproj.io/refresh=true --overwrite`;
              } catch (syncError) {
                await logger.error(`Warning: Could not sync application ${appName}: ${syncError.message}`);
              }
            }

            await logger.debug("All workload applications sync initiated!");

            // Wait a bit for sync to process
            await logger.debug("Waiting for workload sync to process...");
            await new Promise((resolve) => setTimeout(resolve, 30000));

            return;
          }

          await logger.debug(`Waiting for workload applications... (${Math.floor(attempt / 2)}/${maxWaitMinutes} minutes)`);
          await new Promise((resolve) => setTimeout(resolve, 30000));
        } catch (error) {
          // Continue waiting
          await new Promise((resolve) => setTimeout(resolve, 30000));
        }
      }

      throw new Error("Workload applications not found after timeout");
    } catch (error) {
      await logger.error(`Warning: Could not sync workload applications: ${error.message}`);
      await logger.debug("You may need to manually sync applications in ArgoCD UI");
    }
  }

  // TODO:
  async configureArgoCdAccess(clusterName) {
    await logger.debug("Configuring ArgoCD access");

    // Get the path to the AWS load balancer configuration
    const awsLbYamlPath = path.join(terraform.dir, "eks", "aws-lb.yaml");

    // Apply the AWS load balancer configuration with retry logic
    await this.#applyWithRetry(awsLbYamlPath);

    // Wait for the load balancer hostname to be assigned
    const argocdUrl = await this.#waitForLoadBalancerHostname();

    // Wait for ArgoCD web interface to be ready
    await this.#waitForArgoCdReady(argocdUrl);

    // Force sync the workload application
    await this.#syncArgoCdWorkload();

    try {
      // Get ArgoCD admin password
      const argocdPasswordCmd = await $`kubectl get secrets argocd-initial-admin-secret -n argocd --template="{{index .data.password | base64decode}}"`;
      const argocdPassword = argocdPasswordCmd.stdout.trim();

      // Print ArgoCD login information
      await logger.info("ArgoCD Access Information:");
      await logger.info("----------------------------");
      await logger.info(`Cluster: ${clusterName}`);
      await logger.info("Username: admin");
      await logger.info(`Password: ${argocdPassword}`);
      await logger.info(`URL: http://${argocdUrl}`);
      await logger.info("----------------------------");

      return {
        cluster: clusterName,
        username: "admin",
        password: argocdPassword,
        url: `http://${argocdUrl}`,
      };
    } catch (error) {
      await logger.error("Warning: Could not retrieve ArgoCD access information.");
      await logger.error("Try running the following commands manually:");
      await logger.error(`kubectl get secrets argocd-initial-admin-secret -n argocd --template="{{index .data.password | base64decode}}"`);
      await logger.error(`kubectl get svc -n argocd argo-cd-argocd-server -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'`);
      throw error;
    }
  }

  // TODO:
  async cleanupCluster(clusterName) {
    await this.configureKubectl(clusterName);

    // EKS Auto Mode will automatically clean up nodes when cluster is deleted
    await logger.debug(`EKS Auto Mode manages compute automatically - no manual node cleanup required`);

    // Delete AWS ALB
    await logger.debug(`Deleting AWS LB for ${clusterName}`);
    try {
      const awsLbYamlPath = path.join(terraform.dir, "eks", "aws-lb.yaml");
      await $`kubectl --context ${clusterName} delete -f ${awsLbYamlPath}`;
    } catch (error) {
      await logger.error(`Warning: Could not delete AWS LB for ${clusterName}. It might not exist or kubectl context might be invalid.`);
    }

    // Deactivate auto-sync
    await logger.debug(`Deactivating auto-sync for ${clusterName}`);
    try {
      await $`kubectl --context ${clusterName} patch applicationset bootstrap -n argocd --type=json -p='[{"op": "remove", "path": "/spec/template/spec/syncPolicy"}]'`;
    } catch (error) {
      await logger.error(`Warning: Could not deactivate auto-sync for ${clusterName}.`);
    }

    // Clean Workloads
    await logger.debug(`Cleaning workloads for ${clusterName}`);
    try {
      await $`kubectl --context ${clusterName} delete applicationset -n argocd workload --cascade=foreground`;
    } catch (error) {
      await logger.error(`Warning: Could not clean workloads for ${clusterName}.`);
    }

    // Clean namespaces
    await logger.debug(`Cleaning namespaces for ${clusterName}`);
    try {
      await $`kubectl --context ${clusterName} delete applicationset -n argocd namespace --cascade=foreground`;
    } catch (error) {
      await logger.error(`Warning: Could not clean namespaces for ${clusterName}.`);
    }

    // Clean projects
    await logger.debug(`Cleaning projects for ${clusterName}...`);
    try {
      await $`kubectl --context ${clusterName} delete applicationset -n argocd argoprojects --cascade=foreground`;
    } catch (error) {
      await logger.debug(`Warning: Could not clean projects for ${clusterName}.`);
    }

    // Clean addons
    await logger.debug(`Cleaning addons for ${clusterName}...`);
    try {
      await $`kubectl --context ${clusterName} delete applicationset -n argocd cluster-addons --cascade=foreground`;
    } catch (error) {
      await logger.debug(`Warning: Could not clean addons for ${clusterName}.`);
    }

    // Clean app of apps
    await logger.debug(`Cleaning app of apps for ${clusterName}...`);
    try {
      await $`kubectl --context ${clusterName} delete applicationset -n argocd bootstrap --cascade=foreground`;
    } catch (error) {
      await logger.debug(`Warning: Could not clean app of apps for ${clusterName}.`);
    }
  }
}

export default new Cluster();
