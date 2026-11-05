# Signing the Mac app (the day the Apple Developer membership starts)

Today the Mac app is unsigned, so installing it needs one Terminal step.
Everything else is ready: the app is set up for Apple's hardened runtime
(`build/entitlements.mac.plist`, `electron-builder.yml`) and the
**Mac release** workflow signs and notarises it as soon as these five
secrets exist. No code changes are needed on the day.

## Steps (about 30 minutes, after Apple approves the membership)

1. **Developer ID certificate.** In Xcode: Settings > Accounts > your team >
   Manage Certificates > + > *Developer ID Application*. Then in Keychain
   Access, right-click that certificate > Export > save as `cert.p12` with a
   password.
2. **App-specific password.** At account.apple.com > Sign-In and Security >
   App-Specific Passwords > +. Name it "School Social Hub notarisation".
3. **Team ID.** developer.apple.com/account > Membership details > Team ID
   (10 letters and numbers).
4. **Add the secrets** on GitHub: the repository > Settings > Secrets and
   variables > Actions > New repository secret:

   | Name | Value |
   |---|---|
   | `MAC_CERT_P12_BASE64` | In Terminal: `base64 -i cert.p12 \| pbcopy`, then paste |
   | `MAC_CERT_PASSWORD` | The password from step 1 |
   | `APPLE_ID` | The Apple ID email of the membership |
   | `APPLE_APP_SPECIFIC_PASSWORD` | The password from step 2 |
   | `APPLE_TEAM_ID` | The Team ID from step 3 |

5. **Run it.** Actions > Mac release > Run workflow. The run checks the
   signature and Apple's approval, starts the built app once, and keeps the
   `.dmg` and `.zip` for 30 days.

After that the app opens with a double-click (no Terminal step), and it
updates itself: a signed Mac app downloads a new version in the background,
saves a safety copy, and installs it when the app is closed (the same way the
Windows app already does). It switches on by itself once the app is signed;
nothing to set.

For that, each new version's files go up as a GitHub release (the run keeps
them: the `.zip`, its `.blockmap` and `latest-mac.yml`). Until the repository
is private, anyone can see a release; when it goes private, the download
place moves (decided then).

Never paste these values into a chat or a file in the code: only into
GitHub's Secrets page.
