# Signing the apps: Windows choices and Apple Developer steps

Helper, 24 Nov 2026. Document only, for Waleed to choose (Phase 5). Nothing bought or started. Facts from the vendors' own pages read today (links at the end); prices in USD.

## Why signing matters
Without it, Windows shows "Windows protected your PC" (SmartScreen) and macOS says the app "cannot be opened" (today schools must run the xattr / codesign step). Signed apps install with a normal double-click, and the Mac app can update itself (self-update.ts already waits for this).

## Windows: two real options (Azure Artifact Signing is not open to Egypt)

| | A. Microsoft Store (MSIX) | B. Own certificate (SSL.com OV + eSigner cloud) |
|---|---|---|
| Cost | **Free** registration for individuals (since Sep 2025) and companies (since May 2026) | certificate $129/yr (cheaper for 2-5 years, down to $96.75/yr) + eSigner cloud signing $180/yr (240 signings) or $20/month; extra signing $1 |
| Who signs | Microsoft re-signs the MSIX package after review: we need no certificate | we sign in GitHub Actions with the cloud key (no USB token; hardware token rule since June 2023 means cloud or token only) |
| Warnings | none: Store apps are trusted | a new certificate still starts with no SmartScreen reputation, so early users may still see a warning until downloads build trust |
| Updates | Windows updates Store apps itself (our self-update code is not used for the Store copy) | our existing self-update (electron-updater, tested in CI) keeps working |
| Review time | up to 3 business days per version | none; sign and publish when we want |
| Identity check | individual: government ID + selfie; company: business papers, faster with a D-U-N-S number and a company-domain email | OV: business registration papers + a call to a listed company phone; individual (IV) version exists |
| Extra work | electron-builder "appx" target, Store listing (AR/EN), screenshots, privacy policy link | add signing step to windows-release.yml |
| Risk | schools whose IT blocks the Store; every update waits for review | yearly cost; certificate lifetime now max 458 days, so reissue each year |

**Recommendation: A (Microsoft Store) as the main Windows route**, because it is free (fits "free until selling"), has no warning screens at all, and Windows handles updates. Keep the unsigned .exe from GitHub Releases for our own testing only. Choose B only if a school's IT blocks the Store; then buy the 1-year OV ($129) + eSigner Tier 1 ($180/yr), about $309 per year.

Check before starting: that Egypt can be picked as the account country (Microsoft says "nearly 200 markets" but does not list them, and the country cannot be changed later).

## Apple Developer: join by about 25 Jan 2027 ($99 per year)

First decide (Waleed): **individual or organisation?**
- **Individual**: Waleed's legal name shows as the developer. Quickest (often 1-2 days). Needs Apple Account with two-step sign-in, legal name, phone, address (no P.O. box), maybe photo ID; pay with his own card.
- **Organisation**: the company name shows (looks better to schools). Needs a registered legal entity (not a trade name), a D-U-N-S number, authority to sign for the company, an email on the company domain (for example @seen-marketing.net), and a public company website (social pages not accepted). D-U-N-S is free but takes up to 5 business days from D&B plus 2 days for Apple; Apple may ask for notarised papers.

Recommendation: **organisation if Waleed already has a registered company** (it will also be needed for the payment gateway, see tracker/payments-research.md); otherwise individual now, and move to a company later.

### Steps and dates (organisation route; individual route skips 1-2)
1. **By 15 Dec 2026**: look up / request D-U-N-S for the company (free): https://developer.apple.com/enroll/duns-lookup . The name must match the company papers exactly.
2. Make sure the company website is public and the email is on the company domain.
3. **By 5 Jan 2027**: turn on two-step sign-in on the Apple Account, install the Apple Developer app, start enrolment there or at developer.apple.com/programs/enroll . Check that Egypt is allowed at the first screen.
4. Pay $99 when Apple emails (organisations pay after checks). Wait for the confirmation email (contact Apple if nothing after 24 hours).
5. **By 25 Jan 2027**: create a "Developer ID Application" certificate and an app-specific password (or API key) for notarisation; give them to the code thread as GitHub secrets (never in chat or files). Then the code thread turns on signing + notarisation in mac-release.yml and tests self-update on the Mac.

## What only Waleed can do
- Pick individual or organisation (Apple) and confirm the company is registered.
- Request the D-U-N-S number, enrol, pay $99, verify identity.
- Open the Microsoft Partner Center account (free) with ID + selfie or company papers.
- Add the certificates/passwords as GitHub secrets.

## Sources (read 24 Nov 2026)
- Microsoft Store free for individuals (10 Sep 2025): https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/
- Microsoft Store free for companies (7 May 2026): https://blogs.windows.com/windowsdeveloper/2026/05/07/publish-to-microsoft-store-as-a-company-now-with-free-registration-and-faster-onboarding/
- Store FAQ (signing, review time): https://learn.microsoft.com/en-us/windows/apps/publish/faq/get-started-with-the-microsoft-store
- SSL.com OV prices: https://ssl.com/products/software-integrity/code-signing/ov/ ; eSigner prices: https://ssl.com/guide/esigner-pricing-for-code-signing/
- Apple enrolment: https://developer.apple.com/help/account/membership/program-enrollment/ ; D-U-N-S: https://developer.apple.com/support/D-U-N-S/ ; identity: https://developer.apple.com/support/identity-verification
- Earlier note that Azure signing is not open to Egypt: notes/outside-resources-review.md
