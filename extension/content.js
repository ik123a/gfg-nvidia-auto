console.log("GFG-NVIDIA-AUTO: Content script loaded");

const BACKEND_URL = "http://127.0.0.1:5000";
let autoMode = false;
let fixAttempts = 0;
const MAX_FIX_ATTEMPTS = 25; // Increased for better persistence
let isTesting = false; let isSubmitting = false; let isHandlingError = false;
let isWaitingGFG = false; // Flag for GFG rate limit cooldown
let isWaitingFinal = false; // Flag to ensure final submission completes

let timerInterval = null;
let startTime = null;
let countdownDuration = 0;
let modelList = []; // Dynamically loaded from backend

// ===================== UI COMPONENTS =====================

function createHUD() {
  if (document.getElementById('gfg-nvidia-hud')) return;
  const hud = document.createElement('div');
  hud.id = 'gfg-nvidia-hud';
  hud.style.cssText = `
    position: fixed; top: 60px; right: 20px; z-index: 9999;
    padding: 12px 18px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(8px);
    border: 1px solid rgba(108, 92, 231, 0.3); border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); color: white;
    font-family: 'Segoe UI', system-ui, sans-serif; display: flex; flex-direction: column;
    gap: 6px; min-width: 200px; transition: all 0.3s ease; pointer-events: none;
    opacity: 0; transform: translateY(-10px);
  `;
  hud.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <div id="hud-indicator" style="width: 8px; height: 8px; border-radius: 50%; background: #6c5ce7; box-shadow: 0 0 10px #6c5ce7; animation: pulse-hud 2s infinite;"></div>
        <span id="hud-status" style="font-size: 13px; font-weight: 600; color: #e2e8f0;">Ready</span>
      </div>
      <span id="hud-timer" style="font-size: 12px; font-family: monospace; color: #94a3b8;">00:00</span>
    </div>
    <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; margin-top: 4px;">
      <div id="hud-progress" style="width: 0%; height: 100%; background: #6c5ce7; transition: width 0.3s ease;"></div>
    </div>
  `;
  const style = document.createElement('style');
  style.innerHTML = `@keyframes pulse-hud { 0%, 100% { opacity: 0.5; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }`;
  document.head.appendChild(style);
  document.body.appendChild(hud);
}

function updateHUD(status, color = "#6c5ce7", progress = 0) {
  createHUD();
  const hud = document.getElementById('gfg-nvidia-hud');
  const statusEl = document.getElementById('hud-status');
  const indicatorEl = document.getElementById('hud-indicator');
  const progressEl = document.getElementById('hud-progress');
  if (hud) { hud.style.opacity = "1"; hud.style.transform = "translateY(0)"; }
  if (statusEl) statusEl.innerText = status;
  if (indicatorEl) { indicatorEl.style.background = color; indicatorEl.style.boxShadow = `0 0 10px ${color}`; }
  if (progressEl) progressEl.style.width = `${progress}%`;
}

function startTimer(duration = 0) {
  stopTimer(); startTime = Date.now(); countdownDuration = duration;
  const timerEl = document.getElementById('hud-timer');
  timerInterval = setInterval(() => {
    let elapsed = Math.floor((Date.now() - startTime) / 1000);
    
    // Countdown if duration > 0, otherwise count up
    let displayTime = countdownDuration > 0 ? Math.max(0, countdownDuration - elapsed) : elapsed;
    
    const mins = Math.floor(displayTime / 60).toString().padStart(2, '0');
    const secs = (displayTime % 60).toString().padStart(2, '0');
    if (timerEl) timerEl.innerText = `${mins}:${secs}`;
    
    // WATCHDOG: If active countdown hits 0, force a failover
    if (countdownDuration > 0 && displayTime === 0 && elapsed > (countdownDuration + 2)) {
        console.warn("Watchdog: Model timeout detected. Rotating...");
        stopTimer();
        const controller = window._gfg_controller;
        if (controller) controller.abort(); // Triggers the .catch() in triggerSolve
    }
  }, 1000);
}

function stopTimer() { 
    clearInterval(timerInterval); 
    const timerEl = document.getElementById('hud-timer');
    if (timerEl) timerEl.innerText = "00:00";
}

function hideHUDIn(ms = 3000) {
  setTimeout(() => {
    const hud = document.getElementById('gfg-nvidia-hud');
    if (hud && !isTesting && !isSubmitting && !autoMode) { hud.style.opacity = "0"; hud.style.transform = "translateY(-10px)"; }
  }, ms);
}

// ===================== STATE SYNC =====================

chrome.storage.local.get(['autoMode'], (result) => {
  autoMode = !!result.autoMode;
  fetch(`${BACKEND_URL}/health`).then(r => r.json()).then(data => { if (data.models) modelList = data.models; }).catch(() => {});
  if (autoMode) { createHUD(); updateHUD("⚡ Quick-Init...", "#6c5ce7", 15); setTimeout(startAutoSolve, 1500); }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.autoMode) {
    autoMode = changes.autoMode.newValue;
    if (autoMode) { createHUD(); updateHUD("🚀 Turbo Start", "#6c5ce7", 25); setTimeout(startAutoSolve, 3500); }
    else { updateHUD("💤 Auto OFF", "#94a3b8", 0); hideHUDIn(2000); }
  }
});

// ===================== SCRAPING =====================

function getProblemTitle() {
  const el = document.querySelector('.problem-tab__name') || 
             document.querySelector('h3') || 
             document.querySelector('[class*="problem_title"]') ||
             document.querySelector('.problems_header_content__title__L2cB2');
  return el ? el.innerText.trim() : "Unknown Problem";
}

function getProblemDescription() {
  const el = document.querySelector('#scrollableDiv') || 
             document.querySelector('.problems_problem_content__Xm_eO') || 
             document.querySelector('[class*="problem_content"]') ||
             document.querySelector('.problem-description');
  return el ? el.innerText.trim() : "No desc found";
}

function detectResultState() {
  const pane = document.querySelector('[class*="problems_content_pane"]');
  const text = (pane?.innerText || "").trim();
  const pageText = document.body.innerText;
  
  // Check for red diff highlights (Definitive Wrong Answer)
  const hasRedDiff = !!document.querySelector('span[class*="problems_diff_false"]');
  
  if (text.includes('Correct Answer') || text.includes('Problem Solved Successfully') || pageText.includes('Problem Solved Successfully')) return "accepted";
  if (text.includes('Compilation Error')) return "compile_error";
  if (hasRedDiff || text.includes('Wrong Answer') || text.includes('Output Difference')) return "wrong_answer";
  if (text.includes('Time Limit Exceeded') || text.includes('TLE')) return "tle";
  if (text.includes('Runtime Error') || text.includes('Segmentation Fault')) return "runtime_error";
  if (text.includes('Memory Limit')) return "mle";
  if (text.includes('servers are busy')) return "server_busy";
  
  // Check for compile success (tests passed, ready to submit)
  if (text.includes('Compilation Completed') || text.includes('All Test Cases Passed')) return "compile_success";
  
  // 1. Check sidebar for "Solved" status (Green checkmark next to active item)
  const activeSidebarItem = document.querySelector('.sidebar_item__khyNp.active, [class*="sidebar_item"].active, a.active[href*="/problem/"]');
  if (activeSidebarItem && (activeSidebarItem.querySelector('i.green.check, .green.tick, [class*="success"], svg, img') || activeSidebarItem.innerText.includes('✅') || activeSidebarItem.innerText.includes('✓'))) {
      return "accepted";
  }

  // 2. Robust URL-based active sidebar solver check (perfect for Batch track items)
  const currentPath = window.location.pathname;
  const slugMatch = currentPath.match(/\/problems\/([^/]+)/);
  if (slugMatch && slugMatch[1]) {
    const slug = slugMatch[1];
    const activeLink = Array.from(document.querySelectorAll('a')).find(a => {
      const href = a.getAttribute('href') || "";
      return href.includes(slug);
    });
    if (activeLink) {
      const container = activeLink.closest('[class*="problems_solve_next_item"], [class*="sidebar_item"], li, [class*="ProblemsList"]') || activeLink;
      const hasGreenTick = container.querySelector('svg, img[src*="check"], img[src*="tick"], [class*="green"], [class*="success"], [class*="tick"], [class*="check"]') || 
                           container.innerText.includes('✅') || 
                           container.innerText.includes('✓');
      if (hasGreenTick) {
         console.log("GFG-AUTO: Current problem is verified as SOLVED in the sidebar tracklist!");
         return "accepted";
      }
    }
  }
  
  return null;
}

function scrapeFailureDetails() {
  const pane = document.querySelector('[class*="problems_content_pane"]');
  if (!pane) return {};
  const text = pane.innerText;
  
  const labels = Array.from(pane.querySelectorAll('label')).map(l => l.innerText).join(' ');
  const inputs = Array.from(pane.querySelectorAll('textarea')).map(t => t.value).join(' ');
  const input_data = (labels + " " + inputs).trim() || text.split('For Input:')[1]?.split('Your Output:')[0]?.trim();

  const actual_output = text.split(/Your Output\s*:/i)[1]?.split(/Expected Output\s*:/i)[0]?.trim();
  const expected_output = text.split(/Expected Output\s*:/i)[1]?.split(/Output Difference\s*:/i)[0]?.trim();

  return { input_data, actual_output, expected_output };
}

// ===================== AUTOMATION =====================

function startAutoSolve() {
  if (autoMode) {
    closePopups();
    
    // Check if already solved first
    if (detectResultState() === "accepted") {
        console.log("GFG-AUTO: Problem already solved. Skipping...");
        updateHUD("🏁 Already Solved", "#4cd137", 100);
        setTimeout(navigateToNext, 2000);
        return;
    }

    const btn = document.getElementById('gfg-solve-ai-btn');
    if (btn && !btn.disabled) btn.click();
  }
}

async function handleAutoPhase() {
  if (!autoMode) return;
  const state = detectResultState();
  if (!state) return;

  if (state === "accepted") {
    stopTimer();
    updateHUD("🏁 Solved! Moving...", "#4cd137", 100);
    isSubmitting = false; isHandlingError = false; isWaitingFinal = false; isTesting = false; fixAttempts = 0;
    setTimeout(navigateToNext, 3000);
    return;
  }

  if (state === "compile_success") {
    // Tests passed — submit now
    if (!isSubmitting) {
      updateHUD("🚀 Test OK! Submitting...", "#4cd137", 80);
      isTesting = false; isSubmitting = true;
      setTimeout(clickSubmitButton, 2000);
    }
    return;
  }

  if (state === "server_busy") {
    // GFG Server busy — Wait and retry compile
    updateHUD("⏳ GFG Busy - Retrying...", "#fbc531", 75);
    setTimeout(clickCompileButton, 8000); // 8s delay before retry
    return;
  }

  // Handle Errors during Testing/Submitting
  if (state && state !== "accepted" && state !== "compile_success" && !isHandlingError) {
    if (fixAttempts >= MAX_FIX_ATTEMPTS) {
      stopTimer(); 
      updateHUD("❌ Skipping (Retry Limit)", "#e84118", 100);
      setTimeout(navigateToNext, 2000);
      return;
    }
    isHandlingError = true; isTesting = false; isSubmitting = false;
    
    const pane = document.querySelector('[class*="problems_content_pane"]');
    const error_text = pane?.innerText.substring(0, 1500) || "Unknown error";
    const failureData = scrapeFailureDetails();
    
    updateHUD(`🔧 Repairing (${state})`, "#fbc531", 60); fixAttempts++;
    triggerSolve({ 
      error_text, 
      is_logic_error: state === "wrong_answer",
      ...failureData
    });
  }
}

function navigateToNext() {
  updateHUD("⏩ Next problem...", "#764ba2", 0);
  
  function closeAllPanels() {
    // Close the Submissions/Output panels by clicking their X buttons
    const closeBtns = document.querySelectorAll('.problems_header_title__close__W_zJd, [class*="close"], button[aria-label="close"], button[aria-label="Close"]');
    closeBtns.forEach(btn => {
      if (btn.offsetParent !== null && btn.closest('[class*="problems_content"], [class*="output"], [class*="submission"]')) {
        btn.click();
      }
    });
    closePopups();
    
    // Also click the "Problem" tab to switch back from Submissions view
    const problemTab = Array.from(document.querySelectorAll('a, button, div')).find(el => {
      const t = (el.innerText || '').trim();
      return (t === 'Problem' || t === '✎ Problem') && el.offsetParent !== null;
    });
    if (problemTab) problemTab.click();
  }
  
  function tryNavigate() {
    isTesting = false; isSubmitting = false; isHandlingError = false; fixAttempts = 0;
    const currentPath = window.location.pathname;
    
    // Strategy 1: Click the "Next »" or "Next >>" button/link on the page (Universal tag search)
    const nextEls = Array.from(document.querySelectorAll('a, button, div, span, p')).filter(el => {
      if (el.offsetParent === null) return false;
      const txt = (el.innerText || '').trim();
      return txt === 'Next >>' || txt === 'Next »' || txt === 'Next>>' || txt === 'Next»' || txt === 'Next';
    });
    if (nextEls.length > 0) {
      console.log("GFG-AUTO: Navigating via Next button click:", nextEls[0]);
      nextEls[0].click();
      return true;
    }

    // Strategy 3: Find the ">>" / "Next Track" button (Bottom left)
    const allElements = Array.from(document.querySelectorAll('div, button, a, span, p'));
    for (const el of allElements) {
      const txt = (el.innerText || '').trim();
      
      // Match the "Next Track" text directly
      if (txt === 'Next Track' && el.offsetParent !== null) {
        console.log("GFG-AUTO: Found 'Next Track' text, clicking...");
        const clickTarget = el.closest('a, button, [role="button"]') || el.parentElement || el;
        clickTarget.click();
        return true;
      }
      
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join('');
      
      if ((directText === '>>' || directText === '»') && el.offsetParent !== null) {
        console.log("GFG-AUTO: Found >> button, clicking...");
        el.click();
        return true;
      }
    }

    // Strategy 4: CSS class selectors for GFG next/track buttons
    const classSelectors = [
      '[class*="next_track"]', '[class*="nextTrack"]', '[class*="next-track"]',
      'button[class*="sidebar_next"]', '[class*="track_button"]', 'button[class*="problems_next"]',
      '.problems_solve_next_item__IGp_V'
    ];
    for (const sel of classSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        console.log("GFG-AUTO: Navigating via CSS selector:", sel);
        el.click();
        return true;
      }
    }

    // Strategy 5: Broad text search for "Next" variants
    const clickables = Array.from(document.querySelectorAll('button, a, div[onclick], [role="button"]'));
    const nextEl = clickables.find(b => {
      const txt = (b.innerText || '').toLowerCase().trim();
      return (txt === 'solve next' || txt === 'next problem' || txt === 'next track') 
             && b.offsetParent !== null;
    });
    if (nextEl) {
      console.log("GFG-AUTO: Navigating via broad text match:", nextEl.innerText.trim());
      nextEl.click();
      return true;
    }

    // Strategy 6: URL-based fallback (Try to find a problem link on the track page)
    const match = currentPath.match(/\/batch\/([^/]+)\/track\/([^/]+)/);
    if (match && match[1] && match[2]) {
      const allLinks = Array.from(document.querySelectorAll('a[href*="/problem/"]'));
      const validLink = allLinks.find(l => {
          const h = l.getAttribute('href');
          return h && h !== 'undefined' && h !== '#' && h !== currentPath;
      });
      
      if (validLink) {
          console.log("GFG-AUTO: URL fallback — clicking first problem on track page");
          validLink.click();
          return true;
      }
      const trackUrl = `/batch/${match[1]}/track/${match[2]}`;
      console.log("GFG-AUTO: URL fallback — navigating to track page:", trackUrl);
      window.location.href = trackUrl;
      return true;
    }
    
    return false;
  }

  // Step 1: Close all panels immediately
  closeAllPanels();
  
  // Step 2: Wait 1.5s for panels to close, then try navigating
  setTimeout(() => {
    if (!tryNavigate()) {
      console.log("GFG-AUTO: First nav attempt failed, retrying in 3s...");
      updateHUD("⏩ Retrying nav...", "#764ba2", 10);
      // Retry: close panels again and try after 3s
      closeAllPanels();
      setTimeout(() => {
        if (!tryNavigate()) {
          // Last resort: hard reload the current page
          console.log("GFG-AUTO: All nav attempts failed. Hard reloading...");
          updateHUD("🔄 Reloading page...", "#e84118", 0);
          location.reload(true);
        }
      }, 3000);
    }
  }, 1500);
}

// ===================== CORE ACTIONS =====================

function closePopups() {
  // GFG-specific popups, drawers, and overlays
  const closeSelectors = [
    'button[aria-label="close"]',
    'button[aria-label="Close"]',
    '.modal-close',
    '.close-btn',
    'div[class*="drawer"] button[class*="close"]',
    '[class*="popup"] button[class*="close"]',
    '.ui.modal .close',
    '[class*="ProblemDescription_close"]'
  ];
  
  closeSelectors.forEach(selector => {
    const btn = document.querySelector(selector);
    if (btn && btn.offsetParent !== null) {
      btn.click();
      console.log("GFG-AUTO: Auto-closed popup/overlay");
    }
  });

  // Auto-click "OK" on "Request Already Queued" modal
  const modals = document.querySelectorAll('.modal, [class*="modal"], [role="dialog"], .ui.modal');
  modals.forEach(modal => {
    const text = (modal.innerText || '').toLowerCase();
    if (text.includes('request already queued') || text.includes('already in queue') || text.includes('one request in queue')) {
      const okBtn = Array.from(modal.querySelectorAll('button')).find(b => 
        b.innerText.trim() === 'OK' || b.innerText.trim() === 'Ok' || b.innerText.trim() === 'ok'
      );
      if (okBtn) {
        console.log("GFG-AUTO: Auto-clicked OK on 'Request Already Queued' modal");
        okBtn.click();
      }
    }
  });

  // Fallback: find any visible OK button inside any modal/dialog on the page
  const allButtons = Array.from(document.querySelectorAll('button'));
  const okButton = allButtons.find(b => {
    const txt = b.innerText.trim();
    if (txt !== 'OK') return false;
    // Make sure it's inside a modal-like container
    const parent = b.closest('.modal, [class*="modal"], [role="dialog"], .ui.modal, [class*="overlay"]');
    return parent && parent.offsetParent !== null;
  });
  if (okButton) {
    console.log("GFG-AUTO: Auto-clicked OK button in modal");
    okButton.click();
  }
}

async function triggerSolve(extraParams = {}) {
  const btn = document.getElementById('gfg-solve-ai-btn'); if (!btn) return;
  const isFix = !!extraParams.error_text;
  
  // Model Rotation Logic: Sequential Fallback (Index-based)
  let modelIdx = null;
  let modelName = "AI";
  if (modelList.length > 0) {
      modelIdx = fixAttempts % modelList.length;
      modelName = modelList[modelIdx].split('/').pop().split('-')[0]; // Short name e.g. "deepseek" or "qwen"
      extraParams.model_index = modelIdx;
  }

  btn.innerText = isFix ? `🔧 Fixing (${modelName})...` : `⌛ Solving (${modelName})...`; 
  btn.disabled = true;
  updateHUD(isFix ? `🔧 Fixing (${modelName})...` : `🧠 Thinking (${modelName})...`, "#6c5ce7", 40); 
  startTimer(120); 
  
  let editorReturned = false;

  // Timeout fallback in case injected Monaco/Ace unbinds during SPA page transition
  const editorTimeout = setTimeout(() => {
    if (!editorReturned) {
      console.warn("GFG-AUTO: postMessage editor response timed out. Recovering with fallback blank boilerplate.");
      window.removeEventListener("message", onMessage);
      proceedWithSolve("");
    }
  }, 3500);

  const onMessage = async (event) => {
    if (event.data.type === "EDITOR_VALUE_RETURN") {
      editorReturned = true;
      clearTimeout(editorTimeout);
      window.removeEventListener("message", onMessage);
      proceedWithSolve(event.data.value);
    }
  };
  window.addEventListener("message", onMessage);
  window.postMessage({ type: "GET_EDITOR_VALUE" }, "*");

  async function proceedWithSolve(boilerplateCode) {
    try {
      const controller = new AbortController();
      window._gfg_controller = controller; // Store globally for watchdog
      const timeoutId = setTimeout(() => controller.abort(), 125000); // 125s fetch timeout
      
      const response = await fetch(`${BACKEND_URL}/solve`, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          signal: controller.signal,
          body: JSON.stringify({ 
            title: getProblemTitle(), 
            description: getProblemDescription(), 
            boilerplate: boilerplateCode, 
            ...extraParams 
          }) 
      });
      clearTimeout(timeoutId);
      
      const data = await response.json();
      if (data.success) {
        window.postMessage({ type: "SET_EDITOR_VALUE", value: data.code }, "*");
        btn.innerText = '✅ Code Ready'; isHandlingError = false;
        if (autoMode) { 
          updateHUD("📝 Injecting...", "#6c5ce7", 70); 
          isTesting = true; 
          setTimeout(clickCompileButton, 1500); 
        }
        else { stopTimer(); updateHUD("✅ Done!", "#4cd137", 100); hideHUDIn(3000); }
      } else { 
        stopTimer(); 
        const errorMsg = data.error || "AI Failed";
        const isTimeout = errorMsg.toLowerCase().includes("timeout");
        
        if (isTimeout && autoMode) {
            updateHUD("⏳ Timeout (Rotating...)", "#fbc531", 100);
            fixAttempts++; // Force rotation
            isHandlingError = false;
            setTimeout(() => triggerSolve(extraParams), 1000); // RESTART on timeout
            return;
        }

        if (data.is_rate_limit) {
          updateHUD("⏳ Rate Limited (Wait 5s)", "#fbc531", 100);
          fixAttempts++; // Force rotation on rate limit
          if (autoMode) { setTimeout(() => triggerSolve(extraParams), 5000); return; } 
        } else {
          updateHUD(`❌ ${errorMsg}`, "#e84118", 100); 
        }
        isHandlingError = false; 
      }
    } catch (err) { 
      stopTimer(); 
      const isTimeout = err.name === 'AbortError';
      updateHUD(isTimeout ? "⏳ Timeout (Switching...)" : "❌ Error (Retrying...)", "#fbc531", 100); 
      fixAttempts++; // Move to next model
      isHandlingError = false; 
      
      // AUTO-RETRY: If in auto-mode, immediately trigger the NEXT model in the list
      if (autoMode) {
          console.log(`GFG-AUTO Failover: ${isTimeout ? 'Timeout' : 'Error'} occurred. Moving to next model...`);
          setTimeout(() => triggerSolve(extraParams), 1000); 
      }
    }
    btn.disabled = false;
  }
}

function clickCompileButton() {
  let compileBtn = document.querySelector('button[class*="problems_compile_button"]');
  // Ultra-robust text-matching fallback
  if (!compileBtn) {
    compileBtn = Array.from(document.querySelectorAll('button')).find(b => {
      if (b.offsetParent === null) return false;
      const t = b.innerText.trim().toLowerCase();
      return t === 'compile & test' || t === 'compile' || t === 'run code' || t === 'run';
    });
  }

  if (compileBtn) { 
    updateHUD("🧪 Compiling...", "#fbc531", 75); 
    isTesting = true; isSubmitting = false; 
    startTimer(25); 
    compileBtn.click(); 
  } else {
    console.error("GFG-AUTO: Compile button not found!");
  }
}

function clickSubmitButton() {
  let submitBtn = document.querySelector('button[class*="problems_submit_button"], .problems_submit_button__J0vDX, [class*="submit_button"]');
  // Ultra-robust text-matching fallback
  if (!submitBtn) {
    submitBtn = Array.from(document.querySelectorAll('button')).find(b => {
      if (b.offsetParent === null) return false;
      const t = b.innerText.trim().toLowerCase();
      return t === 'submit' || t === 'submit code';
    });
  }

  if (submitBtn) {
    updateHUD("🚀 Final Submit...", "#4cd137", 90); 
    isTesting = false; isSubmitting = true; 
    startTimer(25); 
    submitBtn.click();
  } else {
    console.error("GFG-AUTO: Submit button not found!");
  }
}

function injectButton() {
  if (document.getElementById('gfg-solve-ai-btn')) return;

  let submitBtn = document.querySelector('button[class*="problems_submit_button"]');
  if (!submitBtn) {
    submitBtn = Array.from(document.querySelectorAll('button')).find(b => {
      const t = b.innerText.trim().toLowerCase();
      return t === 'submit' || t === 'submit code';
    });
  }

  if (!submitBtn || !submitBtn.parentElement) return;

  const container = submitBtn.parentElement;
  const btn = document.createElement('button');
  btn.id = 'gfg-solve-ai-btn';
  btn.innerText = '🤖 GFG-Solve-AI';
  btn.className = 'ui button primary';
  btn.style.cssText = `margin-left: 8px; height: 32px; padding: 0 12px; background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%); color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; transition: all 0.2s ease; vertical-align: middle;`;

  btn.onclick = () => triggerSolve();
  container.appendChild(btn);
}

// ===================== INITIALIZATION =====================

const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
(document.head || document.documentElement).appendChild(script);

setInterval(injectButton, 2000);
setInterval(() => { if (autoMode) closePopups(); }, 3000); // Aggressive UI cleanup

// MutationObserver for auto-mode phase detection
const observer = new MutationObserver(() => {
  if (autoMode && !isHandlingError) setTimeout(handleAutoPhase, 500);
});
observer.observe(document.body, { childList: true, subtree: true });

// URL change detection — reset all state on navigation to new problem
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    fixAttempts = 0; isHandlingError = false; isTesting = false; isSubmitting = false;
    stopTimer(); closePopups();
    updateHUD("🆕 New Problem...", "#6c5ce7", 25);
    setTimeout(startAutoSolve, 3500); // Increased delay for GFG SPA stability
  }
}).observe(document, { subtree: true, childList: true });
 
// WHITE SCREEN WATCHDOG — Simple: if blank for 5s, hard refresh (Ctrl+R)
let blankSince = 0;

function checkPageHealth() {
    if (!autoMode) return;
    
    const path = location.pathname;
    
    // Only check on problem pages
    if (!path.includes('/problem/')) {
        blankSince = 0;
        return;
    }
    
    const desc = getProblemDescription();
    const hasEditor = !!document.querySelector('.monaco-editor, .ace_editor, [class*="editor"]');
    const isBlank = (desc === "No desc found" && !hasEditor);
    
    if (isBlank) {
        if (blankSince === 0) {
            blankSince = Date.now();
            console.log("GFG-AUTO: Blank page detected, waiting...");
            return;
        }
        if (Date.now() - blankSince > 5000) {
            console.warn("GFG-AUTO: White screen for 5s. Hard refreshing (Ctrl+R)...");
            updateHUD("🔄 White screen — Refreshing...", "#e84118", 50);
            blankSince = 0;
            location.reload(true); // Hard refresh like Ctrl+R
        }
    } else {
        blankSince = 0;
    }
}

setInterval(checkPageHealth, 2000);
