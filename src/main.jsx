import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlarmClock, ArrowDownRight, ArrowUpRight, BellRing, BusFront, Check, ChevronDown, CircleHelp, Crosshair, LocateFixed, MapPin, Mic, Moon, Navigation, Pause, Play, Plus, Search, ShieldCheck, Sparkles, Sun, Volume2, X } from 'lucide-react';
import './style.css';
import { parseTravelIntent, bfs, aStar, SAMPLE_GRAPH } from './ai.js';

const DEFAULT_CENTER = [31.6340, 74.8723]; // Amritsar fallback only; GPS is requested separately.
const distanceMeters = (a, b) => {
  const R = 6371000, rad = n => n * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const fmtDistance = n => n >= 1000 ? `${(n / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(n))} m`;
const formatETA = sec => { if (!Number.isFinite(sec) || sec < 0) return '—'; const m = Math.round(sec / 60); return m < 1 ? '< 1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`; };
const userIcon = L.divIcon({ className: 'marker-wrap', html: '<span class="user-marker"><i></i></span>', iconSize: [24,24], iconAnchor: [12,12] });
const destIcon = L.divIcon({ className: 'marker-wrap', html: '<span class="dest-marker"><svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></span>', iconSize: [38,42], iconAnchor: [19,38] });

function App() {
  const [dark, setDark] = useState(false);
  const [destination, setDestination] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [position, setPosition] = useState(null);
  const [gpsStatus, setGpsStatus] = useState('not-started');
  const [tracking, setTracking] = useState(false);
  const [distance, setDistance] = useState(null);
  const [threshold, setThreshold] = useState(1000);
  const [alarmMode, setAlarmMode] = useState('distance');
  const [minutesBefore, setMinutesBefore] = useState(5);
  const [alarmActive, setAlarmActive] = useState(false);
  const [alarmDismissed, setAlarmDismissed] = useState(false);
  const [message, setMessage] = useState('Choose a destination to get started.');
  const [soundOn, setSoundOn] = useState(true);
  const [alarmVolume, setAlarmVolume] = useState(75);
  const [snoozed, setSnoozed] = useState(false);
  const [history, setHistory] = useState([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [voiceListening, setVoiceListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [assistantMessages, setAssistantMessages] = useState([{ role: 'assistant', text: 'Hi! Try “alert me 500 metres before college” or “how far is my destination?”' }]);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [algorithm, setAlgorithm] = useState('astar');
  const [graphStart, setGraphStart] = useState('Campus');
  const [graphGoal, setGraphGoal] = useState('Railway Station');
  const [algorithmResult, setAlgorithmResult] = useState(null);
  const [showAiLab, setShowAiLab] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [showDirections, setShowDirections] = useState(false);
  const [liveNavigation, setLiveNavigation] = useState(false);
  const [nextTurnIndex, setNextTurnIndex] = useState(0);
  const [rerouteStatus, setRerouteStatus] = useState('Route updates when your location changes.');
  const [routeRemainingMeters, setRouteRemainingMeters] = useState(null);

  const mapRef = useRef(null), mapObj = useRef(null), routeLine = useRef(null), userMarker = useRef(null), destMarker = useRef(null), watchId = useRef(null), audioCtx = useRef(null), alarmInterval = useRef(null), snoozeTimeout = useRef(null), alerted = useRef(false), lastPosition = useRef(null), volumeRef = useRef(0.75), soundOnRef = useRef(soundOn);
  const routeFetchBusy = useRef(false), liveRouteRef = useRef(null), lastRerouteAt = useRef(0), speechRecognition = useRef(null);
  volumeRef.current = alarmVolume / 100;
  soundOnRef.current = soundOn;

  useEffect(() => {
    if (mapObj.current) return;
    const map = L.map(mapRef.current, { zoomControl: false }).setView(DEFAULT_CENTER, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.on('click', e => {
      setRouteInfo(null); setRouteError(''); setDestination({ lat: e.latlng.lat, lng: e.latlng.lng, name: 'Pinned destination' });
      setMessage('Destination pinned. Start your journey when ready.');
    });
    mapObj.current = map;
    setTimeout(() => map.invalidateSize(), 150);
  
  return () => { map.remove(); mapObj.current = null; };
  }, []);

  const sendAssistantMessage = (event, overrideText) => {
    event?.preventDefault();
    const text = (overrideText ?? assistantInput).trim();
    if (!text) return;
    const parsed = parseTravelIntent(text);
    setAssistantMessages((items) => [
      ...items,
      { role: 'user', text },
      { role: 'assistant', text: parsed.response }
    ]);
    if (speakReplies && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(parsed.response);
      utterance.lang = 'en-IN'; utterance.rate = 1; window.speechSynthesis.speak(utterance);
    }
    setAiAnalysis(parsed);
    setAssistantInput('');

    if (parsed.alert_distance_m != null) {
      setThreshold(Math.max(250, Math.min(3000, Math.round(parsed.alert_distance_m / 250) * 250)));
      setAlarmMode('distance');
    }
    if (parsed.destination) {
      setQuery(parsed.destination);
      setMessage(`Searching the map for “${parsed.destination}”. Choose the correct result to confirm it.`);
      // Fetch real place candidates from OpenStreetMap; the user confirms the correct result.
      setSearching(true); setResults([]);
      const searchChatDestination = async () => {
        try {
          const makeUrl = q => `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=in&limit=6&q=${encodeURIComponent(q)}`;
          let res = await fetch(makeUrl(parsed.destination), { headers: { 'Accept-Language': 'en' } });
          if (!res.ok) throw new Error('Search failed');
          let data = await res.json();
          if (!data.length && !/punjab|india/i.test(parsed.destination)) {
            await new Promise(resolve => setTimeout(resolve, 1100));
            res = await fetch(makeUrl(`${parsed.destination}, Jandiala Guru, Punjab, India`), { headers: { 'Accept-Language': 'en' } });
            if (!res.ok) throw new Error('Search failed');
            data = await res.json();
          }
          const found = data.map(x => ({ lat: Number(x.lat), lng: Number(x.lon), name: x.name || x.display_name.split(',')[0], address: x.display_name }));
          setResults(found);
          if (!found.length) {
            const notFound = `Sorry, I couldn’t find “${parsed.destination}” in the map data. Try adding its town or district, or search the place above.`;
            setMessage(notFound); setAssistantMessages(items => [...items, { role: 'assistant', text: notFound }]);
          } else setMessage(`Found ${found.length} possible result${found.length === 1 ? '' : 's'} for “${parsed.destination}”. Select the correct one.`);
        } catch {
          const unavailable = 'The map search service is temporarily unavailable. Please try the destination search field again.';
          setMessage(unavailable); setAssistantMessages(items => [...items, { role: 'assistant', text: unavailable }]);
        } finally { setSearching(false); }
      };
      searchChatDestination();
    }
    if (parsed.intent === 'GET_DISTANCE') {
      setMessage(position && destination
        ? `You are approximately ${fmtDistance(distanceMeters(position, destination))} from ${destination.name}.`
        : 'Choose a destination and allow location access to calculate distance.');
    } else if (parsed.intent === 'GET_ETA') {
      setMessage(position && destination
        ? `Estimated time: ${formatETA(distanceMeters(position, destination) / Math.max(position.speed || 2.5, 2.5))}. This is approximate.`
        : 'Choose a destination and allow location access to estimate arrival time.');
    } else if (parsed.intent === 'PAUSE_JOURNEY') {
      setMessage('Use the End journey button to stop tracking.');
    } else if (parsed.intent === 'START_JOURNEY') {
      setMessage('Choose a destination first, then press Start my journey.');
    }
  };

  const toggleVoiceInput = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setMessage('Voice input is not supported in this browser. Try the latest Chrome on HTTPS or localhost.'); return; }
    if (voiceListening) { speechRecognition.current?.stop(); setVoiceListening(false); return; }
    const recognition = new Recognition();
    speechRecognition.current = recognition;
    recognition.lang = 'en-IN'; recognition.interimResults = false; recognition.maxAlternatives = 1;
    recognition.onstart = () => { setVoiceListening(true); setMessage('Listening… say a destination or travel request.'); };
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) { setAssistantInput(transcript); sendAssistantMessage(null, transcript); }
    };
    recognition.onerror = () => setMessage('Voice input did not work. Check microphone permission and try again.');
    recognition.onend = () => setVoiceListening(false);
    recognition.start();
  };

  const runAlgorithm = () => {
    if (!SAMPLE_GRAPH[graphStart] || !SAMPLE_GRAPH[graphGoal]) {
      setAlgorithmResult({ found: false, path: [], order: [], expanded: [], algorithm });
      return;
    }
    if (algorithm === 'bfs') {
      const result = bfs(SAMPLE_GRAPH, graphStart, graphGoal);
      setAlgorithmResult({ ...result, algorithm: 'bfs' });
    } else {
      const result = aStar(SAMPLE_GRAPH, graphStart, graphGoal);
      setAlgorithmResult({ ...result, algorithm: 'astar' });
    }
  };

  useEffect(() => {
    if (!mapObj.current || !destination) return;
    if (destMarker.current) destMarker.current.setLatLng([destination.lat, destination.lng]);
    else destMarker.current = L.marker([destination.lat, destination.lng], { icon: destIcon }).addTo(mapObj.current);
    destMarker.current.bindPopup(`<strong>${escapeHtml(destination.name)}</strong>`);
    mapObj.current.panTo([destination.lat, destination.lng], { animate: true });
  }, [destination]);

  useEffect(() => {
    if (!position || !mapObj.current) return;
    const latlng = [position.lat, position.lng];
    if (userMarker.current) userMarker.current.setLatLng(latlng);
    else userMarker.current = L.marker(latlng, { icon: userIcon, zIndexOffset: 1000 }).addTo(mapObj.current);
    if (destination) {
      const d = distanceMeters(position, destination); setDistance(d);
      const alertDistance = liveNavigation && routeRemainingMeters != null ? routeRemainingMeters : d;
      if (tracking && alarmMode === 'distance' && alertDistance <= threshold && !alerted.current) triggerAlarm();
      if (liveNavigation) updateLiveRoute(position);
      const speed = Math.max(position.speed || 0, 2.5); // conservative estimate when GPS speed is unavailable
      if (tracking && alarmMode === 'time' && d / speed <= minutesBefore * 60 && !alerted.current) triggerAlarm();
    }
  }, [position, destination, tracking, threshold, alarmMode, minutesBefore, liveNavigation, routeRemainingMeters]);

  useEffect(() => () => { stopWatch(); stopAlarm(); }, []);
  const stopWatch = () => { if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current); watchId.current = null; };
  const getLocation = (startTracking = false) => {
    if (!navigator.geolocation) { setGpsStatus('unsupported'); setMessage('This browser does not support location. Try a current version of Chrome on HTTPS.'); return; }
    setGpsStatus('requesting'); setMessage('Waiting for your location permission…');
    navigator.geolocation.getCurrentPosition(pos => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed };
      setPosition(p); lastPosition.current = p; setGpsStatus('ready');
      mapObj.current?.setView([p.lat, p.lng], 15);
      if (startTracking) beginWatch();
      else setMessage('Location found. Choose your destination or start a journey.');
    }, err => {
      setGpsStatus('error');
      setMessage(err.code === 1 ? 'Location permission was denied. Allow location access in your browser settings.' : 'Could not get a GPS fix. Move near a window or try again outdoors.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
  };
  const beginWatch = () => {
    if (!navigator.geolocation) return;
    stopWatch(); setTracking(true); alerted.current = false; setAlarmDismissed(false); setAlarmActive(false);
    if (destination) setHistory(h => [{ name: destination.name, time: new Date().toLocaleString() }, ...h].slice(0, 4));
    setMessage('Journey active — keep this page open for the most reliable tracking.');
    watchId.current = navigator.geolocation.watchPosition(pos => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed };
      setPosition(p); lastPosition.current = p; setGpsStatus('ready');
    }, err => { setGpsStatus('error'); setMessage('GPS signal lost. Check location permission and signal; the alarm may not trigger without updates.'); }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
  };
  const startJourney = () => {
    if (!destination) { setMessage('Please search for your destination or tap the map to pin it.'); return; }
    if (!position) { getLocation(true); return; }
    beginWatch();
  };
  const endJourney = () => { stopWatch(); setTracking(false); stopAlarm(); setAlarmActive(false); alerted.current = false; setMessage('Journey ended. You can set another destination anytime.'); };
  // Synthesized classic twin-bell alarm: short, repeating metallic pulses.
  const playAlarmRingtone = () => {
    if (!soundOnRef.current || volumeRef.current <= 0) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx.current) audioCtx.current = new Ctx();
      const ctx = audioCtx.current;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(Math.max(0.001, volumeRef.current * 0.22), now);
      master.connect(ctx.destination);
      // Four rapid strikes make one classic alarm-clock burst.
      [0, 0.22, 0.44, 0.66].forEach((offset, index) => {
        [880, 1175].forEach((frequency, toneIndex) => {
          const osc = ctx.createOscillator();
          const envelope = ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(frequency + (index % 2 ? 18 : 0), now + offset);
          envelope.gain.setValueAtTime(0.0001, now + offset);
          envelope.gain.exponentialRampToValueAtTime(toneIndex === 0 ? 0.65 : 0.42, now + offset + 0.015);
          envelope.gain.setValueAtTime(toneIndex === 0 ? 0.65 : 0.42, now + offset + 0.105);
          envelope.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.17);
          osc.connect(envelope); envelope.connect(master);
          osc.start(now + offset); osc.stop(now + offset + 0.18);
        });
      });
      setTimeout(() => { try { master.disconnect(); } catch {} }, 1200);
    } catch { /* Browsers may block audio until the user interacts with the page. */ }
  };
  const startAlarmSound = () => {
    if (alarmInterval.current) clearInterval(alarmInterval.current);
    playAlarmRingtone();
    alarmInterval.current = setInterval(playAlarmRingtone, 1500);
  };
  const triggerAlarm = () => {
    alerted.current = true; setAlarmActive(true); setAlarmDismissed(false); setSnoozed(false); setMessage('Your destination is approaching! Get ready to exit.');
    if ('Notification' in window && Notification.permission === 'granted') new Notification('Waylo AI: Your stop is near!', { body: `${destination?.name || 'Your destination'} is approaching. Get ready to exit.` });
    startAlarmSound();
  };
  const stopAlarm = () => {
    if (alarmInterval.current) clearInterval(alarmInterval.current);
    alarmInterval.current = null;
    if (snoozeTimeout.current) clearTimeout(snoozeTimeout.current);
    snoozeTimeout.current = null;
  };
  const dismissAlarm = () => { stopAlarm(); setAlarmActive(false); setSnoozed(false); setAlarmDismissed(true); setMessage('Alarm stopped. Stay alert for your stop.'); };
  const snoozeAlarm = () => {
    if (alarmInterval.current) clearInterval(alarmInterval.current);
    alarmInterval.current = null;
    if (snoozeTimeout.current) clearTimeout(snoozeTimeout.current);
    setAlarmActive(false); setSnoozed(true); setMessage('Alarm snoozed for 2 minutes. It will ring again automatically.');
    snoozeTimeout.current = setTimeout(() => {
      setSnoozed(false); setAlarmActive(true); setMessage('Snooze ended — your stop may be near!'); startAlarmSound();
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Waylo AI: Snooze ended', { body: `${destination?.name || 'Your destination'} may be near. Get ready to exit.` });
    }, 2 * 60 * 1000);
  };
  const enableNotifications = async () => {
    if (!('Notification' in window)) { setMessage('Notifications are not supported by this browser.'); return; }
    const permission = await Notification.requestPermission(); setMessage(permission === 'granted' ? 'Notifications enabled. Keep the page open while travelling.' : 'Notifications are blocked. You can enable them in browser settings.');
  };
  const searchPlaces = async e => {
    e?.preventDefault();
    const term = query.trim();
    if (!term) { setMessage('Enter a place name to search.'); return; }
    setSearching(true); setResults([]);
    setMessage(`Searching for “${term}”…`);
    try {
      const makeUrl = q => `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=in&limit=6&q=${encodeURIComponent(q)}`;
      let res = await fetch(makeUrl(term), { headers: { 'Accept-Language': 'en' } });
      if (!res.ok) throw new Error('Search failed');
      let data = await res.json();
      if (!data.length && !/punjab|india/i.test(term)) {
        await new Promise(resolve => setTimeout(resolve, 1100));
        res = await fetch(makeUrl(`${term}, Jandiala Guru, Punjab, India`), { headers: { 'Accept-Language': 'en' } });
        if (!res.ok) throw new Error('Search failed');
        data = await res.json();
      }
      const found = data.map(x => ({ lat: Number(x.lat), lng: Number(x.lon), name: x.name || x.display_name.split(',')[0], address: x.display_name }));
      setResults(found);
      if (!found.length) setMessage(`Location “${term}” was not found on the map. Try adding the town or district, or tap the map to pin the destination.`);
      else setMessage(`Found ${found.length} possible result${found.length === 1 ? '' : 's'} for “${term}”. Select the correct one.`);
    } catch {
      setMessage('Map search is temporarily unavailable. Check your internet connection or tap the map to pin a destination.');
    } finally { setSearching(false); }
  };
  const chooseResult = r => { setRouteInfo(null); setRouteError(''); setDestination(r); setQuery(r.name); setResults([]); setMessage('Destination selected. Set your alert and start your journey.'); mapObj.current?.setView([r.lat, r.lng], 15); };
  const fetchRoadRoute = async (origin, target, fitMap = true) => {
    if (routeFetchBusy.current) return null;
    routeFetchBusy.current = true;
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${target.lng},${target.lat}?overview=full&geometries=geojson&steps=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('The routing service could not calculate a route.');
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No drivable route was found between these points.');
      const route = data.routes[0];
      const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const steps = (route.legs || []).flatMap(leg => leg.steps || []).map((step, i) => ({
        id: i + 1,
        instruction: step.maneuver?.type === 'depart' ? `Head ${step.maneuver?.modifier || 'ahead'}` :
          step.maneuver?.type === 'arrive' ? 'You have arrived at your destination' :
          `${step.maneuver?.type === 'roundabout' ? 'Enter the roundabout' : step.maneuver?.type === 'merge' ? 'Merge' : step.maneuver?.type === 'turn' ? 'Turn' : 'Continue'}${step.maneuver?.modifier ? ` ${step.maneuver.modifier}` : ''}${step.name ? ` onto ${step.name}` : ''}`.trim(),
        distance: step.distance || 0,
        location: step.maneuver?.location ? { lng: step.maneuver.location[0], lat: step.maneuver.location[1] } : null,
        type: step.maneuver?.type || 'continue',
        modifier: step.maneuver?.modifier || ''
      }));
      if (routeLine.current) routeLine.current.remove();
      routeLine.current = L.polyline(coords, { color: '#3678e8', weight: 6, opacity: 0.88, lineCap: 'round', lineJoin: 'round' }).addTo(mapObj.current);
      if (fitMap) mapObj.current?.fitBounds(routeLine.current.getBounds(), { padding: [38, 38] });
      const info = { distance: route.distance, duration: route.duration, steps, coords };
      liveRouteRef.current = info;
      setRouteInfo(info);
      setRouteRemainingMeters(route.distance);
      setNextTurnIndex(steps.findIndex(s => s.type !== 'depart') < 0 ? 0 : steps.findIndex(s => s.type !== 'depart'));
      setRerouteStatus(`Route refreshed at ${new Date().toLocaleTimeString()}.`);
      return info;
    } finally {
      routeFetchBusy.current = false;
    }
  };

  const updateLiveRoute = async (p) => {
    if (!liveNavigation || !destination || !p || routeFetchBusy.current) return;
    // Avoid hammering the public demo router: reroute at most every 20 seconds.
    if (Date.now() - lastRerouteAt.current < 20000) {
      const route = liveRouteRef.current;
      if (route?.coords?.length) {
        let nearest = Infinity;
        route.coords.forEach(([lat, lng]) => { nearest = Math.min(nearest, distanceMeters(p, { lat, lng })); });
        // The remaining distance is approximated by distance to the destination if route progress is unclear.
        setRouteRemainingMeters(nearest < 250 ? Math.max(0, distanceMeters(p, destination)) : Math.max(0, distanceMeters(p, destination)));
      }
      return;
    }
    lastRerouteAt.current = Date.now();
    setRerouteStatus('Refreshing route from your latest GPS position…');
    try {
      const info = await fetchRoadRoute(p, destination, false);
      if (info) {
        setRouteRemainingMeters(info.distance);
        if (mapObj.current && userMarker.current) {
          // Keep the user marker and route visible without constantly zooming the map.
          userMarker.current.setLatLng([p.lat, p.lng]);
        }
      }
    } catch {
      setRerouteStatus('Live reroute unavailable right now; continuing with the last route.');
    }
  };

  const seeDirections = async () => {
    if (!destination) { setMessage('Search for or pin a destination first.'); return; }
    if (!position) { setRouteError('First select “Use my location” so we know your starting point.'); setShowDirections(true); return; }
    setRouteLoading(true); setRouteError(''); setShowDirections(true);
    try {
      await fetchRoadRoute(position, destination, true);
      setMessage('Route loaded. Select Start Live Navigation to refresh directions as you move.');
    } catch (err) {
      setRouteError(`${err.message || 'Directions are temporarily unavailable.'} Check your connection or try another destination.`);
      setRouteInfo(null);
    } finally { setRouteLoading(false); }
  };
  const startLiveNavigation = async () => {
    if (!destination) { setMessage('Choose a destination first.'); return; }
    if (!position) { getLocation(true); return; }
    setLiveNavigation(true);
    setShowDirections(true);
    setRerouteStatus('Starting live navigation…');
    lastRerouteAt.current = 0;
    try {
      await fetchRoadRoute(position, destination, true);
      setMessage('Live navigation started. Keep the page open and follow the next-turn card.');
      if (!tracking) beginWatch();
    } catch (err) {
      setRerouteStatus('Could not start live navigation. Check your connection and try again.');
      setMessage(err.message || 'Could not start live navigation.');
    }
  };
  const stopLiveNavigation = () => {
    setLiveNavigation(false);
    setRerouteStatus('Live navigation paused.');
    setMessage('Live navigation stopped. Your journey tracking can continue.');
  };

  const requestSound = async () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { setMessage('This browser does not support the test ringtone.'); return; }
      if (!audioCtx.current) audioCtx.current = new Ctx();
      await audioCtx.current.resume();
      const ctx = audioCtx.current, now = ctx.currentTime;
      const gain = ctx.createGain(); gain.gain.value = Math.max(0.02, (alarmVolume / 100) * 0.16); gain.connect(ctx.destination);
      [880, 1175, 880, 1175].forEach((hz, i) => {
        const osc = ctx.createOscillator(), env = ctx.createGain(), t = now + i * 0.18;
        osc.type = 'sine'; osc.frequency.value = hz;
        env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(0.8, t + 0.02); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        osc.connect(env); env.connect(gain); osc.start(t); osc.stop(t + 0.16);
      });
      setMessage('Test ringtone played. If you cannot hear it, check device volume and browser tab mute.');
    } catch { setMessage('Sound could not play. Check your device volume and browser permissions.'); }
  };

  // Ask for location on first load; the user can deny it and retry with the location button.
  useEffect(() => {
    const timer = window.setTimeout(() => getLocation(false), 700);
    return () => window.clearTimeout(timer);
  }, []);
  const currentDistance = position && destination ? distanceMeters(position, destination) : null;
  // Keep the journey summary consistent with Route Directions whenever an OSRM road route exists.
  // GPS straight-line distance is only a fallback before road directions have loaded.
  const journeyDistance = liveNavigation && routeRemainingMeters != null
    ? routeRemainingMeters
    : routeInfo?.distance ?? currentDistance;
  const progress = journeyDistance == null ? 0 : Math.max(0, Math.min(100, 100 - journeyDistance / Math.max(threshold * 5, journeyDistance + 1) * 100));
  const eta = routeInfo?.duration != null
    ? formatETA(routeInfo.duration)
    : currentDistance == null ? '—' : `${formatETA(currentDistance / Math.max(position?.speed || 2.5, 2.5))} (approx.)`;

  return <div className={dark ? 'app dark' : 'app'}>
    <header className="topbar"><a className="brand" href="#top" aria-label="Waylo AI home"><span>Waylo <span className="brand-light">AI</span><small>TRAVEL SMARTER</small></span></a><div className="top-actions"><span className="privacy-chip"><ShieldCheck size={15}/> Location stays on your device</span><button className="icon-button" onClick={() => setDark(v => !v)} aria-label="Toggle theme">{dark ? <Sun size={19}/> : <Moon size={19}/>}</button></div></header>
    <main id="top" className="layout">
      <section className="intro"><div className="eyebrow"><span className="eyebrow-dot"/> YOUR PERSONAL TRAVEL COMPANION</div><h1>Close your eyes.<br/><em>Not your stop.</em></h1><p>Set your destination before you doze off. We’ll help you wake up before it’s time to get off.</p><div className="intro-points"><span><Check size={15}/> No account needed</span><span><Check size={15}/> Any destination</span><span><Check size={15}/> Free to use</span></div></section>
      <section className="workspace">
        <div className="panel controls-panel">
          <div className="panel-heading"><div><span className="step-label">STEP 01</span><h2>Where are you headed?</h2></div><span className="heading-icon"><Navigation size={20}/></span></div>
          <form className="search-form" onSubmit={searchPlaces}><Search size={19}/><input aria-label="Search destination" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a bus stop, college, place..."/><button type="submit" disabled={searching}>{searching ? <span className="spinner"/> : <ArrowUpRight size={18}/>}</button></form>
          {results.length > 0 && <div className="search-results">{results.map((r,i) => <button key={`${r.lat}-${i}`} onClick={() => chooseResult(r)} className="result-item"><MapPin size={17}/><span><b>{r.name}</b><small>{r.address}</small></span></button>)}</div>}
          <div className="map-wrap"><div className="map-label"><span className="live-dot"/> LIVE MAP <span className="map-hint">Tap map to pin destination</span></div><div ref={mapRef} className="map"/><button className="locate-button" onClick={() => getLocation(false)}><LocateFixed size={16}/> {gpsStatus === 'requesting' ? 'Finding you…' : 'Use my location'}</button></div>
          <button className="directions-button" onClick={seeDirections} disabled={routeLoading || !destination}><Navigation size={17}/>{routeLoading ? 'Finding route…' : 'See directions'}<ArrowUpRight size={16}/></button>
          {showDirections && <div className="directions-panel">
            <div className="directions-heading"><div><span className="step-label">ROUTE DIRECTIONS</span><h3>{routeInfo ? `${(routeInfo.distance / 1000).toFixed(1)} km · ${formatETA(routeInfo.duration)}` : 'From your location to destination'}</h3></div><button className="clear-button" onClick={() => setShowDirections(false)} aria-label="Hide directions"><X size={16}/></button></div>
            {routeError && <p className="directions-error">{routeError}</p>}
            {routeLoading && <p className="tiny-note">Calculating a road route and turn-by-turn steps…</p>}
            {routeInfo && <><div className="route-summary"><span><MapPin size={15}/> Current location</span><span className="route-line-dash"/><span><Navigation size={15}/> {destination?.name}</span></div>
              <div className="live-nav-controls">
                {!liveNavigation ? <button className="start-button" onClick={startLiveNavigation}><Navigation size={17}/> Start live navigation</button> : <button className="secondary-button" onClick={stopLiveNavigation}><Pause size={16}/> Stop live navigation</button>}
                <span className="live-nav-status"><span className={liveNavigation ? 'live-dot active' : 'live-dot'} />{liveNavigation ? 'LIVE' : 'PREVIEW'}</span>
              </div>
              {liveNavigation && <div className="next-turn-card"><span className="step-label">NEXT TURN</span><strong>{routeInfo.steps[nextTurnIndex]?.instruction || 'Continue towards your destination'}</strong><span>{fmtDistance(routeInfo.steps[nextTurnIndex]?.distance || routeRemainingMeters || 0)} · {routeRemainingMeters == null ? 'Updating distance…' : `${fmtDistance(routeRemainingMeters)} remaining (approx.)`}</span><small>{rerouteStatus}</small></div>}
              <ol className="turn-list">{routeInfo.steps.map((step, i)=><li key={step.id} className={liveNavigation && i === nextTurnIndex ? 'current-turn' : ''}><span className="turn-number">{step.id}</span><div><strong>{step.instruction}</strong><small>{fmtDistance(step.distance)}</small></div></li>)}</ol>
              <p className="tiny-note">Road route provided by OSRM using OpenStreetMap data. Live rerouting is throttled to reduce load on the public demo service. Distance remaining is approximate. This browser website may pause GPS/audio when locked; keep the page open while testing.</p></>}
          </div>}
          <div className="selected-destination"><span className="destination-icon"><MapPin size={19}/></span><span className="destination-copy"><small>YOUR DESTINATION</small><strong>{destination?.name || 'No destination selected'}</strong><small>{destination ? `${destination.lat.toFixed(4)}, ${destination.lng.toFixed(4)}` : 'Search above or tap a point on the map'}</small></span>{destination && <button className="clear-button" onClick={() => {setDestination(null);setDistance(null);setRouteInfo(null);setRouteError('');if(routeLine.current){routeLine.current.remove();routeLine.current=null;}setMessage('Choose a destination to get started.');}} aria-label="Clear destination"><X size={17}/></button>}</div>
          <div className="panel-divider"/>
          <div className="panel-heading alarm-heading"><div><span className="step-label">STEP 02</span><h2>When should we wake you?</h2></div><span className="heading-icon lime"><AlarmClock size={20}/></span></div>
          <div className="mode-toggle"><button className={alarmMode === 'distance' ? 'selected' : ''} onClick={() => setAlarmMode('distance')}><MapPin size={16}/> By distance</button><button className={alarmMode === 'time' ? 'selected' : ''} onClick={() => setAlarmMode('time')}><AlarmClock size={16}/> By time</button></div>
          {alarmMode === 'distance' ? <div className="setting-block"><div className="setting-line"><label htmlFor="distance">Alert me this far away</label><strong>{fmtDistance(threshold)}</strong></div><input id="distance" className="range" type="range" min="250" max="3000" step="250" value={threshold} onChange={e => setThreshold(Number(e.target.value))}/><div className="range-labels"><span>250 m</span><span>3 km</span></div></div> : <div className="setting-block"><div className="setting-line"><label htmlFor="minutes">Alert me before arrival</label><strong>{minutesBefore} min</strong></div><input id="minutes" className="range" type="range" min="2" max="15" step="1" value={minutesBefore} onChange={e => setMinutesBefore(Number(e.target.value))}/><div className="range-labels"><span>2 minutes</span><span>15 minutes</span></div><p className="tiny-note">Time is estimated from GPS speed and may be inaccurate in traffic.</p></div>}
          <div className="setting-block volume-setting"><div className="setting-line"><label htmlFor="alarm-volume"><Volume2 size={14} style={{display:'inline',verticalAlign:'middle',marginRight:5}}/> Alarm ringtone volume</label><strong>{alarmVolume}%</strong></div><input id="alarm-volume" className="range" type="range" min="0" max="100" step="5" value={alarmVolume} onChange={e => setAlarmVolume(Number(e.target.value))}/><div className="range-labels"><span>Quiet</span><span>Loud</span></div></div><div className="alarm-options"><button type="button" className={`option-pill ${soundOn ? 'on' : ''}`} onClick={() => setSoundOn(v => !v)}><Volume2 size={16}/> Sound {soundOn ? 'on' : 'off'}</button><button type="button" className="option-pill" onClick={enableNotifications}><BellRing size={16}/> Enable notifications</button><button type="button" className="option-pill" onClick={requestSound}><Play size={14}/> Test ringtone</button></div>
          {tracking ? <button className="start-button stop-button" onClick={endJourney}><Pause size={19}/> End journey</button> : <button className="start-button" onClick={startJourney}><Navigation size={19}/> Start my journey <ArrowUpRight size={19}/></button>}
          <p className="permission-note"><ShieldCheck size={15}/> Your location is used only in this page to calculate distance. It isn’t sent to a Waylo AI server.</p>
        </div>
        <div className="right-column">
          <div className={`journey-card ${tracking ? 'journey-live' : ''}`}><div className="journey-top"><span className="step-label">YOUR JOURNEY</span><span className={`status-pill ${tracking ? 'status-live' : ''}`}><i/>{tracking ? 'TRACKING LIVE' : 'NOT STARTED'}</span></div><div className="journey-main"><div><small>DISTANCE TO DESTINATION</small><div className="big-distance">{journeyDistance == null ? '—' : fmtDistance(journeyDistance)}</div></div><div className="distance-icon"><BusFront size={25}/></div></div><div className="progress-track"><span style={{width: `${currentDistance == null ? 0 : Math.max(3, progress)}%`}}/></div><div className="journey-stats"><div><span><AlarmClock size={15}/> EST. TRAVEL TIME</span><strong>{eta}</strong></div><div><span><Crosshair size={15}/> GPS STATUS</span><strong className={gpsStatus === 'ready' ? 'gps-good' : ''}>{gpsStatus === 'ready' ? 'Connected' : gpsStatus === 'requesting' ? 'Searching…' : gpsStatus === 'error' ? 'Check GPS' : 'Not connected'}</strong></div></div><div className="journey-message"><span className="message-icon"><Sparkles size={16}/></span><span>{message}</span></div></div>
          {alarmActive && <div className="alarm-card"><div className="alarm-rings"><BellRing size={28}/></div><div className="alarm-text"><strong>Your stop is approaching!</strong><span>{destination?.name || 'Your destination'} is near. Get ready to exit.</span></div><div className="alarm-actions"><button className="snooze-button" onClick={snoozeAlarm}>Snooze 2 min</button><button onClick={dismissAlarm}>Stop</button></div></div>}
          {snoozed && !alarmActive && <div className="dismissed-note snoozed-note"><AlarmClock size={16}/> Alarm snoozed for 2 minutes. Keep your journey active.</div>}
          {alarmDismissed && !alarmActive && !snoozed && <div className="dismissed-note"><Check size={16}/> Alarm stopped. Stay alert for your stop.</div>}
          <div className="how-card"><div className="card-title"><div><span className="step-label">SIMPLE BY DESIGN</span><h3>Three steps. Zero missed stops.</h3></div><span className="how-spark"><Sparkles size={20}/></span></div><div className="how-steps"><div className="how-step"><span className="how-number">01</span><div><strong>Pick your stop</strong><p>Search a place or tap it on the map.</p></div></div><div className="how-step"><span className="how-number">02</span><div><strong>Start your journey</strong><p>Allow location access and keep tracking on.</p></div></div><div className="how-step"><span className="how-number">03</span><div><strong>Rest easy</strong><p>Get an alert before you reach your destination.</p></div></div></div></div>
          <div className="notice-card"><span className="notice-icon"><CircleHelp size={19}/></span><div><strong>A quick heads-up</strong><p>For reliable alerts, keep this page open and your screen awake. Mobile browsers can pause GPS and sound when locked or in the background, so don’t rely on this prototype as your only wake-up method yet.</p></div></div>
          <div className="recent-card"><div className="recent-heading"><h3>Recent journeys</h3><span>ON THIS SESSION</span></div>{history.length ? history.map((h,i) => <div className="history-row" key={`${h.time}-${i}`}><span className="history-icon"><MapPin size={16}/></span><span><strong>{h.name}</strong><small>{h.time}</small></span><Check size={16} className="history-check"/></div>) : <div className="empty-history"><span><BusFront size={20}/></span><p>Your recent journeys will appear here once you start travelling.</p></div>}</div>
          <div className="travel-tips-card"><div className="card-title"><div><span className="step-label">TRAVEL SMARTER</span><h3>Small checks, safer trips</h3></div><span className="how-spark"><ShieldCheck size={19}/></span></div><div className="travel-tip-row"><span>01</span><div><strong>Confirm the right place</strong><p>Choose the matching search result before starting navigation.</p></div></div><div className="travel-tip-row"><span>02</span><div><strong>Keep GPS enabled</strong><p>Allow location access and keep this page open during your journey.</p></div></div><div className="travel-tip-row"><span>03</span><div><strong>Test your alert first</strong><p>Check ringtone volume and browser notifications before travelling.</p></div></div></div>
        </div>
      </section>
      <section className="assistant-wide" aria-label="Waylo AI chatbot">
        <div className="panel ai-assistant-panel">
          <div className="panel-heading"><div><h2>Ask Waylo AI</h2></div><span className="heading-icon"><Sparkles size={20}/></span></div>
          <p className="tiny-note">Ask by typing or voice: “Find Amritsar bus stand”, “Alert me 500 metres before college”, or “How far am I?”. Waylo can search real map places; confirm a result before navigation.</p>
          <div className="chat-log" aria-live="polite">{assistantMessages.map((m,i)=><div key={i} className={`chat-bubble ${m.role}`}>{m.text}</div>)}</div>
          <form className="search-form assistant-form" onSubmit={sendAssistantMessage}><Sparkles size={18}/><input aria-label="Ask Waylo AI" value={assistantInput} onChange={e=>setAssistantInput(e.target.value)} placeholder="Ask for a place or travel help…"/><button className={`voice-button ${voiceListening ? 'listening' : ''}`} type="button" onClick={toggleVoiceInput} aria-label={voiceListening ? 'Stop voice input' : 'Speak to Waylo'} title={voiceListening ? 'Stop listening' : 'Speak to Waylo'}><Mic size={18}/></button><button type="submit" aria-label="Send message"><ArrowUpRight size={18}/></button></form><label className="speech-replies"><input type="checkbox" checked={speakReplies} onChange={e=>setSpeakReplies(e.target.checked)}/> Read replies aloud</label>
          {aiAnalysis && <details className="analysis-details" open><summary>AI Analysis</summary><div className="analysis-grid"><span>Intent</span><strong>{aiAnalysis.intent}</strong><span>Destination</span><strong>{aiAnalysis.destination || 'Not detected'}</strong><span>Alert distance</span><strong>{aiAnalysis.alert_distance_m == null ? 'Not detected' : `${aiAnalysis.alert_distance_m} m`}</strong><span>Heuristic confidence</span><strong>{Math.round(aiAnalysis.confidence*100)}% (rule-based score)</strong><span>Tokens</span><strong>{aiAnalysis.tokens.join(' · ') || '—'}</strong></div><p className="tiny-note">This is an explainable rule-based NLP baseline, not a trained machine-learning model. Always confirm the place and any journey-changing action.</p></details>}
        </div>
      </section>
      <section className="ai-lab-wide">
        <div className="panel ai-lab-panel">
          <div className="panel-heading ai-lab-title"><div><span className="step-label">AI LAB</span><h2>Search algorithm visualizer</h2><p className="tiny-note">Explore how BFS and A* find a path through a connected sample stop network.</p></div><span className="heading-icon lime"><Navigation size={20}/></span></div>
          <div className="ai-lab-workspace">
            <div className="ai-lab-map-column">
              <div className="graph-visual" aria-label="Sample stop graph visualization">
                <div className="graph-visual-head"><div><strong>Sample stop network</strong><span className="graph-subtitle">12 connected locations · edge weights in metres</span></div><span className="graph-state">{algorithmResult ? (algorithmResult.found ? 'Path found' : 'No path') : 'Ready to explore'}</span></div>
                <div className="graph-canvas-wrap"><svg viewBox="0 0 700 390" role="img" aria-label="Twelve connected sample stops with weighted edges" preserveAspectRatio="xMidYMid meet">
                  <g className="graph-edges">
                    {Object.entries(SAMPLE_GRAPH).flatMap(([a, neighbors]) => Object.entries(neighbors).filter(([b]) => Object.keys(SAMPLE_GRAPH).indexOf(a) < Object.keys(SAMPLE_GRAPH).indexOf(b)).map(([b,w]) => {
                      const coords = {
                        'Campus':[90,65], 'Library':[245,55], 'Main Gate':[90,170], 'Market':[390,65],
                        'Bus Stop':[285,175], 'Railway Station':[520,175], 'Hospital':[520,285], 'City Park':[390,285],
                        'College Road':[90,285], 'Temple':[245,365], 'Shopping Mall':[520,65], 'Airport':[650,365]
                      };
                      const [x1,y1] = coords[a], [x2,y2] = coords[b];
                      const active = algorithmResult?.found && algorithmResult.path.includes(a) && algorithmResult.path.includes(b) && Math.abs(algorithmResult.path.indexOf(a)-algorithmResult.path.indexOf(b))===1;
                      return <g key={`${a}-${b}`} className={active ? 'edge-active' : ''}><line x1={x1} y1={y1} x2={x2} y2={y2}/><text x={(x1+x2)/2} y={(y1+y2)/2-5}>{w} m</text></g>;
                    }))}
                  </g>
                  {Object.entries({
                    'Campus':[90,65], 'Library':[245,55], 'Main Gate':[90,170], 'Market':[390,65],
                    'Bus Stop':[285,175], 'Railway Station':[520,175], 'Hospital':[520,285], 'City Park':[390,285],
                    'College Road':[90,285], 'Temple':[245,365], 'Shopping Mall':[520,65], 'Airport':[650,365]
                  }).map(([name,[x,y]]) => {
                    const onPath = algorithmResult?.path?.includes(name);
                    const selected = name===graphStart || name===graphGoal;
                    return <g key={name} className={`graph-node ${onPath?'node-path':''} ${selected?'node-selected':''}`}><rect x={x-47} y={y-16} width="94" height="32" rx="9"/><text x={x} y={y+4}>{name}</text></g>;
                  })}
                </svg></div>
                {algorithmResult && <p className="graph-path-caption">{algorithmResult.found ? `Selected path: ${algorithmResult.path.join(' → ')}` : 'No connected route exists between these nodes.'}</p>}
              </div>
              <div className="lab-control-card formulation-card"><span className="step-label">PROBLEM FORMULATION</span><h3>How the search works</h3><ul className="formulation-list"><li><b>Initial state:</b> selected start stop</li><li><b>Goal state:</b> selected destination</li><li><b>Actions:</b> move along a connected edge</li><li><b>Transition:</b> move to an adjacent stop</li><li><b>Path cost:</b> distance in metres</li><li><b>Goal test:</b> current stop equals goal</li></ul></div>
            </div>
            <aside className="ai-lab-controls-column">
              <div className="lab-control-card">
                <span className="step-label">SEARCH SETUP</span><h3>Run BFS or A*</h3>
                <p className="tiny-note">Choose a search method, starting stop and destination, then run the algorithm to highlight its route on the graph.</p>
                <div className="algorithm-controls"><label>Algorithm<select value={algorithm} onChange={e=>{setAlgorithm(e.target.value);setAlgorithmResult(null)}}><option value="astar">A* Search</option><option value="bfs">Breadth-First Search</option></select></label><label>Start<select value={graphStart} onChange={e=>setGraphStart(e.target.value)}>{Object.keys(SAMPLE_GRAPH).map(n=><option key={n}>{n}</option>)}</select></label><label>Goal<select value={graphGoal} onChange={e=>setGraphGoal(e.target.value)}>{Object.keys(SAMPLE_GRAPH).map(n=><option key={n}>{n}</option>)}</select></label></div>
                <button type="button" className="start-button algorithm-run" onClick={runAlgorithm}><Play size={17}/> Run {algorithm === 'bfs' ? 'BFS' : 'A*'}</button>
              </div>
              {algorithmResult && <div className="algorithm-result"><div className="result-stat"><small>RESULT PATH</small><strong>{algorithmResult.found ? algorithmResult.path.join(' → ') : 'No path found'}</strong></div><div className="result-stat"><small>{algorithmResult.algorithm === 'bfs' ? 'TRAVERSAL ORDER' : 'EXPANDED NODES'}</small><strong>{(algorithmResult.order || algorithmResult.expanded).join(' → ') || '—'}</strong></div>{algorithmResult.cost !== undefined && <div className="result-stat"><small>GRAPH COST</small><strong>{Number.isFinite(algorithmResult.cost) ? `${algorithmResult.cost} m` : '—'}</strong></div>}<p className="tiny-note">{algorithmResult.algorithm === 'bfs' ? 'BFS explores level by level using a queue. This demo shows the edge-count route and traversal order.' : 'A* evaluates f(n) = g(n) + h(n). With no geographic coordinates in this sample, h(n) = 0, so it behaves like uniform-cost search.'}</p></div>}
            </aside>
          </div>
        </div>
      </section>
      <footer><a className="footer-brand" href="#top">waylo-ai<span>.</span></a><span>Made for the moments you need a little help waking up.</span><span className="footer-right">Maps © OpenStreetMap contributors</span></footer>
    </main>
  </div>;
}
function escapeHtml(str) { return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

createRoot(document.getElementById('root')).render(<App/>);
