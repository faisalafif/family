# Family Tracker MVP

Web-only family location prototype using React + Vite + Supabase + Leaflet/OpenStreetMap.

## 1. Supabase

Create a Supabase project, open SQL Editor, and run:

`supabase/schema.sql`

Then copy your project URL and anon key.

## 2. Local setup

```bash
npm install
copy .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Run:

```bash
npm run dev
```

Open the dashboard URL shown by Vite.

## 3. How to test

1. Add a family member with name and phone number.
2. Select the member.
3. Copy the generated tracking link.
4. Open the link on the target phone.
5. Grant browser location permission once.
6. Keep the tracking page open while testing.
7. Open the dashboard and see the latest location on the map.

## Important MVP limitation

This version uses browser Geolocation API. It is not a 24/7 background tracker. If the browser page is closed or the operating system suspends it, location updates can stop.

For a later Android version, keep the same Supabase schema/API concept and replace the browser location collector with a native background location service.

## Security note

The included Supabase policies are intentionally open for a local/private MVP and are NOT suitable for a public production deployment. Before publishing, add Supabase Auth and restrict family data by authenticated user/family.

## Location providers (prototype)

The dashboard's **Get Latest Location** action uses the provider named by `VITE_LOCATION_PROVIDER`. The value is public UI configuration only; never put credentials in a `VITE_*` variable.

Supported values:

- `unavailable` (default): safe default; explains that no network provider is configured.
- `mock`: deterministic simulated coordinates near Jakarta. The UI marks these as **SIMULASI — bukan lokasi nyata**. It is only for testing display/persistence.
- `orange-playground`: calls the Supabase Edge Function below. Orange's official Playground is a free mocked CAMARA API, not Indonesian coverage and not a real device location service. It accepts predefined `+990...` test numbers or test profiles registered in Orange Playground Admin.
- `browser`: dashboard requests are refused; browser GPS is available only on the target's `/track/:token` page. Browser tracking remains supported and sends `GPS` / `browser` provenance.

Before local development, copy `.env.example` to `.env` and set `VITE_LOCATION_PROVIDER=mock` if you want to test with simulated coordinates. Run SQL in `supabase/location-provider.sql` after `schema.sql` to add provenance and request audit fields/table.

### Orange Playground setup

1. Create an Orange Developer account and subscribe to the **Network APIs Playground** / Device Location Retrieval Playground 0.3.
2. Register an application and obtain its Orange Developer `Authorization` header value. The Playground uses 2-legged OAuth client credentials; production Device Location Retrieval requires 3-legged OAuth and consent.
3. Deploy the Edge Function and keep the credential server side:

   ```sh
   supabase functions deploy location-request
   supabase secrets set ORANGE_PLAYGROUND_AUTHORIZATION='Basic ...'
   ```

4. Set `VITE_LOCATION_PROVIDER=orange-playground` in `.env`. Use an actual Playground test profile (`+990...`); an Indonesian `+62...` number will be refused by this adapter. The returned coordinates are always marked simulated.

The implemented documented endpoints are Orange Playground's OAuth token endpoint and CAMARA retrieve endpoint. Do not change these to a production base URL without the provider's production onboarding, 3-legged authorization flow, explicit end-user consent, and operator coverage confirmed for the number. No Telkomsel/IOH/XLSMART/Smartfren production endpoint is configured.

### Architecture and capability limits

`src/location/providers.js` is the provider seam (`getLatestLocation`). The dashboard stores normalized responses in `locations`, updates the member's latest location, and writes `location_requests` audit entries. The tracking page independently retains Browser Geolocation collection. Provider errors do not silently substitute browser coordinates or old rows. Old database rows remain historical and the dashboard labels records as stale after five minutes.

`supabase/functions/location-request` keeps Orange credentials outside the browser, requests a short-lived access token, applies a 12-second timeout, and maps provider errors to readable messages. The provider interface can be extended for an operator after official production docs and authorization are available; no Indonesia telco adapter is included today.

### Security / RLS status

The existing `schema.sql` enables RLS but its `using (true)` / `with check (true)` policies allow public reads and writes to **all** family members and locations. A public tracking token is not safe account authorization. The current UI also has no Supabase Auth, so owner-scoped policies cannot be activated without first adding sign-in and account ownership. Treat this as a local prototype only: before public deployment, add Supabase Auth, add an `owner_id`/family ownership relation, backfill members, replace all permissive policies with `auth.uid()`-scoped policies, and make `/track/:token` use a narrow server-side capability that exposes only the opted-in target's browser location submission. Keep telco authorization and provider secrets only in Edge Function secrets. The Orange Playground function is a mocked learning integration, not a production lookup service.

### Verified API research (27 Sep 2026)

| Provider | Verified capability | Indonesia / real MSISDN | Sandbox, auth, costs / onboarding |
|---|---|---|---|
| GSMA Open Gateway / CAMARA Device Location Retrieval | Standard describes `POST /retrieve`, E.164 MSISDN input and geographic area response with center coordinates, radius and last-location time. Accuracy is network dependent. | The specification alone is not a carrier endpoint. Indonesia production access, operators, coordinates, pricing and onboarding were not publicly verifiable from the docs checked. Consent/authorized OAuth is required for personal data; production may use user-centric authorization. | GSMA sandbox is a free playground with auth-flow testing, but public docs do not confirm live Indonesian operators or real numbers. |
| Telkomsel | Official Telco API materials list Device Location / location verification. | Public docs found do not publish a retrievable-coordinate endpoint, Indonesia production eligibility, accuracy, consent, or API-specific costs. **UNVERIFIED for retrieval**. | DigiHub is a developer marketplace; generic marketplace auth/pricing cannot safely be assumed for Device Location. |
| Indosat / IOH | Operator announcements include Device Location Verification via Telco API Alliance. | Publicly available materials describe checking location in a geographic area; retrieval coordinates and API details are **UNVERIFIED**. | SinergiAPI onboarding portal exists; product docs/prices for retrieval not publicly verified. |
| XLSMART / XL Axiata | Operator/GSMA announcements include Device Location; alliance materials describe verification. | No public retrieval endpoint, location accuracy, consent process, or pricing verified. | Partner/platform onboarding appears necessary; exact service availability is **UNVERIFIED**. |
| Smartfren | Included in GSMA Indonesia Device Location launch announcements. | Current retrieval API and all operational details are **UNVERIFIED**. | Official partner portal exists, but no public Device Location docs/pricing/sandbox confirmed. |
| Infobip (aggregator) | Official Device Location Verification takes MSISDN + coordinates/radius and returns a match result. | Boolean/verification response, not device coordinates; Indonesia operator coverage not confirmed in public docs. | Commercial terms/fees by agreement; availability requires provider confirmation. Not implemented. |
| Aduna (aggregator) | Official location roadmap describes Retrieval as a capability. | Indonesia availability not publicly confirmed; not shown as live for current engagement. | Contact/onboarding required; no public sandbox price/credentials verified. Not implemented. |
| Telefónica Open Gateway | Official sandbox offers Device Location Verification. | No Retrieval coordinates and no Indonesia network coverage shown. | Sandbox available for its supported test networks; not applicable to Indonesian retrieval. |
| Orange Developer CAMARA Playground | Official mocked Device Location Retrieval 0.3 returns a circle center (latitude/longitude), radius, and lastLocationTime; MSISDN E.164. | Mock only, using `+990` test numbers/profiles; **not** an Indonesian carrier and never locates a real phone. | Free Playground subscription, developer account, 2-legged OAuth client credentials. Chosen as lowest-barrier documented prototype. Production requires a separate commercial/operator setup and 3-legged OAuth. |

Primary documentation:

- [CAMARA Device Location Retrieval API specification](https://github.com/camaraproject/DeviceLocation/blob/main/API_definition/device-location-retrieval.yaml)
- [GSMA Open Gateway Device Location Retrieval](https://open-gateway.gsma.com/docs/device-location-retrieval) and [GSMA Sandbox](https://open-gateway.gsma.com/sandbox)
- [Orange Playground Device Location Retrieval 0.3](https://docs.developer.orange.com/network-apis/api-catalog/device-location-retrieval/playground/0.3/getting-started)
- [GSMA Indonesian operator launch announcement](https://www.gsma.com/newsroom/press-release/enhancing-security-and-customer-experience-indonesian-telecom-operators-to-launch-three-service-apis-through-the-gsma-open-gateway-initiative/)
- [Telkomsel, IOH and XLSMART Telco API Alliance](https://www.telkomsel.com/about-us/news/telkomsel-ioh-dan-xlsmart-jalankan-inisatif-bersama-telco-api-alliance-untuk)
- [Infobip service description](https://www.infobip.com/policies/service-description), [Aduna Location APIs](https://www.adunaglobal.com/api-segments/location/), [Telefónica sandbox](https://opengateway.telefonica.com/en/apis)

## Tests

Run `npm test` for offline unit tests (no real telco calls) and `npm run build` to build the web app.

## Android companion

A separate native Kotlin/Compose Android collector is in [`android/`](android/README.md). It retains the web dashboard and browser tracking page, uses a visible location foreground service, a capped offline queue, and Supabase Edge Functions for registration/upload. Apply `supabase/android-location.sql` after the existing schema migrations and deploy the two Android Edge Functions before setup. A real screen-locked device test is still required; background updates are subject to Android and phone-vendor restrictions.
