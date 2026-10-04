import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./style.css";
import { createLocationProvider, getProviderStatus, LocationProviderError } from "./location/providers.js";
import { persistLocationResult } from "./location/persistence.js";
import { isInJakartaDateTimeRange, jakartaDateInputValue, jakartaMidnightUtc, nextDateInputValue } from "./location/history-time.js";
import { buildRouteSegments } from "./location/map-route.js";
import { groupHistoryRecords, isWithinRelativeWindow } from "./location/history-groups.js";

const locationProviderName = import.meta.env.VITE_LOCATION_PROVIDER || "unavailable";
const onlineThresholdMinutes = Math.max(1, Number(import.meta.env.VITE_LOCATION_ONLINE_MINUTES) || 2);
const offlineThresholdMinutes = Math.max(onlineThresholdMinutes + 1, Number(import.meta.env.VITE_LOCATION_OFFLINE_MINUTES) || 10);
const onlineThresholdMs = onlineThresholdMinutes * 60_000;
const offlineThresholdMs = offlineThresholdMinutes * 60_000;
const historyPageSize = 20;
const routeGapMinutes = Math.max(1, Number(import.meta.env.VITE_ROUTE_GAP_MINUTES) || 10);

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

function hasValidCoordinates(row) {
  if (row?.latitude == null || row?.longitude == null || row.latitude === "" || row.longitude === "") return false;
  const latitude = Number(row?.latitude);
  const longitude = Number(row?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
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
  const [adminMessageDraft, setAdminMessageDraft] = useState("");
  const [sendingAdminMessage, setSendingAdminMessage] = useState(false);
  const [adminMessageNotice, setAdminMessageNotice] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [requestingLocation, setRequestingLocation] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const [historyFilter, setHistoryFilter] = useState("ALL");
  const [historyInterval, setHistoryInterval] = useState("1");
  const [historyRangeMode, setHistoryRangeMode] = useState("absolute");
  const [mapMode, setMapMode] = useState("route");
  const [historySheetState, setHistorySheetState] = useState("peek");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [selectedHistoryRecordId, setSelectedHistoryRecordId] = useState(null);
  const [selectedRawRecordId, setSelectedRawRecordId] = useState(null);
  const [historySelectionNotice, setHistorySelectionNotice] = useState("");
  const [historyPopupOpen, setHistoryPopupOpen] = useState(false);
  const [expandedHistoryGroups, setExpandedHistoryGroups] = useState(() => new Set());
  const [historyStartDate, setHistoryStartDate] = useState(() => jakartaDateInputValue());
  const [historyEndDate, setHistoryEndDate] = useState(() => jakartaDateInputValue());
  const [historyStartHour, setHistoryStartHour] = useState("ALL");
  const [historyEndHour, setHistoryEndHour] = useState("ALL");
  const [clockNow, setClockNow] = useState(Date.now());
  const historyFilterClock = historyRangeMode === "relative" ? clockNow : 0;
  const historyQueryFiltersRef = useRef(null);
  const selectedMemberIdRef = useRef(selected?.id);
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerRef = useRef(null);
  const focusedHistorySelectionRef = useRef(null);
  const historyRouteRef = useRef(null);
  const historyMarkersRef = useRef(null);
  const historyMarkerByIdRef = useRef(new Map());
  const historyCardRefs = useRef(new Map());
  const historyLayerRebuildRef = useRef(false);
  const historyPopupSelectionKeyRef = useRef(null);
  const sheetPointerStartRef = useRef(null);
  const suppressSheetClickRef = useRef(false);
  const historyRequestSequenceRef = useRef(0);
  historyQueryFiltersRef.current = { historyStartDate, historyEndDate, historyStartHour, historyEndHour, historyRangeMode, historyInterval };
  selectedMemberIdRef.current = selected?.id;

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
    if (memberId && memberId !== selectedMemberIdRef.current) return;
    const requestSequence = ++historyRequestSequenceRef.current;
    const { historyStartDate: startDate, historyEndDate: endDate, historyStartHour: startHour, historyEndHour: endHour, historyRangeMode: rangeMode, historyInterval: interval } = historyQueryFiltersRef.current;
    if (!supabase || !memberId) {
      setLocationHistory([]);
      setHistoryLoading(false);
      return;
    }

    setHistoryLoading(true);
    try {
      let query = supabase
        .from("locations")
        .select("id,member_id,latitude,longitude,accuracy,source,provider,platform,recorded_at")
        .eq("member_id", memberId)
        .order("recorded_at", { ascending: false });

      if (rangeMode === "relative") {
        const upperBound = new Date();
        const lowerBound = new Date(upperBound.getTime() - Number(interval) * 60_000);
        query = query.gte("recorded_at", lowerBound.toISOString()).lte("recorded_at", upperBound.toISOString());
      } else {
        const startBoundary = jakartaMidnightUtc(startDate);
        if (startBoundary) query = query.gte("recorded_at", startBoundary);
        const crossesMidnight = startHour !== "ALL" && endHour !== "ALL" && Number(startHour) > Number(endHour);
        let dayAfterEnd = nextDateInputValue(endDate);
        if (crossesMidnight && dayAfterEnd) dayAfterEnd = nextDateInputValue(dayAfterEnd);
        const endBoundary = dayAfterEnd && jakartaMidnightUtc(dayAfterEnd);
        if (endBoundary) query = query.lt("recorded_at", endBoundary);
      }

      const batchSize = 1000;
      const allRows = [];
      for (let offset = 0; ; offset += batchSize) {
        const { data, error } = await query.range(offset, offset + batchSize - 1);
        if (error) throw error;
        const batch = data || [];
        allRows.push(...batch);
        if (batch.length < batchSize) break;
      }
      if (requestSequence === historyRequestSequenceRef.current) {
        setLocationHistory([...new Map(allRows.map(row => [row.id, row])).values()]);
      }
    } catch (err) {
      if (requestSequence === historyRequestSequenceRef.current) console.error("Failed to load location history", err);
    } finally {
      if (requestSequence === historyRequestSequenceRef.current) setHistoryLoading(false);
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
      setProviderMessage(`${result.provider === "mock" ? "SIMULASI — bukan lokasi nyata. " : ""}Lokasi diterima ${new Date(recordedAt).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })}${result.accuracy ? ` · akurasi ±${Math.round(result.accuracy)} m` : ""}`);
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
    historyMarkersRef.current = L.layerGroup().addTo(mapInstance.current);
    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
      historyRouteRef.current = null;
      historyMarkersRef.current = null;
      historyMarkerByIdRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current) return;
    if (!selected || selected.latitude == null || selected.longitude == null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const latLng = [selected.latitude, selected.longitude];
    const contactAt = selected.last_source === "ANDROID" && selected.device_seen_at ? selected.device_seen_at : selected.last_seen;
    const ageMs = contactAt ? Math.max(0, clockNow - new Date(contactAt).getTime()) : Infinity;

    const popup = `<b>${selected.name}</b><br/>${locationSourceLabel(selected)}<br/>Accuracy: +/-${Math.round(selected.accuracy || 0)} m<br/>${ageMs >= offlineThresholdMs ? "Last known location - OFFLINE" : `Updated: ${selected.last_seen ? new Date(selected.last_seen).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" }) : "unknown"}`}`;
    if (markerRef.current) {
      markerRef.current.setLatLng(latLng).setPopupContent(popup);
    } else {
      markerRef.current = L.marker(latLng).addTo(mapInstance.current).bindPopup(popup, { autoPan: false });
    }
  }, [selected, clockNow]);

  useEffect(() => {
    if (!selected?.id || selected.latitude == null || selected.longitude == null || !mapInstance.current) return;
    mapInstance.current.setView([Number(selected.latitude), Number(selected.longitude)], 16);
    markerRef.current?.openPopup();
  }, [selected?.id]);

  useEffect(() => {
    const routeLayer = historyRouteRef.current;
    const markerLayer = historyMarkersRef.current;
    if (!routeLayer || !markerLayer) return;
    historyLayerRebuildRef.current = true;
    routeLayer.clearLayers();
    markerLayer.clearLayers();
    historyMarkerByIdRef.current.clear();

    const groupByRawId = new Map();
    for (const group of displayHistory) {
      for (const raw of group.rawRecords) groupByRawId.set(raw.id, group);
    }
    const { chronological, segments: routeSegments } = buildRouteSegments(displayHistory, routeGapMinutes);

    const endpointById = new Map();
    routeSegments.forEach((segment, segmentIndex) => {
      const first = segment[0];
      const last = segment[segment.length - 1];
      const segmentStart = segmentIndex === 0 ? "start" : "gap-start";
      const segmentEnd = segmentIndex === routeSegments.length - 1 ? "end" : "gap-end";
      endpointById.set(first.id, first.id === last.id ? `${segmentStart}-${segmentEnd}` : segmentStart);
      endpointById.set(last.id, first.id === last.id ? `${segmentStart}-${segmentEnd}` : segmentEnd);
      if (mapMode === "route" && segment.length >= 2) {
        L.polyline(segment.map(item => [Number(item.latitude), Number(item.longitude)]), {
          color: "#2563eb",
          weight: 4,
          opacity: 0.78,
          lineCap: "round",
          lineJoin: "round"
        }).addTo(routeLayer);
      }
    });

    const markerRecords = mapMode === "raw"
      ? scopedRawHistory.filter(item => hasValidCoordinates(item) && Number.isFinite(new Date(item.recorded_at).getTime()))
          .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
          .map(record => ({ record, group: groupByRawId.get(record.id) }))
      : chronological.map(record => ({ record, group: record }));
    const renderer = L.canvas({ padding: 0.5 });

    markerRecords.forEach(({ record, group }) => {
      if (!group) return;
      const isRawMode = mapMode === "raw";
      const isSelected = isRawMode
        ? record.id === selectedRawRecordId || (!selectedRawRecordId && group.groupId === selectedHistoryId && record.id === group.id)
        : group.groupId === selectedHistoryId;
      const endpoint = mapMode === "route" ? endpointById.get(record.id) : null;
      const markerColor = isSelected ? "#7c3aed"
        : endpoint?.includes("start") ? "#15803d"
        : endpoint?.includes("end") ? "#b91c1c"
        : endpoint ? "#d97706"
        : isRawMode ? "#6d28d9" : "#1d4ed8";
      const marker = L.circleMarker([Number(record.latitude), Number(record.longitude)], {
        renderer,
        radius: isSelected ? 9 : isRawMode ? 3 : endpoint ? 7 : mapMode === "points" ? 5 : 4,
        color: markerColor,
        weight: isSelected ? 3 : 2,
        fillColor: isSelected ? "#ddd6fe" : "#ffffff",
        fillOpacity: isRawMode ? 0.72 : 0.95
      }).addTo(markerLayer);
      // Keep the visible dot compact on a dense route, but give touch screens a
      // larger invisible hit area so individual points can still be selected.
      const touchTarget = mapInstance.current.getSize().x <= 768
        ? L.circleMarker([Number(record.latitude), Number(record.longitude)], {
            renderer,
            radius: 14,
            color: "#000000",
            opacity: 0,
            weight: 1,
            fill: true,
            fillColor: "#000000",
            fillOpacity: 0.001,
            interactive: true
          }).addTo(markerLayer)
        : marker;

      const popup = document.createElement("div");
      const time = document.createElement("strong");
      time.textContent = new Date(record.recorded_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      const coords = document.createElement("div");
      coords.textContent = `${Number(record.latitude).toFixed(6)}, ${Number(record.longitude).toFixed(6)}`;
      const source = document.createElement("div");
      source.textContent = locationSourceLabel(record);
      const accuracy = document.createElement("div");
      accuracy.textContent = Number.isFinite(Number(record.accuracy)) && Number(record.accuracy) > 0
        ? `Accuracy: +/-${Math.round(Number(record.accuracy))} m`
        : "Accuracy: unavailable";
      const groupCount = document.createElement("div");
      groupCount.textContent = `${group.rawRecords.length} raw record${group.rawRecords.length === 1 ? "" : "s"} in this interval`;
      popup.append(time, coords, source, accuracy, groupCount);
      if (mapMode === "route" && endpoint) {
        const routeEndpoint = document.createElement("div");
        routeEndpoint.textContent = endpoint === "start-end" ? "Route start and end"
          : endpoint === "start" ? "Route start"
          : endpoint === "end" ? "Route end"
          : endpoint?.includes("gap-start") ? "Route segment after a time gap"
          : endpoint?.includes("gap-end") ? "Route segment before a time gap"
          : "Route segment boundary";
        popup.append(routeEndpoint);
      }
      touchTarget.bindPopup(popup, { autoPan: false });
      const popupSelectionKey = `${group.groupId}|${record.id}`;
      touchTarget.on("popupclose", () => {
        if (historyLayerRebuildRef.current || historyPopupSelectionKeyRef.current !== popupSelectionKey) return;
        setHistoryPopupOpen(false);
      });
      touchTarget.on("click", () => {
        historyPopupSelectionKeyRef.current = popupSelectionKey;
        setSelectedHistoryId(group.groupId);
        setSelectedHistoryRecordId(isRawMode ? group.id : record.id);
        setSelectedRawRecordId(isRawMode ? record.id : null);
        setHistorySheetState(state => state === "expanded" ? "expanded" : "peek");
        setHistorySelectionNotice("");
        setHistoryPopupOpen(true);
        if (isRawMode && group.rawRecords.length > 1) {
          setExpandedHistoryGroups(previous => new Set(previous).add(group.groupId));
        }
        const displayIndex = displayHistory.findIndex(item => item.groupId === group.groupId);
        if (displayIndex >= 0) setHistoryPage(Math.floor(displayIndex / historyPageSize) + 1);
      });
      historyMarkerByIdRef.current.set(record.id, touchTarget);
    });
    historyLayerRebuildRef.current = false;
  }, [locationHistory, historyFilter, historyInterval, historyRangeMode, selectedHistoryId, selectedRawRecordId, mapMode, historyStartDate, historyEndDate, historyStartHour, historyEndHour, historyFilterClock]);

  useEffect(() => {
    if (!selectedHistoryId) {
      focusedHistorySelectionRef.current = null;
      return;
    }
    const selectedRecord = displayHistory.find(item => item.groupId === selectedHistoryId);
    const markerId = mapMode === "raw" && selectedRawRecordId ? selectedRawRecordId : selectedHistoryRecordId;
    const marker = historyMarkerByIdRef.current.get(markerId);
    if (!marker || !selectedRecord || !mapInstance.current) return;
    const selectionKey = `${selectedHistoryId}|${mapMode === "raw" ? selectedRawRecordId || "group" : "group"}`;
    if (focusedHistorySelectionRef.current !== selectionKey) {
      const target = marker.getLatLng();
      mapInstance.current.flyTo([target.lat, target.lng], Math.min(17, Math.max(16, mapInstance.current.getZoom())), { duration: 0.5 });
      focusedHistorySelectionRef.current = selectionKey;
    }
    if (historyPopupOpen) {
      historyPopupSelectionKeyRef.current = `${selectedHistoryId}|${markerId}`;
      marker.openPopup();
    }
  }, [selectedHistoryId, selectedHistoryRecordId, selectedRawRecordId, mapMode, historyPopupOpen, locationHistory, historyFilter, historyInterval, historyRangeMode, historyStartDate, historyEndDate, historyStartHour, historyEndHour, historyFilterClock]);

  useEffect(() => {
    if (selectedHistoryId) historyCardRefs.current.get(selectedHistoryId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedHistoryId, historyPage]);

  useEffect(() => {
    if (!selected?.id) {
      historyRequestSequenceRef.current += 1;
      setLocationHistory([]);
      setHistoryLoading(false);
      return;
    }

    loadLocationHistory(selected.id);
  }, [selected?.id, historyRangeMode, historyInterval, historyStartDate, historyEndDate, historyStartHour, historyEndHour]);

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
    setSelectedHistoryId(null);
    setSelectedHistoryRecordId(null);
    setSelectedRawRecordId(null);
    setHistoryPopupOpen(false);
    historyPopupSelectionKeyRef.current = null;
    await loadMembers();
    setSelected(data);
  }

  async function deleteMember(id) {
    if (!supabase) return;
    if (!confirm("Delete this family member?")) return;
    await supabase.from("family_members").delete().eq("id", id);
    setSelectedHistoryId(null);
    setSelectedHistoryRecordId(null);
    setSelectedRawRecordId(null);
    setHistoryPopupOpen(false);
    historyPopupSelectionKeyRef.current = null;
    setSelected(null);
    loadMembers();
  }

  async function sendAdminMessage() {
    const message = adminMessageDraft.trim();
    if (!supabase || !selected || !message || sendingAdminMessage) return;
    setSendingAdminMessage(true);
    setAdminMessageNotice("");
    const { error } = await supabase.from("family_members").update({
      admin_message: message,
      admin_message_updated_at: new Date().toISOString()
    }).eq("id", selected.id);
    if (error) setAdminMessageNotice(`Gagal mengirim pesan: ${error.message}`);
    else {
      setAdminMessageDraft("");
      setAdminMessageNotice("Pesan tersimpan. Android menerimanya saat online dan perlindungan aktif, biasanya dalam beberapa detik.");
    }
    setSendingAdminMessage(false);
  }

  const trackingUrl = selected
    ? `${window.location.origin}/track/${selected.tracking_token}`
    : "";

  function focusLatestLocation() {
    if (selected?.latitude == null || selected?.longitude == null || !mapInstance.current) return;
    mapInstance.current.flyTo([Number(selected.latitude), Number(selected.longitude)], Math.max(15, mapInstance.current.getZoom()), { duration: 0.5 });
    markerRef.current?.openPopup();
  }

  function openMobileFilters() {
    setHistorySheetState("expanded");
    setMobileFiltersOpen(true);
  }

  function handleSheetPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    sheetPointerStartRef.current = { y: event.clientY, state: historySheetState, pointerId: event.pointerId, dragged: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleSheetPointerMove(event) {
    const start = sheetPointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientY - start.y) > 10) start.dragged = true;
  }

  function handleSheetPointerUp(event) {
    const start = sheetPointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const delta = start.y - event.clientY;
    if (start.dragged) suppressSheetClickRef.current = true;
    if (Math.abs(delta) > 45) {
      if (delta > 0) setHistorySheetState(start.state === "collapsed" ? "peek" : "expanded");
      else setHistorySheetState(start.state === "expanded" ? "peek" : "collapsed");
    }
    sheetPointerStartRef.current = null;
  }

  function toggleHistorySheet() {
    if (suppressSheetClickRef.current) {
      suppressSheetClickRef.current = false;
      return;
    }
    setHistorySheetState(state => state === "collapsed" ? "peek" : state === "peek" ? "expanded" : "collapsed");
  }

  const filteredHistory = locationHistory.filter(item => {
    if (historyFilter === "ALL") return true;
    const isAndroid = item.source === "ANDROID" || item.platform === "ANDROID" || item.provider === "android";
    return historyFilter === "ANDROID" ? isAndroid : !isAndroid;
  });
  const hourFilteredHistory = historyRangeMode === "relative" ? filteredHistory : filteredHistory.filter(item =>
    isInJakartaDateTimeRange(item.recorded_at, historyStartDate, historyEndDate, historyStartHour, historyEndHour)
  );
  const intervalMinutes = historyInterval === "ALL" ? null : Number(historyInterval);
  const todayDate = jakartaDateInputValue(new Date(clockNow));
  const relativeMinutes = historyRangeMode === "relative" ? intervalMinutes : null;
  const intervalMs = intervalMinutes == null || historyRangeMode === "relative" || intervalMinutes >= 30 ? null : intervalMinutes * 60_000;
  const scopedRawHistory = [...new Map(hourFilteredHistory
    .filter(item => {
      if (historyRangeMode === "relative") return isWithinRelativeWindow(item.recorded_at, clockNow, relativeMinutes);
      const timestamp = new Date(item.recorded_at).getTime();
      return Number.isFinite(timestamp);
    })
    .map(item => [item.id, item])).values()];
  const displayHistory = groupHistoryRecords(scopedRawHistory, intervalMs);
  const visibleRawIds = new Set(scopedRawHistory.map(item => item.id));
  const pageCount = Math.max(1, Math.ceil(displayHistory.length / historyPageSize));
  const currentHistoryPage = Math.min(historyPage, pageCount);
  const paginatedHistory = displayHistory.slice((currentHistoryPage - 1) * historyPageSize, currentHistoryPage * historyPageSize);
  const groupedHistory = paginatedHistory.reduce((acc, item) => {
    const dateKey = jakartaDateInputValue(new Date(item.recorded_at));
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(item);
    return acc;
  }, {});
  const activeFilterParts = [];
  if (historyRangeMode === "relative") activeFilterParts.push(`Terakhir ${relativeMinutes === 30 ? "30 menit" : `${relativeMinutes / 60} jam`}`);
  else if (historyStartDate || historyEndDate) activeFilterParts.push(`${historyStartDate || "…"} – ${historyEndDate || "…"}`);
  if (historyFilter !== "ALL") activeFilterParts.push(historyFilter === "ANDROID" ? "Android" : "Browser");
  if (historyRangeMode !== "relative" && historyInterval !== "1") activeFilterParts.push(historyInterval === "ALL" || Number(historyInterval) >= 30 ? "Semua titik" : `${historyInterval} menit per grup`);
  if (historyRangeMode !== "relative" && (historyStartHour !== "ALL" || historyEndHour !== "ALL")) activeFilterParts.push(`${historyStartHour === "ALL" ? "00" : String(historyStartHour).padStart(2, "0")}:00–${historyEndHour === "ALL" ? "24" : String(historyEndHour).padStart(2, "0")}:00`);
  const activeFilterSummary = activeFilterParts.length ? activeFilterParts.join(" · ") : "Semua tanggal dan jam";
  useEffect(() => {
    if (!selectedHistoryId) return;
    const selectedGroup = displayHistory.find(group => group.groupId === selectedHistoryId);
    if (!selectedGroup || (selectedRawRecordId && !visibleRawIds.has(selectedRawRecordId))) {
      setSelectedHistoryId(null);
      setSelectedHistoryRecordId(null);
      setSelectedRawRecordId(null);
      setHistoryPopupOpen(false);
      historyPopupSelectionKeyRef.current = null;
      setHistorySelectionNotice(selectedRawRecordId
        ? "Rekaman mentah yang dipilih sudah dihapus atau berada di luar filter waktu; tidak ada titik pengganti yang dipilih."
        : "Lokasi yang dipilih sudah dihapus atau berada di luar filter waktu; tidak ada titik pengganti yang dipilih.");
      return;
    }

    if (!selectedRawRecordId) {
      const selectedRecordStillVisible = selectedGroup.rawRecords.some(record => record.id === selectedHistoryRecordId);
      if (!selectedRecordStillVisible) {
        setSelectedHistoryId(null);
        setSelectedHistoryRecordId(null);
        setHistoryPopupOpen(false);
        historyPopupSelectionKeyRef.current = null;
        setHistorySelectionNotice("Rekaman yang dipilih sudah dihapus atau berada di luar filter waktu; tidak ada titik pengganti yang dipilih.");
      } else if (selectedGroup.id !== selectedHistoryRecordId) {
        setSelectedHistoryRecordId(selectedGroup.id);
        setHistorySelectionNotice("Titik perwakilan grup diperbarui mengikuti rekaman terbaru; pilihan grup tetap sama.");
      }
    } else if (selectedGroup.id !== selectedHistoryRecordId) {
      setSelectedHistoryRecordId(selectedGroup.id);
      setHistorySelectionNotice("Titik perwakilan grup diperbarui; rekaman mentah yang Anda pilih tetap dipertahankan.");
    }
  }, [selectedHistoryId, selectedHistoryRecordId, selectedRawRecordId, locationHistory, historyFilter, historyInterval, historyRangeMode, historyStartDate, historyEndDate, historyStartHour, historyEndHour, historyFilterClock]);
  useEffect(() => {
    if (historyPage > pageCount) setHistoryPage(pageCount);
  }, [historyPage, pageCount]);

  return (
    <div className="app">
      <header>
        <div>
          <h1>Family Tracker</h1>
          <p>Private family location dashboard</p>
        </div>
      </header>

      <main className="layout">
      <aside className={`sidebar history-sheet sheet-${historySheetState}`} aria-label="Location History">
          <button
            type="button"
            className="history-sheet-handle"
            aria-label={historySheetState === "collapsed" ? "Buka riwayat lokasi" : historySheetState === "peek" ? "Perbesar riwayat lokasi" : "Kecilkan riwayat lokasi"}
            aria-expanded={historySheetState !== "collapsed"}
            onClick={toggleHistorySheet}
            onPointerDown={handleSheetPointerDown}
            onPointerMove={handleSheetPointerMove}
            onPointerUp={handleSheetPointerUp}
            onPointerCancel={handleSheetPointerUp}
          >
            <span className="history-sheet-grip" />
            <span className="history-sheet-summary">Location History · {displayHistory.length} grup</span>
            {selectedHistoryId && <span className="history-sheet-selected">Rekaman terpilih: {new Date(displayHistory.find(item => item.groupId === selectedHistoryId)?.recorded_at || Date.now()).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })}</span>}
          </button>
          <div className="sidebar-content">
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
                onClick={() => { setHistoryPage(1); setSelectedHistoryId(null); setSelectedHistoryRecordId(null); setSelectedRawRecordId(null); setHistoryPopupOpen(false); historyPopupSelectionKeyRef.current = null; setHistorySelectionNotice(""); setSelected(m); setHistorySheetState("peek"); }}
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
            <section className="card member-detail-card">
              <h2>{selected.name}</h2>
              <p><b>Last location:</b><br/>
                {selected.latitude != null
                  ? `${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}`
                  : "No location yet"}
              </p>
              <p><b>Accuracy:</b> {selected.accuracy ? `±${Math.round(selected.accuracy)} m` : "-"}</p>
              <p><b>Last update:</b> {selected.last_seen ? new Date(selected.last_seen).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "-"}</p>
              {selected.last_seen && (() => {
                const contactAt = selected.last_source === "ANDROID" && selected.device_seen_at ? selected.device_seen_at : selected.last_seen;
                const ageMs = Math.max(0, clockNow - new Date(contactAt).getTime());
                const status = ageMs < onlineThresholdMs ? "ONLINE" : ageMs < offlineThresholdMs ? "STALE" : "OFFLINE";
                return <p><b>Device status:</b> {ageMs >= offlineThresholdMs ? "Last known location · " : ""}{status} · {Math.floor(ageMs / 60_000)} min ago</p>;
              })()}
              <p><b>Source:</b> {locationSourceLabel(selected)}</p>

              <div className="admin-message-compose">
                <h3>Kirim teks ke Android</h3>
                <textarea
                  value={adminMessageDraft}
                  onChange={event => setAdminMessageDraft(event.target.value)}
                  placeholder="Tulis pesan, emoji juga bisa 🙂"
                  maxLength={500}
                  rows={3}
                  aria-label="Pesan untuk perangkat Android"
                />
                <button type="button" className="secondary" onClick={sendAdminMessage} disabled={!adminMessageDraft.trim() || sendingAdminMessage}>
                  {sendingAdminMessage ? "Mengirim..." : "Kirim teks"}
                </button>
                {adminMessageNotice && <p className="muted" role="status">{adminMessageNotice}</p>}
              </div>

              <div className="device-diagnostics">
                <h3>Diagnostik Android</h3>
                {deviceDiagnosticsError ? <p className="muted">Gagal memuat diagnostik: {deviceDiagnosticsError}. Jalankan ulang supabase/android-location.sql di Supabase SQL Editor.</p> : !deviceDiagnostics ? <p className="muted">Belum ada laporan diagnostik. Pasang APK Android terbaru, deploy ulang android-location-ingest, lalu tunggu Android mengirim lokasi berikutnya.</p> : <>
                  <p className="muted">Laporan: {new Date(deviceDiagnostics.reported_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}{Date.now() - new Date(deviceDiagnostics.reported_at).getTime() > offlineThresholdMs ? " · data mungkin sudah lama" : ""}</p>
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
                {historySelectionNotice && <p className="history-selection-notice" role="status">{historySelectionNotice}</p>}
                <button type="button" className="mobile-filter-toggle" aria-expanded={mobileFiltersOpen} onClick={() => setMobileFiltersOpen(open => !open)}>
                  Filter
                </button>
                <p className="mobile-filter-summary">{activeFilterSummary}</p>
                <div className={`history-filter-controls ${mobileFiltersOpen ? "is-open" : ""}`}>
                <div className="history-date-filters">
                  <div>
                    <label htmlFor="history-start-date">Dari tanggal</label>
                    <input id="history-start-date" type="date" value={historyStartDate} max={historyEndDate || undefined} disabled={historyRangeMode === "relative"} onChange={event => { setHistoryPage(1); setHistoryRangeMode("absolute"); setHistoryStartDate(event.target.value); }} />
                  </div>
                  <div>
                    <label htmlFor="history-end-date">Sampai tanggal</label>
                    <input id="history-end-date" type="date" value={historyEndDate} min={historyStartDate || undefined} disabled={historyRangeMode === "relative"} onChange={event => { setHistoryPage(1); setHistoryRangeMode("absolute"); setHistoryEndDate(event.target.value); }} />
                  </div>
                </div>
                <button
                  type="button"
                  className="history-reset-button"
                  onClick={() => {
                    setHistoryStartDate(todayDate);
                    setHistoryEndDate(todayDate);
                    setHistoryRangeMode("absolute");
                    setHistorySelectionNotice("");
                    setHistoryFilter("ALL");
                    setHistoryInterval("1");
                    setHistoryStartHour("ALL");
                    setHistoryEndHour("ALL");
                    setHistoryPage(1);
                  }}
                  disabled={historyRangeMode === "absolute" && historyStartDate === todayDate && historyEndDate === todayDate && historyFilter === "ALL" && historyInterval === "1" && historyStartHour === "ALL" && historyEndHour === "ALL"}
                >
                  Reset filter
                </button>
                <label htmlFor="history-source-filter">Source</label>
                <select id="history-source-filter" value={historyFilter} onChange={event => { setHistoryPage(1); setHistoryFilter(event.target.value); }}>
                  <option value="ALL">All</option>
                  <option value="ANDROID">Android</option>
                  <option value="BROWSER">Browser</option>
                </select>
                <label htmlFor="history-interval-filter">Rentang waktu / interval tampilan</label>
                <select id="history-interval-filter" value={historyInterval} onChange={event => {
                  const value = event.target.value;
                  setHistoryPage(1);
                  setHistoryInterval(value);
                  setHistoryRangeMode(value !== "ALL" && Number(value) >= 30 ? "relative" : "absolute");
                }}>
                  <option value="ALL">Semua titik</option>
                  <option value="1">1 menit</option>
                  <option value="5">5 menit</option>
                  <option value="15">15 menit</option>
                  <option value="30">30 menit terakhir</option>
                  <option value="60">1 jam terakhir</option>
                  <option value="120">2 jam terakhir</option>
                  <option value="180">3 jam terakhir</option>
                  <option value="240">4 jam terakhir</option>
                  <option value="300">5 jam terakhir</option>
                </select>
                {historyRangeMode === "relative" ? <div className="history-filter-hint">
                  <p className="muted">Rentang bergerak: rekaman dari {relativeMinutes === 30 ? "30 menit" : `${relativeMinutes / 60} jam`} terakhir sampai sekarang. Filter tanggal dan jam dinonaktifkan selama mode ini.</p>
                  <button type="button" className="history-range-mode-button" onClick={() => setHistoryRangeMode("absolute")}>Gunakan tanggal dan jam</button>
                </div> : Number(historyInterval) >= 30 && <p className="muted history-filter-hint">Tanggal/jam absolut aktif; semua titik mentah pada rentang yang dipilih ditampilkan.</p>}
                <div className="history-hour-filters">
                  <div>
                    <label htmlFor="history-start-hour">Dari jam</label>
                    <select id="history-start-hour" value={historyStartHour} disabled={historyRangeMode === "relative"} onChange={event => { setHistoryPage(1); setHistoryRangeMode("absolute"); setHistoryStartHour(event.target.value); }}>
                      <option value="ALL">Semua jam</option>
                      {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={String(hour)}>{String(hour).padStart(2, "0")}:00</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="history-end-hour">Sampai jam</label>
                    <select id="history-end-hour" value={historyEndHour} disabled={historyRangeMode === "relative"} onChange={event => { setHistoryPage(1); setHistoryRangeMode("absolute"); setHistoryEndHour(event.target.value); }}>
                      <option value="ALL">Semua jam</option>
                      {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={String(hour)}>{String(hour).padStart(2, "0")}:00 (batas akhir)</option>)}
                    </select>
                  </div>
                </div>
                {historyRangeMode !== "relative" && (historyStartHour !== "ALL" || historyEndHour !== "ALL") && <p className="muted history-filter-hint">
                  Jam memakai waktu Asia/Jakarta. Batas mulai termasuk, batas akhir tidak termasuk (22:00–23:00 berarti hanya jam 22). Jika melewati tengah malam, misalnya 22:00–02:00, bagian setelah tengah malam dihitung pada hari berikutnya.
                </p>}
                <button type="button" className="history-apply-button" onClick={() => { setMobileFiltersOpen(false); setHistorySheetState("expanded"); }}>Terapkan filter</button>
                </div>
                {displayHistory.length > historyPageSize && <nav className="history-pagination" aria-label="Halaman riwayat lokasi">
                  <span>Menampilkan {(currentHistoryPage - 1) * historyPageSize + 1}-{Math.min(currentHistoryPage * historyPageSize, displayHistory.length)} dari {displayHistory.length} grup</span>
                  <div>
                    <button type="button" onClick={() => setHistoryPage(page => Math.max(1, page - 1))} disabled={currentHistoryPage <= 1}>Sebelumnya</button>
                    <span>Halaman {currentHistoryPage} dari {pageCount}</span>
                    <button type="button" onClick={() => setHistoryPage(page => Math.min(pageCount, page + 1))} disabled={currentHistoryPage >= pageCount}>Berikutnya</button>
                  </div>
                </nav>}
                {historyLoading && <p className="muted">Loading history...</p>}
                {!historyLoading && Object.keys(groupedHistory).length === 0 && (
                  <p className="muted">Belum ada riwayat lokasi.</p>
                )}

                {!historyLoading && Object.entries(groupedHistory).map(([dateKey, items]) => (
                  <div key={dateKey} className="history-day">
                    <div className="history-date">
                      {new Date(jakartaMidnightUtc(dateKey)).toLocaleDateString("id-ID", {
                        timeZone: "Asia/Jakarta",
                        day: "2-digit",
                        month: "short",
                        year: "numeric"
                      })}
                    </div>

                    <ul className="history-list">
                      {items.map(item => (
                          <li key={item.groupId} ref={node => node ? historyCardRefs.current.set(item.groupId, node) : historyCardRefs.current.delete(item.groupId)} className={`history-entry ${selectedHistoryId === item.groupId ? "selected" : ""}`}>
                          <button type="button" className="history-card-button" disabled={!hasValidCoordinates(item)} onClick={() => {
                            historyPopupSelectionKeyRef.current = `${item.groupId}|${item.id}`;
                            setSelectedHistoryId(item.groupId);
                            setSelectedHistoryRecordId(item.id);
                            setSelectedRawRecordId(null);
                            setHistorySelectionNotice("");
                            setHistoryPopupOpen(true);
                            setHistorySheetState(state => state === "expanded" ? "expanded" : "peek");
                            historyMarkerByIdRef.current.get(item.id)?.openPopup();
                            if (hasValidCoordinates(item) && mapInstance.current) mapInstance.current.flyTo([Number(item.latitude), Number(item.longitude)], Math.min(17, Math.max(16, mapInstance.current.getZoom())), { duration: 0.5 });
                          }}>
                            <span>{new Date(item.recorded_at).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                            <strong>{hasValidCoordinates(item) ? `${Number(item.latitude).toFixed(5)}, ${Number(item.longitude).toFixed(5)}` : "Koordinat tidak valid"}</strong>
                            <small>{locationSourceLabel(item)}{Number.isFinite(Number(item.accuracy)) && Number(item.accuracy) > 0 ? `; akurasi: ${Math.round(Number(item.accuracy))} m` : ""}</small>
                            <small>{item.rawRecords.length} rekaman dalam grup{item.rawRecords.length > 1 && " - titik terbaik ditampilkan"}</small>
                          </button>
                          {item.rawRecords.length > 1 && <>
                            <button type="button" className="history-expand-button" aria-expanded={expandedHistoryGroups.has(item.groupId)} onClick={() => setExpandedHistoryGroups(previous => {
                              const next = new Set(previous);
                              if (next.has(item.groupId)) next.delete(item.groupId); else next.add(item.groupId);
                              return next;
                            })}>{expandedHistoryGroups.has(item.groupId) ? "Sembunyikan titik mentah" : "Lihat titik mentah"}</button>
                            {expandedHistoryGroups.has(item.groupId) && <div className="history-raw-records">
                              {item.rawRecords.map(raw => <div key={raw.id} className="history-raw-record">
                                <strong>{new Date(raw.recorded_at).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</strong>
                                <span>{hasValidCoordinates(raw) ? `${Number(raw.latitude).toFixed(6)}, ${Number(raw.longitude).toFixed(6)}` : "Koordinat tidak valid"}</span>
                                <small>{locationSourceLabel(raw)}{Number.isFinite(Number(raw.accuracy)) && Number(raw.accuracy) > 0 ? `; akurasi: ${Math.round(Number(raw.accuracy))} m` : " - akurasi tidak tersedia"}</small>
                                <button type="button" className="history-raw-map-button" disabled={!hasValidCoordinates(raw)} onClick={() => {
                                  historyPopupSelectionKeyRef.current = `${item.groupId}|${raw.id}`;
                                  setMapMode("raw");
                                  setSelectedHistoryId(item.groupId);
                                  setSelectedHistoryRecordId(item.id);
                                  setSelectedRawRecordId(raw.id);
                                  setHistorySelectionNotice("");
                                  setHistoryPopupOpen(true);
                                  setHistorySheetState(state => state === "expanded" ? "expanded" : "peek");
                                  const displayIndex = displayHistory.findIndex(group => group.groupId === item.groupId);
                                  if (displayIndex >= 0) setHistoryPage(Math.floor(displayIndex / historyPageSize) + 1);
                                }}>Lihat rekaman ini di peta</button>
                              </div>)}
                            </div>}
                          </>}
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
          </div>
        </aside>

        <section className="map-wrap">
          <div className="map-action-controls leaflet-control" aria-label="Kontrol peta">
            <button type="button" onClick={focusLatestLocation} disabled={selected?.latitude == null || selected?.longitude == null} aria-label="Kembali ke lokasi terbaru">Lokasi</button>
            <button type="button" onClick={openMobileFilters}>Filter</button>
            <button type="button" onClick={() => setHistorySheetState(state => state === "collapsed" ? "peek" : "expanded")}>Riwayat</button>
          </div>
          <div className="map-mode-control leaflet-control">
            <label htmlFor="map-display-mode">Tampilan peta</label>
            <select id="map-display-mode" value={mapMode} onChange={event => setMapMode(event.target.value)}>
              <option value="route">Rute</option>
              <option value="points">Titik</option>
              <option value="raw">Inspeksi mentah</option>
            </select>
            <small>{mapMode === "route"
              ? `Garis menghubungkan titik terbaik; jeda di atas ${routeGapMinutes} menit memulai segmen baru.`
              : mapMode === "points"
                ? "Menampilkan titik terbaik tanpa garis rute."
                : "Menampilkan semua rekaman mentah sesuai filter, tanpa garis rute."}</small>
          </div>
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

    setStatus(`Lokasi terkirim ${new Date(position.timestamp).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })}`);
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
