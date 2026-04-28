# Benchmark Automation

This project reads benchmark rankings from committed JSON snapshots instead of fetching PassMark on each user request.

## Runtime

- The app loads benchmark data from `data/benchmarks/cpu-high-end.json`
- The app loads benchmark data from `data/benchmarks/gpu-high-end.json`
- Weekly refreshes update those files and Git history keeps the changes auditable

## Manual refresh

Run this from the project root:

```powershell
npm run benchmarks:fetch:all
```

This command:

- builds the TypeScript project
- downloads the latest CPU and GPU ranking pages
- writes up to 1000 rows per source
- fails if CPU returns fewer than 1000 rows
- fails if GPU returns fewer than 500 rows

The GPU high-end chart currently exposes fewer than 1000 items, so the workflow keeps a lower guardrail there instead of forcing an unreachable target.

## Scheduled refresh

GitHub Actions handles the weekly update in `.github/workflows/weekly-benchmarks.yml`.

Why GitHub Actions instead of a Vercel cron job:

- Vercel Hobby cron jobs are available, but they invoke Vercel Functions rather than committing back to your repository
- this project already deploys from Git, so a GitHub-driven refresh keeps the source of truth in the repo
- every pushed snapshot automatically triggers a new Vercel deployment

The workflow:

1. Runs every Monday at `03:00 UTC`
2. Installs dependencies with `npm ci`
3. Refreshes benchmark snapshots
4. Runs the test suite
5. Commits and pushes `data/benchmarks/*.json` when they changed

## Vercel note

As of January 28, 2026, Vercel documents that Hobby cron jobs can run only once per day and with hourly precision, and cron jobs invoke Vercel Functions rather than repository writes.

Sources:

- [Vercel Cron Jobs Usage & Pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
