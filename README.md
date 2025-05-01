# hetzner-podman-bun-deploy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/mati365/hetzner-podman-bunjs-deploy?style=flat-square)
![GitHub issues](https://img.shields.io/github/issues/mati365/hetzner-podman-bunjs-deploy?style=flat-square)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

Example of secure and production-ready `Bun.js` application deployment to Hetzner Cloud utilizing `Alma Linux` (RedHat compatible) with rootless `Podman` Quadlet systemd services. This setup provides enterprise-grade security and management features while being simple enough to serve as an alternative deployment method for Raspberry Pi.

## Description

The project demonstrates a secure, production-ready deployment of a `Bun.js` (and possibly `Node.js`) application using `Ansible` to a Hetzner VPS with enhanced security and service management features based on `Alma Linux` - a RedHat-compatible enterprise Linux distribution.

The infrastructure consists of:

1. Hetzner ARM CAX11 server (provision made by `Ansible`)
2. `Alma Linux` OS (RedHat compatible) for enterprise-grade stability
3. `NGINX` as reverse proxy with `Letsencrypt` SSL certificates with automatic renewal
4. `SELinux` for enhanced security context and isolation
5. Separate system users for each service component to maintain proper isolation
6. Rootless `Podman` with `Quadlet` systemd services for container management
7. `SELinux` volume masking/labeling for secure container volume management
8. `nftables` for advanced firewall management
9. `systemd-proxyd` for service port forwarding and proxying
10. Automatic container updates using `Podman`'s auto-update feature
11. Self-hosted Docker registry for image management
12. `Fish Shell` for improved user experience

This setup provides a secure, maintainable, and scalable infrastructure for deploying `Bun.js` applications with proper isolation between services, automated updates, and robust security measures - all based on enterprise-grade `Alma Linux`.

Take a look at container file: https://github.com/Mati365/hetzner-podman-bunjs-deploy/blob/main/infra/roles/apps/frontend/tasks/main.yml

## How to run it?

1. Create empty project on hetzner.com, add primary IP named `app-primary-ip`
2. Point your DNS to `app-primary-ip` IPv4 address
3. Set these envs:

    ```bash
      HCLOUD_KEY: <your hcloud read & write key>
      REGISTRY_USERNAME: <specify username for podman registry>
      REGISTRY_PASSWORD: <specify password for podman registry>
      WEBSITE_DOMAIN: <specify site domain name without protocol e.g `example.site.org`>
    ```

4. Paste your public SSH keys to all users dirs present in `infra/keys/authorized/`
5. Run `deploy-hetzner.yml` workflow by manually triggering it in GitHub Actions.
6. Connect to the server via SSH: `ssh admin@<your-ip>` (where `<your-ip>` is your Hetzner server's IP address)
7. Enter your `Hello World` site and enjoy!

## Setting up Stateful Services

This project can be extended to include stateful services like databases. Below is a guide on how to deploy PostgreSQL with proper security considerations.

> [!WARNING]
> When mounting volumes with SELinux enabled, you **must** use the `:Z` suffix for your volume mounts. Otherwise, SELinux will block container access to the volume, leading to permission errors.

### PostgreSQL with PostGIS Example

1. **Create a new role in `infra/roles/services/postgres`**

2. **Create a task file `main.yml`:**

```yaml
- name: Ensure postgres volume dir is present
  file:
    path: '{{ item }}'
    state: directory
    owner: db
    group: db
    mode: '0740'
  loop:
    - '{{ podman.volumes_dir }}/postgres'
    - '{{ podman.volumes_dir }}/postgres/data'

- name: Postgres Dockerfile synced
  register: postgres_dockerfile
  template:
    src: Dockerfile
    dest: '{{ podman.volumes_dir }}/postgres/Dockerfile'
    owner: db
    group: db
    mode: '0640'

- name: Ensure postgres build service is present
  become_user: db
  register: postgres_build
  copy:
    dest: ~/.config/systemd/user/build-postgres-dockerfile.service
    content: |
      [Unit]
      Description=Build Postgres Dockerfile
      After=network.target

      [Service]
      Type=oneshot
      ExecStart=/usr/bin/podman build -t postgres-local {{ podman.volumes_dir }}/postgres
      RemainAfterExit=false

      [Install]
      WantedBy=multi-user.target
    owner: db
    group: db
    mode: '0640'

- name: Ensure postgres.container exists
  become_user: db
  register: postgres_container_file
  blockinfile:
    path: ~/.config/containers/systemd/postgres.container
    create: true
    owner: db
    group: db
    mode: '0640'
    block: |
      [Unit]
      Description=The postgres container
      Requires=build-postgres-dockerfile.service
      After=local-fs.target build-postgres-dockerfile.service

      [Container]
      Image=postgres-local
      LogDriver=journald

      PublishPort=5432:5432
      NoNewPrivileges=true
      ReadOnlyTmpfs=true

      Environment=PGDATA=/var/lib/postgresql/data/pgdata
      Environment=POSTGRES_USER={{ podman.postgres.username }}
      Environment=POSTGRES_PASSWORD={{ podman.postgres.password }}

      Volume={{ podman.volumes_dir }}/postgres/data:/var/lib/postgresql/data/pgdata:Z,rw
      UserNS=keep-id:uid=999,gid=999

      [Service]
      TimeoutStartSec=900
      Restart=on-failure
      RestartSec=8

      [Install]
      WantedBy=default.target

- name: Ensure postgres build container service is enabled
  become_user: db
  systemd:
    scope: user
    name: build-postgres-dockerfile
    enabled: true
    daemon_reload: true

- name: Ensure postgres service works
  become_user: db
  systemd:
    scope: user
    name: postgres
    state: '{{ "restarted" if postgres_container_file.changed or postgres_dockerfile.changed or postgres_build.changed else "started" }}'
    enabled: true
    daemon_reload: true
```

3. **Create a `templates` directory with `Dockerfile`:**

```dockerfile
FROM docker.io/pgvector/pgvector:pg17

ENV TZ Europe/Warsaw

RUN apt update && apt install postgis postgresql-17-postgis-3 -y
```

4. **Add PostgreSQL credentials to your group_vars:**

Update `infra/group_vars/all.yml` with:

```yaml
podman:
  # ...existing config...
  postgres:
    username: postgres
    password: "your-secure-password"
```

5. **Add database user to all_users in group_vars:**

```yaml
all_users:
  # ...existing users...
  - name: db
    groups: containers,systemd-journal
```

6. **Add the role to your playbook:**

Update `infra/configure.yml`:

```yaml
# Containerized services
- hosts: web
  gather_facts: true
  become: true
  tags: services
  roles:
    # ...existing roles...
    - role: services/postgres
      tags: postgres
```

### Security Considerations for Stateful Services

1. **Volume labeling:** The `:Z` suffix in volume mounts ensures proper SELinux context, allowing the container to access the volume securely.

2. **User namespace mapping:** The `UserNS=keep-id:uid=999,gid=999` directive maps the PostgreSQL user inside the container to maintain proper file ownership.

3. **Isolation:** Each service runs as a separate system user with limited permissions.

4. **NoNewPrivileges flag:** Prevents privilege escalation from within the container.

### Adapting for Other Stateful Services

The same pattern can be adapted for other stateful services:

1. Create a dedicated system user
2. Properly configure volumes with `:Z` suffix
3. Use separate Podman Quadlet configuration files
4. Consider user namespace mapping for proper file ownership
5. Implement proper backup strategies

## Useful links

https://www.redhat.com/sysadmin/quadlet-podman <br />
https://www.redhat.com/sysadmin/podman-auto-updates-rollbacks <br />
https://docs.podman.io/en/latest/markdown/podman-auto-update.1.html

## License

MIT License

Copyright (c) 2023 Mateusz Bagiński

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
