# VM Provisioning Record — `tmm` (dev/staging)

Stage 0, Task 6 of the revival plan. This is the reproduction recipe for the
box, not a paraphrase of it — every command below was copied from the
terminal as it was run, not reconstructed afterwards from memory.

## Target

|                |                                                                      |
| -------------- | -------------------------------------------------------------------- |
| Hostname       | `tmm`                                                                |
| Address        | `192.168.1.162` (private LAN only)                                   |
| SSH            | `ssh ben@192.168.1.162` — key auth, passwordless `sudo`              |
| OS             | Debian GNU/Linux 13 (trixie)                                         |
| Kernel         | `6.12.95+deb13-cloud-amd64`                                          |
| Virtualization | KVM (QEMU Standard PC)                                               |
| vCPU           | 2                                                                    |
| RAM            | 3.8 GiB total (~3.4-3.5 GiB available at idle)                       |
| Disk           | 32 GB (`/dev/sda1` on `/`), 2.5 GB used / 28 GB free after this task |

Confirmed with `hostnamectl`, `free -h`, `df -h /`, `nproc` at the start of
this task — see task-6-report.md for full output.

### What else runs on the box

Docker 29.6.2 was already installed and running, but with **zero**
containers, images, or volumes (`docker ps -a`, `docker images`, `docker
volume ls` all empty, verified both before and after this task). There was
no Supabase stack to remove — the "drop the eight Supabase containers"
framing in the master plan assumed a state this box was never actually in.

**Update 2026-08-26 — Docker has since been removed entirely.** At the
owner's request, so that nothing can accidentally be deployed to this box
as containers. It was still empty at removal time, so nothing was
destroyed. This was done outside Task 6's scope and does not affect Steps
2–5 below, which never touched Docker either way — the recipe replays
identically on a box that never had it.

```bash
sudo systemctl disable --now docker.socket docker.service containerd.service
sudo apt-get purge -y docker-ce docker-ce-cli docker-ce-rootless-extras \
  containerd.io docker-buildx-plugin docker-compose-plugin docker-model-plugin
sudo apt-get autoremove -y
sudo rm -rf /var/lib/docker /var/lib/containerd /etc/docker /run/docker.sock
sudo rm -f /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.asc
sudo groupdel docker
sudo apt-get update
```

Verified afterwards: no `docker`/`containerd`/`runc` binaries, packages, or
residual `rc`-state configs; no systemd units; no `docker` group;
`/etc/apt/sources.list.d/` reduced to `debian.sources`. **PostgreSQL 17.11
and nginx both confirmed still `active`.**

Removal reclaimed almost nothing — `/var/lib/docker` held 212 KB. Free
space actually went _down_ slightly across this task (29 GB → 28 GB),
because Postgres, PostGIS, Node and nginx were installed in the same
window. The motivation was closing off a deployment path, not disk.

No Postgres, Node, or nginx were present before this task. Nothing else of
note runs on the box.

## How the development Mac reaches Postgres

**SSH tunnel, not direct exposure.** Postgres binds only to loopback:

```
listen_addresses = localhost     # postgresql.conf default, left unchanged
```

confirmed on the wire with `ss -tlnp` after startup:

```
LISTEN 127.0.0.1:5432   postgres
LISTEN    [::1]:5432   postgres
```

— no `0.0.0.0` or LAN-interface bind for port 5432. `pg_hba.conf` (also the
Debian package default, left unchanged) only has `host` entries for
`127.0.0.1/32` and `::1/128`, both `scram-sha-256`, plus `local` (Unix
socket) entries. There is no host entry for `192.168.1.0/24` or `0.0.0.0/0`
at all, so even a misconfigured `listen_addresses` would still be rejected
at the `pg_hba.conf` layer for any non-loopback source. This is the
tightest configuration that still lets the Mac connect: Postgres never
listens on an interface the LAN can reach, so "never expose Postgres to the
open internet" is satisfied by construction, not by a firewall rule that
could be forgotten later.

The Mac reaches it by forwarding a local port over SSH to the VM's loopback:

```bash
ssh -f -N -L 15432:127.0.0.1:5432 ben@192.168.1.162 -o ExitOnForwardFailure=yes
```

then connecting to `127.0.0.1:15432` as if Postgres were local:

```bash
psql "postgresql://tmm_owner@127.0.0.1:15432/town_meeting_manager"
```

Close the tunnel with `pkill -f 'ssh -f -N -L 15432:127.0.0.1:5432 ben@192.168.1.162'`
(or just kill the backgrounded ssh process) when done. This was verified
working end-to-end in Step 5 below, then closed — no tunnel is left running
after this task.

`nginx`'s distro-default site listened on `0.0.0.0:80`/`[::]:80` (the
Debian package default) until the fix described in "Step 4a" below — it now
listens on `127.0.0.1:80`/`[::1]:80` only, matching Postgres's loopback-only
posture. See `nginx-dev.conf` in this directory for the corrected exact
commands and what should change when Stage 1 wires up a real proxy.

## Step 2: Install Postgres, Node, nginx

Debian 13 ships all four packages natively at exactly the versions the
Task 6 brief's survey predicted, confirmed with `apt-cache policy` before
installing anything (no third-party repo needed — only `debian.sources` and
`docker.list`, no PGDG/NodeSource entries exist on the box):

```
postgresql-17           Candidate: 17.11-0+deb13u1
nodejs                   Candidate: 20.19.2+dfsg-1+deb13u2
nginx                    Candidate: 1.26.3-3+deb13u7
```

Commands run, verbatim:

```bash
export DEBIAN_FRONTEND=noninteractive
sudo -n apt-get update -y
sudo -n apt-get install -y postgresql-17 postgresql-17-postgis-3 nodejs nginx
```

(`apt-get install` pulled in `postgresql-17-postgis-3`'s GDAL/GEOS/PROJ
dependency chain, which takes a couple of minutes to unpack on 2 vCPUs —
the install ran to completion in the background across an SSH-session
timeout; verified afterwards with `pgrep apt-get`/`pgrep dpkg` returning
nothing and `dpkg --configure -a` clean.)

Installed versions, confirmed with `dpkg -l` and each tool's own version
flag:

```bash
$ psql --version
psql (PostgreSQL) 17.11 (Debian 17.11-0+deb13u1)
$ node --version
v20.19.2
$ /usr/sbin/nginx -v
nginx version: nginx/1.26.3
$ pg_lsclusters
Ver Cluster Port Status Owner    Data directory              Log file
17  main    5432 online postgres /var/lib/postgresql/17/main /var/log/postgresql/postgresql-17-main.log
$ systemctl is-active postgresql nginx
active
active
$ systemctl is-enabled postgresql nginx
enabled
enabled
```

`postgresql-17-postgis-3` (3.5.2+dfsg-1) is installed but not `CREATE
EXTENSION postgis`'d into any database yet — Stage 5 does that when parcel
work starts. Installing the package now avoids adding the PGDG repo (or a
second Postgres install) later just to get PostGIS.

Node 20.19.2 matters beyond "it's the LTS on the box": the repo root's
`package.json` pins `engines.node: ">=20.19.0"` because `eslint@10` requires
it, and Debian 13's native `nodejs` satisfies that floor exactly — no
NodeSource repo, no nvm, no version mismatch with what CI expects.

## Step 3: Tune Postgres for the real memory budget

`infrastructure/provision/postgresql.conf.tuned` (this directory) documents
and was applied as `/etc/postgresql/17/main/conf.d/99-tmm-tuning.conf` — a
drop-in, not an edit to the package-managed `postgresql.conf`, because
Debian's `postgresql-common` already wires `include_dir = 'conf.d'` in by
default (confirmed present before touching anything). Applying tuning as a
drop-in means `apt-get upgrade` of `postgresql-17` later won't silently
revert it via `.dpkg-new`/prompt.

Commands run:

```bash
# from the Mac, with the file's content on stdin:
cat infrastructure/provision/postgresql.conf.tuned | \
  ssh ben@192.168.1.162 'sudo -n tee /etc/postgresql/17/main/conf.d/99-tmm-tuning.conf > /dev/null'
ssh ben@192.168.1.162 'sudo -n chown postgres:postgres /etc/postgresql/17/main/conf.d/99-tmm-tuning.conf && sudo -n chmod 644 /etc/postgresql/17/main/conf.d/99-tmm-tuning.conf'
ssh ben@192.168.1.162 'sudo -n systemctl restart postgresql'   # shared_buffers/max_connections need a restart, not just reload
```

### Tuning rationale (kept the brief's numbers; here's why they still fit)

The brief's values were written for "4 GB"; the box surveyed at 3.8 GB
total / ~3.4-3.5 GB available. That's a ~5-13% difference, not enough to
push any of these values out of their normal range once checked against the
box's own stated budget (Postgres ~1 GB, Node 200-500 MB, Puppeteer
300-500 MB per Chromium instance — from the brief itself):

- `shared_buffers = 1GB` — 26% of 3.8 GB total, inside the standard "~25%
  of RAM" starting point, and equal to the brief's own "Postgres wants
  roughly 1 GB" figure. Kept as-is.
- `effective_cache_size = 2GB` — a planner hint (expected OS + Postgres
  page-cache size), not a real allocation. 53% of total RAM, inside the
  usual 50-75% guideline. Kept as-is.
- `work_mem = 16MB` — per sort/hash operation, not per connection. The
  worst-case ceiling (50 connections all sorting at once) is 800 MB, but a
  single Fastify process with a small `pg.Pool` won't realistically hold
  anywhere near 50 concurrent connections; day-to-day usage stays well
  under 200 MB. Kept as-is.
- `maintenance_work_mem = 256MB` — used by one `VACUUM`/`CREATE
INDEX`/autovacuum worker at a time in the common case, not continuously.
  Kept as-is.
- `max_connections = 50` — deliberately below Postgres's default of 100,
  per the brief: one Fastify process's pool plus one dedicated
  `postgres.js` `LISTEN` connection needs nowhere near 100 slots, and each
  idle connection still costs backend memory Puppeteer needs more.

Sum check with everything running at once (1 GB Postgres + 500 MB Node +
500 MB one Puppeteer/Chromium instance = 2 GB) leaves ~1.4-1.8 GB of the
3.4-3.5 GB available for OS page cache and headroom — comfortable, not
tight. No value was scaled down from the brief.

Verified applied, post-restart:

```
$ sudo -u postgres psql -c "SHOW shared_buffers;" -c "SHOW effective_cache_size;" \
    -c "SHOW work_mem;" -c "SHOW maintenance_work_mem;" -c "SHOW max_connections;"
 shared_buffers | 1GB
 effective_cache_size | 2GB
 work_mem | 16MB
 maintenance_work_mem | 256MB
 max_connections | 50
```

### Correction: fixed a wrong apply-procedure comment in the tuned-file header

`postgresql.conf.tuned`'s own header comment originally said to apply it
with `sudo -u postgres cp` + `systemctl reload postgresql` — inconsistent
with this section, which correctly requires `tee` as root (the login user
can't write into `/etc/postgresql/` directly) plus a **restart**, not a
reload (`shared_buffers`/`max_connections` are postmaster-context and don't
take effect on reload — see the comment above). A stale copy of that wrong
comment was also live in `/etc/postgresql/17/main/conf.d/99-tmm-tuning.conf`
on the VM. Fixed the header comment in the repo file, then pushed the
corrected file to the VM **without restarting Postgres** — a comment-only
change doesn't need one:

```bash
cat infrastructure/provision/postgresql.conf.tuned | \
  ssh ben@192.168.1.162 'sudo -n tee /etc/postgresql/17/main/conf.d/99-tmm-tuning.conf > /dev/null && \
    sudo -n chown postgres:postgres /etc/postgresql/17/main/conf.d/99-tmm-tuning.conf && \
    sudo -n chmod 644 /etc/postgresql/17/main/conf.d/99-tmm-tuning.conf'
```

Verified the live file now matches the repo file byte-for-byte
(`diff` between the two showed no output), and that Postgres's
`ActiveEnterTimestamp` (`systemctl show postgresql -p ActiveEnterTimestamp`)
is unchanged from the Step 3 restart above — confirming no restart happened
— while `SHOW shared_buffers;`/`SHOW max_connections;` still correctly
report `1GB`/`50` (those values were already live from the original
restart; only the comment text needed to reach the box).

## Step 4: Roles

Two roles, created with an idempotent `DO $$ ... IF NOT EXISTS ... $$`
block (safe to re-run this provisioning step without erroring on a second
pass), followed by `CREATE DATABASE town_meeting_manager OWNER tmm_owner;`,
and the root-owned credentials file written in the same script. Full
command, run on the VM exactly as follows (password values shown as
`${OWNER_PW}`/`${APP_PW}` shell-variable placeholders here — the real
32-character values were never echoed or committed, see below):

```bash
OWNER_PW=$(openssl rand -base64 30 | tr -d '/+=' | head -c 32)
APP_PW=$(openssl rand -base64 30 | tr -d '/+=' | head -c 32)

sudo -n -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tmm_owner') THEN
    CREATE ROLE tmm_owner LOGIN PASSWORD '${OWNER_PW}';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tmm_app') THEN
    CREATE ROLE tmm_app LOGIN PASSWORD '${APP_PW}';
  END IF;
END
\$\$;
SQL

sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_database WHERE datname='town_meeting_manager'" | grep -q 1 || \
  sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE town_meeting_manager OWNER tmm_owner;"

sudo -n install -d -m 0700 -o root -g root /etc/tmm
sudo -n bash -c "cat > /etc/tmm/db-credentials.env" <<CRED
# Town Meeting Manager - Postgres role credentials for the tmm dev/staging VM
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ). Root-owned, mode 0600. Do NOT commit.
TMM_OWNER_PASSWORD=${OWNER_PW}
TMM_APP_PASSWORD=${APP_PW}
CRED
sudo -n chmod 0600 /etc/tmm/db-credentials.env
sudo -n chown root:root /etc/tmm/db-credentials.env
```

`tmm_owner` gets the `IF NOT EXISTS` guard because a re-run of this script
(e.g. after a mistake, or provisioning a second similar box) should not
error out on `CREATE ROLE` colliding with an existing role — it should
just leave the existing role and its password alone. `CREATE DATABASE`
doesn't support `IF NOT EXISTS` in the same way, so it's guarded with an
explicit existence check instead (`CREATE DATABASE ... IF NOT EXISTS` isn't
valid Postgres SQL).

Passwords: 32-character random strings from
`openssl rand -base64 30 | tr -d '/+=' | head -c 32`, one per role,
generated on the VM and never typed or displayed — they went straight from
`openssl` into the `CREATE ROLE` statement and into the credentials file
below in the same script, and were never printed to a terminal or committed
anywhere in cleartext.

**Why the two-role split matters**: PostgreSQL table owners bypass row-level
security unconditionally. Under the old Supabase stack this never surfaced
because PostgREST connected as a role that did not own the tables. If the
application ever connects as the schema owner, all 83 RLS policies become
silent no-ops — no error, every town can read every other town's rows.
`tmm_owner` runs migrations and owns every table; `tmm_app` is what the
Fastify process connects as, and per Step 5's verification, is confirmed
non-superuser (grants for `tmm_app` are issued in the Stage 1 baseline
migration, once tables exist to grant on).

Confirmed role attributes (all `f` — no bypass, no superuser, no
create-role/create-db/replication):

```
  rolname  | rolsuper | rolcreaterole | rolcreatedb | rolreplication | rolbypassrls
-----------+----------+---------------+-------------+----------------+--------------
 tmm_app   | f        | f             | f           | f              | f
 tmm_owner | f        | f             | f           | f              | f
```

### Where the credentials live

`/etc/tmm/db-credentials.env` on the VM — directory `/etc/tmm` is `0700`
owned by `root:root`; the file itself is `0600` owned by `root:root`. `ben`
(the SSH login user) cannot read it directly; only `sudo -n cat
/etc/tmm/db-credentials.env` (root) can. Contents:

```
TMM_OWNER_PASSWORD=<32-char generated password>
TMM_APP_PASSWORD=<32-char generated password>
```

Nothing was committed to the repository, and nothing was echoed into this
session's transcript in full — the verification step in Step 5 captured the
values into local shell variables, used them, and `unset` them immediately
after.

**How the developer's Mac obtains them**: pull the file over the existing
SSH connection when needed, e.g.

```bash
ssh ben@192.168.1.162 'sudo -n cat /etc/tmm/db-credentials.env'
```

and store it locally as, e.g., `packages/api/.env.local` (already
git-ignored) or a password manager entry — not in the repository. Anyone
with SSH access to `ben@192.168.1.162` and passwordless sudo can read this
file; that's the same trust boundary the SSH key itself already grants, so
it adds no new exposure.

## Step 4a: Bind nginx's default site to loopback

Not one of the brief's original six steps, but closes the one LAN-reachable
gap left after Step 2: Debian's default `/etc/nginx/sites-enabled/default`
binds port 80 on **all** interfaces (`listen 80 default_server;` /
`listen [::]:80 default_server;`), which is reachable from the LAN even
though it serves nothing but the stock "Welcome to nginx" page. There is no
firewall on the box (`ufw` not installed), so this was closed at the nginx
config layer instead, matching Postgres's own loopback-only posture:

```bash
ssh ben@192.168.1.162 'sudo -n cp /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.bak-pre-loopback'
ssh ben@192.168.1.162 'sudo -n sed -i \
  -e "s/^\tlisten 80 default_server;/\tlisten 127.0.0.1:80 default_server;/" \
  -e "s/^\tlisten \[::\]:80 default_server;/\tlisten [::1]:80 default_server;/" \
  /etc/nginx/sites-enabled/default'
ssh ben@192.168.1.162 'sudo -n nginx -t && sudo -n systemctl reload nginx'
```

**Mistake made and caught during this step**: the backup copy
(`default.bak-pre-loopback`) was placed inside `/etc/nginx/sites-enabled/`
itself. Debian's `nginx.conf` does `include /etc/nginx/sites-enabled/*;`
with no filename filter, so the backup was loaded as a second, still-`0.0.0.0`-bound
server block — `ss -tlnp` after the `reload` above still showed `0.0.0.0:80`
and `[::]:80`, from the backup file, not the edited one. Fixed by removing
the backup from `sites-enabled/` (moving a rollback copy into an
actively-included config directory is the wrong move regardless of which
directive it contains):

```bash
ssh ben@192.168.1.162 'sudo -n rm -f /etc/nginx/sites-enabled/default.bak-pre-loopback'
```

**Second surprise**: even after removing the stray backup, a `systemctl
reload nginx` (SIGHUP) left the old `0.0.0.0:80`/`[::]:80` listening
sockets open under the reloaded master/workers — the new `listen
127.0.0.1:80` directive didn't take effect until a full restart:

```bash
ssh ben@192.168.1.162 'sudo -n systemctl restart nginx'
```

Verified with `ss -tlnp` before/after each attempt; final state:

```
$ sudo ss -tlnp | grep ':80'
LISTEN 0 511 127.0.0.1:80 0.0.0.0:* users:(("nginx",...))
LISTEN 0 511    [::1]:80    [::]:* users:(("nginx",...))
```

and functionally:

```bash
$ ssh ben@192.168.1.162 'curl -s -o /dev/null -w "loopback: %{http_code}\n" http://127.0.0.1:80/'
loopback: 200
$ ssh ben@192.168.1.162 'curl -s -o /dev/null -w "LAN-ip: %{http_code}\n" --max-time 3 http://192.168.1.162:80/'
LAN-ip: 000   # connection refused/timeout, from the VM's own LAN address
```

`sites-enabled/` now contains only the one, corrected `default` file — no
stray backups. `nginx-dev.conf` in this directory records the same change
for anyone reading the Stage 1 placeholder file directly.

## Step 5: Connectivity verification

From the Mac, with the tunnel from the "How the development Mac reaches
Postgres" section open (`ssh -f -N -L 15432:127.0.0.1:5432
ben@192.168.1.162`):

```bash
psql "postgresql://tmm_owner@127.0.0.1:15432/town_meeting_manager" -c "SELECT version();"
```

```
                                                       version
---------------------------------------------------------------------------------------------------------------------
 PostgreSQL 17.11 (Debian 17.11-0+deb13u1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
```

```bash
psql "postgresql://tmm_app@127.0.0.1:15432/town_meeting_manager" -c \
  "SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user;"
```

```
 current_user | rolsuper
--------------+----------
 tmm_app      | f
```

**Gate passed**: `rolsuper = f` for `tmm_app`. RLS enforcement is intact for
Stage 1's exit gate. Had this printed `t`, the correct response would have
been to stop and not proceed — it did not.

The tunnel was closed immediately after this verification
(`pkill -f 'ssh -f -N -L 15432:127.0.0.1:5432 ben@192.168.1.162'`); nothing
is listening or forwarded now.

## Self-review notes

- Docker was confirmed empty both before and after this task (`docker ps
-a`, `docker images`, `docker volume ls`) — there genuinely was nothing to
  remove, consistent with what the task brief said had already been
  surveyed.
- `postgresql-17-postgis-3` pulls in a large GDAL/GEOS/PROJ dependency
  chain (~100 packages including e.g. `libgdal36`, `libheif1`,
  `libboost-serialization`). That's normal for PostGIS on Debian and not a
  sign anything went wrong; disk usage after install is 2.5 GB/32 GB, still
  well within budget.
- `nginx`'s stock default site originally listened on `0.0.0.0:80`
  (Debian's package default) — a LAN-reachable HTTP port serving nothing
  but the stock nginx welcome page. Initially left as-is under a strict
  reading of the brief's Postgres-scoped "never expose to the open
  internet" language, then closed anyway in Step 4a once flagged: no
  firewall exists on the box, the fix is two lines and zero risk, and it
  matches the Postgres posture this whole task is built around. `ss -tlnp`
  now shows nginx bound to `127.0.0.1:80`/`[::1]:80` only.
- `max_connections = 50` was applied via `systemctl restart` (required for
  both `shared_buffers` and `max_connections` — a reload is not sufficient
  for either), confirmed active with `SHOW max_connections;` returning `50`
  post-restart, not just written to the config file.
- Passwords were generated with `openssl rand -base64 30 | tr -d '/+=' |
head -c 32` rather than a memorable/invented string, written straight to
  a root-owned `0600` file, and never appeared in this session's tool
  output — the verification step captured them into local shell variables
  and `unset` them right after use.
- `postgresql.conf.tuned`'s header comment initially described the wrong
  apply procedure (`sudo -u postgres cp` + `reload`, contradicting Step 3's
  correct `tee`-as-root + `restart`). Caught in review, fixed in the repo
  file, and re-pushed to the VM's `conf.d/` — verified byte-identical via
  `diff` and confirmed no Postgres restart occurred (`ActiveEnterTimestamp`
  unchanged) since only comment text changed.
- The nginx loopback-binding fix (Step 4a) surfaced two real mistakes
  during execution, not just at review time: a backup file left inside
  `sites-enabled/` got loaded as a second, still-public server block, and a
  plain `reload` didn't actually rebind the listening socket (only a full
  `restart` did). Both are recorded in Step 4a with the commands and `ss
-tlnp` output that caught and fixed each one, rather than only reporting
  the final clean state.
