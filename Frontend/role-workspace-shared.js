/* Shared signed-in identity controls for all iTask workspaces. */
(() => {
 "use strict";
 const readUser=()=>{try{return JSON.parse(localStorage.getItem("itaskUser")||"null")}catch(_){return null}};
 const user=readUser();
 if(!user)return;
 const name=String(user.full_name||user.fullName||user.name||user.email||"Account").trim();
 const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"U";
 const host=document.querySelector(".main-content > .d-flex.justify-content-between.align-items-center") ||
            document.querySelector(".main-content header") || document.querySelector(".main-content .topbar");
 if(!host)return;
 // Admin dashboard already renders its own complete account controls.
 if(host.querySelector("#logoutBtn"))return;
 let actions=host.querySelector("[data-account-actions]");
 if(!actions){actions=document.createElement("div");actions.dataset.accountActions="true";actions.className="it-account-actions";host.appendChild(actions);}
 actions.innerHTML=`<span class="it-account-name"></span><span class="it-account-avatar"></span><button type="button" class="it-account-logout">Sign out</button>`;
 actions.querySelector(".it-account-name").textContent=name;
 actions.querySelector(".it-account-avatar").textContent=initials;
 actions.querySelector(".it-account-logout").addEventListener("click",()=>{
   localStorage.removeItem("itaskToken");localStorage.removeItem("itaskUser");
   window.location.href="../login.html";
 });
})();
