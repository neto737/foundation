# @t00ls-dev/create-app

Private workspace CLI for generating the approved basic Cloudflare Workers and
D1 starter. The command is non-interactive and always uses the bundled
`basic-d1` preset.

## Usage

From the foundation workspace:

```sh
pnpm --filter @t00ls-dev/create-app build
pnpm exec create-app ./examples/my-app
```

The preset can also be stated explicitly:

```sh
pnpm exec create-app ./examples/my-app --preset basic-d1
```

The target is required. It may be a new directory or an existing empty
directory. Files, symbolic links, filesystem roots, and non-empty directories
are rejected and are never overwritten.

Run `pnpm exec create-app --help` for the complete command summary.
