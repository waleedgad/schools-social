# Signing the Windows app (later, before selling)

Until the Windows app is signed, Windows shows a blue "Windows protected your
PC / unknown publisher" box the first time a school opens the installer
(More info > Run anyway). Signing removes that box and shows the school's
supplier name instead. It also lets the app's self-update check that every
new version really comes from you.

Everything for signing is ready in the code. On signing day, add the secrets
below and press **Actions > Windows release > Run workflow**.

## Choose one way to sign

Since 2023 a signing key can no longer be kept as a simple file on a
computer: it must live on a USB key or in a signing service in the cloud.
For automatic builds on GitHub, a cloud service is the practical choice.

**Way 1: Azure Trusted Signing (Microsoft).** A monthly service, around
$10 a month for the basic plan. Microsoft checks who you are first. Check
before paying that it accepts a company or person in your country: when this
was written it did not accept every country.

**Way 2: a code-signing certificate from a certificate company** that offers
cloud signing (for example SSL.com eSigner, DigiCert KeyLocker, Certum
SimplySign). Roughly $100 to $400 a year. Some companies can also hand over a
`.pfx` file for automatic signing; ask before buying. Plain "OV" is enough:
the warning box goes once enough schools have installed it. "EV" removes it
straight away but costs more.

Prices and rules change: check them on the day.

## Secrets to add (GitHub > the repository > Settings > Secrets and variables > Actions)

For Way 1 (Azure Trusted Signing):

| Secret | What it is |
|---|---|
| `AZURE_TENANT_ID` | Your Microsoft Entra tenant ID |
| `AZURE_CLIENT_ID` | The app registration's client ID |
| `AZURE_CLIENT_SECRET` | The app registration's secret |
| `AZURE_SIGN_ENDPOINT` | The signing account's address, e.g. `https://weu.codesigning.azure.net` |
| `AZURE_SIGN_ACCOUNT` | The signing account name |
| `AZURE_SIGN_PROFILE` | The certificate profile name |
| `WIN_PUBLISHER_NAME` | The name on the certificate, exactly as written there |

For Way 2 with a certificate file:

| Secret | What it is |
|---|---|
| `WIN_CERT_PFX_BASE64` | The `.pfx` file, turned into text (`base64 -i cert.pfx`) |
| `WIN_CERT_PASSWORD` | Its password |

The run checks that the installer and the app are really signed, starts the
built app once, and keeps the installer and the update files for 30 days.

Never paste these values into a chat or a file in the code: only into
GitHub's Secrets page.
