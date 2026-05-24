import { useState, useMemo, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { db } from "./firebase";
import { doc, setDoc, getDoc, onSnapshot } from "firebase/firestore";

const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function getTodayStr() { return new Date().toISOString().split("T")[0]; }
function getWeekDates(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const diff = d.getDate() - d.getDay();
  return Array.from({ length: 7 }, (_, i) => { const nd = new Date(d); nd.setDate(diff + i); return nd.toISOString().split("T")[0]; });
}

const DEFAULT_VEHICLES = [
  "SON589","XGD950","TUL404","TFP410","SQY053","TUL416","XVJ448","SKP285",
  "SWQ606","NUU698","KSK012","TLP792","JYN900","SOD674","SKV787","YHK173"
].map(plate => ({ plate, available: true }));

const C = {
  bg: "#0f1117", surface: "#1a1d27", card: "#21253a",
  blue: "#1a56c4", yellowGreen: "#b5c832",
  green: "#4ade80", red: "#f87171", orange: "#fb923c",
  text: "#e8eaf6", muted: "#7c8099", border: "#2d3154",
};

const CanavenLogo = () => (
  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
    <svg width="44" height="28" viewBox="0 0 88 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="6" width="52" height="26" rx="13" fill="none" stroke={C.blue} strokeWidth="3"/>
      <rect x="54" y="14" width="24" height="18" rx="3" fill="none" stroke={C.blue} strokeWidth="3"/>
      <line x1="54" y1="23" x2="2" y2="23" stroke={C.blue} strokeWidth="1.5"/>
      <circle cx="18" cy="40" r="7" fill="none" stroke={C.blue} strokeWidth="3"/>
      <circle cx="18" cy="40" r="2.5" fill={C.blue}/>
      <circle cx="52" cy="40" r="7" fill="none" stroke={C.blue} strokeWidth="3"/>
      <circle cx="52" cy="40" r="2.5" fill={C.blue}/>
      <line x1="0" y1="48" x2="82" y2="48" stroke={C.yellowGreen} strokeWidth="2.5"/>
    </svg>
    <div style={{ display:"flex", flexDirection:"column", lineHeight:1 }}>
      <div style={{ fontFamily:"'Arial Black', Arial, sans-serif", fontWeight:900, fontSize:17, color:C.blue, letterSpacing:"0.04em" }}>CANAVEN</div>
      <div style={{ fontFamily:"Arial, sans-serif", fontSize:8, color:C.yellowGreen, letterSpacing:"0.05em", marginTop:3 }}>Transportes de Colombia SAS</div>
    </div>
  </div>
);

export default function App() {
  const [tab, setTab] = useState("schedule");
  const [vehicles, setVehicles] = useState(DEFAULT_VEHICLES);
  const [newPlate, setNewPlate] = useState("");
  const [schedules, setSchedules] = useState({});
  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [reportView, setReportView] = useState("weekly");
  const [selectedPlates, setSelectedPlates] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [authed, setAuthed] = useState(() => !!sessionStorage.getItem("canaven_role"));
  const [role, setRole] = useState(() => sessionStorage.getItem("canaven_role") || "");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  const PIN_ADMIN = "2025";    // Admin: puede editar todo
  const PIN_VIEWER = "1111";   // Visitante: solo lectura

  const isAdmin = role === "admin";

  const handleLogin = () => {
    if (pinInput === PIN_ADMIN) {
      sessionStorage.setItem("canaven_role", "admin");
      setRole("admin"); setAuthed(true); setPinError(false);
    } else if (pinInput === PIN_VIEWER) {
      sessionStorage.setItem("canaven_role", "viewer");
      setRole("viewer"); setAuthed(true); setPinError(false);
    } else {
      setPinError(true); setPinInput("");
    }
  };

  // ── Load from Firestore on mount ──
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "canaven", "data"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.vehicles) setVehicles(data.vehicles);
        if (data.schedules) setSchedules(data.schedules);
      }
      setLoaded(true);
    });
    return () => unsub();
  }, []);

  // ── Save to Firestore whenever data changes ──
  const saveToFirestore = async (newVehicles, newSchedules) => {
    setSyncing(true);
    try {
      await setDoc(doc(db, "canaven", "data"), {
        vehicles: newVehicles,
        schedules: newSchedules,
        updatedAt: new Date().toISOString()
      });
    } catch (e) { console.error(e); }
    setSyncing(false);
  };

  const updateVehicles = (newV) => { setVehicles(newV); saveToFirestore(newV, schedules); };
  const updateSchedules = (newS) => { setSchedules(newS); saveToFirestore(vehicles, newS); };

  const badge = (ok) => ({ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 9px", borderRadius:20, fontSize:10, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", background: ok ? C.green+"22" : C.red+"22", color: ok ? C.green : C.red, border:`1px solid ${ok ? C.green+"55" : C.red+"55"}` });

  // Fleet
  const addVehicle = () => {
    const p = newPlate.trim().toUpperCase();
    if (!p || vehicles.find(v => v.plate === p)) return;
    const newV = [...vehicles, { plate: p, available: true }];
    updateVehicles(newV);
    setNewPlate("");
  };
  const removeVehicle = (plate) => updateVehicles(vehicles.filter(v => v.plate !== plate));
  const toggleAvailability = (plate) => {
    updateVehicles(vehicles.map(v => v.plate === plate ? { ...v, available: !v.available } : v));
    setSelectedPlates(prev => prev.filter(p => p !== plate));
  };

  // Schedule
  const scheduleForDate = schedules[selectedDate] || [];
  const alreadyScheduled = scheduleForDate.map(v => v.plate);
  const notYetScheduled = vehicles.filter(v => v.available && !alreadyScheduled.includes(v.plate));

  const toggleSelectPlate = (plate) => setSelectedPlates(prev => prev.includes(plate) ? prev.filter(p => p !== plate) : [...prev, plate]);
  const selectAll = () => setSelectedPlates(notYetScheduled.map(v => v.plate));
  const clearSelection = () => setSelectedPlates([]);

  const addSelectedToSchedule = () => {
    if (!selectedPlates.length) return;
    const existing = schedules[selectedDate] || [];
    const toAdd = selectedPlates.filter(plate => !existing.find(e => e.plate === plate))
      .map(plate => ({ plate, loaded: false, loadedTime: null, observaciones: "" }));
    updateSchedules({ ...schedules, [selectedDate]: [...existing, ...toAdd] });
    setSelectedPlates([]);
  };

  const removeFromSchedule = (plate) => updateSchedules({ ...schedules, [selectedDate]: (schedules[selectedDate] || []).filter(v => v.plate !== plate) });

  const toggleLoaded = (plate) => {
    const day = [...(schedules[selectedDate] || [])];
    const idx = day.findIndex(v => v.plate === plate);
    if (idx === -1) return;
    day[idx] = { ...day[idx], loaded: !day[idx].loaded, loadedTime: !day[idx].loaded ? new Date().toLocaleTimeString("es-CO", { hour:"2-digit", minute:"2-digit" }) : null };
    updateSchedules({ ...schedules, [selectedDate]: day });
  };

  const updateObservaciones = (plate, value) => {
    const day = [...(schedules[selectedDate] || [])];
    const idx = day.findIndex(v => v.plate === plate);
    if (idx === -1) return;
    day[idx] = { ...day[idx], observaciones: value };
    updateSchedules({ ...schedules, [selectedDate]: day });
  };

  // WhatsApp
  const buildWhatsAppText = () => {
    const d = new Date(selectedDate + "T12:00:00");
    const dateLabel = `${DAYS_ES[d.getDay()]} ${d.getDate()} de ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
    const lines = [`🚛 *CANAVEN - Programación Vehicular*`, `📅 ${dateLabel}`, ``, `*Vehículos Programados:*`];
    scheduleForDate.forEach((v, i) => {
      const status = v.loaded ? `✅ Cargado${v.loadedTime ? " · " + v.loadedTime : ""}` : "⏳ Pendiente";
      const obs = v.observaciones ? ` · 📝 ${v.observaciones}` : "";
      lines.push(`${i + 1}. *${v.plate}* — ${status}${obs}`);
    });
    lines.push(``, `📋 Total: ${scheduleForDate.length} · ✅ Cargados: ${scheduleForDate.filter(v => v.loaded).length}`);
    return lines.join("\n");
  };
  const copyMessage = () => navigator.clipboard.writeText(buildWhatsAppText()).catch(() => {});
  const sendWhatsApp = () => window.open(`https://chat.whatsapp.com/LCkWONNBkq41X0mWV9feOF?text=${encodeURIComponent(buildWhatsAppText())}`, "_blank");

  // CSV Export
  const downloadCSV = (rangeType) => {
    const rows = [["Fecha","Dia","Placa","Estado","Hora Cargue","Observaciones"]];
    const allDates = Object.keys(schedules).sort();
    let filtered = allDates;

    if (rangeType === "week") {
      filtered = allDates.filter(d => weekDates.includes(d));
    } else if (rangeType === "month") {
      filtered = allDates.filter(d => {
        const dt = new Date(d + "T12:00:00");
        return dt.getMonth() === currentMonth && dt.getFullYear() === currentYear;
      });
    }

    filtered.forEach(date => {
      const d = new Date(date + "T12:00:00");
      const dayName = DAYS_ES[d.getDay()];
      (schedules[date] || []).forEach(v => {
        if (v.loaded) {
          rows.push([
            date,
            dayName,
            v.plate,
            v.loaded ? "Cargado" : "Pendiente",
            v.loadedTime || "",
            v.observaciones || ""
          ]);
        }
      });
    });

    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const label = rangeType === "week" ? "semana" : rangeType === "month" ? "mes" : "total";
    a.href = url;
    a.download = `canaven_viajes_${label}_${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Reports
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const weeklyData = useMemo(() => weekDates.map(date => {
    const ds = schedules[date] || [];
    const d = new Date(date + "T12:00:00");
    return { name: DAYS_ES[d.getDay()], programados: ds.length, cargados: ds.filter(v => v.loaded).length };
  }), [schedules, weekDates]);

  const currentMonth = new Date(selectedDate + "T12:00:00").getMonth();
  const currentYear = new Date(selectedDate + "T12:00:00").getFullYear();
  const monthlyData = useMemo(() => {
    const byDay = {};
    Object.entries(schedules).forEach(([date, ds]) => {
      const d = new Date(date + "T12:00:00");
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear)
        byDay[d.getDate()] = { name: `${d.getDate()}`, programados: ds.length, cargados: ds.filter(v => v.loaded).length };
    });
    return Object.values(byDay).sort((a, b) => parseInt(a.name) - parseInt(b.name));
  }, [schedules, currentMonth, currentYear]);

  const vehicleTotals = useMemo(() => {
    const totals = {};
    vehicles.forEach(v => { totals[v.plate] = { scheduled: 0, loaded: 0 }; });
    Object.values(schedules).forEach(ds => ds.forEach(v => {
      if (!totals[v.plate]) totals[v.plate] = { scheduled: 0, loaded: 0 };
      totals[v.plate].scheduled++;
      if (v.loaded) totals[v.plate].loaded++;

    }));
    return totals;
  }, [schedules, vehicles]);

  const reportData = reportView === "weekly" ? weeklyData : monthlyData;

  const TABS = [
    { id:"fleet", icon:"🚗", label:"Flota" },
    { id:"schedule", icon:"📅", label:"Programar" },
    { id:"reports", icon:"📊", label:"Informes" },
  ];

  if (!loaded) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
      <CanavenLogo />
      <div style={{ color:C.muted, fontSize:13, marginTop:8 }}>Cargando datos...</div>
      <div style={{ width:40, height:40, border:`3px solid ${C.border}`, borderTop:`3px solid ${C.blue}`, borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!authed) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px" }}>
      <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} } .shake{animation:shake 0.4s ease;}`}</style>
      <div style={{ width:"100%", maxWidth:320 }}>
        {/* Logo */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:32 }}>
          <CanavenLogo />
        </div>
        {/* Card */}
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:20, padding:"32px 24px", textAlign:"center" }}>
          <div style={{ fontSize:44, marginBottom:12 }}>🔒</div>
          <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:6 }}>Acceso Protegido</div>
          <div style={{ fontSize:13, color:C.muted, marginBottom:8 }}>Ingresa tu PIN para continuar</div>
          <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:24 }}>
            <span style={{ background:C.blue+"22", color:C.blue, border:`1px solid ${C.blue}44`, borderRadius:20, padding:"3px 10px", fontSize:11, fontWeight:700 }}>⚙️ Admin</span>
            <span style={{ background:C.green+"22", color:C.green, border:`1px solid ${C.green}44`, borderRadius:20, padding:"3px 10px", fontSize:11, fontWeight:700 }}>👁️ Visitante</span>
          </div>
          {/* PIN dots display */}
          <div style={{ display:"flex", justifyContent:"center", gap:12, marginBottom:24 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ width:14, height:14, borderRadius:"50%", background: pinInput.length > i ? C.blue : C.border, transition:"background 0.15s" }} />
            ))}
          </div>
          {/* Keypad */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:16 }}>
            {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k, i) => (
              <button key={i} onClick={() => {
                if (k === "⌫") { setPinInput(p => p.slice(0,-1)); setPinError(false); }
                else if (k === "") return;
                else if (pinInput.length < 4) setPinInput(p => p + k);
              }}
                style={{ background: k===""?"transparent":pinError?C.red+"22":C.surface, border:`1px solid ${k===""?"transparent":pinError?C.red+"55":C.border}`, borderRadius:12, padding:"16px 0", fontSize:20, fontWeight:700, color: k==="⌫"?C.muted:C.text, cursor:k===""?"default":"pointer", transition:"all 0.15s" }}
                disabled={k===""}>
                {k}
              </button>
            ))}
          </div>
          {pinError && <div style={{ color:C.red, fontSize:13, fontWeight:600, marginBottom:12 }}>PIN incorrecto. Intenta de nuevo.</div>}
          <button onClick={handleLogin} disabled={pinInput.length < 4}
            style={{ width:"100%", background:pinInput.length===4?C.blue:C.border, color:pinInput.length===4?"#fff":C.muted, border:"none", borderRadius:12, padding:"14px 0", fontSize:16, fontWeight:700, cursor:pinInput.length===4?"pointer":"not-allowed", transition:"all 0.2s" }}>
            Ingresar
          </button>
        </div>
        <div style={{ textAlign:"center", marginTop:20, fontSize:11, color:C.muted }}>
          CANAVEN Transportes de Colombia SAS
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'Segoe UI', Arial, sans-serif", paddingBottom:80 }}>
      <style>{`
        * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
        input[type=date]::-webkit-calendar-picker-indicator { filter:invert(1); }
        ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-thumb { background:#2d3154; border-radius:2px; }
        .tap:active { transform:scale(0.96); opacity:0.85; }
        input::placeholder { color:#7c8099; }
      `}</style>

      {/* HEADER */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"10px 14px", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <CanavenLogo />
          <div style={{ textAlign:"right" }}>
            <div style={{ display:"flex", gap:6, justifyContent:"flex-end", alignItems:"center", marginBottom:2 }}>
              <span style={{ fontSize:9, color: isAdmin ? C.blue : C.green, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em" }}>
                {isAdmin ? "⚙️ Admin" : "👁️ Visitante"}
              </span>
              <button onClick={()=>{ sessionStorage.removeItem("canaven_role"); setAuthed(false); setRole(""); setPinInput(""); }}
                style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:4, color:C.muted, fontSize:9, cursor:"pointer", padding:"1px 5px" }}>Salir</button>
            </div>
            <div style={{ fontSize:9, color: syncing ? C.orange : C.green, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:700 }}>
              {syncing ? "⏳ Guardando..." : "☁️ Sincronizado"}
            </div>
            <div style={{ fontSize:9, color:C.muted, marginTop:1 }}>
              {(() => { const d = new Date(selectedDate+"T12:00:00"); return `${DAYS_ES[d.getDay()]} ${d.getDate()} ${MONTHS_ES[d.getMonth()]}`; })()}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding:"14px", maxWidth:600, margin:"0 auto" }}>

        {/* ===== FLEET ===== */}
        {tab === "fleet" && (
          <div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, marginBottom:2 }}>Gestión de Flota</div>
              <div style={{ fontSize:12, color:C.muted }}>{vehicles.filter(v=>v.available).length} disponibles · {vehicles.filter(v=>!v.available).length} no disponibles</div>
            </div>
            {isAdmin && (
              <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                <input value={newPlate} onChange={e=>setNewPlate(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addVehicle()}
                  placeholder="Nueva placa Ej: ABC123"
                  style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"11px 14px", color:C.text, fontSize:14, outline:"none", textTransform:"uppercase" }} />
                <button onClick={addVehicle} className="tap"
                  style={{ background:C.blue, color:"#fff", border:"none", borderRadius:10, padding:"11px 22px", fontSize:18, fontWeight:700, cursor:"pointer" }}>+</button>
              </div>
            )}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {vehicles.map((v, idx) => {
                const tot = vehicleTotals[v.plate] || {};
                return (
                  <div key={v.plate} style={{ background:C.card, border:`1.5px solid ${v.available ? C.green+"44" : C.red+"33"}`, borderRadius:12, padding:"12px 14px", position:"relative" }}>
                    <div style={{ position:"absolute", top:0, left:0, width:"100%", height:3, borderRadius:"12px 12px 0 0", background: v.available ? `linear-gradient(90deg,${C.green},transparent)` : `linear-gradient(90deg,${C.red},transparent)` }} />
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:11, color:C.muted, fontWeight:700, minWidth:20 }}>{idx+1}</span>
                        <span style={{ fontSize:17, fontWeight:900, color:C.text, letterSpacing:"0.06em" }}>{v.plate}</span>
                      </div>
                      {isAdmin && <button onClick={()=>removeVehicle(v.plate)} style={{ background:"transparent", border:"none", color:C.muted, fontSize:18, cursor:"pointer", padding:"2px 6px" }}>✕</button>}
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      {isAdmin ? (
                        <button onClick={()=>toggleAvailability(v.plate)} className="tap"
                          style={{ ...badge(v.available), cursor:"pointer", padding:"5px 12px", fontSize:11 }}>
                          <span style={{ width:6, height:6, borderRadius:"50%", background: v.available ? C.green : C.red, display:"inline-block" }} />
                          {v.available ? "Disponible" : "No Disponible"}
                        </button>
                      ) : (
                        <span style={{ ...badge(v.available), padding:"5px 12px", fontSize:11 }}>
                          <span style={{ width:6, height:6, borderRadius:"50%", background: v.available ? C.green : C.red, display:"inline-block" }} />
                          {v.available ? "Disponible" : "No Disponible"}
                        </span>
                      )}
                      <div style={{ display:"flex", gap:12 }}>
                        {[["📋",tot.scheduled||0,C.blue],["✅",tot.loaded||0,C.green]].map(([icon,val,color])=>(
                          <div key={icon} style={{ textAlign:"center" }}>
                            <div style={{ fontSize:14, fontWeight:800, color }}>{val}</div>
                            <div style={{ fontSize:9, color:C.muted }}>{icon}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== SCHEDULE ===== */}
        {tab === "schedule" && (
          <div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:16, fontWeight:700, marginBottom:2 }}>Programación Diaria</div>
              <div style={{ fontSize:12, color:C.muted }}>Selecciona vehículos disponibles</div>
            </div>
            <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}
              style={{ width:"100%", background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"11px 14px", color:C.text, fontSize:14, outline:"none", marginBottom:12 }} />
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 14px", marginBottom:12, display:"flex" }}>
              {[["Programados",scheduleForDate.length,C.blue],["Cargados",scheduleForDate.filter(v=>v.loaded).length,C.green]].map(([label,val,color],i)=>(
                <div key={label} style={{ flex:1, textAlign:"center", borderRight:i<1?`1px solid ${C.border}`:"none" }}>
                  <div style={{ fontSize:20, fontWeight:800, color }}>{val}</div>
                  <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</div>
                </div>
              ))}
            </div>
            {scheduleForDate.length > 0 && (
              <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                <button onClick={copyMessage} className="tap"
                  style={{ flex:1, background:C.card, color:C.text, border:`1px solid ${C.border}`, borderRadius:10, padding:"11px 0", fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                  📋 Copiar
                </button>
                <button onClick={sendWhatsApp} className="tap"
                  style={{ flex:2, background:"#25D366", color:"#fff", border:"none", borderRadius:10, padding:"11px 0", fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.826L.057 23.854a.5.5 0 0 0 .612.612l6.029-1.466A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.807 9.807 0 0 1-5.002-1.366l-.358-.213-3.718.904.923-3.616-.234-.372A9.808 9.808 0 0 1 2.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/></svg>
                  Enviar al Grupo
                </button>
              </div>
            )}
            {!isAdmin && (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"14px", marginBottom:12, textAlign:"center" }}>
                <div style={{ fontSize:13, color:C.muted }}>👁️ Modo solo lectura — solo el administrador puede programar vehículos</div>
              </div>
            )}
            {isAdmin && <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, marginBottom:12, overflow:"hidden" }}>
              <div style={{ padding:"11px 14px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:13, fontWeight:700 }}>Disponibles <span style={{ color:C.muted, fontWeight:400 }}>({notYetScheduled.length})</span></div>
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={selectAll} className="tap" style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, padding:"4px 10px", color:C.muted, cursor:"pointer", fontSize:11, fontWeight:600 }}>Todo</button>
                  <button onClick={clearSelection} className="tap" style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, padding:"4px 10px", color:C.muted, cursor:"pointer", fontSize:11, fontWeight:600 }}>Limpiar</button>
                </div>
              </div>
              {vehicles.map((v, idx) => {
                const isScheduled = alreadyScheduled.includes(v.plate);
                const isSelected = selectedPlates.includes(v.plate);
                const disabled = !v.available || isScheduled;
                return (
                  <div key={v.plate} onClick={()=>!disabled&&toggleSelectPlate(v.plate)}
                    style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderBottom:`1px solid ${C.border}`, background:isSelected?C.blue+"22":isScheduled?C.green+"0a":"transparent", cursor:disabled?"not-allowed":"pointer", opacity:disabled&&!isScheduled?0.38:1 }}>
                    <span style={{ fontSize:11, color:C.muted, minWidth:20, textAlign:"right", fontWeight:700 }}>{idx+1}</span>
                    <div style={{ width:22, height:22, borderRadius:6, border:`2px solid ${isSelected?C.blue:isScheduled?C.green:C.border}`, background:isSelected?C.blue:isScheduled?C.green+"33":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:"#fff", fontWeight:900, flexShrink:0 }}>
                      {isSelected?"✓":isScheduled?"●":""}
                    </div>
                    <div style={{ fontWeight:800, fontSize:16, flex:1, letterSpacing:"0.05em" }}>{v.plate}</div>
                    {isScheduled?<span style={{...badge(true),fontSize:9}}>Prog.</span>:v.available?<span style={{...badge(true),fontSize:9}}>Disp.</span>:<span style={{...badge(false),fontSize:9}}>No Disp.</span>}
                  </div>
                );
              })}
              <div style={{ padding:"12px 14px", background:C.surface }}>
                <button onClick={addSelectedToSchedule} disabled={!selectedPlates.length} className="tap"
                  style={{ width:"100%", background:selectedPlates.length?C.blue:C.border, color:selectedPlates.length?"#fff":C.muted, border:"none", borderRadius:10, padding:"13px 0", fontSize:15, fontWeight:700, cursor:selectedPlates.length?"pointer":"not-allowed" }}>
                  {selectedPlates.length?`⚡ Programar ${selectedPlates.length} vehículo(s)`:"Selecciona vehículos"}
                </button>
              </div>
            </div>}
            {scheduleForDate.length > 0 && (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, overflow:"hidden" }}>
                <div style={{ padding:"11px 14px", borderBottom:`1px solid ${C.border}`, fontSize:13, fontWeight:700 }}>
                  Programados hoy · {scheduleForDate.filter(v=>v.loaded).length}/{scheduleForDate.length} cargados
                </div>
                {scheduleForDate.map((v, idx) => (
                  <div key={v.plate} style={{ padding:"13px 14px", borderBottom:`1px solid ${C.border}`, background:v.loaded?C.green+"0d":"transparent" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:9 }}>
                      <span style={{ fontSize:11, color:C.muted, fontWeight:700, minWidth:20 }}>{idx+1}</span>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:v.loaded?C.green:C.orange, boxShadow:v.loaded?`0 0 7px ${C.green}`:`0 0 7px ${C.orange}`, flexShrink:0 }} />
                      <div style={{ fontWeight:900, fontSize:17, flex:1, letterSpacing:"0.05em" }}>{v.plate}</div>
                      {isAdmin && <button onClick={()=>removeFromSchedule(v.plate)} className="tap"
                        style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:6, color:C.muted, cursor:"pointer", fontSize:11, padding:"3px 8px", fontWeight:600 }}>Quitar</button>}
                    </div>
                    <div style={{ marginBottom:8 }}>
                      {isAdmin ? (
                        <input value={v.observaciones||""} onChange={e=>updateObservaciones(v.plate,e.target.value)}
                          placeholder="Observaciones..."
                          style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 12px", color:C.text, fontSize:13, outline:"none" }} />
                      ) : v.observaciones ? (
                        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 12px", color:C.muted, fontSize:13 }}>📝 {v.observaciones}</div>
                      ) : null}
                    </div>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      {isAdmin ? (
                        <button onClick={()=>toggleLoaded(v.plate)} className="tap"
                          style={{ flex:1, background:v.loaded?C.green+"33":C.blue, color:v.loaded?C.green:"#fff", border:v.loaded?`1px solid ${C.green}`:"none", borderRadius:10, padding:"9px 10px", cursor:"pointer", fontWeight:700, fontSize:13 }}>
                          {v.loaded?`✓ Cargado · ${v.loadedTime||""}`:"Confirmar Carga"}
                        </button>
                      ) : (
                        <div style={{ flex:1, background:v.loaded?C.green+"22":"transparent", color:v.loaded?C.green:C.muted, border:`1px solid ${v.loaded?C.green:C.border}`, borderRadius:10, padding:"9px 10px", fontWeight:700, fontSize:13, textAlign:"center" }}>
                          {v.loaded?`✓ Cargado · ${v.loadedTime||""}`:"⏳ Pendiente"}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== REPORTS ===== */}
        {tab === "reports" && (
          <div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, marginBottom:2 }}>Informes</div>
              <div style={{ fontSize:12, color:C.muted }}>Programación, cargas y viajes</div>
            </div>
            <div style={{ display:"flex", gap:8, marginBottom:14 }}>
              <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}
                style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 12px", color:C.text, fontSize:13, outline:"none" }} />
              {["weekly","monthly"].map(v=>(
                <button key={v} onClick={()=>setReportView(v)} className="tap"
                  style={{ background:reportView===v?C.blue:C.card, color:reportView===v?"#fff":C.muted, border:`1px solid ${reportView===v?C.blue:C.border}`, borderRadius:10, padding:"10px 14px", cursor:"pointer", fontSize:12, fontWeight:700 }}>
                  {v==="weekly"?"Semana":"Mes"}
                </button>
              ))}
            </div>

            {/* CSV Download */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
              <div style={{ fontSize:11, color:C.muted, marginBottom:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>⬇️ Descargar CSV de Viajes</div>
              <div style={{ display:"flex", gap:8 }}>
                {[["Semana","week"],["Mes","month"],["Todo","all"]].map(([label, type])=>(
                  <button key={type} onClick={()=>downloadCSV(type)} className="tap"
                    style={{ flex:1, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 4px", color:C.yellowGreen, cursor:"pointer", fontSize:12, fontWeight:700, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                    <span style={{ fontSize:16 }}>📥</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
              {[
                ["Programados",reportData.reduce((s,d)=>s+d.programados,0),"📋",C.blue],
                ["Cargados",reportData.reduce((s,d)=>s+d.cargados,0),"✅",C.green],
                ["Cumplimiento",reportData.reduce((s,d)=>s+d.programados,0)>0?Math.round(reportData.reduce((s,d)=>s+d.cargados,0)/reportData.reduce((s,d)=>s+d.programados,0)*100)+"%":"—","📈","#c084fc"],
              ].map(([label,val,icon,color])=>(
                <div key={label} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"14px", position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", bottom:4, right:8, fontSize:32, opacity:0.07 }}>{icon}</div>
                  <div style={{ fontSize:24, fontWeight:900, color }}>{val}</div>
                  <div style={{ fontSize:10, color:C.muted, marginTop:2, textTransform:"uppercase", letterSpacing:"0.07em" }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 8px", marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:13, marginBottom:12, paddingLeft:8 }}>
                {reportView==="weekly"?`Semana del ${weekDates[0]}`:`${MONTHS_ES[currentMonth]} ${currentYear}`}
              </div>
              {reportData.length===0?(
                <div style={{ textAlign:"center", padding:"28px", color:C.muted, fontSize:13 }}>Sin datos para este período</div>
              ):(
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={reportData} margin={{ top:0, right:4, left:-16, bottom:0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="name" tick={{ fill:C.muted, fontSize:11 }} axisLine={{ stroke:C.border }} tickLine={false} />
                    <YAxis tick={{ fill:C.muted, fontSize:10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, fontSize:12, color:C.text }} />
                    <Legend wrapperStyle={{ fontSize:11, color:C.muted }} />
                    <Bar dataKey="programados" name="Prog." fill={C.blue} radius={[4,4,0,0]} />
                    <Bar dataKey="cargados" name="Carg." fill={C.green} radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, overflow:"hidden" }}>
              <div style={{ padding:"11px 14px", borderBottom:`1px solid ${C.border}`, fontSize:13, fontWeight:700 }}>Por Vehículo</div>
              {vehicles.map((v,i)=>{
                const t=vehicleTotals[v.plate]||{};
                const eff=t.scheduled?Math.round((t.loaded/t.scheduled)*100):0;
                return (
                  <div key={v.plate} style={{ padding:"11px 14px", borderBottom:`1px solid ${C.border}`, background:i%2===0?"transparent":C.surface+"44" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                        <span style={{ fontSize:10, color:C.muted, fontWeight:700 }}>{i+1}</span>
                        <span style={{ fontWeight:900, fontSize:15, color:C.yellowGreen, letterSpacing:"0.05em" }}>{v.plate}</span>
                      </div>
                      <span style={{...badge(v.available),fontSize:9}}>{v.available?"Disp.":"No Disp."}</span>
                    </div>
                    <div style={{ display:"flex", gap:12, marginBottom:7 }}>
                      {[["Prog",t.scheduled||0,C.blue],["Carg",t.loaded||0,C.green]].map(([lbl,val,color])=>(
                        <div key={lbl} style={{ textAlign:"center" }}>
                          <div style={{ fontSize:14, fontWeight:800, color }}>{val}</div>
                          <div style={{ fontSize:9, color:C.muted }}>{lbl}</div>
                        </div>
                      ))}
                      <div style={{ flex:1 }} />
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:14, fontWeight:800, color:eff>=80?C.green:eff>=50?C.yellowGreen:C.muted }}>{eff}%</div>
                        <div style={{ fontSize:9, color:C.muted }}>Efic.</div>
                      </div>
                    </div>
                    <div style={{ height:4, background:C.surface, borderRadius:3, overflow:"hidden" }}>
                      <div style={{ width:`${eff}%`, height:"100%", background:eff>=80?C.green:eff>=50?C.yellowGreen:C.red, borderRadius:3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, background:C.surface, borderTop:`1px solid ${C.border}`, display:"flex", zIndex:200 }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} className="tap"
            style={{ flex:1, background:"transparent", border:"none", padding:"10px 4px 12px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
            <div style={{ fontSize:22 }}>{t.icon}</div>
            <div style={{ fontSize:10, fontWeight:700, color:tab===t.id?C.blue:C.muted, letterSpacing:"0.05em", textTransform:"uppercase" }}>{t.label}</div>
            {tab===t.id&&<div style={{ width:24, height:3, borderRadius:2, background:C.blue, marginTop:1 }} />}
          </button>
        ))}
      </div>
    </div>
  );
}
