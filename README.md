# Waylo AI — updated website prototype

Waylo AI is a mobile-friendly, location-aware travel alarm website built with React, Vite, Leaflet, and OpenStreetMap.

## Run on Windows

1. Extract the ZIP file.
2. Open the extracted `waylo-ai` folder in VS Code.
3. Open Terminal → New Terminal. Make sure the terminal is inside the folder that contains `package.json`.
4. Run:

   ```bash
   npm install
   npm run dev
   ```

5. Open the local address Vite prints, usually `http://localhost:5173`.

You can also double-click `start-waylo-ai.bat` from the extracted folder.

## AI coursework features included

- Explainable rule-based NLP assistant with text normalization, tokenization, intent classification, and extraction of metre/kilometre distance entities.
- Supported intents include destination selection, alert-distance settings, start/pause/resume/end requests, distance/ETA queries, help, and unknown requests.
- Expandable AI Analysis panel shows intent, extracted destination/distance, tokens, and a heuristic confidence score. The score is not a trained-model probability.
- AI Lab runs Breadth-First Search (BFS) and A* on a built-in sample stop graph without GPS. It displays traversal/expanded nodes, path, graph cost, and problem formulation.
- Modular `src/ai.js` contains NLP parsing and graph algorithms, ready for later extension.

## Features included

- Automatically asks for current-location permission when the page opens; the **Use my location** button lets you retry.
- Search for a bus stop, college, or destination using OpenStreetMap place search.
- Tap the map to pin a destination.
- Live GPS updates and straight-line distance calculation.
- Choose an alert threshold by distance (250 m–3 km) or estimated time (2–15 minutes).
- Repeating synthesized classic twin-bell alarm-clock sound.
- Adjustable in-app alarm volume, sound on/off, and a **Test ringtone** button.
- **Snooze 2 min** and **Stop** controls when the alarm is ringing.
- Browser notifications (optional), dark mode, recent journeys, and responsive mobile layout.
- No account or MongoDB required; location is processed in the browser and is not sent to a Waylo AI backend.

## Share it with classmates

To share a working public link, deploy the project to an HTTPS static host such as Vercel or Netlify. Geolocation generally requires HTTPS (except localhost). The map and place search require internet access. Do not share the `localhost` URL; it only works on your own computer.

## AI implementation notes

The NLP implementation is a transparent rule-based baseline, not a trained machine-learning classifier. Destination extraction is heuristic; always confirm the exact search result. The sample graph is for algorithm demonstration and is not a real road network. Because the sample nodes have no geographic coordinates, A* uses `h(n) = 0`, preserving correctness but making it equivalent to uniform-cost search. BFS finds a minimum-edge path, not necessarily the minimum-distance path on weighted edges.

## Important limitations

This is a website prototype, not a guaranteed safety alarm. Mobile browsers may suspend GPS updates, audio, notifications, or timers when the page is backgrounded or the phone is locked. Keep the page open and the screen awake, and test it on the actual phone before relying on it. The website cannot guarantee an alarm if the browser is closed, the phone is powered off, or the battery is dead. A future native Android app with a foreground location service and Android alarm/notification support is the better option for reliable locked-screen use.

The estimated arrival time is a rough calculation from GPS speed and does not follow the actual road or bus route. Distance is straight-line distance, not route distance. Place search uses the public Nominatim service; it is suitable for light prototype use, not heavy production traffic. The final loudness also depends on the phone's media volume and sound settings.

## Turn-by-turn directions

Choose a destination, press **Use my location**, then select **See directions**. Waylo AI requests a driving route from the public OSRM demo service, draws the route as a blue line on the Leaflet/OpenStreetMap map, and lists maneuver instructions with step distances. The route and estimated duration require an internet connection and may be unavailable due to service limits. This is not Google Maps and does not include live traffic. Refresh directions after your GPS position changes. Keep the website open during a journey; mobile browsers may suspend GPS/audio when locked.


## Live navigation (website prototype)

- Select a destination and use **See directions** to preview a road route.
- Choose **Start live navigation** to start location tracking and refresh the route from updated GPS positions (rate-limited to about once every 20 seconds).
- The next-turn card highlights a current instruction; the distance display is approximate in this prototype.
- The distance alert uses the route/destination distance estimate while live navigation is active.
- Uses the public OSRM demo routing endpoint and OpenStreetMap tiles; service limits and availability apply.
- Keep the page open while testing. Mobile browsers may suspend GPS and audio while locked, so this website cannot guarantee background navigation or alarms.
