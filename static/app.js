    let allServices = [];
    let filteredServices = [];
    let map, markers, currentTileLayer, mapStyle = 'satellite';
    let boundaryLayer = null, boundariesVisible = false;
    let highlightMarker = null;
    let userLocation = null;
    let userLocationMarker = null;
    let selectedServiceId = null;
    let mapBoundsFilter = null;
    let urlHydrated = false;
    let suppressUrlUpdate = false;
    let hydratedSelectedShown = false;
    let placeSearch = null;
    let prevFilterKey = '';

    // Haversine distance in metres between two lat/lng points.
    function distanceMetres(lat1, lng1, lat2, lng2) {
      const R = 6371000;
      const toRad = x => x * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a = Math.sin(dLat/2) ** 2 +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }

    function formatDistance(m) {
      if (!isFinite(m)) return '';
      if (m < 950) return Math.round(m / 10) * 10 + ' m';
      const km = m / 1000;
      if (km < 10) return km.toFixed(1) + ' km';
      if (km < 100) return Math.round(km) + ' km';
      if (km < 1000) return Math.round(km / 10) * 10 + ' km';
      return Math.round(km / 100) * 100 + ' km';
    }

    function userLocationIcon() {
      return L.divIcon({
        className: '',
        html: `<div class="user-loc-marker"><div class="user-loc-marker-ring"></div><div class="user-loc-marker-dot"></div></div>`,
        iconSize: [18, 18], iconAnchor: [9, 9]
      });
    }

    function requestUserLocation() {
      const btn = document.getElementById('near-me-btn');
      const label = document.getElementById('near-me-label');
      const err = document.getElementById('near-me-error');
      err.style.display = 'none';

      if (!navigator.geolocation) {
        err.textContent = 'Location is not supported by your browser.';
        err.style.display = 'block';
        return;
      }

      btn.classList.add('loading');
      label.innerHTML = '&#x1F4CD; Finding you…';

      navigator.geolocation.getCurrentPosition(
        pos => setUserLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        error => {
          btn.classList.remove('loading');
          label.innerHTML = '&#x1F4CD; Near me';
          let msg = 'Could not get your location.';
          if (error.code === error.PERMISSION_DENIED) {
            msg = 'Location permission denied. Enable it in your browser and try again.';
          } else if (error.code === error.TIMEOUT) {
            msg = 'Location request timed out. Try again.';
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            msg = 'Location is unavailable right now.';
          }
          err.className = 'near-me-error';
          err.textContent = msg;
          err.style.display = 'block';
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
      );
    }

    function setUserLocation(lat, lng, accuracy) {
      userLocation = { lat, lng, accuracy };
      const btn = document.getElementById('near-me-btn');
      const label = document.getElementById('near-me-label');
      const err = document.getElementById('near-me-error');
      btn.classList.remove('loading');
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      label.innerHTML = '&#x1F4CD; Near your location';
      placeSearch = null;
      document.getElementById('filter-place').value = '';
      document.getElementById('place-error').style.display = 'none';

      // Clear state/suburb so the distance sort isn't silently constrained
      // by a default state choice (e.g. NSW) when the user is elsewhere.
      document.getElementById('filter-state').value = '';
      document.getElementById('filter-suburb').value = '';
      buildSuburbFilter();

      // Warn when accuracy is poor (typically IP-based fallback). Browsers
      // return accuracy as a 95%-confidence radius in metres; >2 km means
      // the pin is not where the user actually is.
      if (accuracy && accuracy > 2000) {
        const km = accuracy >= 10000 ? Math.round(accuracy/1000) : (accuracy/1000).toFixed(1);
        err.className = 'near-me-error warn';
        err.textContent = `Your location is approximate (±${km} km). For precise results, enable precise location in your browser or use a phone with GPS.`;
        err.style.display = 'block';
      } else {
        err.style.display = 'none';
      }

      if (userLocationMarker) { map.removeLayer(userLocationMarker); }
      const layer = L.layerGroup();
      // Faint circle shows the accuracy radius so users can see how uncertain
      // the fix is — a 5 km circle around a pin is far more honest than a dot.
      if (accuracy && accuracy > 50) {
        L.circle([lat, lng], {
          radius: accuracy,
          color: '#0969da',
          weight: 1,
          opacity: 0.35,
          fillColor: '#0969da',
          fillOpacity: 0.08,
          interactive: false
        }).addTo(layer);
      }
      L.marker([lat, lng], { icon: userLocationIcon(), zIndexOffset: 2000, interactive: false }).addTo(layer);
      layer.addTo(map);
      userLocationMarker = layer;

      const zoom = accuracy > 5000 ? 9 : accuracy > 1000 ? 11 : 13;
      map.setView([lat, lng], zoom);

      applyFilters();
    }

    function clearUserLocation() {
      userLocation = null;
      const btn = document.getElementById('near-me-btn');
      btn.classList.remove('active', 'loading');
      btn.setAttribute('aria-pressed', 'false');
      document.getElementById('near-me-label').innerHTML = '&#x1F4CD; Near me';
      document.getElementById('near-me-error').style.display = 'none';
      if (userLocationMarker) { map.removeLayer(userLocationMarker); userLocationMarker = null; }
      applyFilters();
    }

    function highlightIcon() {
      return L.divIcon({
        className: '',
        html: `<div class="marker-highlight"><div class="marker-highlight-ring"></div><div class="marker-highlight-dot"></div></div>`,
        iconSize: [20, 20], iconAnchor: [10, 10]
      });
    }

    function setHighlight(lat, lng) {
      if (highlightMarker) { map.removeLayer(highlightMarker); }
      highlightMarker = L.marker([lat, lng], { icon: highlightIcon(), zIndexOffset: 1000, interactive: false });
      highlightMarker.addTo(map);
    }

    function clearHighlight() {
      if (highlightMarker) { map.removeLayer(highlightMarker); highlightMarker = null; }
    }

    const CAT = {
      food:'Food Relief', housing:'Housing', health:'Health', mental_health:'Mental Health',
      legal:'Legal', employment:'Employment', education:'Education', disability:'Disability',
      family:'Family', community:'Community', financial:'Financial', alcohol_drugs:'Alcohol & Drugs',
      information:'Information', transport:'Transport', personal_care:'Personal Care',
      technology:'Technology', other:'Other'
    };

    // Source data vintage, keyed by source_id. A value is set only when the
    // publication date can be cited from the source URL or filename. Live-API
    // and undated-static sources are intentionally absent — silence is more
    // honest than a guess. Format: { label: display string, year: integer }.
    const SOURCE_VINTAGE = {
      fed_emergency_relief:     { label: 'Oct 2016', year: 2016 },
      fed_employment_services:  { label: 'May 2016', year: 2016 },
      sa_community_directory:   { label: '2021',     year: 2021 },
      qld_breastscreen:         { label: 'Jul 2023', year: 2023 },
      sa_child_family_health:   { label: '2015',     year: 2015 },
      vic_neighbourhood_houses: { label: 'May 2013', year: 2013 },
    };

    function ageYears(year) {
      return new Date().getFullYear() - year;
    }

    function sourceAgeYears(s) {
      const vintage = SOURCE_VINTAGE[s.source_id];
      return vintage ? ageYears(vintage.year) : null;
    }

    function vintageClass(year) {
      const age = ageYears(year);
      if (age >= 5) return 'v-stale';
      if (age >= 2) return 'v-old';
      return 'v-recent';
    }

    const CAT_COLOR = {
      food:'#16a34a', housing:'#d97706', health:'#2563eb', mental_health:'#7c3aed',
      legal:'#ea580c', employment:'#059669', education:'#0891b2', disability:'#c026d3',
      family:'#dc2626', community:'#15803d', financial:'#ca8a04', alcohol_drugs:'#e11d48',
      information:'#1d4ed8', transport:'#64748b', personal_care:'#7c3aed',
      technology:'#4f46e5', other:'#6b7280'
    };

    function markerIcon(cat, precision) {
      const c = CAT_COLOR[cat] || '#64748b';
      if (precision === 'postcode') {
        return L.divIcon({
          className: 'svc-marker',
          html: `<div class="marker-dot marker-approx" style="border-color:${c};"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7]
        });
      }
      return L.divIcon({
        className: 'svc-marker',
        html: `<div class="marker-dot" style="background:${c};"></div>`,
        iconSize: [10, 10], iconAnchor: [5, 5]
      });
    }

    function initMap() {
      map = L.map('map', { zoomSnap: 0.5 }).setView([-28, 134], 5);
      const tileLayers = {
        light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
          maxZoom: 19
        }),
        satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: '&copy; <a href="https://www.esri.com/">Esri</a> &copy; Maxar, Earthstar',
          maxZoom: 19
        })
      };
      currentTileLayer = tileLayers.satellite;
      currentTileLayer.addTo(map);

      const styleBtn = document.getElementById('map-style-toggle');
      styleBtn.textContent = 'Map';
      styleBtn.classList.add('active');
      document.getElementById('map-style-toggle').addEventListener('click', () => {
        map.removeLayer(currentTileLayer);
        mapStyle = mapStyle === 'light' ? 'satellite' : 'light';
        currentTileLayer = tileLayers[mapStyle];
        currentTileLayer.addTo(map);
        styleBtn.textContent = mapStyle === 'light' ? 'Satellite' : 'Map';
        styleBtn.classList.toggle('active', mapStyle === 'satellite');
      });

      fetch('/static/vendor/au-states.json').then(r => r.json()).then(geojson => {
        boundaryLayer = L.geoJSON(geojson, {
          style: { color: '#0969da', weight: 1.5, opacity: 0.5, fillColor: '#0969da', fillOpacity: 0.03, dashArray: '6 4' },
          onEachFeature(feature, layer) {
            layer.bindTooltip(feature.properties.state, { permanent: false, direction: 'center', className: 'boundary-label' });
          }
        });
        boundaryLayer.addTo(map);
        boundariesVisible = true;
        document.getElementById('map-boundaries-toggle').classList.add('active');
      });
      document.getElementById('map-boundaries-toggle').addEventListener('click', () => {
        if (!boundaryLayer) return;
        boundariesVisible = !boundariesVisible;
        if (boundariesVisible) {
          boundaryLayer.addTo(map);
        } else {
          map.removeLayer(boundaryLayer);
        }
        document.getElementById('map-boundaries-toggle').classList.toggle('active', boundariesVisible);
      });

      markers = L.markerClusterGroup({
        maxClusterRadius: 45,
        showCoverageOnHover: false,
        iconCreateFunction(cluster) {
          const n = cluster.getChildCount();
          const sz = n > 100 ? 44 : n > 10 ? 36 : 30;
          const children = cluster.getAllChildMarkers();
          const counts = {};
          children.forEach(m => { const c = m._svcCat || 'other'; counts[c] = (counts[c] || 0) + 1; });
          const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
          const r = sz / 2, ir = r - 5;
          let svg = `<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" xmlns="http://www.w3.org/2000/svg">`;
          if (entries.length === 1) {
            svg += `<circle cx="${r}" cy="${r}" r="${r}" fill="${CAT_COLOR[entries[0][0]] || '#64748b'}" opacity="0.75"/>`;
          } else {
            let angle = -Math.PI / 2;
            entries.forEach(([cat, count]) => {
              const slice = (count / n) * 2 * Math.PI;
              const x1 = r + r * Math.cos(angle), y1 = r + r * Math.sin(angle);
              const x2 = r + r * Math.cos(angle + slice), y2 = r + r * Math.sin(angle + slice);
              const large = slice > Math.PI ? 1 : 0;
              svg += `<path d="M${r},${r} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${CAT_COLOR[cat] || '#64748b'}" opacity="0.75"/>`;
              angle += slice;
            });
          }
          svg += `<circle cx="${r}" cy="${r}" r="${ir}" fill="#fff"/>`;
          svg += `<text x="${r}" y="${r}" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="600" font-family="Inter,sans-serif" fill="#334155">${n}</text>`;
          svg += `</svg>`;
          return L.divIcon({ html: svg, className: 'cluster-pie', iconSize: [sz, sz] });
        }
      });
      map.addLayer(markers);
      markers.on('clustermouseover', function(e) {
        const cluster = e.layer;
        if (cluster._tipBound) return;
        cluster._tipBound = true;
        const children = cluster.getAllChildMarkers();
        const counts = {};
        children.forEach(m => { const c = m._svcCat || 'other'; counts[c] = (counts[c] || 0) + 1; });
        const top3 = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const lines = top3.map(([cat, n]) => `${CAT[cat] || 'Other'}: ${n}`);
        cluster.bindTooltip(lines.join('<br>'), { direction: 'top', offset: [0, -10], className: 'cluster-tooltip' }).openTooltip();
      });
      map.on('moveend', () => {
        if (!mapBoundsFilter && urlHydrated) {
          document.querySelector('.map-search').classList.add('visible');
        }
      });
    }

    let isStreaming = false;

    function updateStats() {
      document.getElementById('total-count').textContent = allServices.length.toLocaleString();
      document.getElementById('state-count').textContent = new Set(allServices.map(s=>s.state).filter(Boolean)).size;
      const dates = allServices.map(s=>s.source_date).filter(Boolean).sort().reverse();
      if (dates.length) {
        const d = new Date(dates[0] + 'T00:00:00');
        const days = Math.floor((Date.now() - d.getTime()) / 86400000);
        let label;
        if (days <= 0) label = 'today';
        else if (days === 1) label = 'yesterday';
        else if (days < 30) label = days + ' days ago';
        else label = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
        const el = document.getElementById('last-updated');
        el.textContent = label;
        const fullDate = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
        el.title = `Pipeline last refreshed on ${fullDate}. This is the rebuild date — individual sources may be older; each record shows its own vintage.`;
      }
    }

    function showStreamBar(count, pct) {
      const bar = document.getElementById('stream-bar');
      bar.classList.add('visible');
      document.getElementById('stream-bar-fill').style.width = pct + '%';
      document.getElementById('stream-bar-text').innerHTML = `<span class="stream-dot"></span>Loading more services... ${count.toLocaleString()} loaded (${pct}%)`;
    }

    function hideStreamBar() {
      const bar = document.getElementById('stream-bar');
      document.getElementById('stream-bar-fill').style.width = '100%';
      document.getElementById('stream-bar-text').innerHTML = `All ${allServices.length.toLocaleString()} services loaded`;
      setTimeout(() => { bar.classList.remove('visible'); }, 2000);
    }

    async function loadData() {
      try {
        const estimated = 24500;
        let url = '/services/services.json?_size=1000&_shape=objects';
        let firstBatch = true;

        while (url) {
          const resp = await fetch(url);
          const json = await resp.json();
          const newRows = json.rows || [];
          allServices.push(...newRows);

          const pct = Math.min(100, Math.round((allServices.length / estimated) * 100));

          if (firstBatch) {
            document.getElementById('loading').style.display = 'none';
            buildCatFilter();
            buildSuburbFilter();
            hydrateFromUrl();
            updateStats();
            applyFilters();
            showNearbyPrompt();
            firstBatch = false;
            isStreaming = true;

            if (json.next_url) {
              showStreamBar(allServices.length, pct);
            }
          } else {
            showStreamBar(allServices.length, pct);
            document.getElementById('results-count').textContent = allServices.length.toLocaleString() + ' results';
            addMarkersForServices(newRows);
          }

          url = json.next_url || null;
        }

        isStreaming = false;
        updateStats();
        rebuildFilters();
        if (document.getElementById('filter-place').value.trim()) {
          updatePlaceSearch();
        } else {
          applyFilters();
        }
        hideStreamBar();
      } catch(e) {
        console.error(e);
        if (!allServices.length) {
          document.getElementById('loading').innerHTML = '<div class="skeleton-map" style="width:100%"><div class="skeleton-map-label" style="color:#dc2626;border-color:#fecaca">Failed to load data — please try refreshing the page</div></div>';
        } else {
          isStreaming = false;
          hideStreamBar();
        }
      }
    }

    function rebuildFilters() {
      // Rebuild category dropdown (preserving selection)
      const catSel = document.getElementById('filter-category');
      const prevCat = catSel.value;
      catSel.innerHTML = '<option value="">All categories</option>';
      const counts = {};
      allServices.forEach(s => { counts[s.category] = (counts[s.category]||0)+1; });
      Object.keys(CAT).forEach(k => {
        if (!counts[k]) return;
        const o = document.createElement('option');
        o.value = k;
        o.textContent = `${CAT[k]} (${counts[k].toLocaleString()})`;
        catSel.appendChild(o);
      });
      if (prevCat) catSel.value = prevCat;
      buildCatChips(counts);
      // Re-activate chips
      document.querySelectorAll('.cat-chip').forEach(chip => {
        if (activeChips.has(chip.dataset.cat)) chip.classList.add('active');
      });
      buildSuburbFilter();
    }

    let activeChips = new Set();

    function buildCatFilter() {
      const sel = document.getElementById('filter-category');
      const counts = {};
      allServices.forEach(s => { counts[s.category] = (counts[s.category]||0)+1; });
      Object.keys(CAT).forEach(k => {
        if (!counts[k]) return;
        const o = document.createElement('option');
        o.value = k;
        o.textContent = `${CAT[k]} (${counts[k].toLocaleString()})`;
        sel.appendChild(o);
      });
      buildCatChips(counts);
    }

    function buildCatChips(counts) {
      const container = document.getElementById('cat-chips');
      container.innerHTML = '';
      Object.keys(CAT).forEach(k => {
        if (!counts[k]) return;
        const chip = document.createElement('div');
        chip.className = 'cat-chip';
        chip.dataset.cat = k;
        chip.innerHTML = `<span class="chip-dot" style="background:${CAT_COLOR[k]}"></span>${CAT[k]} <span class="chip-count">${counts[k].toLocaleString()}</span>`;
        chip.addEventListener('click', () => toggleChip(k, chip));
        container.appendChild(chip);
      });
    }

    function toggleChip(cat, chip) {
      if (activeChips.has(cat)) {
        activeChips.delete(cat);
        chip.classList.remove('active');
      } else {
        activeChips.add(cat);
        chip.classList.add('active');
      }
      // Sync dropdown
      if (activeChips.size === 1) {
        document.getElementById('filter-category').value = [...activeChips][0];
      } else {
        document.getElementById('filter-category').value = '';
      }
      applyFilters();
    }

    function isOsm(s) {
      return s.source_name && s.source_name.toLowerCase().includes('openstreetmap') ||
             s.source_id && s.source_id.toLowerCase().includes('osm');
    }

    function qualityClass(q) {
      if (q === 'complete') return 'q-complete';
      if (q === 'partial') return 'q-partial';
      return 'q-minimal';
    }

    function qualityLabel(q) {
      if (q === 'complete') return 'Complete';
      if (q === 'partial') return 'Partial';
      return 'Minimal';
    }

    function readiness(s) {
      const hasContact = !!(s.phone || s.website || s.email);
      const hasLocation = !!(s.address || (s.latitude && s.longitude));
      const age = sourceAgeYears(s);
      if (s.quality === 'complete' && hasContact && hasLocation &&
          s.location_precision !== 'none' && (age == null || age < 5)) {
        return { key: 'ready', label: 'Ready' };
      }
      if (!hasContact || !hasLocation || s.quality === 'minimal' || age >= 10) {
        return { key: 'low', label: 'Low confidence' };
      }
      return { key: 'verify', label: 'Verify' };
    }

    function readinessRank(s) {
      const r = readiness(s).key;
      if (r === 'ready') return 0;
      if (r === 'verify') return 1;
      return 2;
    }

    function addMarkersForServices(services) {
      const batch = [];
      services.forEach(s => {
        if (s.latitude && s.longitude) {
          const m = L.marker([s.latitude, s.longitude], { icon: markerIcon(s.category, s.location_precision) });
          const tipLabel = [s.name, s.suburb].filter(Boolean).join(', ');
          if (tipLabel) m.bindTooltip(tipLabel, { direction: 'top', offset: [0, -6], className: 'svc-tooltip' });
          m.on('click', () => {
            setHighlight(s.latitude, s.longitude);
            selectService(s, false);
          });
          m._svcCat = s.category;
          batch.push(m);
        }
      });
      if (batch.length) markers.addLayers(batch);
    }

    function renderServices(services) {
      markers.clearLayers();
      const list = document.getElementById('results-list');
      list.innerHTML = '';
      document.getElementById('results-count').textContent = services.length.toLocaleString() + ' results';

      if (!services.length) {
        list.innerHTML = '<div class="no-results">No services match your filters</div>';
        return;
      }

      addMarkersForServices(services);

      const query = document.getElementById('search').value.trim();
      const limit = 400;
      const frag = document.createDocumentFragment();
      services.slice(0, limit).forEach(s => {
        const d = document.createElement('div');
        d.className = 'service-card' + (selectedServiceId && s.id === selectedServiceId ? ' active' : '');
        d.setAttribute('role', 'listitem');
        d.setAttribute('tabindex', '0');
        d.dataset.serviceId = s.id || '';
        const loc = [s.suburb, s.state].filter(Boolean).join(', ');
        const srcClass = isOsm(s) ? 'src-osm' : 'src-gov';
        const srcLabel = isOsm(s) ? 'OSM' : 'GOV';
        const qClass = qualityClass(s.quality);
        const ready = readiness(s);
        const approxBadge = s.location_precision === 'postcode'
          ? `<span class="svc-approx" title="Pin shows postcode centroid, not the exact address">~approx</span>`
          : '';
        const distBadge = ((userLocation || placeSearch) && isFinite(s._distance))
          ? `<span class="svc-distance" title="Distance from your location">${formatDistance(s._distance)}</span>`
          : '';
        const vintage = SOURCE_VINTAGE[s.source_id];
        const vintageBadge = vintage
          ? `<span class="svc-vintage ${vintageClass(vintage.year)}" title="Source data published ${vintage.label} (${ageYears(vintage.year)} years ago). Verify before referring.">${vintage.label}</span>`
          : '';
        const ageClass = vintage && ageYears(vintage.year) >= 5 ? 'bad' : vintage && ageYears(vintage.year) >= 2 ? 'warn' : '';
        const locationClass = s.location_precision === 'postcode' ? 'warn' : s.location_precision === 'none' ? 'bad' : '';
        const phoneAction = s.phone ? `<a class="svc-action" href="tel:${s.phone}" title="Call ${esc(s.name)}" onclick="event.stopPropagation()">Call</a>` : '';
        const webAction = s.website ? `<a class="svc-action" href="${s.website}" target="_blank" rel="noopener" title="Open website" onclick="event.stopPropagation()">Web</a>` : '';
        const reportAction = `<a class="svc-action" href="${reportIssueUrl(s)}" target="_blank" rel="noopener" title="Report an issue" onclick="event.stopPropagation()">!</a>`;
        const descHtml = descSnippet(s.description, query);
        const descLine = descHtml ? `<div class="svc-desc">${descHtml}</div>` : '';
        d.innerHTML = `
          <div class="svc-head">
            <div class="svc-name">${esc(s.name||'Unnamed')}</div>
            <div class="svc-actions">${phoneAction}${webAction}${reportAction}</div>
          </div>
          ${descLine}
          <div class="svc-row">
            <span class="svc-tag t-${s.category||'other'}">${CAT[s.category]||'Other'}</span>
            <span class="svc-ready ready-${ready.key}" title="Referral readiness">${ready.label}</span>
            <span class="svc-source ${srcClass}">${srcLabel}</span>
            ${vintageBadge}
            ${approxBadge}
            <span class="svc-quality ${qClass}" title="${qualityLabel(s.quality)}"></span>
            <span class="svc-meta">${esc(loc)}</span>
            ${distBadge}
          </div>
          <div class="svc-confidence">
            <span class="confidence-pill"><span class="confidence-label">Record</span><span class="confidence-value">${qualityLabel(s.quality)}</span></span>
            <span class="confidence-pill ${locationClass}"><span class="confidence-label">Location</span><span class="confidence-value">${locationLabel(s)}</span></span>
            <span class="confidence-pill ${ageClass}"><span class="confidence-label">Source</span><span class="confidence-value">${serviceAgeLabel(s)}</span></span>
          </div>
        `;
        d.onclick = () => { selectService(s); };
        d.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectService(s); } };
        frag.appendChild(d);
      });
      list.appendChild(frag);
      if (services.length > limit) {
        const m = document.createElement('div');
        m.className = 'no-results';
        m.textContent = `Showing ${limit} of ${services.length.toLocaleString()}`;
        list.appendChild(m);
      }
    }

    function showDetail(s) {
      const p = document.getElementById('detail-panel');
      const c = document.getElementById('detail-content');
      const addr = [s.address, s.suburb, s.state, s.postcode].filter(Boolean).join(', ');
      const directions = directionsUrl(s, addr);

      const srcClass = isOsm(s) ? 'src-osm' : 'src-gov';
      const srcLabel = isOsm(s) ? 'OpenStreetMap' : 'Government';
      const qClass = qualityClass(s.quality);
      const qLabel = qualityLabel(s.quality);
      const ready = readiness(s);

      const vintage = SOURCE_VINTAGE[s.source_id];

      let h = `<div class="detail-name">${esc(s.name||'Unnamed')}</div>`;
      h += `<div class="detail-badges">`;
      h += `<span class="svc-tag t-${s.category||'other'}">${CAT[s.category]||'Other'}</span>`;
      h += `<span class="svc-ready ready-${ready.key}">${ready.label}</span>`;
      h += `<span class="svc-source ${srcClass}">${srcLabel}</span>`;
      if (vintage) {
        h += `<span class="svc-vintage ${vintageClass(vintage.year)}">${vintage.label}</span>`;
      }
      h += `<span class="detail-quality"><span class="svc-quality ${qClass}"></span>${qLabel}</span>`;
      if (s.location_precision === 'postcode') {
        h += `<span class="svc-approx" title="Pin shows postcode centroid, not the exact address">~approx</span>`;
      }
      h += `</div>`;
      if (s.location_precision === 'postcode') {
        h += `<div class="detail-approx-note">Approximate location — the pin is the postcode centroid, not a verified street address. Use the address above for directions.</div>`;
      }
      if (vintage && ageYears(vintage.year) >= 5) {
        h += `<div class="detail-vintage-note">Source data is ${ageYears(vintage.year)} years old (${vintage.label}). Phone numbers, addresses and opening hours may no longer be correct — verify before referring someone.</div>`;
      }
      if (s.description) {
        const q = document.getElementById('search').value.trim();
        h += `<div class="detail-desc">${highlightAll(s.description, q)}</div>`;
      }
      h += '<div class="detail-actions">';
      if (s.phone) h += `<a class="detail-action" href="tel:${s.phone}">Call</a>`;
      if (s.website) h += `<a class="detail-action" href="${s.website}" target="_blank" rel="noopener">Website</a>`;
      if (directions) h += `<a class="detail-action" href="${directions}" target="_blank" rel="noopener">Directions</a>`;
      h += `<button class="detail-action" type="button" onclick="navigator.clipboard && navigator.clipboard.writeText(location.href)">Copy link</button>`;
      h += `<a class="detail-action" href="${reportIssueUrl(s)}" target="_blank" rel="noopener">Report issue</a>`;
      h += '</div>';
      h += section('Contact', [
        s.phone && r('Phone', `<a href="tel:${s.phone}">${esc(s.phone)}</a>`),
        s.email && r('Email', `<a href="mailto:${s.email}">${esc(s.email)}</a>`),
        s.website && r('Web', `<a href="${s.website}" target="_blank" rel="noopener">${esc(host(s.website))}</a>`),
      ]);
      h += section('Location', [
        addr && r('Address', esc(addr)),
        r('Precision', esc(locationLabel(s))),
        ((userLocation || placeSearch) && isFinite(s._distance)) && r('Distance', esc(formatDistance(s._distance))),
      ]);
      h += section('Referral Info', [
        r('Readiness', esc(ready.label)),
        r('Record quality', esc(qLabel)),
        s.hours && r('Hours', esc(s.hours)),
        s.eligibility && r('Eligibility', esc(s.eligibility)),
        s.cost && r('Cost', esc(s.cost)),
      ]);
      h += section('Source / Trust', [
        s.source_organisation && r('Source', esc(s.source_organisation)),
        s.source_name && r('Dataset', esc(s.source_name)),
        s.source_url && r('Source URL', `<a href="${s.source_url}" target="_blank" rel="noopener">${esc(host(s.source_url))}</a>`),
        s.source_date && r('Pipeline refresh', esc(s.source_date)),
        vintage && r('Source vintage', `${vintage.label} <span class="vintage-age">(${ageYears(vintage.year)} years ago)</span>`),
      ]);
      c.innerHTML = h;
      p.classList.add('visible');
    }

    function r(l,v){return `<span class="dl">${l}</span><span class="dv">${v}</span>`;}
    function section(title, rows) {
      const body = rows.filter(Boolean).join('');
      if (!body) return '';
      return `<div class="detail-section"><div class="detail-section-title">${title}</div><div class="detail-grid">${body}</div></div>`;
    }
    function host(u){try{return new URL(u).hostname}catch{return u}}
    function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
    function escapeRegex(s){return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');}
    function serviceAgeLabel(s) {
      const vintage = SOURCE_VINTAGE[s.source_id];
      return vintage ? `${ageYears(vintage.year)}y old` : 'source date unknown';
    }
    function locationLabel(s) {
      if (s.location_precision === 'address') return 'exact pin';
      if (s.location_precision === 'postcode') return 'postcode pin';
      return 'no pin';
    }
    function reportIssueUrl(s) {
      const title = `Data issue: ${s.name || s.id || 'service record'}`;
      const lines = [
        `Service ID: ${s.id || ''}`,
        `Name: ${s.name || ''}`,
        `Source: ${s.source_name || ''}`,
        `Source organisation: ${s.source_organisation || ''}`,
        `Source URL: ${s.source_url || ''}`,
        '',
        'What needs correcting?',
        ''
      ];
      return 'https://github.com/oa-sa/data/issues/new?title=' +
        encodeURIComponent(title) + '&body=' + encodeURIComponent(lines.join('\n'));
    }
    function directionsUrl(s, addr) {
      const target = addr || (s.latitude && s.longitude ? `${s.latitude},${s.longitude}` : '');
      return target ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}` : '';
    }
    function resolvePlace(query) {
      const q = query.trim().toLowerCase();
      if (!q) return null;
      const exactPostcode = q.match(/^\d{4}$/);
      const hits = allServices.filter(s => {
        if (!s.latitude || !s.longitude || !isFinite(Number(s.latitude)) || !isFinite(Number(s.longitude))) return false;
        if (exactPostcode) return String(s.postcode || '').trim() === q;
        return String(s.suburb || '').toLowerCase() === q;
      });
      if (!hits.length) return null;
      const lat = hits.reduce((sum, s) => sum + Number(s.latitude), 0) / hits.length;
      const lng = hits.reduce((sum, s) => sum + Number(s.longitude), 0) / hits.length;
      return {
        lat, lng,
        label: exactPostcode ? q : hits[0].suburb,
        count: hits.length
      };
    }
    function updatePlaceSearch() {
      const input = document.getElementById('filter-place');
      const radius = Number(document.getElementById('filter-radius').value) || 10;
      const err = document.getElementById('place-error');
      const value = input.value.trim();
      err.style.display = 'none';
      placeSearch = null;
      if (!value) {
        applyFilters();
        return;
      }
      const place = resolvePlace(value);
      if (!place) {
        err.textContent = 'No matching postcode or suburb in the loaded data.';
        err.style.display = 'block';
        applyFilters();
        return;
      }
      placeSearch = { ...place, radiusKm: radius };
      userLocation = null;
      document.getElementById('near-me-btn').classList.remove('active', 'loading');
      document.getElementById('near-me-btn').setAttribute('aria-pressed', 'false');
      document.getElementById('near-me-label').innerHTML = '&#x1F4CD; Near me';
      if (userLocationMarker) { map.removeLayer(userLocationMarker); userLocationMarker = null; }
      map.setView([place.lat, place.lng], radius <= 5 ? 13 : radius <= 10 ? 12 : 10);
      applyFilters();
    }
    function setMapAreaFilter(active) {
      mapBoundsFilter = active ? map.getBounds() : null;
      document.querySelector('.map-search').classList.toggle('visible', !!active);
      document.getElementById('search-map-area').classList.toggle('active', !!active);
      document.getElementById('clear-map-area').classList.toggle('visible', !!active);
      applyFilters();
    }
    function updateUrl() {
      if (suppressUrlUpdate || !urlHydrated) return;
      const params = new URLSearchParams();
      const q = document.getElementById('search').value.trim();
      const st = document.getElementById('filter-state').value;
      const cat = activeChips.size === 1 ? [...activeChips][0] : document.getElementById('filter-category').value;
      const sub = document.getElementById('filter-suburb').value;
      const place = document.getElementById('filter-place').value.trim();
      const radius = document.getElementById('filter-radius').value;
      const readinessFilter = document.getElementById('filter-readiness').value;
      const sourceType = document.getElementById('filter-source-type').value;
      const sortBy = document.getElementById('sort-by').value;
      if (q) params.set('q', q);
      if (st) params.set('state', st);
      if (cat) params.set('category', cat);
      if (sub) params.set('suburb', sub);
      if (place) params.set('place', place);
      if (place && radius) params.set('radius', radius);
      if (readinessFilter) params.set('readiness', readinessFilter);
      if (sourceType) params.set('source', sourceType);
      if (document.getElementById('filter-phone').checked) params.set('phone', '1');
      if (document.getElementById('filter-website').checked) params.set('website', '1');
      if (document.getElementById('filter-exact').checked) params.set('exact', '1');
      if (document.getElementById('filter-fresh').checked) params.set('fresh', '1');
      if (sortBy && sortBy !== 'relevance') params.set('sort', sortBy);
      if (selectedServiceId) params.set('id', selectedServiceId);
      if (mapBoundsFilter) {
        const sw = mapBoundsFilter.getSouthWest();
        const ne = mapBoundsFilter.getNorthEast();
        params.set('bbox', [sw.lat, sw.lng, ne.lat, ne.lng].map(n => n.toFixed(4)).join(','));
      }
      const qs = params.toString();
      history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
    }
    function hydrateFromUrl() {
      if (urlHydrated) return;
      suppressUrlUpdate = true;
      const params = new URLSearchParams(location.search);
      document.getElementById('search').value = params.get('q') || '';
      document.getElementById('filter-state').value = params.get('state') || '';
      buildSuburbFilter();
      const sub = params.get('suburb');
      if (sub) document.getElementById('filter-suburb').value = sub;
      const cat = params.get('category');
      if (cat) {
        document.getElementById('filter-category').value = cat;
        activeChips.clear();
        activeChips.add(cat);
        document.querySelectorAll('.cat-chip').forEach(chip => {
          chip.classList.toggle('active', chip.dataset.cat === cat);
        });
      }
      document.getElementById('filter-place').value = params.get('place') || '';
      document.getElementById('filter-radius').value = params.get('radius') || '10';
      document.getElementById('filter-readiness').value = params.get('readiness') || '';
      document.getElementById('filter-source-type').value = params.get('source') || '';
      document.getElementById('sort-by').value = params.get('sort') || 'relevance';
      document.getElementById('filter-phone').checked = params.get('phone') === '1';
      document.getElementById('filter-website').checked = params.get('website') === '1';
      document.getElementById('filter-exact').checked = params.get('exact') === '1';
      document.getElementById('filter-fresh').checked = params.get('fresh') === '1';
      if (document.getElementById('filter-place').value.trim()) {
        const resolved = resolvePlace(document.getElementById('filter-place').value);
        if (resolved) {
          placeSearch = { ...resolved, radiusKm: Number(document.getElementById('filter-radius').value) || 10 };
        }
      }
      selectedServiceId = params.get('id') || null;
      const bbox = (params.get('bbox') || '').split(',').map(Number);
      if (bbox.length === 4 && bbox.every(Number.isFinite)) {
        mapBoundsFilter = L.latLngBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
        map.fitBounds(mapBoundsFilter, { padding: [20, 20] });
        document.querySelector('.map-search').classList.add('visible');
        document.getElementById('search-map-area').classList.add('active');
        document.getElementById('clear-map-area').classList.add('visible');
      }
      urlHydrated = true;
      suppressUrlUpdate = false;
    }
    function selectService(s, focusMap = true) {
      selectedServiceId = s.id || null;
      if (focusMap && s.latitude && s.longitude) {
        map.setView([s.latitude, s.longitude], 15);
        setHighlight(s.latitude, s.longitude);
      }
      showDetail(s);
      document.querySelectorAll('.service-card').forEach(card => {
        card.classList.toggle('active', card.dataset.serviceId === selectedServiceId);
      });
      updateUrl();
      const closeBtn = document.getElementById('detail-close');
      if (closeBtn) closeBtn.focus();
    }

    // Build a highlighted description snippet for the list view. When a search
    // query is present and matched inside the description, the snippet centres
    // on the first match so the highlight is always visible within the 2-line
    // clamp; otherwise it shows the start of the description.
    function descSnippet(desc, query, maxLen = 160) {
      if (!desc) return '';
      let text;
      if (query) {
        const idx = desc.toLowerCase().indexOf(query.toLowerCase());
        if (idx >= 0) {
          const before = 40;
          const start = Math.max(0, idx - before);
          const end = Math.min(desc.length, start + maxLen);
          text = desc.slice(start, end).trim();
          if (start > 0) text = '…' + text;
          if (end < desc.length) text = text + '…';
        } else {
          text = desc.length > maxLen ? desc.slice(0, maxLen).trim() + '…' : desc;
        }
      } else {
        text = desc.length > maxLen ? desc.slice(0, maxLen).trim() + '…' : desc;
      }
      let safe = esc(text);
      if (query) {
        safe = safe.replace(new RegExp('(' + escapeRegex(query) + ')', 'gi'), '<mark>$1</mark>');
      }
      return safe;
    }

    // Highlight matches inside an already-escaped or plain text block without
    // trimming it — used by the detail panel where the full description shows.
    function highlightAll(text, query) {
      const safe = esc(text);
      if (!query) return safe;
      return safe.replace(new RegExp('(' + escapeRegex(query) + ')', 'gi'), '<mark>$1</mark>');
    }

    function buildSuburbFilter() {
      const sel = document.getElementById('filter-suburb');
      const st = document.getElementById('filter-state').value;
      const prev = sel.value;
      sel.innerHTML = '<option value="">All suburbs</option>';
      let pool = allServices;
      if (st) pool = pool.filter(s => s.state === st);
      const suburbs = {};
      pool.forEach(s => { if (s.suburb) suburbs[s.suburb] = (suburbs[s.suburb]||0)+1; });
      Object.keys(suburbs).sort().forEach(sub => {
        const o = document.createElement('option');
        o.value = sub;
        o.textContent = `${sub} (${suburbs[sub]})`;
        sel.appendChild(o);
      });
      if (prev && suburbs[prev]) sel.value = prev;
    }

    function addFilterChip(chips, label, clear) {
      chips.push({ label, clear });
    }

    function renderActiveFilters() {
      const wrap = document.getElementById('active-filters');
      const chips = [];
      const q = document.getElementById('search').value.trim();
      const st = document.getElementById('filter-state').value;
      const cat = activeChips.size === 1 ? [...activeChips][0] : document.getElementById('filter-category').value;
      const sub = document.getElementById('filter-suburb').value;
      const place = document.getElementById('filter-place').value.trim();
      const readinessFilter = document.getElementById('filter-readiness').value;
      const sourceType = document.getElementById('filter-source-type').value;
      if (q) addFilterChip(chips, `Search: ${q}`, () => { document.getElementById('search').value = ''; });
      if (st) addFilterChip(chips, `State: ${st}`, () => { document.getElementById('filter-state').value = ''; buildSuburbFilter(); });
      if (sub) addFilterChip(chips, `Suburb: ${sub}`, () => { document.getElementById('filter-suburb').value = ''; });
      if (cat) addFilterChip(chips, CAT[cat] || cat, () => {
        activeChips.clear();
        document.getElementById('filter-category').value = '';
        document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
      });
      if (placeSearch || place) addFilterChip(chips, `Near: ${place || placeSearch.label}`, () => {
        placeSearch = null;
        document.getElementById('filter-place').value = '';
        document.getElementById('place-error').style.display = 'none';
      });
      const readinessLabels = { ready: 'Ready', verify: 'Verify', low: 'Low confidence' };
      if (readinessFilter) addFilterChip(chips, `Readiness: ${readinessLabels[readinessFilter] || readinessFilter}`, () => { document.getElementById('filter-readiness').value = ''; });
      if (sourceType) addFilterChip(chips, sourceType === 'gov' ? 'Government only' : 'OSM only', () => { document.getElementById('filter-source-type').value = ''; });
      [
        ['filter-phone', 'Has phone'],
        ['filter-website', 'Has website'],
        ['filter-exact', 'Exact pin'],
        ['filter-fresh', 'Hide stale'],
      ].forEach(([id, label]) => {
        if (document.getElementById(id).checked) addFilterChip(chips, label, () => { document.getElementById(id).checked = false; });
      });
      if (mapBoundsFilter) addFilterChip(chips, 'Map area', () => {
        mapBoundsFilter = null;
        document.querySelector('.map-search').classList.remove('visible');
        document.getElementById('search-map-area').classList.remove('active');
        document.getElementById('clear-map-area').classList.remove('visible');
      });

      wrap.innerHTML = '';
      wrap.classList.toggle('visible', chips.length > 0);
      chips.forEach(chip => {
        const el = document.createElement('span');
        el.className = 'filter-chip';
        el.innerHTML = `${esc(chip.label)} <button type="button" aria-label="Remove ${esc(chip.label)}">&times;</button>`;
        el.querySelector('button').addEventListener('click', () => {
          chip.clear();
          applyFilters();
        });
        wrap.appendChild(el);
      });
    }

    function applyFilters() {
      const q = document.getElementById('search').value.toLowerCase().trim();
      const st = document.getElementById('filter-state').value;
      const cat = document.getElementById('filter-category').value;
      const sub = document.getElementById('filter-suburb').value;
      const readinessFilter = document.getElementById('filter-readiness').value;
      const sourceType = document.getElementById('filter-source-type').value;
      const sortBy = document.getElementById('sort-by').value;
      let f = allServices.slice();
      if (st) f = f.filter(s => s.state === st);
      if (activeChips.size > 0) {
        f = f.filter(s => activeChips.has(s.category));
      } else if (cat) {
        f = f.filter(s => s.category === cat);
      }
      if (sub) f = f.filter(s => s.suburb === sub);
      if (q) f = f.filter(s => [s.name,s.description,s.address,s.suburb,s.phone].filter(Boolean).join(' ').toLowerCase().includes(q));
      if (readinessFilter) f = f.filter(s => readiness(s).key === readinessFilter);
      if (sourceType === 'gov') f = f.filter(s => !isOsm(s));
      if (sourceType === 'osm') f = f.filter(s => isOsm(s));
      if (document.getElementById('filter-phone').checked) f = f.filter(s => !!s.phone);
      if (document.getElementById('filter-website').checked) f = f.filter(s => !!s.website);
      if (document.getElementById('filter-exact').checked) f = f.filter(s => s.location_precision === 'address');
      if (document.getElementById('filter-fresh').checked) f = f.filter(s => {
        const age = sourceAgeYears(s);
        return age == null || age < 5;
      });
      if (mapBoundsFilter) {
        f = f.filter(s => s.latitude && s.longitude && mapBoundsFilter.contains([s.latitude, s.longitude]));
      }

      const distanceOrigin = placeSearch || userLocation;
      if (distanceOrigin) {
        f.forEach(s => {
          s._distance = (s.latitude && s.longitude)
            ? distanceMetres(distanceOrigin.lat, distanceOrigin.lng, s.latitude, s.longitude)
            : Infinity;
        });
        if (placeSearch) {
          f = f.filter(s => isFinite(s._distance) && s._distance <= placeSearch.radiusKm * 1000);
        }
      }

      if (sortBy === 'distance' || (distanceOrigin && sortBy === 'relevance')) {
        f.sort((a, b) => a._distance - b._distance);
      } else if (sortBy === 'readiness') {
        f.sort((a, b) => readinessRank(a) - readinessRank(b) || String(a.name).localeCompare(String(b.name)));
      } else if (sortBy === 'quality') {
        const rank = { complete: 0, partial: 1, minimal: 2 };
        f.sort((a, b) => (rank[a.quality] ?? 3) - (rank[b.quality] ?? 3) || String(a.name).localeCompare(String(b.name)));
      } else if (sortBy === 'source_age') {
        f.sort((a, b) => (sourceAgeYears(a) ?? Infinity) - (sourceAgeYears(b) ?? Infinity));
      } else if (sortBy === 'name') {
        f.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      }

      filteredServices = f;
      renderServices(f);

      const filterKey = [q, st, cat, [...activeChips].sort().join(','), sub].join('|');
      if (urlHydrated && !isStreaming && filterKey !== prevFilterKey && !mapBoundsFilter && !userLocation && !placeSearch) {
        const geoResults = f.filter(s => s.latitude && s.longitude);
        if (geoResults.length > 0 && (q || st || cat || activeChips.size || sub)) {
          const bounds = L.latLngBounds(geoResults.map(s => [s.latitude, s.longitude]));
          map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 15, duration: 0.8 });
        } else if (!q && !st && !cat && !activeChips.size && !sub) {
          map.flyTo([-28, 134], 5, { duration: 0.8 });
        }
      }
      prevFilterKey = filterKey;

      renderActiveFilters();
      if (selectedServiceId && !hydratedSelectedShown) {
        const selected = allServices.find(s => s.id === selectedServiceId);
        if (selected) {
          hydratedSelectedShown = true;
          selectService(selected, true);
          return;
        }
      }
      updateUrl();
    }

    let t;
    document.getElementById('search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(applyFilters, 200); });
    let placeTimer;
    document.getElementById('filter-place').addEventListener('input', () => {
      clearTimeout(placeTimer);
      placeTimer = setTimeout(updatePlaceSearch, 300);
    });
    document.getElementById('filter-radius').addEventListener('change', updatePlaceSearch);
    document.getElementById('filter-state').addEventListener('change', () => { buildSuburbFilter(); applyFilters(); });
    document.getElementById('filter-category').addEventListener('change', () => {
      activeChips.clear();
      const cat = document.getElementById('filter-category').value;
      if (cat) activeChips.add(cat);
      document.querySelectorAll('.cat-chip').forEach(chip => {
        chip.classList.toggle('active', activeChips.has(chip.dataset.cat));
      });
      applyFilters();
    });
    document.getElementById('filter-suburb').addEventListener('change', applyFilters);
    ['filter-readiness','filter-source-type','sort-by'].forEach(id => {
      document.getElementById(id).addEventListener('change', applyFilters);
    });
    ['filter-phone','filter-website','filter-exact','filter-fresh'].forEach(id => {
      document.getElementById(id).addEventListener('change', applyFilters);
    });
    document.getElementById('clear-filters').addEventListener('click', () => {
      document.getElementById('search').value='';
      document.getElementById('filter-state').value='';
      document.getElementById('filter-category').value='';
      document.getElementById('filter-place').value='';
      document.getElementById('filter-radius').value='10';
      document.getElementById('filter-readiness').value='';
      document.getElementById('filter-source-type').value='';
      document.getElementById('sort-by').value='relevance';
      ['filter-phone','filter-website','filter-exact','filter-fresh'].forEach(id => {
        document.getElementById(id).checked = false;
      });
      document.getElementById('filter-suburb').innerHTML='<option value="">All suburbs</option>';
      activeChips.clear();
      selectedServiceId = null;
      mapBoundsFilter = null;
      placeSearch = null;
      hydratedSelectedShown = false;
      document.getElementById('place-error').style.display='none';
      document.querySelector('.map-search').classList.remove('visible');
      document.getElementById('search-map-area').classList.remove('active');
      document.getElementById('clear-map-area').classList.remove('visible');
      document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
      // clearUserLocation calls applyFilters internally
      clearUserLocation();
    });

    document.getElementById('near-me-btn').addEventListener('click', (e) => {
      // Clicking the × inside the active button clears; elsewhere toggles.
      if (e.target.closest('.near-me-clear')) {
        clearUserLocation();
        return;
      }
      if (userLocation) {
        clearUserLocation();
      } else {
        requestUserLocation();
      }
    });
    function closeDetail() {
      const wasActive = document.querySelector('.service-card.active');
      document.getElementById('detail-panel').classList.remove('visible');
      selectedServiceId = null;
      document.querySelectorAll('.service-card').forEach(card => card.classList.remove('active'));
      clearHighlight();
      updateUrl();
      if (wasActive) wasActive.focus();
    }
    document.getElementById('detail-close').addEventListener('click', closeDetail);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('detail-panel').classList.contains('visible')) {
        closeDetail();
      }
    });
    document.getElementById('search-map-area').addEventListener('click', () => setMapAreaFilter(true));
    document.getElementById('clear-map-area').addEventListener('click', () => setMapAreaFilter(false));

    (function initLegend() {
      const body = document.getElementById('map-legend-body');
      let html = '';
      Object.entries(CAT).forEach(([key, label]) => {
        const c = CAT_COLOR[key] || '#64748b';
        html += `<div class="legend-item"><span class="legend-dot" style="background:${c}"></span>${label}</div>`;
      });
      html += `<div class="legend-item"><span class="legend-dot legend-dot-approx"></span>Approx location</div>`;
      body.innerHTML = html;
      document.getElementById('map-legend-toggle').addEventListener('click', () => {
        document.getElementById('map-legend').classList.toggle('open');
      });
    })();

    document.getElementById('download-csv').addEventListener('click', () => {
      if (!filteredServices.length) return;
      const cols = ['name','category','readiness','description','address','suburb','state','postcode','phone','email','website','hours','eligibility','cost','latitude','longitude','quality','location_precision','distance'];
      const escape = v => {
        if (v == null) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      };
      let csv = cols.join(',') + '\n';
      filteredServices.forEach(s => {
        csv += cols.map(c => {
          if (c === 'readiness') return escape(readiness(s).label);
          if (c === 'distance') return escape(isFinite(s._distance) ? formatDistance(s._distance) : '');
          return escape(s[c]);
        }).join(',') + '\n';
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'oa-sa-services.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    function isMobile() { return window.matchMedia('(max-width: 768px)').matches; }

    function setMobileView(view) {
      document.body.dataset.mobileView = view;
      document.querySelectorAll('.mobile-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.view === view);
      });
      if (view === 'map' && map) {
        setTimeout(() => map.invalidateSize(), 50);
      }
    }

    document.querySelectorAll('.mobile-tab').forEach(btn => {
      btn.addEventListener('click', () => setMobileView(btn.dataset.view));
    });
    setMobileView('list');

    // When a service card is tapped on mobile, switch to map so the pin is visible
    document.getElementById('results-list').addEventListener('click', (e) => {
      if (isMobile() && e.target.closest('.service-card')) {
        setMobileView('map');
      }
    });

    function showNearbyPrompt() {
      if (location.search) return;
      if (localStorage.getItem('aosi-prompt-dismissed')) return;
      const prompt = document.getElementById('nearby-prompt');
      prompt.classList.add('visible');
    }

    function dismissNearbyPrompt() {
      const prompt = document.getElementById('nearby-prompt');
      prompt.classList.remove('visible');
      localStorage.setItem('aosi-prompt-dismissed', '1');
    }

    document.getElementById('nearby-prompt-btn').addEventListener('click', () => {
      dismissNearbyPrompt();
      requestUserLocation();
    });

    document.getElementById('nearby-prompt-dismiss').addEventListener('click', () => {
      dismissNearbyPrompt();
    });

    initMap();
    loadData();
