# Farah Charcoal production deployment

This setup runs the root Vite app, the NestJS API, and PostgreSQL with Docker Compose on Ubuntu Server. Employees reach the app over Tailscale. The only public ingress is the Clerk webhook listener; it forwards only `POST /webhooks/clerk`. PostgreSQL has no host port.

## Branch and approval model

Repository state shows `feature/waste-pool` as the current development branch and `main` as the established production branch in the existing workflow and deployment notes. CI runs for pushes to `main` and `feature/**`, and for pull requests targeting `main`. The server polls only `origin/main` every five minutes.

Configure GitHub branch protection for `main`: require pull requests, require the `test-and-build` job, and require the appropriate human approval(s). The poller treats every commit on `main` as approved; do not enable it until those repository rules are active. GitHub administrators can bypass branch rules, so protect bypass permissions too.

## First server setup

1. Back up any existing HP laptop data. Install a supported Ubuntu Server release, Docker Engine with the Compose plugin, Git, curl, gzip, and Tailscale. Keep SSH private to the tailnet or LAN.
2. Create `/opt/farah-charcoal/app` as a Git clone of this repository, with a read-only deploy key if private. Ensure the clone has no local modifications. The deploy scripts run as root and explicitly mark this path safe for Git; keep the checkout writable by root for detached checkouts.
3. Create `/opt/farah-charcoal/.env.production` from this directory's `.env.production.example`. Enter real production Clerk credentials and a long random PostgreSQL password locally on the server. Encode any reserved characters in the password when placing it in `DATABASE_URL`. Set file ownership to root and mode `600`; never commit the real file.
4. Set up off-device encrypted backup storage. The deploy script creates a gzip-compressed logical PostgreSQL backup under `/opt/farah-charcoal/backups` before every migration and does not delete backups. Copy backups off the laptop regularly; local backups do not protect against disk loss.
5. Deploy the reviewed production commit manually after verifying `main` branch protection: `sudo /usr/bin/bash /opt/farah-charcoal/app/deployment/scripts/deploy.sh <commit-sha>`. Use the full reviewed commit SHA from `origin/main`. This builds tagged images, backs up the database, applies Prisma migrations, starts services, and checks `/health`.
6. Install and enable the timer only after manual deployment and smoke tests succeed:
   ```sh
   sudo install -m 0644 /opt/farah-charcoal/app/deployment/systemd/farah-charcoal-deploy.{service,timer} /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now farah-charcoal-deploy.timer
   sudo systemctl list-timers farah-charcoal-deploy.timer
   ```
7. Configure private app access with Tailscale Serve, for example `sudo tailscale serve --bg --https=8443 http://127.0.0.1:8080`. Confirm an employee device on the tailnet can sign in and complete core accounting flows.
8. Configure the public webhook with Tailscale Funnel or another public HTTPS ingress only for `127.0.0.1:8081`, for example `sudo tailscale funnel --bg 8081`; keep port 8080 private. In Clerk, use `https://<machine>.<tailnet>.ts.net/webhooks/clerk` and subscribe to `user.created`, `user.updated`, and `user.deleted`. Ensure `CLERK_WEBHOOK_SECRET` matches the signing secret. Tailscale Serve/Funnel syntax and policy vary by version and account; verify them on the server.
9. Test a valid and invalid Clerk webhook delivery in Clerk, database persistence after a container restart, and a restore into a separate test database before relying on automatic deployments.

## Deployment behavior

`deploy-poll.sh` fetches `origin/main` and invokes `deploy.sh`; it does not lock. `deploy.sh` is the sole owner of `deployment-state/deploy.lock` for both manual and polled runs, and rechecks the current SHA after acquiring it. A busy lock returns status 75 (the poller treats that as a benign overlap). A failed SHA is recorded so the timer does not repeat the same failed rollout and fill the disk with backups; a newer main SHA is still attempted.

`deploy.sh` refuses a dirty checkout, checks Compose configuration, builds images tagged with the full target SHA, waits for PostgreSQL, writes and validates a unique backup, runs `prisma migrate deploy`, waits for healthy services, and checks the app's proxied health endpoint. It atomically updates the deployed SHA only after all these steps succeed. Failures preserve their original exit status and record the failed SHA. Invalid partial backups are removed; verified backups are retained. Database schema/data is never automatically rolled back.

Each deploy builds a new full-SHA image tag; it does not overwrite the prior tag, and the scripts never prune images. On a post-update failure, image rollback first verifies both exact prior tags exist, then runs Compose with `--no-build` and rechecks health. If either tag is missing, it refuses an implicit rebuild and prints a recovery message. Image rollback is safe only when the old application supports every migration that already ran and the old image passes health. This repository's migration history includes dropped columns and a dropped table, so do not assume rollback compatibility. Prefer expand/contract changes: add nullable columns/tables or compatible indexes first, deploy code that works with both shapes, backfill separately, and remove/rename/narrow old schema in a later release after no old app image needs it. Review each SQL migration for destructive operations before enabling the auto-deploy timer.

Do not run `docker compose down -v`, remove `production_pgdata`, or prune old deployment images. Keep enough disk space for at least the current and previous images plus backups.

## Recovery

The script prints the backup path when a rollout fails. For an application-only rollback after a successful deployment, pause polling, then restore the previous image tag:

```sh
cd /opt/farah-charcoal/app
sudo systemctl stop farah-charcoal-deploy.timer
PREVIOUS_SHA="$(sudo cat /opt/farah-charcoal/deployment-state/previous-commit)"
sudo env DEPLOY_IMAGE_TAG="$PREVIOUS_SHA" docker compose --env-file /opt/farah-charcoal/.env.production -f deployment/compose.production.yml up -d --wait backend frontend webhook-proxy
printf '%s\n' "$PREVIOUS_SHA" | sudo tee /opt/farah-charcoal/deployment-state/current-commit >/dev/null
```

Keep polling paused until the problem is fixed on `main`; otherwise the poller will deploy the same bad commit again. Check migration compatibility first; old code may not work with a newer schema.

Restore a database only when a migration left the schema unusable or data was corrupted and an operator explicitly approves the recovery point. Prefer an application image rollback when the schema remains valid and backward-compatible. Before restoring, schedule maintenance and stop the API and both proxies; also pause polling. The following commands import into a new database and leave the current database (including writes newer than the backup) intact:

```sh
cd /opt/farah-charcoal/app
BACKUP='/opt/farah-charcoal/backups/name-of-selected-backup.sql.gz'
sudo systemctl stop farah-charcoal-deploy.timer
sudo docker compose --env-file /opt/farah-charcoal/.env.production -f deployment/compose.production.yml stop backend frontend webhook-proxy
sudo docker compose --env-file /opt/farah-charcoal/.env.production -f deployment/compose.production.yml exec -T db sh -ec 'createdb -U "$POSTGRES_USER" farah_recovery'
sudo gzip -dc "$BACKUP" | sudo docker compose --env-file /opt/farah-charcoal/.env.production -f deployment/compose.production.yml exec -T db sh -ec 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" farah_recovery'
```

Verify the recovered data, then have the operator change `DATABASE_URL` to use `farah_recovery` and start the services with a schema-compatible image tag. Keep the old database and backup until the app is verified. The recovery database reflects the backup time; later production writes are not present in it and may need reconciliation. Never restore over or delete the current database/volume, and do not switch production to the recovery database until the operator has approved the recovery point and understands the write gap.

## Security notes

- `.env.production` stays outside the repository and Docker build context. The frontend build receives only `VITE_CLERK_PUBLISHABLE_KEY` and the same-origin API path; Clerk secret keys, webhook secrets, and database credentials are backend/server-only.
- The Clerk publishable key is intentionally public. Do not add secret-valued `VITE_*` variables: Vite embeds them in browser assets.
- The backend has no published host port. The private app proxy publishes only on loopback port 8080; the webhook-only proxy publishes only on loopback port 8081. Do not expose either directly on the LAN/router. PostgreSQL is only on Compose's internal `dbnet`.
- Health checks and webhook signature verification are implemented in the application. The webhook proxy enforces its exact path and POST method, and Nest verifies Svix headers against the raw request body.
