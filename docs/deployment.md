## Deployment

There is currently no working deployment path. Phase F removed the Docker
Compose stack, which had already stopped working when Docker was removed from
the VM, along with the scripts that drove it. Building a deployment for the
current stack — a process manager for the Fastify API, nginx, and a way to
apply migrations as the database owner — is owned by a separate spec, expected
in Stage 2.

For local development, see `CLAUDE.md` and `pnpm db:reset`.
