const $=s=>document.querySelector(s);
function show(id){["home","login","request","library","admin"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id));}
async function api(url,opt={}){const r=await fetch(url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Something went wrong");return d}
async function boot(){const m=await api("/api/me");if(m.loggedIn){$("#logout").classList.remove("hidden");await loadVideos();if(m.user.role==="admin"){show("admin");await loadAdmin()}else show("library")}else show("home")}
$("#loginForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/login",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(new FormData(e.target))});location.reload()}catch(x){$("#loginMsg").textContent=x.message}}
$("#requestForm").onsubmit=async e=>{e.preventDefault();try{const d=await api("/api/request-access",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(new FormData(e.target))});$("#requestMsg").textContent=d.message;e.target.reset()}catch(x){$("#requestMsg").textContent=x.message}}
$("#logout").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload()}
async function loadVideos(){const vs=await api("/api/videos");$("#videoGrid").innerHTML=vs.length?vs.map(v=>`<div class="card"><h3>${esc(v.title)}</h3><small>${esc(v.original_name)}</small><button onclick="playVideo(${v.id},'${escAttr(v.title)}')">▶ Watch</button></div>`).join(""):"<p>No videos available yet.</p>"}
function playVideo(id,title){$("#playerTitle").textContent=title;$("#video").src="/api/video/"+id+"/stream";$("#player").classList.remove("hidden");$("#video").play().catch(()=>{})}
function closePlayer(){$("#video").pause();$("#video").removeAttribute("src");$("#player").classList.add("hidden")}
async function loadAdmin(){const users=await api("/api/admin/users");$("#users").innerHTML=users.map(u=>`<div class="user"><b>${esc(u.name)}</b><br>${esc(u.email)}<br>Status: <b>${u.status}</b><br>${u.role!=="admin"?`<button onclick="setStatus(${u.id},'approved')">Approve</button><button onclick="setStatus(${u.id},'rejected')">Reject</button>`:"Admin"}</div>`).join("");const vs=await api("/api/videos");$("#adminVideos").innerHTML=vs.map(v=>`<div class="video-row"><b>${esc(v.title)}</b> — ${esc(v.original_name)} <button onclick="deleteVideo(${v.id})">Delete</button></div>`).join("")}
async function setStatus(id,status){await api("/api/admin/users/"+id+"/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});loadAdmin()}
$("#uploadForm").onsubmit=async e=>{e.preventDefault();$("#uploadMsg").textContent="Uploading...";try{const r=await fetch("/api/admin/videos",{method:"POST",body:new FormData(e.target)});const d=await r.json();if(!r.ok)throw Error(d.error);$("#uploadMsg").textContent="Uploaded successfully.";e.target.reset();await loadAdmin();await loadVideos()}catch(x){$("#uploadMsg").textContent=x.message}}
async function deleteVideo(id){if(!confirm("Delete this video?"))return;await api("/api/admin/videos/"+id,{method:"DELETE"});loadAdmin();loadVideos()}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function escAttr(s){return esc(s).replace(/'/g,"&#39;")}
boot();
