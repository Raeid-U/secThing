# Unpublished Development Context

Continues from published `dev_log_0004.md`.

## Operational network verification

After a container-sandbox policy change, one-off `worker` Compose containers were used to probe the same outbound paths as the application, without starting PostgreSQL or changing application data. The configured SEC User-Agent was used; the Wikimedia probe used a descriptive User-Agent based on the same configured contact address.

- `www.sec.gov/files/company_tickers.json` returned HTTP 200.
- `data.sec.gov/submissions/CIK0001286613.json` failed before TLS completed: `Client network socket disconnected before secure TLS connection was established`.
- `en.wikipedia.org/api/rest_v1/page/summary/Artificial_intelligence` failed with the same pre-TLS socket-disconnect error.

The successful ticker-mapping request does not make live SEC onboarding functional: `SecClient.fetchCompanySubmission` requires the distinct `data.sec.gov` hostname. Wikimedia enrichment remains deferred and must be explicitly attributed when it is eventually implemented. The user has since asked that development logs be created only upon an explicit end-of-session/report request; keep subsequent durable notes in this rolling file.

## Safe continuation

The user subsequently updated the policy and the same one-off worker-container probe succeeded for all three hosts:

- `www.sec.gov/files/company_tickers.json`: HTTP 200.
- `data.sec.gov/submissions/CIK0001286613.json`: HTTP 200.
- `en.wikipedia.org/api/rest_v1/page/summary/Artificial_intelligence`: HTTP 200.

The earlier TLS failures are resolved in the worker runtime. The next useful validation is to start the normal Compose stack and run a real LINC intake, verifying persistence of its company profile and filing catalogue. Do not create a numbered dev log unless the user explicitly requests one.
