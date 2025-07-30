# Workshop

Use the VSC setup. Upload zip file. Unzip:
```bash
unzip <zip-file>
```

## Install and Setup Tools

- Change to workshop folder.

```
cd ~/environment/eks-blue-green
```

- Install Node.js.

```
# Download and install nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# in lieu of restarting the shell
\. "$HOME/.nvm/nvm.sh"
# Download and install Node.js:
nvm install 22
# Verify the Node.js version:
node -v # Should print "v22.16.0".
nvm current # Should print "v22.16.0".
# Download and install Yarn:
corepack enable yarn
# Verify Yarn version:
yarn -v
```

- Install Node.js dependencies.

```
yarn install
npm install -g zx
```

```bash
# Get AWS Account ID and update .env file
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Update .env file with the required values
cat > .env << EOF
ENVIRONMENT_NAME=eks-upgrade
KUBERNETES_VERSION=1.30
REGION=us-west-2
ACCOUNT_ID=$ACCOUNT_ID
EKS_ADMIN_ROLE=WSParticipantRole
CI=true #false
SLACK_CHANNEL="#eks-upgrade"
SLACK_BOT_TOKEN=
EOF
```


Attach Policies:
```bash
aws iam attach-role-policy --role-name WSParticipantRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMFullAccess
```

## Automated Mode (CI=true)

Set CI mode to true in .env
ensure "CI=true" in .env

```bash
cd scripts
chmod +x -R .
cd utils
chmod +x -R .
```

```bash
cd ..
# Manual bootstrap (creates GitLab + CI/CD setup)
./setup.mjs
./1-setup-gitlab.mjs

# Remaining scripts run via GitLab CI/CD pipeline
# Navigate to GitLab web interface and trigger pipeline stages manually
# Scripts 2 to 10 & Cleanup script

# Clean up Gitlab
./cleanup-gitlab.mjs
```

## Manual Mode (CI=false)

```

Set CI mode to false in .env
ensure "CI=false" in .env

```bash
cd scripts
chmod +x -R .
cd utils
chmod +x -R .
```

```bash
cd ..
./setup.mjs
./1-setup-gitlab.mjs
./2-create-base-infra.mjs
./3-create-blue-cluster.mjs
./4-setup-next-version-branch.mjs
./5-create-green-cluster.mjs
./6-enable-internal-test.mjs
./7-promote-green-cluster.mjs
./8-rollback-blue-cluster.mjs
./9-merge-next-version-branch.mjs
./10-delete-green-cluster.mjs
./cleanup-everything.mjs
./cleanup-gitlab.mjs
```