import { ACCOUNT_ID, BASE_DIR, REGION, shortDir } from "./base.mjs";
import logger from "./logger.mjs";

import path from "path";
import { $, cd } from "zx";
$.verbose = true;

class Terraform {
  #TERRAFORM_DIR;
  #BUCKET;

  constructor() {
    this.#TERRAFORM_DIR = path.join(BASE_DIR, "terraform");
    this.#BUCKET = `eks-upgrade-tf-state-${ACCOUNT_ID}`;
  }

  get dir() {
    return this.#TERRAFORM_DIR;
  }

  async init(module) {
    const dir = `${this.#TERRAFORM_DIR}/${module}`;
    logger.debug(`Initializing Terraform in ${shortDir(dir)}`);
    cd(dir);
    const bucket = `eks-upgrade-tf-state-${ACCOUNT_ID}`;
    await $`terraform init -backend-config="region=${REGION}" -backend-config="bucket=${bucket}"`;
    await $`terraform validate`;
  }

  async apply(module, options = {}) {
    const dir = `${this.#TERRAFORM_DIR}/${module}`;
    logger.debug(`Applying Terraform in ${shortDir(dir)}`);
    cd(dir);
    const { workspace, varFile, vars } = options;

    if (workspace) {
      try {
        await $`terraform workspace select ${workspace}`;
        logger.info(`Selected existing workspace: ${workspace}`);
      } catch (error) {
        logger.debug(`Workspace ${workspace} not found, creating it`);
        await $`terraform workspace new ${workspace}`;
        logger.info(`Created new workspace: ${workspace}`);
      }
    }

    let cmd = ["terraform", "apply", "-auto-approve", `-var=remote_state_bucket=${this.#BUCKET}`, `-var=region=${REGION}`];
    if (vars && Object.keys(vars).length > 0) {
      if (varFile) cmd.push(`-var-file=${varFile}`);
      Object.entries(vars).forEach(([key, value]) => {
        cmd.push(`-var=${key}=${value}`);
      });
    } else if (varFile) {
      cmd.push(`-var-file=${varFile}`);
    }

    // Execute terraform apply
    await $`${cmd}`;
  }

  async destroy(module, options = {}) {
    const dir = `${this.#TERRAFORM_DIR}/${module}`;
    logger.debug(`Destroying Terraform resources in ${shortDir(dir)}`);
    cd(dir);

    const { workspace, target, vars } = options;

    if (workspace) {
      try {
        await $`terraform workspace select ${workspace}`;
        logger.debug(`Selected workspace: ${workspace}`);
      } catch (error) {
        logger.error(`Workspace ${workspace} doesn't exist, skipping`);
        return;
      }
    }

    let cmd = ["terraform", "destroy", "-auto-approve", `-var=remote_state_bucket=${this.#BUCKET}`, `-var=region=${REGION}`];
    if (vars && Object.keys(vars).length > 0) {
      Object.entries(vars).forEach(([key, value]) => {
        cmd.push(`-var=${key}=${value}`);
      });
    }
    if (target) {
      cmd.push(`-target=${target}`);
    }

    try {
      await $`${cmd}`;
      logger.info(`Successfully destroyed resources in ${shortDir(dir)}`);
    } catch (error) {
      logger.error(`Error destroying resources, error: ${error.message}`);
      throw error;
    }
  }

  async getOutputValue(module, outputName) {
    const dir = `${this.#TERRAFORM_DIR}/${module}`;
    cd(dir);
    
    // Initialize ALB module if needed
    if (module === 'alb') {
      await this.init(module);
    }
    
    const output = await $`terraform output -raw ${outputName}`;
    return output.stdout.trim();
  }

  async removeState(module, target, options = {}) {
    const dir = `${this.#TERRAFORM_DIR}/${module}`;
    logger.debug(`Checking Terraform state in ${shortDir(dir)} for ${target}`);
    cd(dir);

    const { workspace } = options;

    if (workspace) {
      try {
        await $`terraform workspace select ${workspace}`;
        logger.debug(`Selected workspace: ${workspace}`);
      } catch (error) {
        logger.error(`Workspace ${workspace} doesn't exist, skipping`);
        return;
      }
    }

    try {
      const stateList = await $`terraform state list`;
      const targetExists = stateList.stdout.split("\n").some((line) => line.trim() === target);

      if (!targetExists) {
        logger.debug(`Target ${target} not found in state, skipping removal`);
        return;
      }

      logger.debug(`Removing state for ${target}`);
      await $`terraform state rm ${target}`;
      logger.debug(`Successfully removed state for ${target} in ${module}`);
    } catch (error) {
      logger.error(`Error managing state, error: ${error.message}`);
      throw error;
    }
  }

  async cleanupEksState(workspace) {
    await logger.info("🧹 Cleaning up Kubernetes/Helm resources from Terraform state...");
    
    const kubernetesResources = [
      "kubernetes_namespace.argocd",
      "kubernetes_secret.git_secrets",
      'kubernetes_secret.git_secrets["git-workloads"]',
      'kubernetes_secret.git_secrets["git-addons"]',
      "module.gitops_bridge_bootstrap.helm_release.argocd[0]",
      "module.gitops_bridge_bootstrap.kubernetes_secret_v1.cluster[0]",
      'module.gitops_bridge_bootstrap.helm_release.bootstrap["bootstrap"]'
    ];

    for (const resource of kubernetesResources) {
      try {
        await this.removeState("eks", resource, { workspace });
      } catch (error) {
        await logger.info(`⚠️ Could not remove ${resource} from state (may not exist): ${error.message}`);
        // Continue with other resources - don't fail the entire cleanup
      }
    }
    
    await logger.info("✅ Kubernetes/Helm state cleanup completed");
  }

  // Create S3 backend bucket
  async createBackend() {
    try {
      logger.debug(`Creating S3 bucket: ${this.#BUCKET}`);
      await $`aws s3 mb s3://${this.#BUCKET} --region ${REGION}`.catch(() => {});
      logger.info("Backend resources created or already exist.");
    } catch (error) {
      logger.error(`Error creating backend resources: ${error.message}`);
      throw error;
    }
  }

  // Delete S3 backend bucket
  async deleteBackend() {
    try {
      logger.debug(`Deleting S3 bucket: ${this.#BUCKET}`);
      await $`aws s3 rb s3://${this.#BUCKET} --force --region ${REGION}`.catch(() => {});
      logger.info("Backend resources deleted (if existed).");
    } catch (error) {
      logger.error(`Error deleting backend resources: ${error.message}`);
      throw error;
    }
  }
}

export default new Terraform();
