-- Pause the ingest worker's cron tick before a migration + deploy window (see design/gtm/RELEASE-RUNBOOK.md).
select cron.alter_job(jobid, active := false) from cron.job where jobname = 'spotter-worker-tick';
select jobname, active from cron.job where jobname = 'spotter-worker-tick';
