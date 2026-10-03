import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./style.css";
import { createLocationProvider, getProviderStatus, LocationProviderError } from "./location/providers.js";
import { persistLocationResult } from "./location/persistence.js";

const locationProviderName = import.meta.env.VITE_LOCATION_PROVIDER || "unavailable";
const onlineThresholdMinutes = Math.max(1, Number(import.meta.env.VITE_LOCATION_ONLINE_MINUTES) || 2);
const offlineThresholdMinutes = Math.max(onlineThresholdMinutes + 1, Number(import.meta.env.VITE_LOCATION_OFFLINE_MINUTES) || 10);
const onlineThresholdMs = onlineThresholdMinutes * 60_000;
const offlineThresholdMs = offlineThresholdMinutes * 60_000;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasSupabaseConfig = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== "https://YOUR_PROJECT.supabase.co" &&
  supabaseAnonKey !== "YOUR_SUPABASE_ANON_KEY"
);
const supabase = hasSupabaseConfig ? createClient(supabaseUrl, supabaseAnonKey) : null;

function randomToken() {
  return crypto.randomUUID();
}

function locationSourceLabel(row) {
  const source = row?.last_source ?? row?.source;
  const provider = row?.last_provider ?? row?.provider;
  if (source === "ANDROID" || provider === "ANDROID" || provider === "android") return "Android GPS";
  if (source === "BROWSER" || source === "GPS" || provider === "browser") return "Browser GPS";
  if (source === "TELCO") return "Telco Network";
  if (source === "MOCK" || provider === "mock") return "SIMULASI";
  return source || provider ? "Last known location" : "Browser GPS (legacy)";
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 11a8 8 0 1 0 2.35 5.65L20 17.5V20h2.5l-1.05-1.05A9.97 9.97 0 1 1 22 12h-2Zm-8 3.5A1.5 1.5 0 1 1 12 13a1.5 1.5 0 0 1 0 3Z" fill="currentColor"/>
    </svg>
  );
}

function ConfigError() {
  return (
    <div className="tracker-page">
      <div className="tracker-card">
        <h1>Family Tracker</h1>
        <div className="status" style={{ background: "#fff1f2", color: "#9f1239" }}>
          <span className="dot" style={{ background: "#ef4444" }} />
          Supabase config belum siap
        </div>
        <p className="muted">
          Isi file .env dengan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY yang valid.
          Setelah itu reload halaman.
        </p>
      </div>
    </div>
  );
}

function Dashboard() {
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [locationHistory, setLocationHistory] = useState([]);
  const [deviceDiagnostics, setDeviceDiagnostics] = useState(null);
  const [deviceDiagnosticsError, setDeviceDiagnosticsError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [requestingLocation, setRequestingLocation] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const [historyFilter, setHistoryFilter] = useState("ALL");
  const [historyStartDate, setHistoryStartDate] = useState("");
  const [historyEndDate, setHistoryEndDate] = useState("");
  const [clockNow, setClockNow] = useState(Date.now());
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerRef = useRef(null);
  const historyRouteRef = useRef(null);

  async function loadMembers() {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("family_members")
        .select("*")
        .order("created_at", { ascending: true });

      if (!error) {
        setMembers(data || []);

        if (selected?.id) {
          const refreshed = (data || []).find(member => member.id === selected.id);
          if (refreshed) setSelected(refreshed);
        }
      }
    } catch (err) {
      console.error("Failed to load family members", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadLocationHistory(memberId) {
    if (!supabase || !memberId) {
      setLocationHistory([]);
      return;
    }

    setHistoryLoading(true);
    try {
      let query = supabase
        .from("locations")
        .select("id,member_id,latitude,longitude,accuracy,source,provider,platform,recorded_at")
        .eq("member_id", memberId)
        .order("recorded_at", { ascending: false });

      if (historyStartDate) query = query.gte("recorded_at", new Date(`${historyStartDate}T00:00:00`).toISOString());
      if (historyEndDate) {
        const exclusiveEnd = new Date(`${historyEndDate}T00:00:00`);
        exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
        query = query.lt("recorded_at", exclusiveEnd.toISOString());
      }

      const { data, error } = await query.limit(historyStartDate || historyEndDate ? 1000 : 120);

      if (!error) setLocationHistory(data || []);
    } catch (err) {
      console.error("Failed to load location history", err);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadDeviceDiagnostics(memberId) {
    if (!supabase || !memberId) {
      setDeviceDiagnostics(null);
      return;
    }
    const { data, error } = await supabase
      .from("android_device_status")
      .select("device_id,location_permission,background_permission,foreground_service,location_services,network_online,battery_optimization_exempt,battery_percent,queued_uploads,reported_at")
      .eq("member_id", memberId)
      .order("reported_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error) {
      setDeviceDiagnostics(data || null);
      setDeviceDiagnosticsError("");
    }
    else {
      setDeviceDiagnostics(null);
      setDeviceDiagnosticsError(error.message || "Gagal membaca laporan diagnostik.");
      console.warn("Diagnostik Android belum tersedia; jalankan supabase/android-location.sql", error);
    }
  }

  async function handleRefresh() {
    await loadMembers();
    if (selected?.id) {
      await loadLocationHistory(selected.id);
      await loadDeviceDiagnostics(selected.id);
    }
  }

  async function requestLatestLocation() {
    if (!selected || !supabase || requestingLocation) return;
    setRequestingLocation(true);
    setProviderMessage("Meminta lokasi...");
    const requestedAt = new Date().toISOString();
    let result = null;
    let failure = null;
    try {
      const provider = createLocationProvider(locationProviderName, {
        invoke: (...args) => supabase.functions.invoke(...args)
      });
      result = await provider.getLatestLocation({ phoneNumber: selected.phone, memberId: selected.id });
      const recordedAt = await persistLocationResult(supabase, selected.id, result);
      setProviderMessage(`${result.provider === "mock" ? "SIMULASI — bukan lokasi nyata. " : ""}Lokasi diterima ${new Date(recordedAt).toLocaleTimeString("id-ID")}${result.accuracy ? ` · akurasi ±${Math.round(result.accuracy)} m` : ""}`);
      await loadMembers();
      await loadLocationHistory(selected.id);
    } catch (error) {
      failure = error;
      const message = error instanceof LocationProviderError ? error.message : (error.message || "Permintaan lokasi gagal.");
      setProviderMessage(message);
    } finally {
      const { error: auditError } = await supabase.from("location_requests").insert({
        member_id: selected.id,
        provider: locationProviderName,
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        status: result && !failure ? "success" : "failed",
        error_code: failure?.code || null,
        error_message: failure?.message || null,
        metadata: result ? { source: result.source, accuracy: result.accuracy } : {}
      });
      if (auditError) console.warn("Request audit could not be saved; apply supabase/location-provider.sql", auditError);
      setRequestingLocation(false);
    }
  }

  useEffect(() => {
    if (!supabase) return;

    loadMembers();
    const channel = supabase
      .channel("locations")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "locations" },
        () => {
          loadMembers();
          if (selected?.id) loadLocationHistory(selected.id);
        }
      )
      .on("postgres_changes",
        { event: "*", schema: "public", table: "android_device_status" },
        () => { if (selected?.id) loadDeviceDiagnostics(selected.id); }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [selected?.id]);

  useEffect(() => {
    if (!selected?.id) {
      setDeviceDiagnostics(null);
      return;
    }
    loadDeviceDiagnostics(selected.id);
  }, [selected?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    mapInstance.current = L.map(mapRef.current).setView([-6.2, 106.816], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapInstance.current);
    historyRouteRef.current = L.layerGroup().addTo(mapInstance.current);
  }, []);

  useEffect(() => {
    if (!selected || !mapInstance.current) return;

    if (selected.latitude == null || selected.longitude == null) return;

    const latLng = [selected.latitude, selected.longitude];
    const contactAt = selected.last_source === "ANDROID" && selected.device_seen_at ? selected.device_seen_at : selected.last_seen;
    const ageMs = contactAt ? Math.max(0, clockNow - new Date(contactAt).getTime()) : Infinity;
    mapInstance.current.setView(latLng, 16);

    if (markerRef.current) markerRef.current.remove();

    markerRef.current = L.marker(latLng)
      .addTo(mapInstance.current)
      .bindPopup(`<b>${selected.name}</b><br/>${locationSourceLabel(selected)}<br/>Accuracy: ±${Math.round(selected.accuracy || 0)} m<br/>${ageMs >= offlineThresholdMs ? "Last known location · OFFLINE" : `Updated: ${selected.last_seen ? new Date(selected.last_seen).toLocaleTimeString() : "unknown"}`}`)
      .openPopup();
  }, [selected]);

  useEffect(() => {
    const routeLayer = historyRouteRef.current;
    if (!routeLayer) return;
    routeLayer.clearLayers();

    const chronological = filteredHistory
      .filter(item => item.latitude != null && item.longitude != null && Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)))
      .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    const points = chronological.map(item => [Number(item.latitude), Number(item.longitude)]);

    if (points.length >= 2) {
      L.polyline(points, { color: "#2563eb", weight: 4, opacity: 0.8 }).addTo(routeLayer);
    }

    chronological.forEach((item, index) => {
      const point = L.circleMarker(points[index], {
        radius: index === 0 || index === chronological.length - 1 ? 7 : 4,
        color: index === 0 ? "#15803d" : index === chronological.length - 1 ? "#b91c1c" : "#1d4ed8",
        weight: 2,
        fillColor: "#ffffff",
        fillOpacity: 1
      }).addTo(routeLayer);
      const popup = document.createElement("div");
      const time = document.createElement("strong");
      time.textContent = new Date(item.recorded_at).toLocaleString("id-ID");
      const coords = document.createElement("div");
      coords.textContent = `${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)}`;
      const endpoint = document.createElement("div");
      endpoint.textContent = index === 0 ? "Titik awal" : index === chronological.length - 1 ? "Titik terbaru" : `Titik ${index + 1}`;
      popup.append(time, coords, endpoint);
      point.bindPopup(popup);
    });
  }, [locationHistory, historyFilter]);

  useEffect(() => {
    if (!selected?.id) {
      setLocationHistory([]);
      return;
    }

    loadLocationHistory(selected.id);
  }, [selected?.id, historyStartDate, historyEndDate]);

  async function addMember(e) {
    e.preventDefault();
    if (!supabase) {
      alert("Supabase config belum valid. Isi file .env terlebih dahulu.");
      return;
    }
    if (!name.trim() || !phone.trim()) return;

    const token = randomToken();
    const { data, error } = await supabase
      .from("family_members")
      .insert({
        name: name.trim(),
        phone: phone.trim(),
        tracking_token: token
      })
      .select()
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    setName("");
    setPhone("");
    await loadMembers();
    setSelected(data);
  }

  async function deleteMember(id) {
    if (!supabase) return;
    if (!confirm("Delete this family member?")) return;
    await supabase.from("family_members").delete().eq("id", id);
    setSelected(null);
    loadMembers();
  }

  const trackingUrl = selected
    ? `${window.location.origin}/track/${selected.tracking_token}`
    : "";

  const filteredHistory = locationHistory.filter(item => {
    if (historyFilter === "ALL") return true;
    const isAndroid = item.source === "ANDROID" || item.platform === "ANDROID" || item.provider === "android";
    return historyFilter === "ANDROID" ? isAndroid : !isAndroid;
  });
  const groupedHistory = filteredHistory.reduce((acc, item) => {
    const dateKey = new Date(item.recorded_at).toISOString().slice(0, 10);
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(item);
    return acc;
  }, {});

  return (
    <div className="app">
      <header>
        <div>
          <h1>Family Tracker</h1>
          <p>Private family location dashboard</p>
        </div>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <section className="card">
            <h2>Add Family Member</h2>
            <form onSubmit={addMember}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+62xxxxxxxxxx" />
              <button type="submit">Add Member</button>
            </form>
          </section>

          <section className="card">
            <h2>Family</h2>
            {loading && <p>Loading...</p>}
            {!loading && members.length === 0 && <p className="muted">No members yet.</p>}
            {members.map(m => (
              <button
                className={`member ${selected?.id === m.id ? "active" : ""}`}
                key={m.id}
                onClick={() => setSelected(m)}
              >
                <span className="dot" />
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.phone}</small>
                </span>
              </button>
            ))}
          </section>

          {selected && (
            <section className="card">
              <h2>{selected.name}</h2>
              <p><b>Last location:</b><br/>
                {selected.latitude != null
                  ? `${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}`
                  : "No location yet"}
              </p>
              <p><b>Accuracy:</b> {selected.accuracy ? `±${Math.round(selected.accuracy)} m` : "-"}</p>
              <p><b>Last update:</b> {selected.last_seen ? new Date(selected.last_seen).toLocaleString() : "-"}</p>
              {selected.last_seen && (() => {
                const contactAt = selected.last_source === "ANDROID" && selected.device_seen_at ? selected.device_seen_at : selected.last_seen;
                const ageMs = Math.max(0, clockNow - new Date(contactAt).getTime());
                const status = ageMs < onlineThresholdMs ? "ONLINE" : ageMs < offlineThresholdMs ? "STALE" : "OFFLINE";
                return <p><b>Device status:</b> {ageMs >= offlineThresholdMs ? "Last known location · " : ""}{status} · {Math.floor(ageMs / 60_000)} min ago</p>;
              })()}
              <p><b>Source:</b> {locationSourceLabel(selected)}</p>

              <div className="device-diagnostics">
                <h3>Diagnostik Android</h3>
                {deviceDiagnosticsError ? <p className="muted">Gagal memuat diagnostik: {deviceDiagnosticsError}. Jalankan ulang supabase/android-location.sql di Supabase SQL Editor.</p> : !deviceDiagnostics ? <p className="muted">Belum ada laporan diagnostik. Pasang APK Android terbaru, deploy ulang android-location-ingest, lalu tunggu Android mengirim lokasi berikutnya.</p> : <>
                  <p className="muted">Laporan: {new Date(deviceDiagnostics.reported_at).toLocaleString("id-ID")}{Date.now() - new Date(deviceDiagnostics.reported_at).getTime() > offlineThresholdMs ? " · data mungkin sudah lama" : ""}</p>
                  <p><b>Izin lokasi:</b> {deviceDiagnostics.location_permission ? "Diizinkan" : "Belum diizinkan"}</p>
                  <p><b>Izin latar belakang:</b> {deviceDiagnostics.background_permission ? "Diizinkan" : "Belum diizinkan"}</p>
                  <p><b>Foreground service:</b> {deviceDiagnostics.foreground_service ? "Aktif · layanan lokasi berjalan di latar dengan notifikasi persisten" : "Tidak aktif · lokasi latar tidak sedang dipantau"}</p>
                  <p><b>Location services:</b> {deviceDiagnostics.location_services ? "Aktif" : "Nonaktif"}</p>
                  <p><b>Network saat laporan:</b> {deviceDiagnostics.network_online ? "Online" : "Offline"}</p>
                  <p><b>Baterai perangkat:</b> {deviceDiagnostics.battery_percent == null ? "Belum dilaporkan" : `${deviceDiagnostics.battery_percent}%`}</p>
                  <p><b>Optimasi baterai:</b> {deviceDiagnostics.battery_optimization_exempt ? "Dikecualikan dari pembatasan" : "Pembatasan aktif · Android dapat membatasi aktivitas latar"}</p>
                  <p><b>Antrean upload lokal:</b> {deviceDiagnostics.queued_uploads} dari 500</p>
                </>}
              </div>

              {["mock", "orange-playground"].includes(locationProviderName) && (
                <button type="button" className="icon-button" onClick={requestLatestLocation} disabled={requestingLocation}>
                  <RefreshIcon />
                  <span>{requestingLocation ? "Meminta lokasi..." : "Get Latest Location"}</span>
                </button>
              )}
              <p className="muted provider-status"><b>Location provider:</b> {getProviderStatus(locationProviderName)}</p>
              {!["mock", "orange-playground"].includes(locationProviderName) && <p className="provider-message">Dashboard menerima lokasi yang sudah dikirim oleh Browser Tracker atau aplikasi Android saat perlindungan aktif. Tombol refresh hanya memuat ulang data tersimpan.</p>}
              {providerMessage && <p className="provider-message" role="status">{providerMessage}</p>}
              <button type="button" className="secondary" onClick={handleRefresh}>Refresh data tersimpan</button>

              <div className="history-block">
                <h3>Location history</h3>
                <p className="muted">Garis rute menghubungkan titik berdasarkan waktu, dari titik awal ke titik terbaru.</p>
                <div className="history-date-filters">
                  <div>
                    <label htmlFor="history-start-date">Dari tanggal</label>
                    <input id="history-start-date" type="date" value={historyStartDate} max={historyEndDate || undefined} onChange={event => setHistoryStartDate(event.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="history-end-date">Sampai tanggal</label>
                    <input id="history-end-date" type="date" value={historyEndDate} min={historyStartDate || undefined} onChange={event => setHistoryEndDate(event.target.value)} />
                  </div>
                </div>
                <button
                  type="button"
                  className="history-reset-button"
                  onClick={() => {
                    setHistoryStartDate("");
                    setHistoryEndDate("");
                    setHistoryFilter("ALL");
                  }}
                  disabled={!historyStartDate && !historyEndDate && historyFilter === "ALL"}
                >
                  Reset filter
                </button>
                <label htmlFor="history-source-filter">Source</label>
                <select id="history-source-filter" value={historyFilter} onChange={event => setHistoryFilter(event.target.value)}>
                  <option value="ALL">All</option>
                  <option value="ANDROID">Android</option>
                  <option value="BROWSER">Browser</option>
                </select>
                {historyLoading && <p className="muted">Loading history...</p>}
                {!historyLoading && Object.keys(groupedHistory).length === 0 && (
                  <p className="muted">Belum ada riwayat lokasi.</p>
                )}

                {!historyLoading && Object.entries(groupedHistory).map(([dateKey, items]) => (
                  <div key={dateKey} className="history-day">
                    <div className="history-date">
                      {new Date(`${dateKey}T00:00:00`).toLocaleDateString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric"
                      })}
                    </div>

                    <ul className="history-list">
                      {items.map(item => (
                        <li key={item.id}>
                          <span>{new Date(item.recorded_at).toLocaleTimeString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit"
                          })}</span>
                          <strong>
                            {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
                          </strong>
                          <small>{locationSourceLabel(item)}{item.accuracy ? ` · ±${Math.round(item.accuracy)} m` : ""}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {trackingUrl && (
                <>
                  <label>Tracking link</label>
                  <input readOnly value={trackingUrl} onFocus={e => e.target.select()} />
                  <button className="secondary" onClick={() => navigator.clipboard.writeText(trackingUrl)}>
                    Copy Link
                  </button>
                </>
              )}
              <button className="danger" onClick={() => deleteMember(selected.id)}>Delete</button>
            </section>
          )}
        </aside>

        <section className="map-wrap">
          <div ref={mapRef} className="map" />
        </section>
      </main>
    </div>
  );
}

function Tracker({ token }) {
  const [member, setMember] = useState(null);
  const [status, setStatus] = useState("Preparing...");
  const [coords, setCoords] = useState(null);
  const pollId = useRef(null);
  const watchId = useRef(null);
  const lastSavedAt = useRef(0);

  async function saveLocation(memberData, position) {
    const now = Date.now();
    if (now - lastSavedAt.current < 20_000) return;
    lastSavedAt.current = now;
    const { latitude, longitude, accuracy } = position.coords;
    setCoords({ latitude, longitude, accuracy });
    const recordedAt = new Date().toISOString();
    const { error: locationError } = await supabase.from("locations").insert({
      member_id: memberData.id,
      latitude,
      longitude,
      accuracy,
      source: "BROWSER",
      platform: "BROWSER",
      provider: "browser",
      recorded_at: recordedAt
    });

    if (locationError) {
      console.error("Failed to save location", locationError);
      setStatus(`Lokasi didapat, gagal disimpan: ${locationError.message}`);
      return;
    }

    const { error: memberError } = await supabase
      .from("family_members")
      .update({ latitude, longitude, accuracy, last_seen: recordedAt, last_source: "BROWSER", last_provider: "browser", device_seen_at: recordedAt })
      .eq("id", memberData.id);

    if (memberError) {
      console.error("Failed to update member location", memberError);
      setStatus(`Riwayat tersimpan, gagal memperbarui lokasi terakhir: ${memberError.message}`);
      return;
    }

    setStatus(`Lokasi terkirim ${new Date(position.timestamp).toLocaleTimeString()}`);
  }

  function requestCurrentLocation() {
    if (!member || !navigator.geolocation) {
      setStatus("Lokasi tidak tersedia di browser ini.");
      return;
    }

    setStatus("Meminta posisi perangkat...");
    navigator.geolocation.getCurrentPosition(
      position => saveLocation(member, position),
      error => setStatus(`Gagal mendapatkan lokasi: ${error.message}`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }

  useEffect(() => {
    let alive = true;
    let pollLocation = null;

    async function init() {
      if (!supabase) {
        setStatus("Supabase config belum valid.");
        return;
      }

      const { data, error } = await supabase
        .from("family_members")
        .select("*")
        .eq("tracking_token", token)
        .single();

      if (!alive) return;

      if (error || !data) {
        setStatus("Invalid tracking link.");
        return;
      }

      setMember(data);

      if (!navigator.geolocation) {
        setStatus("Geolocation is not supported by this browser.");
        return;
      }

      setStatus("Requesting location permission...");

      pollLocation = () => {
        navigator.geolocation.getCurrentPosition(
          position => saveLocation(data, position),
          error => setStatus(`Gagal mendapatkan lokasi: ${error.message}`),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
        );
      };

      watchId.current = navigator.geolocation.watchPosition(
        position => saveLocation(data, position),
        error => setStatus(`Gagal memantau lokasi: ${error.message}`),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
      );
      pollLocation();
      pollId.current = window.setInterval(pollLocation, 60_000);
      document.addEventListener("visibilitychange", pollLocation);
    }

    init();

    return () => {
      alive = false;
      if (pollId.current != null) window.clearInterval(pollId.current);
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      if (pollLocation) document.removeEventListener("visibilitychange", pollLocation);
    };
  }, [token]);

  return (
    <div className="tracker-page">
      <div className="tracker-card">
        <h1>Family Tracker</h1>
        {member ? <h2>{member.name}</h2> : null}
        <button type="button" onClick={requestCurrentLocation}>Kirim lokasi sekarang</button>
        <div className="status">
          <span className="dot" />
          {status}
        </div>

        {coords && (
          <div className="location-data">
            <div><span>Latitude</span><b>{coords.latitude.toFixed(6)}</b></div>
            <div><span>Longitude</span><b>{coords.longitude.toFixed(6)}</b></div>
            <div><span>Accuracy</span><b>±{Math.round(coords.accuracy)} m</b></div>
          </div>
        )}

        <p className="muted">
          Keep this page open while using the web-only MVP. A browser cannot
          guarantee location updates after the page is closed or the OS suspends it.
        </p>
      </div>
    </div>
  );
}

function App() {
  if (!hasSupabaseConfig) {
    return <ConfigError />;
  }

  const path = window.location.pathname;
  if (path.startsWith("/track/")) {
    return <Tracker token={path.split("/")[2]} />;
  }
  return <Dashboard />;
}

createRoot(document.getElementById("root")).render(<App />);
