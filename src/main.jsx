import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./style.css";

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
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerRef = useRef(null);

  async function loadMembers() {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("family_members")
        .select("*")
        .order("created_at", { ascending: true });

      if (!error) setMembers(data || []);
    } catch (err) {
      console.error("Failed to load family members", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!supabase) return;

    loadMembers();
    const channel = supabase
      .channel("locations")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "locations" },
        () => loadMembers()
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    mapInstance.current = L.map(mapRef.current).setView([-6.2, 106.816], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapInstance.current);
  }, []);

  useEffect(() => {
    if (!selected || !mapInstance.current) return;

    if (selected.latitude == null || selected.longitude == null) return;

    const latLng = [selected.latitude, selected.longitude];
    mapInstance.current.setView(latLng, 16);

    if (markerRef.current) markerRef.current.remove();

    markerRef.current = L.marker(latLng)
      .addTo(mapInstance.current)
      .bindPopup(`<b>${selected.name}</b><br/>Accuracy: ±${Math.round(selected.accuracy || 0)} m`)
      .openPopup();
  }, [selected]);

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
  const watchId = useRef(null);

  useEffect(() => {
    let alive = true;

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

      watchId.current = navigator.geolocation.watchPosition(
        async position => {
          const { latitude, longitude, accuracy } = position.coords;
          setCoords({ latitude, longitude, accuracy });
          setStatus("Location tracking active");

          await supabase.from("locations").insert({
            member_id: data.id,
            latitude,
            longitude,
            accuracy,
            recorded_at: new Date().toISOString()
          });

          await supabase
            .from("family_members")
            .update({
              latitude,
              longitude,
              accuracy,
              last_seen: new Date().toISOString()
            })
            .eq("id", data.id);
        },
        error => {
          setStatus(`Location error: ${error.message}`);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 20000
        }
      );
    }

    init();

    return () => {
      alive = false;
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [token]);

  return (
    <div className="tracker-page">
      <div className="tracker-card">
        <h1>Family Tracker</h1>
        {member ? <h2>{member.name}</h2> : null}
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
