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
  const [vehicles, setVehicles] = useState(DEFAULT_VEHICLES.map(v => ({...v, destination:"Monterrey"})));
  const [destinations, setDestinations] = useState(["Monterrey"]);
  const [selectedDestination, setSelectedDestination] = useState("Monterrey");
  const [newDestination, setNewDestination] = useState("");
  const [newPlate, setNewPlate] = useState("");
  const [schedules, setSchedules] = useState({});
  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [selectedPlates, setSelectedPlates] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [replaceInput, setReplaceInput] = useState({}); // { plate: inputValue }
  const [ownerInputs, setOwnerInputs] = useState({}); // { "destino::placa": propietario }
  const [pdfFrom, setPdfFrom] = useState(getTodayStr());
  const [pdfTo, setPdfTo] = useState(getTodayStr());
  const [pdfObs, setPdfObs] = useState("");
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [loadModal, setLoadModal] = useState({ open:false, plate:"", numero:"", volumenGOV:"", ocrLoading:false, ocrError:"", ocrText:"" });
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
        const loadedDestinations = Array.isArray(data.destinations) && data.destinations.length ? data.destinations : ["Monterrey"];
        const normalizedVehicles = (data.vehicles || DEFAULT_VEHICLES).map(v => ({ ...v, destination: v.destination || "Monterrey" }));
        const normalizedSchedules = {};
        Object.entries(data.schedules || {}).forEach(([date, arr]) => {
          normalizedSchedules[date] = (arr || []).map(v => ({ ...v, destination: v.destination || "Monterrey" }));
        });
        setDestinations(loadedDestinations);
        setVehicles(normalizedVehicles);
        setSchedules(normalizedSchedules);
        if (!loadedDestinations.includes(selectedDestination)) setSelectedDestination(loadedDestinations[0]);
      }
      setLoaded(true);
    });
    return () => unsub();
  }, []);

  // ── Save to Firestore whenever data changes ──
  const saveToFirestore = async (newVehicles, newSchedules, newDestinations = destinations) => {
    setSyncing(true);
    try {
      await setDoc(doc(db, "canaven", "data"), {
        vehicles: newVehicles,
        schedules: newSchedules,
        destinations: newDestinations,
        updatedAt: new Date().toISOString()
      });
    } catch (e) { console.error(e); }
    setSyncing(false);
  };

  const updateVehicles = (newV) => { setVehicles(newV); saveToFirestore(newV, schedules, destinations); };
  const updateSchedules = (newS) => { setSchedules(newS); saveToFirestore(vehicles, newS, destinations); };
  const updateDestinations = (newD) => { setDestinations(newD); saveToFirestore(vehicles, schedules, newD); };

  const addDestination = () => {
    const name = newDestination.trim();
    if (!name) return;
    const exists = destinations.some(d => d.toLowerCase() === name.toLowerCase());
    if (exists) return;
    const next = [...destinations, name];
    updateDestinations(next);
    setSelectedDestination(name);
    setNewDestination("");
  };

  const badge = (ok) => ({ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 9px", borderRadius:20, fontSize:10, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", background: ok ? C.green+"22" : C.red+"22", color: ok ? C.green : C.red, border:`1px solid ${ok ? C.green+"55" : C.red+"55"}` });

  // Fleet
  const addVehicle = () => {
    const p = newPlate.trim().toUpperCase();
    if (!p || vehicles.find(v => v.plate === p && (v.destination || "Monterrey") === selectedDestination)) return;
    const newV = [...vehicles, { plate: p, available: true, destination: selectedDestination }];
    updateVehicles(newV);
    setNewPlate("");
  };
  const removeVehicle = (plate) => updateVehicles(vehicles.filter(v => !(v.plate === plate && (v.destination || "Monterrey") === selectedDestination)));
  const ownerKey = (plate) => `${selectedDestination}::${plate}`;
  const saveOwner = (plate) => {
    const key = ownerKey(plate);
    const value = (ownerInputs[key] ?? destinationVehicles.find(v => v.plate === plate)?.owner ?? "").trim();
    const nv = vehicles.map(v => (v.plate === plate && (v.destination || "Monterrey") === selectedDestination) ? { ...v, owner: value } : v);
    updateVehicles(nv);
    setOwnerInputs(prev => ({ ...prev, [key]: value }));
  };
  const toggleAvailability = (plate) => {
    updateVehicles(vehicles.map(v => v.plate === plate && (v.destination || "Monterrey") === selectedDestination ? { ...v, available: !v.available } : v));
    setSelectedPlates(prev => prev.filter(p => p !== plate));
  };

  const applyReplacement = (originalPlate) => {
    const newPlate = (replaceInput[originalPlate] || "").trim().toUpperCase();
    if (!newPlate || newPlate === originalPlate) return;
    // Insert replacement in same position, disable original
    setVehicles(prev => {
      const updated = prev.map(v => {
        if (v.plate === originalPlate && (v.destination || "Monterrey") === selectedDestination) return { ...v, available: false, replacedBy: newPlate };
        return v;
      });
      // Insert new vehicle right after original if not already in list
      if (!updated.find(v => v.plate === newPlate && (v.destination || "Monterrey") === selectedDestination)) {
        const idx = updated.findIndex(v => v.plate === originalPlate && (v.destination || "Monterrey") === selectedDestination);
        updated.splice(idx + 1, 0, { plate: newPlate, available: true, destination: selectedDestination });
      }
      updateVehicles(updated);
      return updated;
    });
    setReplaceInput(prev => ({ ...prev, [originalPlate]: "" }));
  };

  const clearReplacement = (originalPlate) => {
    setVehicles(prev => {
      const v = prev.find(p => p.plate === originalPlate && (p.destination || "Monterrey") === selectedDestination);
      if (!v || !v.replacedBy) return prev;
      const updated = prev
        .filter(p => !(p.plate === v.replacedBy && (p.destination || "Monterrey") === selectedDestination))
        .map(p => p.plate === originalPlate && (p.destination || "Monterrey") === selectedDestination ? { ...p, available: true, replacedBy: null } : p);
      updateVehicles(updated);
      return updated;
    });
  };

  // Schedule by destination
  const destinationVehicles = vehicles.filter(v => (v.destination || "Monterrey") === selectedDestination);
  const scheduleForDate = (schedules[selectedDate] || []).filter(v => (v.destination || "Monterrey") === selectedDestination);
  const alreadyScheduled = scheduleForDate.map(v => v.plate);
  const notYetScheduled = destinationVehicles.filter(v => v.available && !alreadyScheduled.includes(v.plate));

  const toggleSelectPlate = (plate) => setSelectedPlates(prev => prev.includes(plate) ? prev.filter(p => p !== plate) : [...prev, plate]);
  const selectAll = () => setSelectedPlates(notYetScheduled.map(v => v.plate));
  const clearSelection = () => setSelectedPlates([]);

  const addSelectedToSchedule = () => {
    if (!selectedPlates.length) return;
    const existing = schedules[selectedDate] || [];
    const toAdd = selectedPlates.filter(plate => !existing.find(e => e.plate === plate))
      .map(plate => ({ plate, destination: selectedDestination, loaded: false, loadedTime: null, observaciones: "" }));
    updateSchedules({ ...schedules, [selectedDate]: [...existing, ...toAdd] });
    setSelectedPlates([]);
  };

  const removeFromSchedule = (plate) => updateSchedules({ ...schedules, [selectedDate]: (schedules[selectedDate] || []).filter(v => !(v.plate === plate && (v.destination || "Monterrey") === selectedDestination)) });

  const toggleLoaded = (plate) => {
    const day = [...(schedules[selectedDate] || [])];
    const idx = day.findIndex(v => v.plate === plate && (v.destination || "Monterrey") === selectedDestination);
    if (idx === -1) return;

    // Si ya está cargado, conserva el comportamiento anterior: permite desmarcarlo.
    if (day[idx].loaded) {
      day[idx] = { ...day[idx], loaded:false, loadedTime:null };
      updateSchedules({ ...schedules, [selectedDate]: day });
      return;
    }

    // Antes de confirmar una carga solicitamos N° y Volumen GOV.
    const current = day[idx];
    setLoadModal({
      open:true,
      plate,
      numero: current.numeroCargue || "",
      volumenGOV: current.volumenGOV != null ? String(current.volumenGOV) : "",
      ocrLoading:false,
      ocrError:"",
      ocrText:""
    });
  };

  const closeLoadModal = () => {
    setLoadModal({ open:false, plate:"", numero:"", volumenGOV:"", ocrLoading:false, ocrError:"", ocrText:"" });
  };

  const loadTesseract = () => new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const existing = document.querySelector('script[data-canaven-tesseract="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Tesseract), { once:true });
      existing.addEventListener("error", () => reject(new Error("No se pudo cargar el lector OCR.")), { once:true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.async = true;
    script.dataset.canavenTesseract = "1";
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error("No se pudo cargar el lector OCR. Verifica la conexión a internet."));
    document.head.appendChild(script);
  });

  const extractLoadDataFromOCR = (rawText) => {
    const text = (rawText || "").replace(/\r/g, "\n");
    const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // N° / No / Numero / Número
    let numero = "";
    const numeroMatch =
      normalized.match(/(?:N\s*[°ºo]?|NO\.?|NUMERO|NRO\.?)[\s:#-]*([A-Z0-9][A-Z0-9./_-]{2,})/i);
    if (numeroMatch) numero = numeroMatch[1].trim();

    // Volumen GOV / GOV / Barriles. Acepta coma o punto decimal.
    let volumen = "";
    const volumenMatch =
      normalized.match(/(?:VOLUMEN(?:\s+EN)?\s+(?:BARRILES\s+)?GOV|VOLUMEN\s+GOV|GOV|BARRILES)[\s:#-]*([0-9]{1,3}(?:[.,][0-9]{1,3})?(?:[.,][0-9]{3})?)/i);
    if (volumenMatch) volumen = volumenMatch[1].trim();

    return { numero, volumen };
  };

  const handleLoadImage = async (file) => {
    if (!file) return;
    setLoadModal(prev => ({ ...prev, ocrLoading:true, ocrError:"", ocrText:"" }));
    try {
      const Tesseract = await loadTesseract();
      const result = await Tesseract.recognize(file, "spa", {
        logger: m => {
          if (m && m.status === "recognizing text") {
            setLoadModal(prev => ({ ...prev, ocrLoading:true }));
          }
        }
      });
      const rawText = result?.data?.text || "";
      const found = extractLoadDataFromOCR(rawText);
      setLoadModal(prev => ({
        ...prev,
        ocrLoading:false,
        ocrError: (!found.numero && !found.volumen) ? "No pude identificar automáticamente N° o Volumen GOV. Puedes escribirlos manualmente." : "",
        ocrText: rawText,
        numero: found.numero || prev.numero,
        volumenGOV: found.volumen || prev.volumenGOV
      }));
    } catch (e) {
      console.error(e);
      setLoadModal(prev => ({
        ...prev,
        ocrLoading:false,
        ocrError:e?.message || "No se pudo leer la imagen. Ingresa los datos manualmente."
      }));
    }
  };

  const confirmLoad = () => {
    // N° de cargue, Volumen GOV e imagen son 100% opcionales.
    // El cargue SIEMPRE puede confirmarse, incluso con los tres campos vacíos.
    const numero = String(loadModal.numero || "").trim();
    const volumenRaw = String(loadModal.volumenGOV || "").trim().replace(/\s/g, "").replace(",", ".");
    const volumen = volumenRaw === "" ? null : Number(volumenRaw);

    // Si el usuario escribió un volumen inválido, no bloqueamos el cargue:
    // guardamos el valor como texto para no impedir la confirmación.
    const volumenGuardado = volumenRaw === "" ? null : (Number.isFinite(volumen) ? volumen : volumenRaw);

    const day = [...(schedules[selectedDate] || [])];
    const idx = day.findIndex(v => v.plate === loadModal.plate);
    if (idx === -1) return;

    day[idx] = {
      ...day[idx],
      loaded:true,
      loadedTime:new Date().toLocaleTimeString("es-CO", { hour:"2-digit", minute:"2-digit" }),
      numeroCargue:numero || null,
      volumenGOV:volumenGuardado
    };
    updateSchedules({ ...schedules, [selectedDate]: day });
    closeLoadModal();
  };

  const updateObservaciones = (plate, value) => {
    const day = [...(schedules[selectedDate] || [])];
    const idx = day.findIndex(v => v.plate === plate && (v.destination || "Monterrey") === selectedDestination);
    if (idx === -1) return;
    day[idx] = { ...day[idx], observaciones: value };
    updateSchedules({ ...schedules, [selectedDate]: day });
  };

  // WhatsApp
  const buildWhatsAppText = () => {
    const d = new Date(selectedDate + "T12:00:00");
    const dateLabel = `${DAYS_ES[d.getDay()]} ${d.getDate()} de ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
    const lines = [`🚛 *CANAVEN - Programación Vehicular*`, `📍 Destino: ${selectedDestination}`, `📅 ${dateLabel}`, ``, `*Vehículos Programados:*`];
    scheduleForDate.forEach((v, i) => {
      const status = v.loaded ? `✅ Cargado${v.loadedTime ? " · " + v.loadedTime : ""}` : "⏳ Programado";
      const obs = v.observaciones ? ` · 📝 ${v.observaciones}` : "";
      lines.push(`${i + 1}. *${v.plate}* — ${status}${obs}`);
    });
    lines.push(``, `📋 Total: ${scheduleForDate.length} · ✅ Cargados: ${scheduleForDate.filter(v => v.loaded).length}`);
    return lines.join("\n");
  };
  const copyMessage = () => navigator.clipboard.writeText(buildWhatsAppText()).catch(() => {});
  const sendWhatsApp = () => window.open(`https://chat.whatsapp.com/LCkWONNBkq41X0mWV9feOF?text=${encodeURIComponent(buildWhatsAppText())}`, "_blank");

  // CSV Export for the selected date range
  const downloadCSV = () => {
    if (!pdfFrom || !pdfTo) {
      alert("Selecciona las fechas Desde y Hasta.");
      return;
    }
    if (pdfFrom > pdfTo) {
      alert("La fecha Desde no puede ser posterior a la fecha Hasta.");
      return;
    }

    const rows = [["Fecha","Dia","Placa","Destino","Propietario","Estado","Hora Cargue","N° Cargue","Volumen GOV (Barriles)","Observaciones"]];
    const filteredDates = Object.keys(schedules)
      .filter(date => date >= pdfFrom && date <= pdfTo)
      .sort();

    filteredDates.forEach(date => {
      const d = new Date(date + "T12:00:00");
      const dayName = DAYS_ES[d.getDay()];
      (schedules[date] || []).forEach(v => {
        if (!v.loaded) return;
        rows.push([
          date,
          dayName,
          v.plate,
          v.destination || "Monterrey",
          v.owner || "",
          "Cargado",
          v.loadedTime || "",
          v.numeroCargue || "",
          v.volumenGOV || "",
          v.observaciones || ""
        ]);
      });
    });

    const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type:"text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `canaven_viajes_${pdfFrom}_a_${pdfTo}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // PDF Report generation
  const generatePDF = async (autoPrint = true) => {
    setGeneratingPdf(true);
    try {
      // Collect data for date range
      const from = new Date(pdfFrom + "T12:00:00");
      const to = new Date(pdfTo + "T12:00:00");
      const days = [];
      let d = new Date(from);
      while (d <= to) {
        const ds = d.toISOString().split("T")[0];
        const daySchedules = schedules[ds] || [];
        const cargados = daySchedules.filter(v => v.loaded).length;
        if (cargados > 0) {
          days.push({ date: ds, label: `${d.getDate()}/${d.getMonth()+1}/${String(d.getFullYear()).slice(2)}`, cargados });
        }
        d.setDate(d.getDate() + 1);
      }
      const total = days.reduce((s, d) => s + d.cargados, 0);

      // Build HTML for PDF
      const fromLabel = `${from.getDate()}/${from.getMonth()+1}/${from.getFullYear()}`;
      const toLabel = `${to.getDate()}/${to.getMonth()+1}/${to.getFullYear()}`;
      const today = new Date();
      const reportDate = `${today.getDate()}/${today.getMonth()+1}/${today.getFullYear()}`;

      // SVG chart dimensions
      const svgW = 520, svgH = 200, padL = 30, padB = 50, padT = 20, padR = 10;
      const chartW = svgW - padL - padR;
      const chartH2 = svgH - padT - padB;

      const buildSVGBars = (dataArr, color) => {
        if (dataArr.length === 0) return `<svg width="${svgW}" height="${svgH}"><text x="${svgW/2}" y="${svgH/2}" text-anchor="middle" fill="#999" font-size="13">Sin datos</text></svg>`;
        const maxV = Math.max(...dataArr.map(d => d.val), 1);
        const bW = Math.min(36, Math.floor(chartW / dataArr.length) - 4);
        const gap = (chartW - bW * dataArr.length) / (dataArr.length + 1);
        const yLines = [0, 0.25, 0.5, 0.75, 1].map(p => Math.round(maxV * p));
        let svg = `<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg" style="font-family:Arial,sans-serif;">`;
        // Grid lines
        yLines.forEach(v => {
          const y = padT + chartH2 - Math.round((v/maxV)*chartH2);
          svg += `<line x1="${padL}" y1="${y}" x2="${svgW-padR}" y2="${y}" stroke="#ddd" stroke-width="1"/>`;
          svg += `<text x="${padL-4}" y="${y+4}" text-anchor="end" font-size="9" fill="#999">${v}</text>`;
        });
        // X axis
        svg += `<line x1="${padL}" y1="${padT+chartH2}" x2="${svgW-padR}" y2="${padT+chartH2}" stroke="#999" stroke-width="1.5"/>`;
        // Bars
        dataArr.forEach((d, i) => {
          const x = padL + gap + i * (bW + gap);
          const bH = Math.max(2, Math.round((d.val / maxV) * chartH2));
          const y = padT + chartH2 - bH;
          svg += `<rect x="${x}" y="${y}" width="${bW}" height="${bH}" fill="${color}" rx="2"/>`;
          svg += `<text x="${x + bW/2}" y="${y - 3}" text-anchor="middle" font-size="9" font-weight="bold" fill="#333">${d.val}</text>`;
          // Label rotated
          const lx = x + bW/2; const ly = padT + chartH2 + 8;
          svg += `<text transform="rotate(-40,${lx},${ly})" x="${lx}" y="${ly}" text-anchor="end" font-size="7.5" fill="#666">${d.label}</text>`;
        });
        svg += `</svg>`;
        return svg;
      };

      const chartH = 180;

      // Build monthly comparison data (last 12 months)
      const monthlyMap = {};
      Object.entries(schedules).forEach(([date, ds]) => {
        if (date < pdfFrom || date > pdfTo) return;
        const d = new Date(date + "T12:00:00");
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
        const label = MONTHS_ES[d.getMonth()].slice(0,3) + " " + String(d.getFullYear()).slice(2);
        if (!monthlyMap[key]) monthlyMap[key] = { label, total: 0 };
        monthlyMap[key].total += ds.filter(v => v.loaded).length;
      });
      const monthlyArr = Object.entries(monthlyMap)
        .sort(([a],[b]) => a.localeCompare(b))
        .slice(-12)
        .map(([,v]) => v);

      // Build charts only after monthlyArr has been created
      const dailySVG = buildSVGBars(days.map(d => ({ val: d.cargados, label: d.label })), "#1a56c4");
      const monthlySVG = buildSVGBars(monthlyArr.map(m => ({ val: m.total, label: m.label })), "#b5c832");

      // Cargues realizados por vehículo para el rango del informe.
      // Se consolida por placa para evitar repetir vehículos.
      const pdfVehicleMap = {};
      Object.entries(schedules).forEach(([date, ds]) => {
        const dt = new Date(date + "T12:00:00");
        if (dt < from || dt > to) return;
        ds.forEach(v => {
          if (!v.loaded) return;
          const plate = String(v.plate || "").trim().toUpperCase();
          if (!plate) return;
          if (!pdfVehicleMap[plate]) pdfVehicleMap[plate] = { plate, loaded:0 };
          pdfVehicleMap[plate].loaded += 1;
        });
      });
      const vehicleAvailData = Object.values(pdfVehicleMap)
        .sort((a,b) => b.loaded - a.loaded || a.plate.localeCompare(b.plate));
      const maxVehicleLoaded = Math.max(...vehicleAvailData.map(v => v.loaded), 1);

      const availBarsHtml = vehicleAvailData.map(v => {
        const barWidth = Math.round((v.loaded / maxVehicleLoaded) * 200);
        return `<tr>
          <td style="padding:5px 8px;font-weight:bold;font-size:10px;white-space:nowrap;">${v.plate}</td>
          <td style="padding:5px 8px;width:100%;">
            <svg width="200" height="14" xmlns="http://www.w3.org/2000/svg">
              <rect x="0" y="0" width="200" height="14" fill="#eeeeee" rx="3"/>
              <rect x="0" y="0" width="${barWidth}" height="14" fill="#1a56c4" rx="3"/>
            </svg>
          </td>
          <td style="padding:5px 8px;font-size:10px;font-weight:bold;color:#1a56c4;white-space:nowrap;">${v.loaded} cargues</td>
        </tr>`;
      }).join("");

      const tableRows = days.map(day =>
        `<tr><td style="border:1px solid #ccc;padding:6px 12px;text-align:center;">${day.label}</td>
         <td style="border:1px solid #ccc;padding:6px 12px;text-align:center;font-weight:bold;">${day.cargados}</td></tr>`
      ).join("");

      // Cantidad de viajes por destino para el rango del informe
      const destinationMap = {};
      Object.entries(schedules).forEach(([date, ds]) => {
        const dt = new Date(date + "T12:00:00");
        if (dt < from || dt > to) return;
        ds.forEach(v => {
          const destination = v.destination || "Monterrey";
          if (!destinationMap[destination]) destinationMap[destination] = { programados: 0, cargados: 0 };
          destinationMap[destination].programados += 1;
          if (v.loaded) destinationMap[destination].cargados += 1;
        });
      });
      const destinationRows = Object.entries(destinationMap)
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([destination, values]) => `<tr>
          <td style="border:1px solid #ccc;padding:6px 12px;font-weight:bold;">${destination}</td>
          <td style="border:1px solid #ccc;padding:6px 12px;text-align:center;">${values.programados}</td>
          <td style="border:1px solid #ccc;padding:6px 12px;text-align:center;font-weight:bold;">${values.cargados}</td>
        </tr>`).join("");
      const destinationTotalProgramados = Object.values(destinationMap).reduce((s,v) => s + v.programados, 0);
      const destinationTotalCargados = Object.values(destinationMap).reduce((s,v) => s + v.cargados, 0);

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>
        @page{size:auto;margin:0;}
        body{font-family:Arial,sans-serif;margin:0;padding:20px 30px 30px;color:#222;font-size:11px;}
        /* Membrete fijo: Chrome lo repite automáticamente en cada página impresa. */
        .header{position:relative;left:auto;right:auto;top:auto;height:72px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #1a56c4;padding-bottom:8px;background:#fff;z-index:1000;}
        .logo-text{font-size:22px;font-weight:900;color:#1a56c4;letter-spacing:1px;}
        .logo-sub{font-size:9px;color:#b5c832;letter-spacing:2px;}
        h2{text-align:center;font-size:13px;font-weight:bold;letter-spacing:1px;margin:0 0 20px;}
        .section-title{font-weight:bold;font-size:11px;margin:16px 0 6px;}
        .item{margin:3px 0 3px 20px;font-size:10px;}
        .chart-wrap{border:1px solid #ddd;border-radius:4px;padding:16px;margin:12px 0;break-inside:avoid;page-break-inside:avoid;}
        .chart-title{text-align:center;font-weight:bold;font-size:12px;margin-bottom:12px;}
        .bars{display:flex;align-items:flex-end;justify-content:center;gap:2px;height:200px;border-bottom:2px solid #999;}
        table{border-collapse:collapse;margin:0 auto;break-inside:avoid;page-break-inside:avoid;}
        thead{display:table-header-group;}
        tr{break-inside:avoid;page-break-inside:avoid;}
        th{background:#1a56c4;color:#fff;padding:6px 24px;font-size:11px;}
        tfoot{display:table-footer-group;}
        tfoot td{font-weight:bold;background:#f0f0f0;border:1px solid #ccc;padding:6px 12px;text-align:center;}
        /* Mantiene el título y su tabla juntos; si no caben, pasan completos a la siguiente hoja. */
        .table-section{break-inside:avoid;page-break-inside:avoid;margin:0 0 16px;}
        .obs-section{break-inside:avoid;page-break-inside:avoid;}
        .obs-item{margin:4px 0;font-size:10px;}
        .footer{border-top:1px dashed #aaa;margin-top:32px;padding-top:12px;font-size:10px;break-inside:avoid;page-break-inside:avoid;}
        .sign-line{border-bottom:1px solid #333;width:140px;margin:24px 0 4px;}
        @media print{
          .table-section,.chart-wrap,.footer{break-inside:avoid;page-break-inside:avoid;}
        }
      </style></head><body>
      <div class="header">
        <div>
          <img src="data:image/png;base64,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PHRxMkqSCDM4MAL8Hjx58fGnV1J2TfaOSaR/Erj64r7JpWxG5T2o1ksk0dNS0kDR0lTPI4NZG3Jxkk8zyAJ6l0bJRR1dqp6m5WKK21cjMy0pkbL0R8W+3gfSFHNtUc8dnsV6jppqmnsl9pbhWMhjL3iBu8x7w0cXbofvYHU0qQTXPu1oioummKltQ+poZH0ErQQHP3SGHiB+VjmnV1J2TfaOSaR/Fe4Wq2nlRw/RXGttXZ67Vl20821NZLbYaeZ8pxuvEocQAOfDd+tV7sCbTjULjY2V7KDuBTC9dsiYZu2+7pN7pP6XGd/H9XzKYaYjkbtf1hIY3hjqG3Bri0gEhsucHkU6upOyb7RyTSP4qWdyrbnHacP0UNpto/3OH6KpLUzKg7XKneZcTqk363mzOaJNwWzdZ0+CPA6PHTb/AF5xnjuqd7YrdHdptJWyqglnoqm/Mjq4mOe1r4ugmJa/dI8HIbkHgeGU6upOyb7RyTSP4qY9yrb8zh+iuJWVlnptZ27TJtLXS11HPVNmGN1oicxpaRzyd8fuVX7KrOLRqfSVZSU9ZDNWS3mkrXvllf0kEMhFOx++TwaAA3zcuZXt7IGC0O1Za577TzyU7LJcWUr4o5C9tY4x9CGFgyJCQd3zhOrqTsm+0ck0j+KtS809sttqqrg60yVQp4nSmGmgMksmBndY0fKceoda+1Nb7ZNSxT9z2xCRgfuyM3XNyM4I6j5lFNWi8fAFcW3HpjeO9p4qMZ3zP2v4fLr3s8l8tqNX2psnjE9sgr4JhSQ1PbUcj4aeNzmb00jGeE5rOZA59fDKdXUnZN9o5JpH8Spr3JtvzOH6K5uqH2PT2nLjfa6ha6moKaSplEbMuLWNJIA8fBcPYI6c7LbWyeZ8/RyVEccjmvbvRNnkEZAf4QbubuAeIGFLNRT22nsNfNeGtdbm07+2muiMgMe6Q4FrQS4YzwAKdXUnZN9o5JpH8VyNIB14tDa266WbZZXuyyB9QycuYQCHbzOHXy8y/YqzT0ur59LtpIzXwUTK143eHRveWD62qPbCq581nultoqiev07bq3oLHXTMc0y02413R+EAXCNxMYd1gDxKDWervPwys1rJYq1lsuF7ns/dAyN3H0wjEUTej+WB00TnbxGPDTq6k7JvtHJNI/iVZet7pSWCrtdtt2mHXm6XR8raamjlZCN2Nm+9xe84GBjA5klSu2AtoowaTtTn+B3gd3iescPP61A9vFVY6bTML6+4y228QyOqbJUw08kkjKuNpLWjdac72dwtPyg4hSfZ9cr1d9IUNx1FaTabnL0nT0h/o8SOa397Q0+tSRUkEJzo2AHuAC8L3HaV3kRFYXKIiIiIiIiJgeIIiIiYHiCIiIiIiIiIiIiIiIiIiIiIiIRlc/Ttmt9gtUdrtcJhpY3ve1heXYL3l7uJ483FdBERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERf//Z" style="height:52px;object-fit:contain;" />
        </div>
        <div style="text-align:right;font-size:10px;color:#555;">Informe generado: ${reportDate}</div>
      </div>
      <h2>INFORME OPERATIVO</h2>
      <p><strong>1. FECHA:</strong> ${reportDate}</p>
      <p class="section-title">2. ACTIVIDADES:</p>
      <div class="item">1. Programación de vehículos diarios.</div>
      <div class="item">2. Seguimiento de GPS para asegurar cantidad de vehículos programados</div>
      <div class="item">3. Solicitud de documentos operativos a los propietarios</div>
      <div class="item">4. Comunicación con personal de Canacol para asegurar la actividad y cumplir la programación.</div>
      <div class="item">5. Reunión propietarios temas de facturación y pagos.</div>
      <p class="section-title">3. INDICADORES: cargue de vehículos del ${fromLabel} al ${toLabel}</p>
      <div class="chart-wrap">
        <div class="chart-title">CARGUES POR DÍA</div>
        ${dailySVG}
        <div style="text-align:center;margin-top:4px;font-size:9px;color:#555;">■ CARGUES</div>
      </div>
      <div class="table-section">
        <p class="section-title">4. CANTIDAD DE VIAJES POR DESTINO</p>
        <table style="width:100%;">
          <thead><tr><th>DESTINO</th><th>PROGRAMADOS</th><th>CARGADOS</th></tr></thead>
          <tbody>${destinationRows || `<tr><td colspan="3" style="border:1px solid #ccc;padding:8px;text-align:center;">Sin viajes registrados en el período</td></tr>`}</tbody>
          <tfoot><tr><td>TOTAL</td><td>${destinationTotalProgramados}</td><td>${destinationTotalCargados}</td></tr></tfoot>
        </table>
      </div>
      <p class="section-title">5. COMPARATIVO MENSUAL DE CARGUES</p>
      <div class="chart-wrap">
        <div class="chart-title">CARGUES POR MES</div>
        ${monthlySVG}
        <div style="text-align:center;margin-top:4px;font-size:9px;color:#555;">■ TOTAL CARGUES POR MES</div>
      </div>
      <div class="table-section">
        <p class="section-title">6. INDICADOR: DEL ${fromLabel.toUpperCase()} A ${toLabel.toUpperCase()}</p>
        <table>
          <thead><tr><th>DIA</th><th>VIAJES</th></tr></thead>
          <tbody>${tableRows}</tbody>
          <tfoot><tr><td>TOTAL</td><td>${total}</td></tr></tfoot>
        </table>
      </div>
      <div class="table-section">
        <p class="section-title">7. CARGUES REALIZADOS POR VEHÍCULO</p>
        <div class="chart-wrap" style="padding:12px;">
        <div class="chart-title">CANTIDAD DE CARGUES POR VEHÍCULO</div>
        <table style="width:100%;border-collapse:collapse;">
          <tbody>${availBarsHtml || `<tr><td colspan="3" style="padding:8px;text-align:center;color:#666;">Sin cargues registrados en el período</td></tr>`}</tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="padding:6px 8px;font-size:10px;color:#666;border-top:1px solid #ddd;">
                Total cargues del período: <strong>${total}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
      <div class="obs-section">
        <p class="section-title">8. OBSERVACIONES:</p>
      ${(pdfObs || `Promedio de cargues por día: ${days.length > 0 ? (total/days.length).toFixed(1) : 0} viajes.`).split("\n").map(l => `<div class="obs-item">• ${l}</div>`).join("")}
      </div>
      <div class="footer">
        <div style="margin-bottom:4px;">Realizo:</div>
        <img src="data:image/png;base64,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" style="height:60px;object-fit:contain;display:block;margin:0 0 2px 0;" />
        <div><strong>RONALD JESUS ORTIZ</strong></div>
      </div>
      </body></html>`;

      // Open the report in a new tab and open the browser print dialog.
      // From the print dialog choose "Guardar como PDF".
      const win = window.open("", "_blank");
      if (!win) {
        alert("El navegador bloqueó la ventana del informe. Permite las ventanas emergentes para esta página e inténtalo nuevamente.");
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.document.title = `CANAVEN - Informe Operativo ${fromLabel} a ${toLabel}`;
      setTimeout(() => {
        win.focus();
        if (autoPrint) win.print();
      }, autoPrint ? 400 : 100);
    } catch(e) {
      console.error("Error generando el informe PDF:", e);
      alert("No se pudo generar el informe. Revisa la consola para ver el error.");
    } finally {
      setGeneratingPdf(false);
    }
    setGeneratingPdf(false);
  };

  // Reports: all metrics are based only on the date range selected in Informes.
  const reportDates = useMemo(() => {
    if (!pdfFrom || !pdfTo || pdfFrom > pdfTo) return [];
    return Object.keys(schedules)
      .filter(date => date >= pdfFrom && date <= pdfTo)
      .sort();
  }, [schedules, pdfFrom, pdfTo]);

  const reportData = useMemo(() => {
    return reportDates.map(date => {
      const d = new Date(date + "T12:00:00");
      const ds = schedules[date] || [];
      return {
        name: `${d.getDate()}/${d.getMonth()+1}`,
        programados: ds.length,
        cargados: ds.filter(v => v.loaded).length
      };
    });
  }, [reportDates, schedules]);

  const reportTotals = useMemo(() => ({
    programados: reportData.reduce((s,d) => s + d.programados, 0),
    cargados: reportData.reduce((s,d) => s + d.cargados, 0)
  }), [reportData]);

  // Viajes por destino para el rango seleccionado.
  const destinationReportData = useMemo(() => {
    const result = {};
    reportDates.forEach(date => {
      (schedules[date] || []).forEach(v => {
        const destination = v.destination || "Monterrey";
        if (!result[destination]) result[destination] = { destination, programados:0, cargados:0 };
        result[destination].programados += 1;
        if (v.loaded) result[destination].cargados += 1;
      });
    });
    return Object.values(result).sort((a,b) => a.destination.localeCompare(b.destination));
  }, [schedules, reportDates]);

  // Cargues realizados por vehículo: una sola fila por placa, sin repetir.
  // Si una placa aparece asociada a más de un destino, sus cargues se consolidan.
  const vehicleLoadedReportData = useMemo(() => {
    const result = {};
    reportDates.forEach(date => {
      (schedules[date] || []).forEach(v => {
        if (!v.loaded) return;
        const plate = String(v.plate || "").trim().toUpperCase();
        if (!plate) return;
        if (!result[plate]) result[plate] = { plate, cargues:0 };
        result[plate].cargues += 1;
      });
    });
    return Object.values(result).sort((a,b) => b.cargues - a.cargues || a.plate.localeCompare(b.plate));
  }, [schedules, reportDates]);

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
              <div style={{ fontSize:12, color:C.muted }}>Destino seleccionado: {selectedDestination}</div>
            </div>
            <div style={{ display:"flex", gap:8, marginBottom:10 }}>
              <select value={selectedDestination} onChange={e=>{setSelectedDestination(e.target.value);setSelectedPlates([]);}} style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"11px 14px", color:C.text, fontSize:14, outline:"none" }}>
                {destinations.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
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
            {isAdmin && (
              <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                <input value={newDestination} onChange={e=>setNewDestination(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addDestination()} placeholder="Nuevo destino, Ej: Cartagena" style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 12px", color:C.text, fontSize:13, outline:"none" }} />
                <button onClick={addDestination} className="tap" style={{ background:C.green, color:"#08110b", border:"none", borderRadius:10, padding:"10px 14px", fontSize:13, fontWeight:800, cursor:"pointer" }}>+ Destino</button>
              </div>
            )}
            <div style={{ marginBottom:10, fontSize:12, color:C.muted }}>
              {destinationVehicles.filter(v=>v.available).length} disponibles · {destinationVehicles.filter(v=>!v.available).length} no disponibles · {destinationVehicles.length} total
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {destinationVehicles.map((v, idx) => {
                const tot = vehicleTotals[`${selectedDestination}::${v.plate}`] || {};
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
                    {isAdmin && (
                      <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:8 }}>
                        <input
                          value={ownerInputs[ownerKey(v.plate)] ?? v.owner ?? ""}
                          onChange={e => setOwnerInputs(prev => ({ ...prev, [ownerKey(v.plate)]: e.target.value }))}
                          onKeyDown={e => e.key === "Enter" && saveOwner(v.plate)}
                          placeholder="Nombre del propietario"
                          style={{ flex:1, background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 10px", color:C.text, fontSize:12, outline:"none" }}
                        />
                        <button onClick={() => saveOwner(v.plate)} className="tap"
                          style={{ background:C.blue, color:"#fff", border:"none", borderRadius:7, padding:"8px 11px", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                          💾 Guardar
                        </button>
                      </div>
                    )}
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: isAdmin && !v.replacedBy ? 8 : 0 }}>
                      {isAdmin ? (
                        <button onClick={()=>!v.replacedBy && toggleAvailability(v.plate)} className="tap"
                          style={{ ...badge(v.available), cursor: v.replacedBy ? "default" : "pointer", padding:"5px 12px", fontSize:11, opacity: v.replacedBy ? 0.6 : 1 }}>
                          <span style={{ width:6, height:6, borderRadius:"50%", background: v.available ? C.green : C.red, display:"inline-block" }} />
                          {v.replacedBy ? `Reemplazado → ${v.replacedBy}` : v.available ? "Disponible" : "No Disponible"}
                        </button>
                      ) : (
                        <span style={{ ...badge(v.available), padding:"5px 12px", fontSize:11 }}>
                          <span style={{ width:6, height:6, borderRadius:"50%", background: v.available ? C.green : C.red, display:"inline-block" }} />
                          {v.replacedBy ? `→ ${v.replacedBy}` : v.available ? "Disponible" : "No Disponible"}
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
                    {/* Replacement UI - admin only */}
                    {isAdmin && !v.replacedBy && (
                      <div style={{ display:"flex", gap:6, marginTop:6 }}>
                        <input
                          value={replaceInput[v.plate] || ""}
                          onChange={e => setReplaceInput(prev => ({ ...prev, [v.plate]: e.target.value }))}
                          onKeyDown={e => e.key === "Enter" && applyReplacement(v.plate)}
                          placeholder="Placa reemplazo (opcional)"
                          style={{ flex:1, background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:12, outline:"none", textTransform:"uppercase" }}
                        />
                        <button onClick={() => applyReplacement(v.plate)}
                          disabled={!(replaceInput[v.plate] || "").trim()}
                          className="tap"
                          style={{ background: (replaceInput[v.plate]||"").trim() ? C.orange : C.border, color:"#fff", border:"none", borderRadius:7, padding:"7px 12px", fontSize:12, fontWeight:700, cursor:(replaceInput[v.plate]||"").trim()?"pointer":"not-allowed" }}>
                          ↔ Reemplazar
                        </button>
                      </div>
                    )}
                    {/* Clear replacement button */}
                    {isAdmin && v.replacedBy && (
                      <div style={{ marginTop:6 }}>
                        <button onClick={() => clearReplacement(v.plate)} className="tap"
                          style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:7, padding:"5px 12px", color:C.muted, fontSize:11, cursor:"pointer", fontWeight:600 }}>
                          ✕ Quitar reemplazo
                        </button>
                      </div>
                    )}
                  </div>
                );
              })})()}
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
              {destinationVehicles.map((v, idx) => {
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
                          {v.loaded?`✓ Cargado · ${v.loadedTime||""}`:"⏳ Programado"}
                        </div>
                      )}
                    </div>
                    {v.loaded && (v.numeroCargue || v.volumenGOV) && (
                      <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
                        {v.numeroCargue && (
                          <div style={{ flex:1, minWidth:130, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 10px", fontSize:11 }}>
                            <span style={{ color:C.muted }}>N° Cargue: </span><strong style={{ color:C.text }}>{v.numeroCargue}</strong>
                          </div>
                        )}
                        {v.volumenGOV != null && v.volumenGOV !== "" && (
                          <div style={{ flex:1, minWidth:130, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 10px", fontSize:11 }}>
                            <span style={{ color:C.muted }}>GOV: </span><strong style={{ color:C.yellowGreen }}>{Number(v.volumenGOV).toLocaleString("es-CO")} Bbl</strong>
                          </div>
                        )}
                      </div>
                    )}
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
              <div style={{ fontSize:12, color:C.muted }}>
                Selecciona el período exacto que quieres consultar y descargar.
              </div>
            </div>

            {/* Date range */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px", marginBottom:14 }}>
              <div style={{ fontSize:11, color:C.muted, marginBottom:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>
                📅 Período del informe
              </div>
              <div style={{ display:"flex", gap:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Desde</div>
                  <input type="date" value={pdfFrom} onChange={e=>setPdfFrom(e.target.value)}
                    style={{ width:"100%", boxSizing:"border-box", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 10px", color:C.text, fontSize:12, outline:"none" }} />
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Hasta</div>
                  <input type="date" value={pdfTo} onChange={e=>setPdfTo(e.target.value)}
                    style={{ width:"100%", boxSizing:"border-box", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 10px", color:C.text, fontSize:12, outline:"none" }} />
                </div>
              </div>
              {pdfFrom && pdfTo && pdfFrom > pdfTo && (
                <div style={{ marginTop:8, color:C.red, fontSize:11, fontWeight:700 }}>
                  ⚠️ La fecha Desde no puede ser posterior a la fecha Hasta.
                </div>
              )}
            </div>

            {/* Export / preview options */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px", marginBottom:16 }}>
              <div style={{ fontSize:11, color:C.muted, marginBottom:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>
                📥 Opciones de descarga
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                <button onClick={downloadCSV} className="tap"
                  style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"11px 6px", color:C.yellowGreen, cursor:"pointer", fontSize:12, fontWeight:800, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                  <span style={{ fontSize:18 }}>📊</span>
                  <span>Descargar CSV</span>
                </button>
                <button onClick={()=>generatePDF(false)} disabled={generatingPdf || !pdfFrom || !pdfTo || pdfFrom > pdfTo} className="tap"
                  style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"11px 6px", color:C.blue, cursor:generatingPdf?"not-allowed":"pointer", fontSize:12, fontWeight:800, display:"flex", flexDirection:"column", alignItems:"center", gap:4, opacity:(!pdfFrom || !pdfTo || pdfFrom > pdfTo)?0.5:1 }}>
                  <span style={{ fontSize:18 }}>👁️</span>
                  <span>Ver informe</span>
                </button>
                <button onClick={()=>generatePDF(true)} disabled={generatingPdf || !pdfFrom || !pdfTo || pdfFrom > pdfTo} className="tap"
                  style={{ background:generatingPdf?C.border:"#dc2626", color:"#fff", border:"none", borderRadius:9, padding:"11px 6px", cursor:generatingPdf?"not-allowed":"pointer", fontSize:12, fontWeight:800, display:"flex", flexDirection:"column", alignItems:"center", gap:4, opacity:(!pdfFrom || !pdfTo || pdfFrom > pdfTo)?0.5:1 }}>
                  <span style={{ fontSize:18 }}>📄</span>
                  <span>{generatingPdf ? "Preparando..." : "Descargar PDF"}</span>
                </button>
              </div>
              <div style={{ marginTop:8, color:C.muted, fontSize:10, textAlign:"center" }}>
                “Ver informe” abre una vista previa; desde allí también puedes usar imprimir/guardar como PDF.
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
              {[
                ["Programados",reportTotals.programados,"📋",C.blue],
                ["Cargados",reportTotals.cargados,"✅",C.green],
                ["Cumplimiento",reportTotals.programados>0?Math.round(reportTotals.cargados/reportTotals.programados*100)+"%":"—","📈","#c084fc"],
              ].map(([label,val,icon,color])=>(
                <div key={label} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"14px", position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", bottom:4, right:8, fontSize:32, opacity:0.07 }}>{icon}</div>
                  <div style={{ fontSize:24, fontWeight:900, color }}>{val}</div>
                  <div style={{ fontSize:10, color:C.muted, marginTop:2, textTransform:"uppercase", letterSpacing:"0.07em" }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Daily chart for selected range */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 8px", marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:13, marginBottom:4, paddingLeft:8 }}>
                Cargues por día
              </div>
              <div style={{ fontSize:11, color:C.muted, marginBottom:12, paddingLeft:8 }}>
                {pdfFrom && pdfTo ? `Período: ${pdfFrom} a ${pdfTo}` : "Selecciona un período"}
              </div>
              {reportData.length===0 ? (
                <div style={{ textAlign:"center", padding:"28px", color:C.muted, fontSize:13 }}>
                  Sin datos para este período
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={reportData} margin={{ top:0, right:4, left:-16, bottom:20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="name" tick={{ fill:C.muted, fontSize:9 }} axisLine={{ stroke:C.border }} tickLine={false} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tick={{ fill:C.muted, fontSize:10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, fontSize:12, color:C.text }} />
                    <Legend wrapperStyle={{ fontSize:11, color:C.muted }} />
                    <Bar dataKey="programados" name="Programados" fill={C.blue} radius={[4,4,0,0]} />
                    <Bar dataKey="cargados" name="Cargados" fill={C.green} radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Viajes por destino */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px", marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:13, marginBottom:4 }}>Viajes por destino</div>
              <div style={{ fontSize:11, color:C.muted, marginBottom:12 }}>
                Cantidad de viajes según el destino en el período seleccionado.
              </div>
              {destinationReportData.length===0 ? (
                <div style={{ textAlign:"center", padding:"18px", color:C.muted, fontSize:12 }}>Sin viajes registrados para este período</div>
              ) : (
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                    <thead>
                      <tr style={{ background:C.surface }}>
                        {["Destino","Programados","Cargados"].map(h=>(
                          <th key={h} style={{ padding:"8px 10px", textAlign:h==="Destino"?"left":"center", fontSize:10, color:C.muted, textTransform:"uppercase", borderBottom:`1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {destinationReportData.map((d,i)=>(
                        <tr key={d.destination} style={{ borderBottom:`1px solid ${C.border}`, background:i%2===0?"transparent":C.surface+"44" }}>
                          <td style={{ padding:"9px 10px", fontWeight:700 }}>{d.destination}</td>
                          <td style={{ padding:"9px 10px", textAlign:"center", color:C.blue, fontWeight:700 }}>{d.programados}</td>
                          <td style={{ padding:"9px 10px", textAlign:"center", color:C.green, fontWeight:700 }}>{d.cargados}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background:C.surface, borderTop:`2px solid ${C.border}` }}>
                        <td style={{ padding:"9px 10px", fontWeight:800 }}>TOTAL</td>
                        <td style={{ padding:"9px 10px", textAlign:"center", fontWeight:800, color:C.blue }}>{destinationReportData.reduce((s,d)=>s+d.programados,0)}</td>
                        <td style={{ padding:"9px 10px", textAlign:"center", fontWeight:800, color:C.green }}>{destinationReportData.reduce((s,d)=>s+d.cargados,0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* Monthly comparison within the selected range */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 8px", marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:13, marginBottom:4, paddingLeft:8 }}>Comparativo mensual de cargues</div>
              <div style={{ fontSize:11, color:C.muted, marginBottom:12, paddingLeft:8 }}>
                Solo se muestran los meses incluidos en las fechas seleccionadas.
              </div>
              {(() => {
                const monthlyMap = {};
                reportDates.forEach(date => {
                  const d = new Date(date + "T12:00:00");
                  const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
                  const label = MONTHS_ES[d.getMonth()].slice(0,3) + " " + String(d.getFullYear()).slice(2);
                  if (!monthlyMap[key]) monthlyMap[key] = { label, total:0, prog:0 };
                  const ds = schedules[date] || [];
                  monthlyMap[key].total += ds.filter(v=>v.loaded).length;
                  monthlyMap[key].prog += ds.length;
                });
                const monthlyArr = Object.entries(monthlyMap).sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v);
                if (!monthlyArr.length) return <div style={{ textAlign:"center", padding:"28px", color:C.muted, fontSize:13 }}>Sin datos mensuales para este período</div>;
                const data = monthlyArr.map(m=>({ name:m.label, programados:m.prog, cargados:m.total }));
                return (
                  <>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={data} margin={{ top:0, right:4, left:-16, bottom:20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="name" tick={{ fill:C.muted, fontSize:9 }} axisLine={{ stroke:C.border }} tickLine={false} />
                        <YAxis tick={{ fill:C.muted, fontSize:10 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, fontSize:12, color:C.text }} />
                        <Legend wrapperStyle={{ fontSize:11, color:C.muted }} />
                        <Bar dataKey="programados" name="Programados" fill={C.blue} radius={[4,4,0,0]} />
                        <Bar dataKey="cargados" name="Cargados" fill={C.green} radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                    <div style={{ marginTop:14, overflowX:"auto" }}>
                      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                        <thead>
                          <tr style={{ background:C.surface }}>
                            {["Mes","Programados","Cargados"].map(h=>(
                              <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:10, color:C.muted, textTransform:"uppercase", borderBottom:`1px solid ${C.border}` }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyArr.map((m,i)=>(
                            <tr key={i} style={{ borderBottom:`1px solid ${C.border}`, background:i%2===0?"transparent":C.surface+"44" }}>
                              <td style={{ padding:"9px 10px", fontWeight:700 }}>{m.label}</td>
                              <td style={{ padding:"9px 10px", color:C.blue, fontWeight:600 }}>{m.prog}</td>
                              <td style={{ padding:"9px 10px", color:C.green, fontWeight:600 }}>{m.total}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Cargues realizados por vehículo - one row per plate */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 8px", marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:13, marginBottom:2, paddingLeft:8 }}>
                Cargues realizados por vehículo
              </div>
              <div style={{ fontSize:11, color:C.muted, marginBottom:12, paddingLeft:8 }}>
                Cantidad de cargues realizados por cada placa entre {pdfFrom} y {pdfTo}. Las placas se consolidan para no repetirlas.
              </div>
              {vehicleLoadedReportData.length===0 ? (
                <div style={{ textAlign:"center", padding:"20px", color:C.muted, fontSize:13 }}>
                  Sin cargues realizados para este período
                </div>
              ) : (
                <div style={{ padding:"0 8px" }}>
                  {(() => {
                    const maxLoads = Math.max(...vehicleLoadedReportData.map(v=>v.cargues), 1);
                    return vehicleLoadedReportData.map((v,i)=>(
                      <div key={v.plate} style={{ marginBottom:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                          <span style={{ fontWeight:800, fontSize:13, color:C.text, letterSpacing:"0.05em" }}>{v.plate}</span>
                          <span style={{ fontSize:12, color:C.green, fontWeight:800 }}>{v.cargues} cargues</span>
                        </div>
                        <div style={{ height:10, background:C.surface, borderRadius:5, overflow:"hidden", border:`1px solid ${C.border}` }}>
                          <div style={{ width:`${Math.round((v.cargues/maxLoads)*100)}%`, height:"100%", borderRadius:5, background:C.blue }} />
                        </div>
                      </div>
                    ));
                  })()}
                  <div style={{ marginTop:12, padding:"8px 10px", background:C.surface, borderRadius:8, display:"flex", justifyContent:"space-between", fontSize:12 }}>
                    <span style={{ color:C.muted }}>Total cargues realizados:</span>
                    <span style={{ fontWeight:800, color:C.green }}>{reportTotals.cargados}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MODAL: CONFIRMAR CARGUE */}
      {loadModal.open && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,.72)", zIndex:500,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16
        }}>
          <div style={{
            width:"100%", maxWidth:460, maxHeight:"90vh", overflowY:"auto",
            background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:18,
            boxShadow:"0 20px 60px rgba(0,0,0,.45)"
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <div style={{ fontSize:18, fontWeight:900 }}>Confirmar cargue</div>
              <button onClick={closeLoadModal} className="tap"
                style={{ background:"transparent", border:"none", color:C.muted, fontSize:24, cursor:"pointer" }}>×</button>
            </div>
            <div style={{ color:C.muted, fontSize:12, marginBottom:16 }}>
              Vehículo <strong style={{ color:C.yellowGreen }}>{loadModal.plate}</strong> · Puedes ingresar los datos manualmente, cargar una imagen desde tus fotos o simplemente confirmar la carga sin diligenciarlos.
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
              <div>
                <div style={{ fontSize:10, color:C.muted, marginBottom:5, fontWeight:700 }}>N° DE CARGUE (opcional)</div>
                <input value={loadModal.numero}
                  onChange={e=>setLoadModal(prev=>({...prev,numero:e.target.value,ocrError:""}))}
                  placeholder="Ej. 123456"
                  style={{ width:"100%", boxSizing:"border-box", background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"11px 12px", color:C.text, fontSize:14, outline:"none" }} />
              </div>
              <div>
                <div style={{ fontSize:10, color:C.muted, marginBottom:5, fontWeight:700 }}>VOLUMEN GOV (BARRILES) (opcional)</div>
                <input type="text" inputMode="decimal" value={loadModal.volumenGOV}
                  onChange={e=>setLoadModal(prev=>({...prev,volumenGOV:e.target.value,ocrError:""}))}
                  placeholder="Ej. 10.500"
                  style={{ width:"100%", boxSizing:"border-box", background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"11px 12px", color:C.text, fontSize:14, outline:"none" }} />
              </div>
            </div>

            <label style={{
              display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              background:C.surface, border:`1px dashed ${C.blue}`, borderRadius:10, padding:"12px",
              color:C.blue, fontWeight:800, fontSize:12, cursor:"pointer", marginBottom:10
            }}>
              📷 {loadModal.ocrLoading ? "Leyendo imagen..." : "Cargar imagen desde fotos y extraer datos"}
              <input type="file" accept="image/*" style={{ display:"none" }}
                disabled={loadModal.ocrLoading}
                onChange={e=>handleLoadImage(e.target.files?.[0])} />
            </label>

            {loadModal.ocrLoading && (
              <div style={{ background:C.surface, borderRadius:9, padding:10, color:C.muted, fontSize:11, marginBottom:10 }}>
                🔎 Analizando la imagen... puede tardar unos segundos.
              </div>
            )}

            {loadModal.ocrError && (
              <div style={{ background:C.red+"16", border:`1px solid ${C.red}44`, color:C.red, borderRadius:9, padding:10, fontSize:11, marginBottom:10 }}>
                {loadModal.ocrError}
              </div>
            )}

            {loadModal.ocrText && (
              <details style={{ marginBottom:10 }}>
                <summary style={{ color:C.muted, fontSize:10, cursor:"pointer" }}>Ver texto detectado por OCR</summary>
                <pre style={{ whiteSpace:"pre-wrap", fontSize:9, color:C.muted, background:C.surface, borderRadius:8, padding:8, maxHeight:120, overflow:"auto" }}>{loadModal.ocrText}</pre>
              </details>
            )}

            <div style={{ display:"flex", gap:8, marginTop:4 }}>
              <button onClick={closeLoadModal} className="tap"
                style={{ flex:1, background:C.surface, color:C.muted, border:`1px solid ${C.border}`, borderRadius:10, padding:"11px", fontWeight:700, cursor:"pointer" }}>
                Cancelar
              </button>
              <button onClick={confirmLoad} disabled={loadModal.ocrLoading} className="tap"
                style={{ flex:1, background:C.green, color:"#07110a", border:"none", borderRadius:10, padding:"11px", fontWeight:900, cursor:"pointer" }}>
                ✓ Confirmar cargue
              </button>
            </div>
          </div>
        </div>
      )}

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
