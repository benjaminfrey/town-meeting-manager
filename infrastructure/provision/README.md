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
Docker itself was left alone: removing it wasn't asked for and nothing in
Stage 0 needs it gone.

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

`nginx`'s distro-default site does listen on `0.0.0.0:80`/`[::1]:80` (the
Debian package default, unchanged) — see `nginx-dev.conf` in this directory
for why that's left as-is for now (it serves nothing but the stock "Welcome
to nginx" page) and what should change when Stage 1 wires up a real proxy.

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

## Step 4: Roles

Two roles, created with `CREATE ROLE ... LOGIN PASSWORD '<generated>'`
wrapped in an idempotent `DO $$ ... IF NOT EXISTS ... $$` block (safe to
re-run this provisioning step without erroring on a second pass), followed
by `CREATE DATABASE town_meeting_manager OWNER tmm_owner;`:

```sql
CREATE ROLE tmm_owner LOGIN PASSWORD '<generated>';   -- owns the schema, runs migrations
CREATE ROLE tmm_app   LOGIN PASSWORD '<generated>';   -- application login, NOT a table owner
CREATE DATABASE town_meeting_manager OWNER tmm_owner;
```

Passwords: 32-character random strings from
`openssl rand -base64 30 | tr -d '/+=' | head -c 32`, one per role,
generated on the VM and never typed or displayed — they went straight from
`openssl` into the `CREATE ROLE` statement and into the credentials file
below in the same script.

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
- `nginx`'s stock default site listens on `0.0.0.0:80` (Debian's package
  default). This is not a Postgres exposure issue and the brief's "never
  expose to the open internet" language is specifically about Postgres, but
  it's noted here for the record: the box does have one LAN-reachable HTTP
  port serving nothing but the stock nginx welcome page. `nginx-dev.conf`
  in this directory documents that Stage 1's real config should bind nginx
  to loopback too, matching the Postgres posture, rather than the LAN.
- `max_connections = 50` was applied via `systemctl restart` (required for
  both `shared_buffers` and `max_connections` — a reload is not sufficient
  for either), confirmed active with `SHOW max_connections;` returning `50`
  post-restart, not just written to the config file.
- Passwords were generated with `openssl rand -base64 30 | tr -d '/+=' |
head -c 32` rather than a memorable/invented string, written straight to
  a root-owned `0600` file, and never appeared in this session's tool
  output — the verification step captured them into local shell variables
  and `unset` them right after use.
