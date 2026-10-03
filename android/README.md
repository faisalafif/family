# Family Tracker Android companion

This is a separate native Kotlin/Compose collector. The existing React web app and `/track/:token` browser tracker remain available.

## Setup

1. Run `supabase/android-location.sql` in the existing Supabase project after `schema.sql` and `location-provider.sql`.
2. From this `family-tracker/` directory, link the Supabase CLI to the existing project and deploy the functions:

   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy device-register
   supabase functions deploy android-location-ingest
   ```

   The checked-in Supabase config sets `verify_jwt = false` for these two endpoints because this MVP uses a high-entropy tracking token as an enrollment capability. Each function validates the token, family member, installation UUID and payload before using the server-side service-role key. Never add the service-role key to Android.
3. In Android Studio, open this `android/` directory. Create `android/local.properties` from `local.properties.example`; set the local Android SDK path, Supabase project URL and a Supabase **publishable** key. The publishable key is client-safe; never use a Supabase secret/service-role key here.
4. Install Android Studio with Android SDK 36 and JDK 17. The project uses Android Gradle Plugin 8.13.2, which requires Gradle 8.13. If there is no Gradle wrapper yet, use a local Gradle 8.13 once to run `gradle wrapper --gradle-version 8.13`, then open/sync the project. Build `app > Build > Build Bundle(s) / APK(s) > Build APK(s)`. Install `app/build/outputs/apk/debug/app-debug.apk` on the test phone. This workspace has no Android SDK or Gradle installation, so APK compilation has not been verified here.
5. On the dashboard, add the family member and copy their tracking link. Open the Android app on that person's device, enter the same name and Indonesian phone number plus the tracking link, and continue. The Edge Function checks the capability token and identity against the existing family member record.
6. Grant precise/approximate foreground location, then grant **Allow all the time** on Android 10+ from the app's location permission settings. Allow notifications on Android 13+ and keep the visible service notification enabled. Press **Aktifkan perlindungan lokasi**.
7. Leave the phone locked on mobile data for 5–10 minutes. Open the dashboard on another device. Confirm that location history gets `source=ANDROID`, the time advances, and the source/accuracy are shown. That locked-screen hardware test has not been run here, so the collector is not declared acceptance-tested.

## What it does

- Fused Location Provider requests high-accuracy updates about every 30 seconds (fastest interval 15 seconds) from an explicit foreground service with `foregroundServiceType="location"` and an ongoing notification.
- A Room queue retains up to 500 events. WorkManager uploads while online and retries after network recovery. Each event has an idempotency UUID.
- The app shows a friendly animated pin/walker, setup, current status, battery, network, queue size, and permission/service diagnostics.
- The app has a visible Pause action. It does not hide, evade, or disable Android restrictions.
- A best-effort boot receiver is enabled only before Android 14 and only when background location permission was granted. On newer Android versions the app may need to be reopened and tracking restarted.

## Permissions

The app requests coarse/fine location in the foreground and asks the user to explicitly grant background location in system settings on Android 10+. Android 14+ also requires the location foreground-service type and `FOREGROUND_SERVICE_LOCATION`. Android 13+ notification permission is requested before tracking. Approximate location still works but has lower precision; this app does not repeatedly prompt after denial.

Android may delay or stop location delivery due to battery saver, OEM task managers (Xiaomi/OPPO/Vivo/Realme), revoked permissions, disabled location services, force stop, reboot restrictions or poor GPS/network coverage. The service displays its persistent notification. Exempting battery optimization is not requested automatically; Diagnostics reports it and the user can change it through Android settings if needed. See [Android location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions) and [location foreground service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types#location).

## Security caveat

The Android functions use the family tracking token as an installation enrollment capability because this MVP has no Supabase Auth. The tracking token is effectively a credential: share it only with the family member who owns the device; revoke the link/member if it is exposed. The Edge Functions use Supabase's server-side privileged client; no secret key is placed in Android or React code. A production deployment should replace token-based enrollment with authenticated users and owner-scoped RLS before exposing the web MVP publicly. See [Supabase Edge Function authorization](https://supabase.com/docs/guides/functions/auth).
