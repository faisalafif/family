# Android App Usage History

## Setup

1. Run or rerun `supabase/android-location.sql` in the Supabase SQL Editor. The app usage tables have RLS enabled and no `anon` or `authenticated` read policies; Edge Functions use the service role.
2. Configure a strong dashboard-only key in Supabase Functions secrets. Do not put it in Vite `.env`, Android `local.properties`, source control, or the APK:

   ```powershell
   npx.cmd --yes supabase@latest secrets set ANDROID_USAGE_DASHBOARD_KEY='GANTI_DENGAN_SECRET_RANDOM_PANJANG' --project-ref ccbpucixbqaxgkdkihcs
   ```

   **Key yang saat ini dipasang di Supabase:** `uwdF_aJVNMTUqxVL9dvYd1gVVM7nAALz_8-d2aHvgfg`

   Masukkan key tersebut di bagian **App Usage History** pada web. Karena key ini memberi akses baca ke data App Usage, jangan commit atau publikasikan dokumen yang memuatnya. Key ini sudah pernah dibagikan di chat; rotasi dengan secret acak baru sebelum membagikan repo/dokumen, lalu ganti nilai di sini dan gunakan nilai baru di web.

3. Deploy the functions (the protection/location functions include the pause timestamp change from the previous update):

   ```powershell
   npx.cmd --yes supabase@latest functions deploy android-app-usage-ingest --project-ref ccbpucixbqaxgkdkihcs
   npx.cmd --yes supabase@latest functions deploy android-app-usage-read --project-ref ccbpucixbqaxgkdkihcs
   npx.cmd --yes supabase@latest functions deploy android-location-ingest --project-ref ccbpucixbqaxgkdkihcs
   npx.cmd --yes supabase@latest functions deploy android-protection-control --project-ref ccbpucixbqaxgkdkihcs
   ```

4. Build and install the new APK. In note, enable **Riwayat penggunaan aplikasi**. Android opens Usage Access settings; the device owner must explicitly allow it. If the setting remains off, GPS continues to work and app usage remains off.
5. Deploy the web app. In its App Usage History section, enter the same dashboard-only key. It is kept in the current browser tab's session storage and sent only in a request header to `android-app-usage-read`.

## Data and limitations

- Collection is opt-in and independent of location tracking. It stores package identifier, visible application label when Android exposes one, daily foreground duration, and last-used time when available. It does not read notifications, messages, screen contents, keystrokes, or passwords.
- The collector refreshes the current and previous six local calendar days, stores offline snapshots locally, and retries idempotent uploads. The server deletes records older than 30 days. Android controls the availability and completeness of its usage aggregates.
- Android's aggregate UsageStats API does not guarantee exact session start/end intervals. The dashboard therefore shows daily total and last-used time, not fabricated intervals.
- The legacy dashboard's family/location data policies are public. App usage data is isolated in RLS-protected tables and read through an Edge Function requiring the dashboard-only secret; this does not change the legacy GPS dashboard authorization model.
- No browser-domain collector or phishing classification is enabled. Usage Access does not reveal Chrome URLs or domains. A future DNS/VPN monitor must be separately opt-in, display Android's required VPN/foreground notification, and label DNS data only as network-observed domains.
- Google Safe Browsing API access is free for non-commercial use and has quotas. Its terms restrict commercial use and require conspicuous accuracy limitations and attribution for warnings. Submitted URLs may be used by Google and shared; no domain data is currently sent to Google. See [appropriate use and quotas](https://developers.google.com/safe-browsing/reference/Appropriate.Usage) and [terms](https://developers.google.com/safe-browsing/terms).
