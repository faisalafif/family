# Android App Usage History

## Setup

1. Run or rerun `supabase/android-location.sql` in the Supabase SQL Editor. The app usage tables have RLS enabled and no `anon` or `authenticated` read policies; Edge Functions use the service role.
2. Deploy the functions (the read functions authorize using the selected member's tracking token; no dashboard key needs to be entered in the web app):

   ```powershell
   npx.cmd --yes supabase@latest functions deploy android-app-usage-ingest --project-ref ccbpucixbqaxgkdkihcs
   npx.cmd --yes supabase@latest functions deploy android-app-usage-read --project-ref ccbpucixbqaxgkdkihcs
   npx.cmd --yes supabase@latest functions deploy android-domain-ingest --project-ref ccbpucixbqaxgkdkihcs
   npx.cmd --yes supabase@latest functions deploy android-domain-read --project-ref ccbpucixbqaxgkdkihcs
   npx.cmd --yes supabase@latest functions deploy android-location-ingest --project-ref ccbpucixbqaxgkdkihcs
   npx.cmd --yes supabase@latest functions deploy android-protection-control --project-ref ccbpucixbqaxgkdkihcs
   ```

3. Install and link the APK once using the member's tracking link/token. After that, the **Aktifkan berbagi lokasi ** button enables both features, and **Jeda perlindungan** pauses both. Android still requires the device owner to grant Usage Access once in system settings; location permission and notification prompts are also controlled by Android.
4. Deploy the web app. App Usage History and Web Safety Monitor load automatically for the selected linked member; no dashboard key entry is required.

## Web Safety Monitor (opt-in DNS domain history)

- The Android screen has a separate **Web Safety Monitor** switch. Enabling it first requests notification permission when required, then asks Android for VPN consent. The owner must accept the system VPN prompt. Android shows the active VPN indicator and a persistent notification; the switch in note stops the monitor.
- The local VPN routes only DNS queries addressed to its private tunnel DNS address. It records public IPv4/UDP DNS question names and forwards the requests to the DNS server of the current underlying network. Ordinary web traffic is not routed through the tunnel.
- DNS-observed names can include prefetching, app background checks, and other lookups; they are not proof that a person opened a page. The monitor cannot see URL paths, page content, messages, passwords, or which app caused each query. Encrypted DNS, direct DNS, IPv6-only DNS, and DNS-over-TCP may not be captured by this initial implementation.
- The Android queue and Supabase rows retain up to 30 days. Run `supabase/android-location.sql`, deploy both `android-domain-*` functions, build/install the APK, enable the switch, and approve the Android VPN dialog.
- Domain history is shown as **not checked** for threats. No phishing reputation service or block action is configured, so the dashboard does not label domains safe or malicious and does not block connections.

## Data and limitations

- Collection is opt-in and independent of location tracking. It stores package identifier, visible application label when Android exposes one, daily foreground duration, and last-used time when available. It does not read notifications, messages, screen contents, keystrokes, or passwords.
- With Usage Access granted, the app also reads Android foreground activity events to build an approximate per-app session timeline. The dashboard keeps each session under its original start time, paginates both totals and sessions, and displays an active badge only while the last device report is under two minutes old. This is a foreground-use estimate, not screen recording or proof of a person's actions.
- The APK requests Android package visibility to resolve installed apps' display names. The dashboard uses those display names and keeps package identifiers inside expanded details.
- The collector refreshes the current and previous six local calendar days, stores offline snapshots locally, and retries idempotent uploads. The server deletes records older than 30 days. Android controls the availability and completeness of its usage aggregates.
- Foreground event delivery and background scheduling are controlled by Android and device power settings. Data may arrive late; the active badge is intentionally time-limited and does not claim live state after a stale report.
- While the location foreground service is active, App Usage sync runs directly about once per minute. WorkManager provides a 15-minute fallback if that service is unavailable; Android may defer this fallback under power restrictions.
- The legacy dashboard's family/location data policies are public. App usage data is isolated in RLS-protected tables and read through an Edge Function that validates the member tracking token; this does not change the legacy GPS dashboard authorization model. Treat tracking links/tokens as private credentials.
- Usage Access does not reveal Chrome URLs or domains. The separate VPN feature above records limited DNS-observed domain names only and requires visible Android consent/notification. No third-party threat service receives the names.
- Google Safe Browsing API access is free for non-commercial use and has quotas. Its terms restrict commercial use and require conspicuous accuracy limitations and attribution for warnings. Submitted URLs may be used by Google and shared; no domain data is currently sent to Google. See [appropriate use and quotas](https://developers.google.com/safe-browsing/reference/Appropriate.Usage) and [terms](https://developers.google.com/safe-browsing/terms).
