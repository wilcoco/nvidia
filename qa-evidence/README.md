# Local QA evidence

This directory is the canonical local destination for evidence that should not
be committed with source or synthetic production data. Everything below this
README is ignored by Git.

Use these paths:

- `qa-evidence/webmcp/YYYY-MM-DD-client-version/`
- `qa-evidence/mobile/YYYY-MM-DD-device-os-browser/`
- `qa-evidence/releases/<git-short>-manifest.md`

Each test folder should contain a filled result Markdown file plus screenshots,
screen recordings or exported client transcripts. Remove tokens, cookies,
email addresses and real company data before sharing an archive.
