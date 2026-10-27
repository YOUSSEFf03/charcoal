# Farah Charcoal — deployment starter pack
VC
This pack is tailored to the uploaded repository layout (root Vite app + `apps/backend` NestJS/Prisma workspace).

## Architecture
- Employee app: private access over Tailscale; no public app URL required.
- Clerk webhook: separate public HTTPS endpoint via Tailscale Funnel, routed by a dedicated Nginx config that accepts only `POST /webhooks/clerk`.
- PostgreSQL: no published host port; persistent Docker volume.
- Updates: GitHub Actions validates `main`; the HP server polls GitHub every 5 minutes and deploys new commits. This avoids exposing SSH or installing a public GitHub runner on the laptop.

## Important prerequisites
1. Keep Windows until the deployment is tested and backups/recovery are proven.
2. Commit and push the desired production code to GitHub `main`. The uploaded ZIP included uncommitted local changes and does not include `.git`, so this pack cannot safely determine which commit should be deployed. Do not deploy a branch until you have reviewed/committed the intended changes.
3. Have a Clerk **production** instance ready, with `pk_live_...`, `sk_live_...`, and the webhook signing secret. Never put `sk_live_...` or `whsec_...` in GitHub code or the Vite frontend.
4. Confirm the production app can use the Clerk instance/domain configuration you intend. The private app URL will be the Tailscale machine DNS name on port 8443; the public webhook URL will be the same Tailscale DNS name on HTTPS port 443.
5. Install Ubuntu Server LTS, Docker Engine + Compose plugin, Git, OpenSSH client, and Tailscale on the HP only after you have backed up anything you need from Windows.

## Files
- `Dockerfile.backend`: builds the NestJS API from the repository root.
- `Dockerfile.frontend`: builds the root Vite application.
- `compose.production.yml`: backend, frontend, PostgreSQL, and isolated webhook proxy.
- `nginx/app.conf`: frontend SPA + same-origin API reverse proxy.
- `nginx/webhook.conf`: only permits `POST /webhooks/clerk`; all other paths/methods are rejected.
- `scripts/deploy.sh`: backs up DB, fetches `main`, builds, applies migrations, and restarts services.
- `scripts/deploy-poll.sh` + `systemd/*`: checks `main` every 5 minutes without opening an inbound SSH port.
- `.github/workflows/ci.yml`: tests and builds on pushes/PRs to `main`.
- `.env.production.example`: template only. Copy it on the server to `.env.production` and enter real values locally on the server.

## Before first deployment
This is a starter pack, not a completed production installation. It has not been run on your HP laptop, against your Clerk instance, or against a production database. Validate the repository build and migration history on a disposable database first. Review `scripts/deploy.sh` and `compose.production.yml` before running them. The server's initial deployment should be manual; enable polling only after it passes smoke tests.

## First-run sequence (high level)
1. Push reviewed code to `main`.
2. On the Ubuntu server, clone the repository to `/opt/farah-charcoal/app` using a read-only GitHub deploy key if the repository is private.
3. Copy `deployment/.env.production.example` to `/opt/farah-charcoal/.env.production`, fill in actual production secrets, and set permissions to `600`.
4. Set `GITHUB_REPO_SSH` in `/opt/farah-charcoal/.deploy-config` to the SSH URL for your repository, e.g. `git@github.com:YOUSSEFf03/charcoal.git`; set `DEPLOY_BRANCH=main`.
5. Run an initial reviewed deployment manually: `sudo /opt/farah-charcoal/app/deployment/scripts/deploy.sh`.
6. Test private app access, login, core accounting flows, database persistence after restart, webhook signature verification, and restore a test backup.
7. Configure Tailscale Serve for private app access: `sudo tailscale serve --bg --https=8443 http://127.0.0.1:8080`.
8. Configure the public webhook: `sudo tailscale funnel --bg 8081`. This publishes the dedicated local webhook proxy on the machine's public Tailscale HTTPS hostname. Check your Tailscale account/admin settings support Funnel and review its current policy.
9. In Clerk, set the webhook endpoint to `https://<machine>.<tailnet>.ts.net/webhooks/clerk` and subscribe only to `user.created`, `user.updated`, and `user.deleted`. Use the signing secret Clerk gives you as `CLERK_WEBHOOK_SECRET`.
10. Install the systemd units from `deployment/systemd/` and enable the timer only after the first manual deploy and smoke tests.

The exact Tailscale command syntax/features can vary by installed version and tailnet policy; verify with `tailscale serve --help` and `tailscale funnel --help` on the server. If Funnel is unavailable on your plan, use a domain-backed Cloudflare Tunnel or another stable HTTPS ingress, still forwarding only to the webhook-only proxy.

## Security notes
- Never publish PostgreSQL's port.
- Never set `DEV_AUTH_BYPASS_ENABLED=true` or `NODE_ENV=development` in production.
- Never commit `.env.production`, private keys, tokens, or real webhook secrets.
- The app frontend exposes only the Clerk **publishable** key at build time; that key is expected to be public. Secret keys stay on the backend.
- Backups must be copied off the HP laptop. A backup stored only on the same SSD is not disaster recovery.
- The default database password in the dev `docker-compose.yml` is not reused here.
