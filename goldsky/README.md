# Goldsky pipeline

The first pipeline is intentionally inspection-only. It reads new successful
execution outcomes for `dclv2.ref-labs.near` and discards them after making
them available through Goldsky live inspection. No database credentials are
stored in this repository.

## Run the inspection pipeline

```powershell
goldsky login
goldsky turbo validate goldsky/near-dcl-inspect.yaml
goldsky turbo apply goldsky/near-dcl-inspect.yaml
goldsky turbo inspect justhoot-near-dcl-inspect
```

Use the inspected records to confirm the exact `near.execution_outcomes`
schema and the runtime representation of `logs`. The production pipeline will
then parse only events where:

```text
executor_id = dclv2.ref-labs.near
standard = dcl.ref
event = swap
pool_id = 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1|wrap.near|100
```

The PostgreSQL connection must be stored as a Goldsky `jdbc` secret, not in a
YAML file or GitHub. Goldsky needs Railway's public Postgres connection URL;
the private `postgres.railway.internal` hostname is only reachable inside the
Railway private network.
