# A2Z Organizational Password Manager

Welcome to the A2Z Organizational Password Manager. A2Z is a secure, zero-trust password management solution designed for organizational use, featuring advanced cryptographic architecture and seamless user experiences.

## Features

* **Zero-Trust Architecture:** Passwords and secrets are never stored in plaintext. We utilize Argon2, PBKDF2-HMAC-SHA256, and AES-GCM encryption methods to secure your data.
* **Two-Factor Authentication (2FA):** Integrated 2FA (TOTP) ensuring that your vaults are safeguarded against unauthorized access. Complete with a secure, segmented TOTP input UI.
* **Bulk CSV Uploads:** Easily migrate and populate your system by uploading `.csv` files containing users and departments directly from the dashboard.
* **Department-Level Sharing:** Streamlined access management allowing secure sharing of credentials within designated departments.
* **Modern & Responsive UI:** Clean, intuitive, and responsive design for an optimized User Experience.

## Software Requirements

To run this application locally, you must have the following installed on your machine:
* **Docker** (v20.10+)
* **Docker Compose** (v2.0+)

## How to Run the Website (Recommended Method)

We recommend using the included `manage.sh` script as the primary "website runner" to manage the application and its containers.

1. **Extract the Project:**
   Extract the project zip folder and navigate to the project root directory in your terminal.

2. **Make the Runner Executable:**
   Before running the script, ensure it has executable permissions:
   ```bash
   chmod +x manage.sh
   ```

3. **Start the Website:**
   Use the runner script to build and start the application:
   ```bash
   ./manage.sh start
   ```

4. **Access the Website:**
   Open your preferred web browser and go to:
   * **https://localhost** (Recommended - Make sure to accept the self-signed certificate for local testing)
   * or **http://localhost**

5. **Stopping the Website:**
   When you are finished, you can stop the platform by running:
   ```bash
   ./manage.sh stop
   ```

*(Note: If you prefer, you can also use standard `docker-compose up --build -d` and `docker-compose down` commands).*

## Default Credentials

Upon your first launch, the database is automatically seeded with an Administrator account. 

* **Username:** `admin`
* **Master Password:** `Admin123!ChangeMe`

*Note: You will be prompted to configure your 2FA via an Authenticator App (e.g., Google Authenticator, Authy) upon your first login.*

## How to Use the Website

1. **Login:** Enter the default admin credentials on the login page.
2. **Setup 2FA:** Scan the generated QR code using your Authenticator App and enter the 6-digit code.
3. **Dashboard:** Once logged in, you will be directed to the Admin Dashboard.
4. **Manage Users & Departments:** Navigate using the sidebar to add new organizational users, assign them to departments, and manage access.
5. **Upload CSV:** Click on the "Upload CSV" button in the admin dashboard to quickly import multiple users and departments. Ensure your CSV follows the format provided in the platform.
6. **Secure Your Vault:** After any changes, ensure you log out properly to lock the vault.

---
*Developed for Advanced Cryptography Project.*
