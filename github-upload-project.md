# Upload this project to GitHub (Git)

This guide walks through publishing `project-crypto` to GitHub using Git from Windows (PowerShell).

## Prerequisites

1. [Git for Windows](https://git-scm.com/download/win) installed — verify with `git --version` in PowerShell.
2. A [GitHub](https://github.com) account.
3. Authentication for pushes:
   - **HTTPS**: a [Personal Access Token (PAT)](https://github.com/settings/tokens) (GitHub does not accept your account password for Git over HTTPS), or
   - **SSH**: an SSH key [added to your GitHub account](https://docs.github.com/en/authentication/connecting-to-github-with-ssh).

## 1. Create a new empty repository on GitHub

1. On GitHub: **+** → **New repository**.
2. Pick a name (for example `project-crypto`).
3. Leave the repo **empty**: do **not** add README, `.gitignore`, or license (avoids merge conflicts on the first push).
4. Create the repository and keep the page open — you need the clone/push URL.

## 2. Open a terminal in your project folder

```powershell
cd "C:\Users\USER\Desktop\project-crypto"
```

Adjust the path if your project lives elsewhere.

## 3. Initialize Git (if this folder is not a repo yet)

```powershell
git status
```

If you see **fatal: not a git repository**, run:

```powershell
git init
```

Optional — use `main` as the default branch name:

```powershell
git branch -M main
```

## 4. Configure Git (first time only)

If Git complains about missing user identity:

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## 5. Add a `.gitignore` (recommended)

Before the first commit, ignore secrets and generated files (for example `node_modules`, `.env`, build folders). Add or update `.gitignore` to match your stack so you do not push credentials or huge artifacts.

## 6. Stage and commit

```powershell
git add .
git status
git commit -m "Initial commit"
```

## 7. Add the GitHub remote

Replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub username and repository name.

**HTTPS:**

```powershell
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
```

**SSH:**

```powershell
git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO.git
```

Verify:

```powershell
git remote -v
```

### If `origin` already exists

Point it at the correct URL:

```powershell
git remote set-url origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
```

Or remove and re-add:

```powershell
git remote remove origin
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
```

## 8. Push to GitHub

If your branch is `main`:

```powershell
git push -u origin main
```

If your branch is still `master`:

```powershell
git push -u origin master
```

- **HTTPS**: when prompted for a password, use a **Personal Access Token**, not your GitHub account password.
- **SSH**: ensure your key is loaded and registered on GitHub.

## 9. Ongoing workflow

After you change files:

```powershell
git add .
git commit -m "Short description of the change"
git push
```

## 10. Troubleshooting

| Symptom | What to try |
|--------|-------------|
| Push rejected (non-fast-forward) | The remote has commits you do not have. Prefer starting from an **empty** repo. If you intentionally added files on GitHub first, pull and reconcile (for example `git pull origin main --rebase`) before pushing — only if you understand the resulting history. |
| Wrong remote URL | `git remote set-url origin <correct-url>` |
| Accidentally staged secrets or huge folders | Add paths to `.gitignore`, then `git rm -r --cached <path>`, commit again, and push. |

## Quick reference (copy-paste order)

```powershell
cd "C:\Users\USER\Desktop\project-crypto"
git init
git branch -M main
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Remember to substitute your real GitHub URL and to set `user.name` / `user.email` if Git asks.
