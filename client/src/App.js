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
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);

  // state grouping
  const [user, setUser] = useState(null);
  const [view, setView] = useState('map');
  const [data, setData] = useState({ quests: [], posts: [] });
  const [location, setLocation] = useState({ coords: null, error: null });
  const [ui, setUi] = useState({
    createModal: false,
    outOfZone: false,
    success: false,
    selfVerifyAlert: false,
    proximityAlert: false,
    showLeaderboard: false,
    leaderboardData: null,
    activeTab: 'quests'
  });
  const [active, setActive] = useState({ selected: null, activeQuest: null });
  const [form, setForm] = useState({ title: "", task: "", coords: null, image: "" });
  const [replyTarget, setReplyTarget] = useState(null);
  const [prevCoords, setPrevCoords] = useState(null);
  const [dbUser, setDbUser] = useState({ totalDistance: 0 });

  const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : 'https://waypoint-backend-4jop.onrender.com';

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();

      // clear map reference
      if (map.current) {
        map.current.remove();
        map.current = null;
      }

      setActive({ selected: null, activeQuest: null });

      setUi({ createModal: false, outOfZone: false, success: false, selfVerifyAlert: false, proximityAlert: false });

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
      fetch(`${API_URL}/api/quests`).then(res => res.json()),
      fetch(`${API_URL}/api/posts`).then(res => res.json())
    ])
      .then(([quests, posts]) => setData({ quests, posts }))
      .catch(err => console.error("Data sync failed:", err));
  }, [user]);

  // location tracking
  useEffect(() => {
    if (!user) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const newCoords = [pos.coords.longitude, pos.coords.latitude];

        if (prevCoords) {
          const moved = turf.distance(prevCoords, newCoords, { units: 'kilometers' });

          // update to prevent GPS jumping
          if (moved > 0.05) {
            fetch(`${API_URL}/api/user/distance`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: user.uid, distanceInKm: moved })
            })
              .then(res => res.json())
              .then(updatedStats => {
                setDbUser(updatedStats);
              })
              .catch(err => console.error("Distance update failed:", err));
          }
        }

        setPrevCoords(newCoords);
        setLocation({ coords: newCoords, error: null });
      },
      () => setLocation(s => ({ ...s, error: "Please enable location." })),
      { enableHighAccuracy: true }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [user, prevCoords]); // track movement segments


  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        // user state for UI access
        setUser(firebaseUser);

        // sync stats with your backend
        try {
          const res = await fetch(`${API_URL}/api/users/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: firebaseUser.uid, username: firebaseUser.displayName })
          });
          const dbData = await res.json();
          setDbUser(dbData);
        } catch (err) {
          console.error("Auto-sync failed:", err);
        }
      } else {
        // clear everything
        setUser(null);
        setDbUser({ totalDistance: 0 });
      }
    });

    return () => unsubscribe();
  }, []);

  // map
  useEffect(() => {
    if (!user || !location.coords || !mapContainer.current) return;

    if (map.current) return;

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
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
        paint: { 'fill-color': '#000', 'fill-opacity': 0.80 }
      });

      renderMarkers(data.quests, mapInstance, location.coords);

      // check if fog exists at the click point
      mapInstance.on('click', (e) => {
        const features = mapInstance.queryRenderedFeatures(e.point, { layers: ['fog-layer'] });

        // only show "Out of Zone" if user clicked fog pixels
        if (features.length > 0) {
          if (!ui.createModal && !active.selected) {
            setUi(s => ({ ...s, outOfZone: true }));
          }
        }
      });

      mapInstance.on('dblclick', (e) => {
        // prevent default zoom
        e.preventDefault();

        const clickPos = [e.lngLat.lng, e.lngLat.lat];
        const dist = turf.distance(location.coords, clickPos, { units: 'kilometers' });

        if (dist <= 0.3) {
          setForm(f => ({ ...f, coords: clickPos }));
          setUi(s => ({ ...s, createModal: true }));
        } else {
          setUi(s => ({ ...s, outOfZone: true }));
        }
      });

      mapInstance.on('move', () => {
        if (location.coords) {
          const fogSource = mapInstance.getSource('fog');
          if (fogSource) {
            fogSource.setData(getFogGeoJSON(location.coords));
          }
          renderMarkers(data.quests, mapInstance, location.coords);
        }
      });
    });

    // keep map alive during tab switches
    return () => { };
  }, [user, location.coords, mapContainer.current]);

  useEffect(() => {
    if (view === 'map' && map.current) {
      setTimeout(() => {
        map.current.resize();
      }, 100);
    }
  }, [view]);

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
    markersRef.current.forEach(m => m.remove());

    markersRef.current = questList
      .filter(q => turf.distance(center, q.location.coordinates) <= 0.3)
      .map(q => {
        const el = document.createElement('div');
        el.className = 'custom-marker';

        const marker = new mapboxgl.Marker(el)
          .setLngLat(q.location.coordinates)
          .addTo(mapInst);

        el.onclick = () => {
          // calculate hours remaining for UI
          const created = new Date(q.createdAt).getTime();
          const expires = created + (24 * 60 * 60 * 1000);
          const hoursLeft = Math.max(0, (expires - Date.now()) / (1000 * 60 * 60));

          setActive(s => ({
            ...s,
            selected: { ...q, timeLeft: hoursLeft.toFixed(1) }
          }));
        };
        return marker;
      });
  };

  const submitPost = async () => {
    if (!form.image) return alert("Select an image proof!");

    const postData = {
      username: user.displayName,
      userId: user.uid,
      questTitle: active.activeQuest.title,
      // verify proximity later
      questLocation: active.activeQuest.location,
      image: form.image,
      date: new Date().toLocaleDateString(),
      likes: [],
      verifications: [], // verification array
      comments: []
    };

    try {
      const res = await fetch(`${API_URL}/api/posts`, {
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

  const toggleLike = async (postId) => {
    try {
      const res = await fetch(`${API_URL}/api/posts/${postId}/like`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid })
      });

      if (res.ok) {
        const updatedPost = await res.json();
        // update local state so heart turns red immediately
        setData(s => ({
          ...s,
          posts: s.posts.map(p => p._id === postId ? updatedPost : p)
        }));
      }
    } catch (err) {
      console.error("Like toggle failed:", err);
    }
  };

  const handlePostSubmission = async (postId, text) => {
    if (!text.trim()) return;

    try {
      let res;
      // attaching this to an existing comment
      if (replyTarget) {
        res = await fetch(`${API_URL}/api/posts/${postId}/comments/${replyTarget.commentId}/replies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: user.displayName,
            text: text
          })
        });
      } else {
        // post a brand new top-level comment
        res = await fetch(`${API_URL}/api/posts/${postId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: user.displayName,
            text: text
          })
        });
      }

      if (res.ok) {
        const updatedPost = await res.json();
        setData(s => ({
          ...s,
          posts: s.posts.map(p => p._id === postId ? updatedPost : p)
        }));
        document.getElementById(`input-${postId}`).value = "";
        setReplyTarget(null); // next message is a fresh comment
      }
    } catch (err) {
      console.error("Submission failed:", err);
    }
  };

  const toggleVerification = async (post) => {
    // proximity check
    if (!post.questLocation) return;
    const distance = turf.distance(location.coords, post.questLocation.coordinates, { units: 'kilometers' });

    if (distance > 0.3) {
      setUi(s => ({ ...s, proximityAlert: true }));
      return;
    }

    // anti-self-verify
    if (post.userId === user.uid) {
      setUi(s => ({ ...s, selfVerifyAlert: true }));
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/posts/${post._id}/verify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid })
      });

      if (res.ok) {
        const updatedPost = await res.json();
        setData(s => ({
          ...s,
          posts: s.posts.map(p => p._id === post._id ? updatedPost : p)
        }));
      }
    } catch (err) {
      console.error("Verification failed:", err);
    }
  };

  const deleteComment = async (postId, commentId) => {
    const res = await fetch(`${API_URL}/api/posts/${postId}/comments/${commentId}`, { method: 'DELETE' });
    if (res.ok) {
      const updatedPost = await res.json();
      setData(s => ({ ...s, posts: s.posts.map(p => p._id === postId ? updatedPost : p) }));
    }
  };

  const deleteReply = async (postId, commentId, replyIdx) => {
    // position in c.replies array
    const res = await fetch(`${API_URL}/api/posts/${postId}/comments/${commentId}/replies/${replyIdx}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      const updatedPost = await res.json();
      setData(s => ({ ...s, posts: s.posts.map(p => p._id === postId ? updatedPost : p) }));
    }
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
          > SOCIAL </button>
          <button
            onClick={() => setView('map')}
            className={view === 'map' ? 'nav-link active' : 'nav-link'}
          > MAP </button>
          <button
            onClick={() => setView('profile')}
            className={view === 'profile' ? 'nav-link active' : 'nav-link'}
          > PROFILE </button>
        </div>
        <div className="user-nav">
          <span className="greeting-text">Happy Questing, {user.displayName.split(' ')[0]}!</span>
        </div>
      </nav>

      <main className={`main-viewport ${view === 'map' ? 'map-active' : 'scroll-active'}`}>

        {/* 1. MAP LAYER */}
        <div className="map-view-wrapper" style={{
          display: view === 'map' ? 'block' : 'none',
          zIndex: 1,
          position: 'absolute',
          inset: 0
        }}>
          {!location.coords && !location.error && <div className="loading-screen">Locating...</div>}
          <div ref={mapContainer} className="map-container" style={{ width: '100%', height: '100%' }} />
        </div>

        {location.error && view === 'map' && (
          <div className="location-error-overlay" style={{ zIndex: 1000 }}>
            <h2>Location Required</h2>
            <p>{location.error}</p>
          </div>
        )}

        {/* 2. SOCIAL VIEW */}
        {view === 'social' && (
          <div className="social-container">

            {/* leaderboard stats button */}
            <div className="leaderboard-header">
              <button className="stats-trigger-btn" onClick={() => {
                fetch(`${API_URL}/api/leaderboard`)
                  .then(res => res.json())
                  .then(stats => setUi(s => ({ ...s, leaderboardData: stats, showLeaderboard: true, activeTab: 'quests' })));
              }}>
                🏆 Leaderboard
              </button>
            </div>

            {active.activeQuest ? (
              <div className="post-card submission-form">
                <h2>Complete: {active.activeQuest.title}</h2>
                <input
                  type="file"
                  capture="environment"
                  accept="image/*"
                  onChange={(e) => {
                    const reader = new FileReader();
                    reader.onloadend = () => setForm(f => ({ ...f, image: reader.result }));
                    if (e.target.files[0]) reader.readAsDataURL(e.target.files[0]);
                  }}
                />
                {form.image && <img src={form.image} alt="preview" className="img-preview" />}
                <button onClick={submitPost} className="submit-btn">Post Proof</button>
              </div>
            ) : (
              <div>
                <h2>Social Feed</h2>
                {data.posts.map((post, i) => (
                  <div key={post._id || i} className="post-card">
                    <p><strong>@{post.username}</strong>: {post.questTitle}</p>

                    <div className="status-badge" style={{
                      display: 'inline-block',
                      fontSize: '0.65rem',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      marginBottom: '10px',
                      textTransform: 'uppercase',
                      backgroundColor: (post.verifications?.length >= 1) ? '#2ecc71' : '#f1c40f',
                      color: '#000',
                      fontWeight: 'bold'
                    }}>
                      {(post.verifications?.length >= 1) ? '✓ Verified' : '○ Pending'}
                    </div>

                    {post.image && <img src={post.image} alt="proof" className="post-img" />}

                    <div className="post-interactions" style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
                      <button
                        onClick={() => toggleLike(post._id)}
                        className={`like-btn ${post.likes?.includes(user.uid) ? 'liked' : ''}`}
                      >
                        {post.likes?.includes(user.uid) ? '❤️' : '🤍'} {post.likes?.length || 0}
                      </button>

                      <button
                        onClick={() => toggleVerification(post)}
                        className={`verify-btn ${post.verifications?.includes(user.uid) ? 'verified' : ''}`}
                      >
                        {post.verifications?.includes(user.uid) ? '🚩' : '🏳️'} {post.verifications?.length || 0}
                      </button>
                    </div>

                    {/* comment section */}
                    <div className="comments-section">
                      {post.comments?.map((c) => (
                        <div key={c.id} className="comment-container">
                          <div className="comment-main" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <p className="comment-item"><strong>{c.username}</strong> {c.text}</p>
                            <div style={{ display: 'flex', gap: '10px' }}>
                              <button className="subtle-link" onClick={() => {
                                setReplyTarget({ commentId: c.id, username: c.username });
                                const input = document.getElementById(`input-${post._id}`);
                                input.value = `@${c.username} `;
                                input.focus();
                              }}>reply</button>
                              {c.username === user.displayName && (
                                <button className="subtle-del" onClick={() => deleteComment(post._id, c.id)}>×</button>
                              )}
                            </div>
                          </div>
                          {/* replies */}
                          <div className="replies-list" style={{ marginLeft: '15px', borderLeft: '1px solid #222', paddingLeft: '10px' }}>
                            {c.replies?.map((r, idx) => (
                              <div key={idx} className="reply-item" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <p style={{ fontSize: '0.85rem', margin: '2px 0' }}>
                                  <span style={{ color: '#444' }}>↳</span> <strong>{r.username}</strong> {r.text}
                                </p>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button className="subtle-link" onClick={() => {
                                    setReplyTarget({ commentId: c.id, username: r.username });
                                    const input = document.getElementById(`input-${post._id}`);
                                    input.value = `@${r.username} `;
                                    input.focus();
                                  }}>reply</button>
                                  {r.username === user.displayName && (
                                    <button className="subtle-del" onClick={() => deleteReply(post._id, c.id, idx)}>×</button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      <div className="comment-input-wrapper" style={{ display: 'flex', gap: '8px', marginTop: '15px', borderTop: '1px solid #222', paddingTop: '10px' }}>
                        <input
                          id={`input-${post._id}`}
                          type="text"
                          placeholder={replyTarget ? `Replying to ${replyTarget.username}...` : "Add a comment..."}
                          style={{ flexGrow: 1, background: 'transparent', border: 'none', color: '#fff', outline: 'none' }}
                          onKeyDown={(e) => { if (e.key === 'Enter') handlePostSubmission(post._id, e.target.value); }}
                        />
                        <button className="subtle-post-btn" onClick={() => {
                          const input = document.getElementById(`input-${post._id}`);
                          handlePostSubmission(post._id, input.value);
                        }}>post</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. LEADERBOARD POPUP */}
        {ui.showLeaderboard && (
          <div className="custom-modal-overlay">
            <div className="custom-modal-content leaderboard-modal">
              <h2>🏆 Rankings</h2>
              <div className="leaderboard-tabs">
                <button
                  onClick={() => setUi(s => ({ ...s, activeTab: 'quests' }))}
                  className={ui.activeTab === 'quests' ? 'active' : ''}
                > Total Quests </button>
                <button
                  onClick={() => setUi(s => ({ ...s, activeTab: 'km' }))}
                  className={ui.activeTab === 'km' ? 'active' : ''}
                > Total Distance </button>
              </div>

              <div className="leaderboard-list">
                {(ui.activeTab === 'km' ? ui.leaderboardData?.distance : ui.leaderboardData?.completions)?.length > 0 ? (
                  (ui.activeTab === 'km' ? ui.leaderboardData?.distance : ui.leaderboardData?.completions).map((entry, i) => (
                    <div key={i} className="leader-item">
                      <span>{i + 1}. {entry.username}</span>
                      <strong>{ui.activeTab === 'km' ? `${entry.totalDistance?.toFixed(2)} km` : `${entry.count} verified`}</strong>
                    </div>
                  ))
                ) : (
                  <p style={{ color: '#888', textAlign: 'center', margin: '20px 0' }}>No stats yet!</p>
                )}
              </div>
              <button className="secondary" style={{ width: '100%', marginTop: '20px' }} onClick={() => setUi(s => ({ ...s, showLeaderboard: false }))}>Close</button>
            </div>
          </div>
        )}

        {/* UI Overlays */}
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
                    const res = await fetch(`${API_URL}/api/quests`, {
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

        {view === 'map' && active.selected && (
          <div className="quest-picker-overlay">
            <div className="timer-badge">⌛ {active.selected.timeLeft} h left</div>
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

        {ui.selfVerifyAlert && (
          <div className="custom-modal-overlay">
            <div className="custom-modal-content out-of-zone-alert">
              <h2>Nice Try!</h2>
              <p>You can't verify your own quest. Let the community decide your fate!</p>
              <button onClick={() => setUi(s => ({ ...s, selfVerifyAlert: false }))}>Got it</button>
            </div>
          </div>
        )}

        {ui.proximityAlert && (
          <div className="custom-modal-overlay">
            <div className="custom-modal-content out-of-zone-alert">
              <h2>Too Far Away!</h2>
              <p>You must be within 300 meters of the quest location to verify this completion.</p>
              <button onClick={() => setUi(s => ({ ...s, proximityAlert: false }))}>Ok</button>
            </div>
          </div>
        )}

        {/* 4. PROFILE VIEW */}
        {view === 'profile' && (
          <div className="profile-container">
            <div className="profile-card">
              <img src={user.photoURL} alt="pfp" className="profile-pfp" />
              <div className="profile-header-info">
                <h2>{user.displayName}</h2>

                <div className="profile-stats-bar" style={{ display: 'flex', gap: '20px', margin: '10px 0' }}>
                  <div className="stat-item" style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ fontSize: '1.2rem' }}>
                      {data.posts.filter(p => p.userId === user.uid && p.verifications?.length >= 1).length}
                    </strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Quests</span>
                  </div>
                  <div className="stat-item" style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ fontSize: '1.2rem' }}>
                      {dbUser.totalDistance?.toFixed(1) || 0}
                    </strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>KM</span>
                  </div>
                </div>

                <button onClick={handleLogout} className="logout-btn-profile">Logout</button>
              </div>
            </div>
            <h3>Post History</h3>
            {data.posts.filter(p => p.userId === user.uid).map((post, i) => (
              <div key={i} className="post-card">
                <p>{post.questTitle}</p>
                {post.image && <img src={post.image} alt="proof" className="post-img" />}
                <div className="post-interactions">
                  <button
                    onClick={() => toggleLike(post._id)}
                    className={`like-btn ${post.likes?.includes(user.uid) ? 'liked' : ''}`}
                  >
                    {post.likes?.includes(user.uid) ? '❤️' : '🤍'} {post.likes?.length || 0}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}