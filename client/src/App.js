import React, { useEffect, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import { auth, provider, signInWithPopup } from './firebase';

// fog math
import { getFogGeoJSON } from './mapUtils';

import 'mapbox-gl/dist/mapbox-gl.css';
import './App.css';

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN;

export default function App() {
  console.log("Checking Token:", process.env.REACT_APP_MAPBOX_TOKEN);
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);

  // state grouping
  const [user, setUser] = useState(null);
  const [view, setView] = useState('map');
  const [data, setData] = useState({ quests: [], posts: [] });
  const [location, setLocation] = useState({ coords: null, error: null });
  const [ui, setUi] = useState({ createModal: false, outOfZone: false, success: false });
  const [active, setActive] = useState({ selected: null, activeQuest: null });
  const [form, setForm] = useState({ title: "", task: "", coords: null, image: "" });

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      setUser(result.user);
    } catch (error) { console.error("Login failed:", error); }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      setUser(null);
      setView('map');
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  // data fetching
  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetch('https://waypoint-backend-4jop.onrender.com/api/quests').then(res => res.json()),
      fetch('https://waypoint-backend-4jop.onrender.com/api/posts').then(res => res.json())
    ])
    .then(([quests, posts]) => setData({ quests, posts }))
    .catch(err => console.error("Data sync failed:", err));
  }, [user]);

   // location tracking
  useEffect(() => {
    if (!user) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setLocation({ coords: [pos.coords.longitude, pos.coords.latitude], error: null }),
      () => setLocation(s => ({ ...s, error: "Please enable location permissions." })),
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [user]);

  // map lifecycle
  useEffect(() => {
    if (!user || view !== 'map' || !location.coords || !mapContainer.current) return;

    // prevent re-initializing if map already exists
    if (map.current) return;

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v10',
      center: location.coords,
      zoom: 14,
      doubleClickZoom: false
    });

    mapInstance.on('load', () => {
      map.current = mapInstance;
      
      const fogGeo = getFogGeoJSON(location.coords);
      mapInstance.addSource('fog', { type: 'geojson', data: fogGeo });
      mapInstance.addLayer({
        id: 'fog-layer', type: 'fill', source: 'fog',
        paint: { 'fill-color': '#000', 'fill-opacity': 0.85 }
      });

      renderMarkers(data.quests, mapInstance, location.coords);

      // direct event listeners
      mapInstance.on('click', 'fog-layer', () => {
        if (!ui.createModal && !active.selected) setUi(s => ({ ...s, outOfZone: true }));
      });

      mapInstance.on('dblclick', (e) => {
        const clickPos = [e.lngLat.lng, e.lngLat.lat];
        if (turf.distance(location.coords, clickPos, { units: 'kilometers' }) <= 0.3) {
          setForm(f => ({ ...f, coords: clickPos }));
          setUi(s => ({ ...s, createModal: true }));
        } else {
          setUi(s => ({ ...s, outOfZone: true }));
        }
      });
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [view, location.coords == null]); 

  // move updating
  useEffect(() => {
    const m = map.current;
    if (m?.isStyleLoaded() && location.coords) {
      // update logic here
      m.getSource('fog').setData(getFogGeoJSON(location.coords));
      renderMarkers(data.quests, m, location.coords);
    }
  }, [location.coords, data.quests]);

  const renderMarkers = (questList, mapInst, center) => {
    // clear old markers using Ref
    markersRef.current.forEach(m => m.remove());

    markersRef.current = questList
      .filter(q => turf.distance(center, q.location.coordinates) <= 0.3)
      .map(q => {
        const el = document.createElement('div');
        el.className = 'custom-marker';
        
        const marker = new mapboxgl.Marker(el)
          .setLngLat(q.location.coordinates)
          .addTo(mapInst);

        el.onclick = () => setActive(s => ({ ...s, selected: q }));
        return marker;
      });
  };

  const submitPost = async () => {
    if (!form.image) return alert("Select an image proof!");
    const postData = {
      username: user.displayName,
      userId: user.uid,
      questTitle: active.activeQuest.title,
      image: form.image,
      date: new Date().toLocaleDateString()
    };
    try {
      const res = await fetch('https://waypoint-backend-4jop.onrender.com/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postData)
      });
      if (res.ok) {
        const newPost = await res.json();
        setData(s => ({ ...s, posts: [newPost, ...s.posts] }));
        setActive(s => ({ ...s, activeQuest: null }));
        setForm(f => ({ ...f, image: "" }));
        setUi(s => ({ ...s, success: true }));
      }
    } catch (err) { console.error(err); }
  };

  if (!user) return (
    <div className="login-wall">
      <h1>Waypoint</h1>
      <button onClick={handleLogin} className="login-btn">Login with Google</button>
    </div>
  );

  return (
    <div className="App">
      <nav className="navbar">
        <div className="logo">Waypoint</div>
        <div className="nav-buttons">
        <button 
          onClick={() => setView('social')} 
          className={view === 'social' ? 'nav-link active' : 'nav-link'}
        >
        SOCIAL </button>
        <button 
          onClick={() => setView('map')} 
          className={view === 'map' ? 'nav-link active' : 'nav-link'}
        >
        MAP </button>
        <button 
          onClick={() => setView('profile')} 
          className={view === 'profile' ? 'nav-link active' : 'nav-link'}
        >
        PROFILE </button>
      </div>
        <div className="user-nav">
          <span className="greeting-text">Happy Questing, {user.displayName.split(' ')[0]}!</span>
        </div>
      </nav>

      <main className={`main-viewport ${view === 'map' ? 'map-active' : 'scroll-active'}`}>
        {location.error && view === 'map' && (
          <div className="location-error-overlay">
            <h2>Location Required</h2>
            <p>{location.error}</p>
          </div>
        )}

        {view === 'social' && (
          <div className="social-container">
            {active.activeQuest ? (
              <div className="post-card submission-form">
                <h2>Complete: {active.activeQuest.title}</h2>
                <input type="file" onChange={(e) => {
                  const reader = new FileReader();
                  reader.onloadend = () => setForm(f => ({ ...f, image: reader.result }));
                  if (e.target.files[0]) reader.readAsDataURL(e.target.files[0]);
                }} accept="image/*" />
                {form.image && <img src={form.image} alt="preview" className="img-preview" />}
                <button onClick={submitPost} className="submit-btn">Post Proof</button>
              </div>
            ) : (
              <div>
                <h2>Social Feed</h2>
                {data.posts.map((post, i) => (
                  <div key={i} className="post-card">
                    <p><strong>@{post.username}</strong>: {post.questTitle}</p>
                    {post.image && <img src={post.image} alt="proof" className="post-img" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'map' && (
          <div className="map-view-wrapper">
            {!location.coords && !location.error && <div className="loading-screen">Locating...</div>}
            <div ref={mapContainer} className="map-container" />

            {ui.outOfZone && (
              <div className="custom-modal-overlay">
                <div className="custom-modal-content out-of-zone-alert">
                  <h2>Out of Zone!</h2>
                  <p>Move closer to reveal more of the map!</p>
                  <button onClick={() => setUi(s => ({ ...s, outOfZone: false }))}>Ok</button>
                </div>
              </div>
            )}

            {ui.createModal && (
              <div className="custom-modal-overlay">
                <div className="custom-modal-content">
                  <h2>New Quest</h2>
                  <input type="text" placeholder="Title" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} className="modal-input" />
                  <textarea placeholder="Description" value={form.task} onChange={(e) => setForm(f => ({ ...f, task: e.target.value }))} className="modal-textarea" />
                  <div className="modal-actions">
                    <button onClick={async () => {
                      if (form.title && form.task) {
                        const newQuestData = {
                          title: form.title, task: form.task,
                          location: { type: "Point", coordinates: form.coords },
                          createdBy: user.displayName
                        };
                        const res = await fetch('https://waypoint-backend-4jop.onrender.com/api/quests', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(newQuestData)
                        });
                        if (res.ok) {
                          const result = await res.json();
                          setData(s => ({ ...s, quests: [...s.quests, { ...newQuestData, _id: result.insertedId }] }));
                          setUi(s => ({ ...s, createModal: false }));
                          setForm(f => ({ ...f, title: "", task: "" }));
                        }
                      }
                    }}>Create</button>
                    <button onClick={() => setUi(s => ({ ...s, createModal: false }))} className="secondary">Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {active.selected && (
              <div className="quest-picker-overlay">
                <h3>{active.selected.title}</h3>
                <p>{active.selected.task}</p>
                <div className="picker-buttons">
                  <button className="accept-btn" onClick={() => { 
                    setActive(s => ({ ...s, activeQuest: active.selected, selected: null })); 
                    setView('social'); 
                  }}>Accept</button>
                  <button className="reject-btn" onClick={() => setActive(s => ({ ...s, selected: null }))}>Keep looking</button>
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'profile' && (
          <div className="profile-container">
            <div className="profile-card">
              <img src={user.photoURL} alt="pfp" className="profile-pfp" />
              <div className="profile-header-info">
                <h2>{user.displayName}</h2>
                <button onClick={handleLogout} className="logout-btn-profile">Logout</button>
              </div>
            </div>
            <h3>Post History</h3>
            {data.posts.filter(p => p.userId === user.uid).map((post, i) => (
              <div key={i} className="post-card">
                <p>{post.questTitle}</p>
                {post.image && <img src={post.image} alt="proof" className="post-img" />}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}