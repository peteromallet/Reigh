# Local Development Setup

## 🚀 Quick Start (Recommended)

If you just want to get everything running locally as fast as possible, use the provided helper scripts.

1. **Clone the repository and enter it**
   ```bash
   git clone https://github.com/peteromallet/reigh
   cd reigh
   ```
2. **Run the automated setup** (first-time only)
   ```bash
   ./setup.sh
   ```
   This script will:
   • install Node dependencies and seed the local SQLite DB
   • clone the Python server (peteromallet/Headless-Wan2GP) and create its virtual-env
   • install Python dependencies (incl. PyTorch & ffmpeg)
   • create the necessary `.env` / `.env.local` files

   > **Note**
   > • The script expects Node 18+ and Python 3.10 (or `python3`) to be available in your `PATH`.
   > • On Debian/Ubuntu images the script tries `apt-get install python3.10-venv ffmpeg` if you run it with `sudo/root`.
   > • On macOS you should have `ffmpeg` installed via Homebrew (`brew install ffmpeg`).

3. **Launch all services** (every time you want to work)
   ```bash
   ./launch.sh
   ```
   This spawns three background processes and writes their output to log files:
   • `api.log`      – Express API (port 8085)
   • `frontend.log` – Vite dev server (port 2222)
   • `python.log`   – Headless-Wan2GP Python server

   Press `Ctrl+C` in the launch shell to stop everything gracefully.

4. **Check service health (optional)**
   ```bash
   ./check-status.sh
   ```
   A small helper that pings the dev servers and tells you whether they are up.

---

## 📖 Manual / Detailed Setup

<details>
<summary><strong>📖 Manual / Detailed Setup (click to expand)</strong></summary>

> Skip this section if you used the scripts above. The steps below describe what the scripts do under the hood and can be useful if you prefer a manual approach or need to debug.

This guide provides the essential steps to set up and run this project locally using a SQLite database.

## Prerequisites

- Node.js and npm (or yarn) installed.
  - It is recommended to use Node.js version 18 or newer.
  - <details>
    <summary>If you need to install/manage Node.js versions (click to expand)</summary>

    We recommend using [Node Version Manager (nvm)](https://github.com/nvm-sh/nvm) to install and manage Node.js versions.

    1.  **Install nvm:**
        Open your terminal and run the following command:
        ```sh
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
        ```
        Or, if you prefer `wget`:
        ```sh
        wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
        ```
    2.  **Activate nvm:**
        After the installation, you might need to close and reopen your terminal. Alternatively, you can source your shell's configuration file immediately. For example, if you use `zsh` (common on macOS):
        ```sh
        source ~/.zshrc
        ```
        Or for `bash`:
        ```sh
        source ~/.bashrc
        ```
        The nvm installation script usually provides specific instructions for your shell if needed.
    3.  **Install Node.js:**
        Once nvm is active, install the recommended Node.js version (e.g., v18):
        ```sh
        nvm install 18
        nvm use 18
        nvm alias default 18
        ```
    4.  **Verify installation:**
        Check your Node.js and npm versions:
        ```sh
        node -v
        npm -v
        ```
        You should see versions like `v18.x.x` and `10.x.x` (or newer compatible versions).

    </details>
- Git installed.

## Setup Instructions

1.  **Clone the Repository:**
    ```sh    
    git clone https://github.com/peteromallet/reigh
    cd reigh
    ```

2.  **Install Dependencies:**
    ```sh
    npm i
    ```

3.  **Configure Environment for Local SQLite:**
    *   Create a file named `.env.local` in the root of your project.
    *   Add the following line to it:
        ```env
        APP_ENV=local
        ```
    This configures the application to use a local SQLite database (defaulting to `./local.db`).

4.  **Set Up and Seed the Local SQLite Database:**
    Run the following command in your terminal:
    ```sh
    npm run db:seed:sqlite
    ```
    This command will:
    *   Create the `./local.db` file if it doesn't exist.
    *   Create all necessary tables based on the schema defined in `db/migrations-sqlite/0000_clear_rocket_raccoon.sql`.
    *   Populate the database with initial seed data.
    *   You should see a confirmation message like `[Seed] Database seeding completed successfully.` in your terminal.

5.  **Start the Development Servers:**

    You'll need to run two separate commands in two different terminal sessions:

    *   **Frontend Development Server (Vite):**
        ```sh
        npm run dev
        ```
        Your application frontend should now be running (typically at `http://localhost:2222/`).

    *   **Backend API Server (Express.js):**
        ```sh
        npm run start:api
        ```
        This will start your backend server. Check your terminal output for messages indicating the server is running (e.g., listening on a specific port, typically different from the frontend).

    The frontend server will connect to the local SQLite database via the backend API server. Check your frontend terminal output for a message similar to `[DB] Connecting to SQLite at ./local.db via Drizzle...` (this message might appear when the backend server starts, or when the frontend first tries to communicate with it).

    <details>
    <summary>Click to expand for details on running on Runpod</summary>

    When deploying or running the development environment on a hosted platform like Runpod, your frontend and backend will likely be accessible via different public URLs/ports. The Vite development server needs to be told where to proxy API requests.

    *   **Backend API (`npm run start:api`):** This server runs on an internal port (default `8085`). **Note:** On some Runpod setups (or other containerized environments), port `8085` might already be in use (e.g., by a pre-configured Nginx server). If you encounter issues, you may need to change the port your backend API listens on. For this project, this can typically be done in `src/server/index.ts` (e.g., changing `8085` to `6969`). The platform (e.g., Runpod) will then map a public IP and port to this new internal port.
    *   **Frontend Dev Server (`npm run dev`):** This server runs on an internal port (default `2222`). The platform will also map a public IP and port to this. You'll access your app via `http://<your-public-ip>:<public-frontend-port>`.

    To ensure the frontend (served by Vite) can reach the backend API when using Runpod:

    *   Identify the full public URL of your **Runpod backend API server**. This will be `http://<your-runpod-public-ip>:<public-port-mapped-to-your-backend-internal-port>`.
    *   When starting the Vite frontend development server **inside the Runpod container**, set the `VITE_API_TARGET_URL` environment variable to this public backend URL.

    Example (Backend API running on internal port `8085`, publicly accessible via `http://213.173.102.76:10368`):
    ```sh
    # Inside your Runpod container, if your API is on internal port 8085
    # and Runpod maps public 213.173.102.76:10368 to internal 8085:
    VITE_API_TARGET_URL=http://213.173.102.76:10368 npm run dev
    ```
    The Vite dev server (also in the container) will then proxy any requests made from the frontend (e.g., `/api/...`) to `http://213.173.102.76:10368/api/...`.

    *Alternative for intra-container communication:* If both Vite and your API are in the same container, you *should* also be able to use `http://localhost:<your-backend-internal-port>` (e.g., `VITE_API_TARGET_URL=http://localhost:8085 npm run dev`). This targets the API server directly within the container's network. However, ensure your API server is indeed listening on `localhost` (or `0.0.0.0`) on that port and that no other process (like Nginx) is intercepting traffic to that `localhost` port.

    For **purely local development** (both frontend and backend on your local machine, not using Runpod), you typically do not need to set `VITE_API_TARGET_URL`, as the Vite configuration usually defaults to proxying to `http://localhost:8085/api` (or whatever port your local backend is configured to use if you've changed it from the default). Always verify your project's `vite.config.ts` for the precise local default proxy settings.

    **Exposing Ports on Runpod:**

    Runpod handles port exposure in specific ways. The port your application listens on inside the container (e.g., `8085` for the API if you changed it from `8085`, or `2222` for the frontend) will be mapped to a different public-facing port by Runpod.

    *   **HTTP Ports (Proxy):** When you define an HTTP port in your Pod or Template configuration (e.g., port `8085` for your API), Runpod makes it accessible via a proxy URL like `https://{POD_ID}-{INTERNAL_PORT}.proxy.runpod.net`. For example, if your Pod ID is `s7breobom8crgs` and your internal API port is `8085`, the public URL would be `https://s7breobom8crgs-8085.proxy.runpod.net`.
    *   **TCP Ports (Public IP):** If your pod has a public IP, you can expose ports via TCP. You'd add the desired internal port (e.g., `8085`) to the TCP port list in your Pod/Template configuration. Runpod will then assign a public IP and a *different* external port that maps to your internal port. You'll find this mapping in the "Connect" menu of your Pod. For example, `your-public-ip:10368` might map to your internal port `8085`.

    **Crucially, ensure that you have configured Runpod to expose the correct TCP port for your backend API (e.g., `8085` if you changed it from the default `8085`) and TCP port `2222` (for the frontend development server) in your Pod/Template settings.**

    Refer to the official [Runpod documentation on exposing ports](https://docs.runpod.io/pods/configuration/expose-ports) for detailed instructions and diagrams on how to configure this in the Runpod interface (either through the Template or Pod configuration page). You'll need to ensure the ports your application servers listen on (e.g., `8085` for the backend, `2222` for the frontend) are correctly specified in the Runpod settings as either HTTP or TCP ports to make them accessible.

    </details>

---

Your local development environment is now ready. You can access the application in your browser and begin working.
</details>
