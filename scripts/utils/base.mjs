import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(BASE_DIR, ".env") });
dotenv.config({ path: path.join(BASE_DIR, ".env.local"), override: true });
const { ACCOUNT_ID, REGION, SLACK_BOT_TOKEN, SLACK_CHANNEL, EKS_ADMIN_ROLE } = process.env;

const shortDir = (dir) => `<WORKSPACE>${dir.replace(BASE_DIR, "")}`;

const getEksAdminRoleVars = () => {
  return EKS_ADMIN_ROLE && EKS_ADMIN_ROLE.trim() !== '' 
    ? { eks_admin_role_name: EKS_ADMIN_ROLE } 
    : {};
};

export { ACCOUNT_ID, BASE_DIR, REGION, shortDir, SLACK_BOT_TOKEN, SLACK_CHANNEL, EKS_ADMIN_ROLE, getEksAdminRoleVars };
