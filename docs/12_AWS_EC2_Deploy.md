# Going live on AWS — one server, reachable by IP address (no domain yet)

This puts the **web console, the API and the database on one small AWS server (EC2)** using the `docker-compose.yml` in this repository. Phones and browsers reach it at `http://<server-ip>/`. It is the quickest honest path; when a domain is bought, HTTPS is a 10-minute add-on (section 9). The bigger ECS/RDS design in `10_AWS_Deployment.md` stays available for later.

Rough cost: a `t3.small` (2 GB) is about USD 15–17 a month + 30 GB disk ≈ USD 3 + a few cents for the fixed IP. Use `t3.medium` (4 GB, ≈ USD 30) if the server feels slow.

---

## 1. Get the right permission (the screenshot shows "Access denied")

The IAM user you were given is not allowed to do anything except sign in. Ask whoever owns the AWS account (the root user / an admin) to attach a policy to your IAM user:

* Easiest: **`AmazonEC2FullAccess`** (IAM → Users → your user → *Add permissions* → *Attach policies directly*).
* Also useful (optional): `AmazonSSMReadOnlyAccess`, `CloudWatchReadOnlyAccess`, `IAMReadOnlyAccess`, `AWSBillingReadOnlyAccess`.

Nothing else is required for this setup: no S3, RDS, ECS or IAM rights. **Never send access keys in chat or commit them** — you sign in to the console in the browser and need no keys at all.

**Region:** your screenshot shows *eu-north-1 (Stockholm)*. For users in India, **Asia Pacific (Mumbai) `ap-south-1`** is faster. Pick it at the top right of the console before you create anything, and stay in the same region for everything below.

## 2. Create the server (EC2 console, about 5 minutes)

1. **EC2 → Instances → Launch instances**
2. Name: `karyasetu`
3. Image: **Ubuntu Server 24.04 LTS** (64-bit x86)
4. Instance type: **t3.small** (or t3.medium)
5. **Key pair → Create new key pair**: name `karyasetu-key`, type RSA, `.pem`. A file downloads — **keep it safe**, it is the only way to log in. (Windows: put it in `C:\Users\<you>\.ssh\karyasetu-key.pem`.)
6. **Network settings → Edit → Create security group**, with exactly these rules:
   * SSH (22) — Source: **My IP** (not "Anywhere")
   * HTTP (80) — Source: Anywhere (0.0.0.0/0)
   * Do **not** open 5432 (database), 3000 or 3001.
7. **Storage:** 30 GiB `gp3`.
8. Launch. Then **EC2 → Elastic IPs → Allocate → Associate** it to the instance. This is the **fixed public IP** (it will not change if the server restarts). Write it down: `<SERVER-IP>`.

## 3. Log in and install Docker

From PowerShell on your PC:
```powershell
ssh -i C:\Users\<you>\.ssh\karyasetu-key.pem ubuntu@<SERVER-IP>
```
(If it complains the key file is too open: right-click the file → Properties → Security → keep only your user.)

On the server:
```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu          # then log out and log in again
# small servers need swap while building the images
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 4. Get the code

The repository is `https://github.com/dtsolution-a/fsm`. If it is private, create a **fine-grained personal access token** on GitHub (Settings → Developer settings; repository `fsm`, permission *Contents: Read-only*) and use it as the password:
```bash
git clone https://github.com/dtsolution-a/fsm.git karyasetu
cd karyasetu
```

## 5. Configure secrets (on the server only)

```bash
cp .env.example .env
nano .env
```
Fill the three values with **long random text** — generate each with `openssl rand -hex 24` and paste:
```
POSTGRES_PASSWORD=<random>
JWT_SECRET=<random, 32+ characters>
SEED_ADMIN_PASSWORD=<12+ characters you will remember: this is the Admin login>
HTTP_PORT=80
```
`.env` is never committed to git. Keep a copy in a password manager.

## 6. Start it

```bash
docker compose up -d --build            # first build takes 5-10 minutes
docker compose ps                       # all services "running"/"healthy"
docker compose run --rm backend node dist-tools/seed.js     # first time only: lists + the Admin user
```
Open **`http://<SERVER-IP>/`** → sign in as `Admin` with `SEED_ADMIN_PASSWORD`. Then change that password in the app (*Users*) or via the profile page.

Check the API: `http://<SERVER-IP>/api/v1/health` shows `{"status":"ok","db":"up",...}`.

## 7. Put your real data in (the QuikAllot import)

The customer files (`Data/` folder) are **not in git** (private data). Load them from your PC into the server database through an SSH tunnel — nothing is exposed to the internet:

1. PowerShell window 1 (leave it open):
   ```powershell
   ssh -i C:\Users\<you>\.ssh\karyasetu-key.pem -L 5433:127.0.0.1:5432 ubuntu@<SERVER-IP>
   ```
2. PowerShell window 2, in `E:\FSM\backend` (use the server's `POSTGRES_PASSWORD`):
   ```powershell
   $env:DATABASE_URL = "postgresql://fsm:<POSTGRES_PASSWORD>@127.0.0.1:5433/fsm?schema=public"
   npm run import:quikallot
   npm run import:users
   npm run link:zones
   ```
   The imported users' random passwords are written to `backend/import-credentials.csv` on your PC (git-ignored). Hand them out and ask people to change them.
3. Close the tunnel window when done.

## 8. The mobile app against the IP address

Android blocks plain `http://` in release builds, so for the IP-only stage install the **debug build** (it allows it):
```powershell
cd E:\FSM\mobile
flutter build apk --debug --dart-define=API_URL=http://<SERVER-IP>/api/v1
```
The APK is at `mobile\build\app\outputs\flutter-apk\app-debug.apk`. Send it to the phones (WhatsApp / Drive) and install it. Once you have a domain with HTTPS, build a normal release APK with `--dart-define=API_URL=https://your-domain/api/v1`.

## 9. Later: domain + HTTPS (recommended before wide use)

Passwords and tokens travel unencrypted over plain `http://`. That is acceptable for an internal pilot, **not for the long run**. When you have a domain:
1. Point an `A` record at the Elastic IP.
2. Open port 443 in the security group.
3. Put **Caddy** (automatic HTTPS) in front, or use `certbot` with nginx. Ask and it will be added to `docker-compose.yml`.

## 10. Day-2 operations

| Task | Command (on the server, in `~/karyasetu`) |
|---|---|
| Update to the latest code | `git pull && docker compose up -d --build` (database migrations run automatically) |
| See logs | `docker compose logs -f backend` |
| Restart | `docker compose restart` |
| **Database backup** | `docker compose exec -T db pg_dump -U fsm fsm \| gzip > ~/backup-$(date +%F).sql.gz` — run daily by cron, and copy off the server |
| Restore | `gunzip -c backup.sql.gz \| docker compose exec -T db psql -U fsm fsm` |
| Take an AWS snapshot | EC2 → Volumes → Create snapshot (do this before big changes) |
| Run the demo kit | `docker compose exec backend node scripts/demo-kit.mjs` (and `--remove`) — see `11_Demo_Guide.md` |

Photos and signatures are stored in the `uploads` Docker volume (they survive rebuilds); they are included if you snapshot the disk.

## 11. Security checklist for this setup

* Security group: SSH only from your IP; only 80 (and later 443) public. The database listens on the server's own `127.0.0.1` only.
* `.env` secrets only on the server; JWT secret is 32+ random characters (the API refuses to start in production otherwise).
* The app locks an account for 15 minutes after 5 wrong passwords, and rate-limits sign-in and the public pages (both in the API and in nginx).
* Passwords must be 10+ characters with a letter and a number. Change the Admin password after the first sign-in; use a different strong password per person.
* Turn on **EC2 → Instance → Actions → Security → Modify instance metadata options → IMDSv2 required**, and enable automatic security updates: `sudo apt-get install -y unattended-upgrades`.
* Keep the GitHub repository **private** (it contains your business documents).
* Enable MFA on the AWS account and on the IAM user.
* API docs (`/api/docs`) are off in production by default.

## 12. If something goes wrong

* **Site does not open:** security group has port 80 open? `docker compose ps` — is `proxy` running? `docker compose logs proxy`.
* **"Invalid configuration" in backend logs:** a value in `.env` is missing or `JWT_SECRET` is too short.
* **Build is killed / out of memory:** make sure swap is on (step 3) or use `t3.medium`.
* **Phone app says cannot reach server:** open `http://<SERVER-IP>/api/v1/health` in the phone's browser; the app must be built with that exact address.
