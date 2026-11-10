# ⚡ GFG-NVIDIA-AUTO

## Verified scope — 10 November 2026

This repository contains a Manifest V3 GeeksforGeeks extension and a Flask
backend on port 5000. The extension scrapes problem text, requests code, injects
it into the page editor and can click Compile/Submit in auto mode. The backend
can query multiple NVIDIA models and use a model judge; model names and provider
availability were not checked with live calls.

`/solve` and `/solve_evolve` now reject malformed or non-object JSON with HTTP
400 and `{"success": false, ...}` before solver dispatch. Previously null,
arrays and JSON scalars raised `AttributeError` and returned HTTP 500.

```sh
python -m unittest discover -s backend -p test_requests.py -v
node --check extension/content.js
node --check extension/injected.js
node --check extension/popup.js
```

Both offline Flask tests pass, covering invalid input and a synthetic successful
response. Providers and dotenv loading are replaced before import; the test does
not send inference requests, read API keys or interact with GFG accounts. Syntax
checks do not validate current site selectors or automatic submissions.
The code still removes C++ comments using regexes that can truncate `//` inside
string literals. Structured field validation and localhost authentication/CORS
restrictions also remain follow-up work. Browser local storage is not encrypted
secret storage; the existing ignore rules do not prove past commits contain no keys.

![Source review flow diagram, not a runtime screenshot](docs/review-flow.svg)

The diagram describes the implementation. No live GFG submissions, account
sessions, model calls or success-rate benchmarks were run. A real execution
capture requires an explicitly owned fixture/authorized session and provider
configuration; no screenshot is presented as evidence for those boundaries.


An automated, highly-optimized multi-model AI coding solver browser extension for **GeeksforGeeks (GFG)**. Powered by NVIDIA's high-speed inference microservices (NIM), this extension automatically solves coding problems, compiles, handles test cases, learns from failed attempts, and evolves solutions to complete tracks effortlessly.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue.svg?logo=google-chrome&logoColor=white)](#)
[![Python Backend](https://img.shields.io/badge/Python-3.8%2B-green.svg?logo=python&logoColor=white)](#)
[![Flask Server](https://img.shields.io/badge/Flask-Framework-black.svg?logo=flask&logoColor=white)](#)
[![NVIDIA NIM](https://img.shields.io/badge/NVIDIA-NIM%20AI-76B900.svg?logo=nvidia&logoColor=white)](#)

---

## ✨ Key Features

- **🚀 Autopilot Solving**: Automatically scrapes problem descriptions, injects optimized C++ solutions, compiles, handles errors, and navigates to the next challenge in the track.
- **🧠 Multi-Model Consensus & LLM Judge**: Races multiple top-tier open models in parallel (Llama 3.3, Qwen 2.5 Coder, Nemotron) and lets a dedicated LLM Judge inspect and select the most correct and efficient solution.
- **🔧 Self-Correction & Evolution**: Scrapes failing input/output data, compiler messages, or runtime errors, and executes up to 25 context-aware repair cycles with full history memory.
- **⚙️ Hot-Reloadable CSS Selector overrides**: GFG frequently updates its CSS module class hashes. Built-in expandable settings drawer in the extension popup lets you change CSS selectors on-the-fly, backed by ultra-robust text-matching fallbacks.
- **🛡️ Plug-and-Play Security**: No hardcoded API keys! Enter your NVIDIA API key directly in the Chrome Popup (saved securely in local browser storage) or keep it in the backend `.env`.

---

## 🛠️ Prerequisites

1. **Python 3.8+** installed on your system.
2. **Google Chrome** (or any Chromium-based browser like Brave/Edge).
3. **NVIDIA API Key** (Get a free key with 1,000+ free request credits at [NVIDIA Build NIMs](https://build.nvidia.com/)).

---

## 🚀 Installation & Setup

### Step 1: Clone and Set Up the Backend Server

The backend runs a lightweight Flask server that handles communication with NVIDIA APIs, manages model rotation, and executes the LLM judge.

#### On Windows:
1. Double-click the **`start_backend.bat`** script in the project root.
2. This script will automatically create a Python virtual environment, activate it, install all dependencies (`requirements.txt`), and run the server on `http://127.0.0.1:5000`.

#### On macOS / Linux:
1. Open a terminal in the project directory.
2. Make the script executable and run it:
   ```bash
   chmod +x start_backend.sh
   ./start_backend.sh
   ```
3. The script sets up your virtual environment and starts the server on port `5000`.

*(Optional: Copy `backend/.env.example` to `backend/.env` and insert your `NVIDIA_API_KEY` there, or proceed to the next step to configure it directly in the browser!)*

---

### Step 2: Install the Chrome Extension

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click the **Load unpacked** button in the top-left corner.
4. Select the **`extension`** folder inside the cloned project directory.
5. Click the Extension Pin icon in Chrome and pin **GFG-NVIDIA-AUTO** to your toolbar.

---

### Step 3: Configure Your API Key

1. Click the **GFG-NVIDIA-AUTO** icon (⚡) in your browser toolbar.
2. Click the gear icon (**⚙️**) in the top-right corner to slide open the Settings panel.
3. Paste your **NVIDIA API Key** (`nvapi-...`) into the input field.
4. Click **Save Settings**.
5. Check the **Backend Connection** card in the popup. It should change to a green **Connected** status.

---

## 🤖 How to Use

1. Navigate to any GeeksforGeeks practice problem or batch track (e.g. `https://practice.geeksforgeeks.org/problems/...`).
2. **Manual Mode**: You will see a new gradient-colored **🤖 GFG-Solve-AI** button next to the standard GFG "Submit" button. Click it to trigger a single solve.
3. **Auto Mode**:
   - Open the extension popup (⚡).
   - Toggle **Auto-Solve Mode** to **ON**.
   - Watch the HUD (Heads-Up Display) in the top-right corner of the page. It will automatically initialize, write the code, compile, run tests, fix any logic bugs, submit, and transition to the next challenge!

---

## 🔧 Dynamic CSS Selectors Configuration

If GeeksforGeeks releases a major design overhaul, some buttons or headers might stop working. You can easily adapt **without modifying any extension files**:

1. Click the gear icon (**⚙️**) in the extension popup.
2. Find the **GFG CSS Selectors** section.
3. Replace the selectors with the new CSS classes or IDs from GFG.
   *Example: If the submit button selector changes, inspect GFG's page (Right click button -> Inspect) and update the **Submit Button** input to the new selector.*
4. Click **Save Settings**. The extension will immediately reload these values!

> [!TIP]
> **Text-Matching Fallback**: The extension has built-in fallback rules. If it cannot find buttons using CSS selectors, it will automatically search for elements containing keywords like `"Submit"`, `"Compile"`, or `"Run Code"`, making it incredibly durable!

---

## 📦 Directory Structure

```filepath
gfg-auto/
├── extension/             # Chrome Extension Files
│   ├── manifest.json      # Extension metadata
│   ├── content.js         # Scrapes page and manages GFG interaction
│   ├── injected.js        # Editor interface (Monaco/Ace) injector
│   ├── popup.html         # Beautiful extension interface & settings
│   └── popup.js           # popup state syncing & backend pinger
├── backend/               # Flask API Server Files
│   ├── main.py            # API routing & race logic
│   ├── solvers.py         # NVIDIA API call handlers
│   ├── judge.py           # LLM consensus judge logic
│   ├── requirements.txt   # Backend dependencies
│   ├── .env.example       # Blank environment template
│   └── .env               # Local environment configuration (Git-ignored)
├── start_backend.bat      # Windows bootstrapper
├── start_backend.sh       # Unix bootstrapper
└── .gitignore             # Safety guard (keeps API keys off GitHub)
```

---

## 🛡️ Security Disclaimer

- **Never commit your API keys**: The `.env` file containing local API keys is ignored by Git by default (`.gitignore` included). 
- **Browser Local Storage**: If you enter the API key in the extension popup, it is stored in Chrome's `chrome.storage.local` sandbox which is strictly private to your browser instance.
- For educational and personal productivity use only. Respect GeeksforGeeks' Terms of Service when using automated tools.

---

*Made with 💜 for developers who want to learn faster and master algorithms.*
