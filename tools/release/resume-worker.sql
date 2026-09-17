-- Resume the ingest worker's cron tick after the deploy has been smoke-tested.
select cron.alter_job(jobid, active := true) from cron.job where jobname = 'spotter-worker-tick';
select jobname, active from cron.job where jobname = 'spotter-worker-tick';
