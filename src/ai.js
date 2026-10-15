// Explainable rule-based NLP + graph-search algorithms for the Waylo AI AI demo.
export function normalizeText(input) {
  return String(input || "").toLowerCase().replace(/[’']/g, "'").replace(/[^\w.\s'-]/g, " ").replace(/\s+/g, " ").trim();
}
const numberWords = { one:1, a:1, an:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, half:0.5 };
function extractDistance(text) {
  const t = normalizeText(text);
  const m = t.match(/\b(\d+(?:\.\d+)?|one|a|an|two|three|four|five|six|seven|eight|nine|ten|half)\s*(kilometers?|kilometres?|kms?|km|meters?|metres?|m)\b/);
  if (!m) return null;
  const n = numberWords[m[1]] ?? Number(m[1]);
  const unit = m[2];
  return Math.round(n * (/^(km|kms|kilometer|kilometers|kilometre|kilometres)$/.test(unit) ? 1000 : 1));
}
function extractDestination(raw) {
  const patterns = [
    /\b(?:find|search for|locate|look up)\s+(?:the\s+)?(.+?)$/i,
    /\bbefore\s+(?:reaching\s+)?(?:the\s+)?(.+?)$/i,
    /\b(?:to|at|reaching|reach|towards|for)\s+(?:the\s+)?(.+?)(?:\s+and\s+alert\b|\s+alert me\b|\s+before\b|$)/i,
    /\b(?:destination|stop)\s*(?:is|:)?\s*(.+)$/i
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m?.[1]) {
      const value = m[1].trim().replace(/[?.!,]+$/g, "").replace(/^(the|my)\s+/i, "");
      if (value && !/^(one|two|three|500|1000|1 km|500 m)\b/i.test(value)) return value;
    }
  }
  return null;
}
export function parseTravelIntent(input) {
  const raw = String(input || "").trim();
  const text = normalizeText(raw);
  const distance = extractDistance(text);
  let intent = "UNKNOWN", destination = null, action = null, response = "I’m not sure I understood. Try “take me to Amritsar bus stand” or “alert me 500 metres before college.”";
  if (!text) return { intent, destination, alert_distance_m: distance, confidence: 0.1, response: "Type a travel request to get started.", tokens: [] };
  if (/\b(help|what can you do|examples)\b/.test(text)) {
    intent = "HELP"; response = "I can set a destination, set an alert distance, start/pause/resume/end a journey, and report distance or ETA.";
  } else if (/\b(how far|distance to|distance left|remaining distance)\b/.test(text)) {
    intent = "GET_DISTANCE"; response = "I’ll show the latest distance available from your current journey.";
  } else if (/\b(eta|how long|time left|minutes left|arrival time)\b/.test(text)) {
    intent = "GET_ETA"; response = "I’ll show the current estimated time if location and speed data are available.";
  } else if (/\b(pause|stop tracking)\b/.test(text)) {
    intent = "PAUSE_JOURNEY"; action = "pause"; response = "I understood that you want to pause journey tracking. Confirm using the Pause control.";
  } else if (/\b(resume|continue tracking)\b/.test(text)) {
    intent = "RESUME_JOURNEY"; action = "resume"; response = "I understood that you want to resume journey tracking. Use the Resume control to continue.";
  } else if (/\b(cancel|end|finish)\b/.test(text) && /\b(journey|trip|navigation|tracking|route)\b/.test(text)) {
    intent = "END_JOURNEY"; action = "end"; response = "I understood that you want to end this journey. Confirm with End Journey.";
  } else {
    destination = extractDestination(raw);
    if (distance !== null && destination) {
      intent = "SET_DESTINATION_AND_ALERT";
      response = `I found destination “${destination}” and an alert threshold of ${distance >= 1000 ? `${distance/1000} km` : `${distance} m`}. Please confirm the exact map result before starting.`;
    } else if (distance !== null) {
      intent = "SET_ALERT_DISTANCE"; response = `I understood an alert distance of ${distance >= 1000 ? `${distance/1000} km` : `${distance} m`}. You can apply it with the alert-distance setting.`;
    } else if (destination && /\b(change|switch|instead)\b/.test(text)) {
      intent = "CHANGE_DESTINATION"; response = `I found a possible new destination: “${destination}”. Please select the matching place from search results.`;
    } else if (destination && /\b(start|go|take me|going|get off|destination|bus stand|college|station|temple)\b/.test(text)) {
      intent = "SET_DESTINATION"; response = `I found a possible destination: “${destination}”. Search and confirm the exact location on the map.`;
    } else if (/\b(start|begin)\b/.test(text) && /\b(journey|trip|navigation)\b/.test(text)) {
      intent = "START_JOURNEY"; action = "start"; response = "Ready to start. Select a destination first, then use Start Journey.";
    }
  }
  const confidence = intent === "UNKNOWN" ? 0.25 : (destination && /DESTINATION/.test(intent) ? 0.88 : 0.82);
  return { intent, destination, alert_distance_m: distance, confidence, response, tokens: text.split(" "), action };
}
export const SAMPLE_GRAPH = {
  "Campus": { "Library": 300, "Main Gate": 500, "College Road": 250 },
  "Library": { "Campus": 300, "Market": 450, "City Park": 550 },
  "Main Gate": { "Campus": 500, "Bus Stop": 600, "Temple": 800 },
  "Market": { "Library": 450, "Bus Stop": 350, "Shopping Mall": 400 },
  "Bus Stop": { "Main Gate": 600, "Market": 350, "Railway Station": 1200, "Hospital": 700 },
  "Railway Station": { "Bus Stop": 1200, "Hospital": 650, "Shopping Mall": 900 },
  "Hospital": { "Bus Stop": 700, "Railway Station": 650, "City Park": 500 },
  "City Park": { "Library": 550, "Hospital": 500, "Temple": 600 },
  "College Road": { "Campus": 250, "Temple": 950, "Shopping Mall": 1100 },
  "Temple": { "Main Gate": 800, "City Park": 600, "College Road": 950, "Airport": 2400 },
  "Shopping Mall": { "Market": 400, "Railway Station": 900, "College Road": 1100, "Airport": 3000 },
  "Airport": { "Temple": 2400, "Shopping Mall": 3000 }
};
export function bfs(graph, start, goal) {
  const queue = [start], visited = new Set([start]), parent = {}, order = [];
  while (queue.length) {
    const node = queue.shift(); order.push(node);
    if (node === goal) break;
    for (const next of Object.keys(graph[node] || {})) {
      if (!visited.has(next)) { visited.add(next); parent[next] = node; queue.push(next); }
    }
  }
  const path = [];
  if (visited.has(goal)) { let n = goal; while (n !== undefined) { path.unshift(n); n = parent[n]; } }
  return { order, path, found: path.length > 0 };
}
export function aStar(graph, start, goal) {
  const open = new Set([start]), cameFrom = {}, g = { [start]: 0 }, f = { [start]: heuristic(start, goal) }, expanded = [];
  while (open.size) {
    let current = [...open].sort((a,b) => (f[a] ?? Infinity) - (f[b] ?? Infinity))[0];
    if (current === goal) {
      const path = [current]; while (cameFrom[current] !== undefined) { current = cameFrom[current]; path.unshift(current); }
      return { path, expanded, cost: g[goal], found: true };
    }
    open.delete(current); expanded.push(current);
    for (const [next, cost] of Object.entries(graph[current] || {})) {
      const tentative = g[current] + cost;
      if (tentative < (g[next] ?? Infinity)) {
        cameFrom[next] = current; g[next] = tentative; f[next] = tentative + heuristic(next, goal); open.add(next);
      }
    }
  }
  return { path: [], expanded, cost: Infinity, found: false };
}
function heuristic(a, b) {
  // This small classroom graph has no geographic coordinates, so use a conservative zero heuristic.
  // A* remains correct and reduces to uniform-cost search for this sample graph.
  return 0;
}
