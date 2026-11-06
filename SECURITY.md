# Security

## Reporting a vulnerability

Please report it privately through [GitHub's security advisories](https://github.com/guillempuche/shorts-studio/security/advisories/new). Don't open a public issue. You'll get an answer within a week.

## What matters most here

- **API keys.** shorts-studio reads keys from the environment or the macOS Keychain. It must never print them, log them or write them to a post folder. Anything that leaks a key is in scope.
- **Spending.** Anything that lets a paid call skip the script approval, the `--yes` confirmation or the spending caps.
- **Downloads.** Anything that makes `source download` read browser cookies when `download.cookiesFromBrowser` isn't set.
- **The install scripts** (`install.sh`, `install.ps1`) and the checksums of the release binaries.
