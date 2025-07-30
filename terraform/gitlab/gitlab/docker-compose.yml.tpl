services:
  gitlab:
    image: gitlab/gitlab-ee:17.9.8-ee.0
    container_name: gitlab
    restart: always
    hostname: '${PUBLIC_IP}'  # Will be updated with actual IP/hostname
    environment:
      GITLAB_OMNIBUS_CONFIG: |
        # Add any other gitlab.rb configuration here, each on its own line
        external_url 'http://${PUBLIC_IP}'  # Will be updated with actual IP/hostname
        gitlab_rails['gitlab_shell_ssh_port'] = 2222  # Using 2222 to avoid conflict with instance SSH
        gitlab_rails['initial_root_password'] = File.read('/run/secrets/gitlab_root_password').strip
    ports:
      - '80:80'
      - '443:443'
      - '2222:22'  # Map container's 22 to host's 2222
    volumes:
      - '$GITLAB_HOME/config:/etc/gitlab'
      - '$GITLAB_HOME/logs:/var/log/gitlab'
      - '$GITLAB_HOME/data:/var/opt/gitlab'
    secrets:
      - gitlab_root_password
    shm_size: '256m'

secrets:
  gitlab_root_password:
    file: ./root_password.txt
