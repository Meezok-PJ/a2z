# A2Z v2 — QA / Launch Handover Guide

## Default Credentials (Prototype)

- **Admin username**: `admin`
- **Admin master password (plaintext)**: `Admin123!ChangeMe`

Notes:
- The Admin user is seeded on backend startup from environment variables in `docker-compose.yml`.
- The seeded Admin account starts as **not set up** (`is_setup=false`), so the first login will trigger the **First Time Login (FTL)** onboarding flow.

---

## Execution Guide (`manage.sh`)

Run these from the project root:

- **Set VM private IP host (recommended when running in VM)**:
  - `export APP_HOST=<VM_PRIVATE_IP>`
- **Build + fresh start (recommended first run)**:
  - `./manage.sh rebuild`
- **Start existing stack**:
  - `./manage.sh start`
- **View logs (all containers)**:
  - `./manage.sh logs`
- **Stop stack**:
  - `./manage.sh stop`

---

## Application Walkthrough (First Run)

1. Start the stack:
   - `export APP_HOST=<VM_PRIVATE_IP>` (if using host-to-VM access)
   - `./manage.sh rebuild`

2. Open the app:
   - Visit `https://<VM_PRIVATE_IP>` (or `https://localhost` if local-only)

3. Bypass the self-signed certificate warning:
   - **Chrome/Chromium**: click **Advanced** → **Proceed to site (unsafe)**
   - **Firefox**: click **Advanced** → **Accept the Risk and Continue**

4. Admin first-time login (FTL onboarding):
   - Enter username: `admin`
   - You should be routed into **Create master password**
   - Set the master password to: `Admin123!ChangeMe`
   - Scan the displayed **TOTP QR code** with an authenticator app
   - Enter the current TOTP code to complete login
   - You will be redirected to the Admin dashboard at `/admin`

5. Provision your first test user (as Admin):
   - In the Admin dashboard, stay on the **Users** tab
   - Enter a new username (e.g., `testuser1`)
   - Pick a department
   - Click **Create**

6. Trigger the test user’s FTL onboarding flow:
   - Logout from the Admin dashboard
   - On the login page, enter the new test user’s username
   - Because the user was provisioned with `is_setup=false`, the UI should start the **FTL** flow
   - Create the test user’s master password, scan the TOTP QR, then enter a code to complete login
   - The test user will be redirected to `/vault`

---

## Setup Organization Example

To simulate a real-world scenario, you can provision the following users and add these example services to their vaults.

### 1. Provision Users (Admin Dashboard)

| Department | Username | Role | Temporary Password (FTL) |
|---|---|---|---|
| **IT_Department** | `admin` | Admin | `Admin123!ChangeMe` |
| **IT_Department** | `jdoe_it` | User | `ItPass!2026` |
| **HR_Department** | `asmith_hr` | User | `HrPass!2026` |
| **Engineering** | `bwayne_eng` | User | `EngPass!2026` |

### 2. Vault Services Example

Once logged in as these users, populate their vaults with the following data to demonstrate shared vs. private access:

| Owner | Service Name | Username | URL | Password | Scope | Visible To |
|---|---|---|---|---|---|---|
| `admin` | AWS Root Access | `root@company.com` | `https://aws.amazon.com` | `SuperSecretAWS!1` | **Shared** | All `IT_Department` users |
| `admin` | Cloudflare DNS | `admin@company.com` | `https://cloudflare.com` | `CloudFlareSec!9` | **Shared** | All `IT_Department` users |
| `jdoe_it` | Personal GitHub | `jdoe_personal` | `https://github.com` | `MyGitPass123` | **Private** | Only `jdoe_it` |
| `asmith_hr` | Workday Portal | `asmith@company.com` | `https://workday.com` | `WorkdayHR2026` | **Shared** | All `HR_Department` users |
| `bwayne_eng`| Jira Workspace | `bwayne` | `https://jira.company.com` | `JiraEng2026` | **Shared** | All `Engineering` users |
| `bwayne_eng`| Spotify | `bruce_w` | `https://spotify.com` | `BatMusic99` | **Private** | Only `bwayne_eng` |

---

## Database Access Guide

To access the PostgreSQL database running inside the Docker container, you can use the `docker exec` command to open an interactive `psql` session.

### 1. Accessing the Database Container

Run the following command from your terminal:

```bash
docker exec -it a2z-v2-db-1 psql -U a2z -d a2z_vault
```

*Alternatively, if you are using `docker compose` from the project root:*
```bash
docker compose exec db psql -U a2z -d a2z_vault
```

### 2. Viewing the Database (psql commands)

Once you are inside the `psql` interactive prompt (`a2z_vault=#`), you can use the following commands to view and manage the database:

- **List all tables**: `\dt`
- **View a table's schema/columns**: `\d table_name` (e.g., `\d users`)
- **View all data in a table**: `SELECT * FROM table_name;`
- **Quit the database prompt**: `\q`

### 3. Example Queries

**View all registered users:**
```sql
SELECT id, username, department, is_setup FROM users;
```

**View vault entries:**
```sql
SELECT id, owner_id, service_name, scope FROM vault_entries;
```
